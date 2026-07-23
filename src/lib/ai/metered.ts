import "server-only";

/**
 * metered.ts — the metered-AI wrapper (Phase-3 slice S1 frozen contract, issue
 * #96). Every quota-consuming model call in the app goes through runMeteredAi;
 * routes assemble inputs + map the result, but NEVER call checkAndIncrement,
 * refundUsage, generatePlan, or generateReplan directly.
 *
 *   DRIFT RULE — routes never call checkAndIncrement / refundUsage /
 *   generatePlan / generateReplan directly. The wrapper is the only caller,
 *   so the meter/refund/timeout invariants live in exactly one place.
 *
 * Shape of a metered call:
 *   1. METER FIRST (after the route's cheap rejections): checkAndIncrement.
 *      A cap hit returns before any model spend.
 *   2. Capture `periodStart` and close over it — a failure that straddles
 *      local midnight on the 1st refunds the row the increment HIT, not the
 *      new month's row.
 *   3. Outer bound: AbortSignal.timeout(80_000) threaded into `call`. On fire
 *      the SDK throws APIUserAbortError → classified as `timeout` (504).
 *   4. Boundary #1 = the model call; Boundary #2 = persist. A throw from
 *      either refunds; a persist RESULT (e.g. replan's {kind:"decided"}) is a
 *      success, not an error — the route maps it, no refund.
 *   5. settle() = refund (validation_limited mode ONLY for output_invalid) +
 *      a structured `quota_refund` log line + a guarded onFailure cleanup
 *      (its own errors are swallowed + logged, never masking the AI failure).
 *
 * BUDGET ARITHMETIC (frozen): the outer abort is 80s. AI_REQUEST_OPTIONS caps
 * each single request at 60s with 1 retry; the hard 80s abort cuts the
 * retry-after sleep so total model time is provably < 80s < maxDuration=90 on
 * both routes. Residual risk (accepted): a platform kill at exactly 90s can
 * strand ≤1 increment; it self-corrects at the month reset.
 */
import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  RateLimitError,
  InternalServerError,
} from "./client";
import { PlanUnavailableError, PlanValidationError } from "./plan";
import { ReplanUnavailableError, ReplanValidationError } from "./replan";
import { logAiError } from "./log";
import {
  checkAndIncrement,
  refundUsage,
  type MeteredKind,
  type RefundMode,
} from "@/lib/billing/usage";

/** Hard outer abort — provably inside maxDuration=90 on both metered routes. */
const HARD_ABORT_MS = 80_000;

// ---------------------------------------------------------------------------
// Failure taxonomy (D1 — C1..C9)
// ---------------------------------------------------------------------------

export type AiFailureClass =
  | "not_configured" // C1 — 503
  | "timeout" // C2 — 504
  | "transport" // C3 — 503
  | "upstream_rate_limited" // C4 — 503
  | "upstream_unavailable" // C5 — 503
  | "request_rejected" // C6 — 500
  | "output_invalid" // C7 — 502 (rate-limited refund)
  | "persist_failed" // C8 — 500
  | "internal"; // C9 — 500

export interface AiFailureOutcome {
  class: AiFailureClass;
  /** HTTP status the route returns for this class. */
  status: number;
  /** How refundUsage is invoked — validation_limited ONLY for output_invalid. */
  refundMode: RefundMode;
}

/**
 * Wraps a throw from the persist boundary (#2) so the single classifier can
 * emit persist_failed without a second code path. Boundary-determined, not
 * error-shape-determined — a persist can throw anything.
 */
export class MeteredPersistError extends Error {
  constructor(readonly cause: unknown) {
    super("metered persist failed");
    this.name = "MeteredPersistError";
  }
}

function outcome(
  cls: AiFailureClass,
  status: number,
  refundMode: RefundMode = "unconditional",
): AiFailureOutcome {
  return { class: cls, status, refundMode };
}

/**
 * Classify a thrown error into the C1..C9 taxonomy. instanceof order is
 * load-bearing: the SDK's timeout/abort classes subclass APIError (and the
 * connection-timeout subclasses APIConnectionError), so the most specific
 * checks come first and generic `APIError` is the 4xx catch-all (C6).
 */
export function classifyAiFailure(err: unknown): AiFailureOutcome {
  // C1 — our "no client configured" sentinels.
  if (err instanceof PlanUnavailableError || err instanceof ReplanUnavailableError) {
    return outcome("not_configured", 503);
  }
  // C7 — our Zod gate. The ONLY rate-limited refund.
  if (err instanceof PlanValidationError || err instanceof ReplanValidationError) {
    return outcome("output_invalid", 502, "validation_limited");
  }
  // C8 — a throw from the persist boundary (wrapped by runMeteredAi).
  if (err instanceof MeteredPersistError) {
    return outcome("persist_failed", 500);
  }
  // C2 — single-request timeout OR the outer 80s abort. Check the timeout
  // subclass + the abort class before their APIConnectionError/APIError bases.
  if (err instanceof APIConnectionTimeoutError || err instanceof APIUserAbortError) {
    return outcome("timeout", 504);
  }
  // C3 — non-timeout transport failure.
  if (err instanceof APIConnectionError) {
    return outcome("transport", 503);
  }
  // C4 — provider 429.
  if (err instanceof RateLimitError) {
    return outcome("upstream_rate_limited", 503);
  }
  // C5 — provider >= 500 (incl. 529 overloaded).
  if (err instanceof InternalServerError) {
    return outcome("upstream_unavailable", 503);
  }
  // C6 — any other APIError (a 4xx we shouldn't have sent — our bug).
  if (err instanceof APIError) {
    return outcome("request_rejected", 500);
  }
  // C9 — anything else.
  return outcome("internal", 500);
}

// ---------------------------------------------------------------------------
// Response matrix — constant bodies; the ONLY JSON error body is the 402
// cap_hit the routes build themselves. All 5xx/502/504 stay constant text.
// ---------------------------------------------------------------------------

const KIND_NOUN: Record<"plan" | "replan", string> = {
  plan: "Plan",
  replan: "Replan",
};

/** The exact status + constant body a route returns for a classified failure. */
export function meteredErrorResponse(
  o: AiFailureOutcome,
  kindLabel: "plan" | "replan",
): Response {
  const noun = KIND_NOUN[kindLabel];
  let body: string;
  switch (o.status) {
    case 503:
      body = "AI service unavailable.";
      break;
    case 504:
      body = "AI service timed out. Try again.";
      break;
    default: // 502 (output_invalid) and 500 (request_rejected/persist/internal)
      body = `${noun} generation failed.`;
      break;
  }
  return new Response(body, { status: o.status });
}

// ---------------------------------------------------------------------------
// The wrapper
// ---------------------------------------------------------------------------

export type MeteredResult<P> =
  | { ok: true; value: P }
  | { ok: false; capped: true; cap: number; used: number }
  | { ok: false; capped: false; outcome: AiFailureOutcome };

export interface RunMeteredAiArgs<R, P> {
  userId: string;
  kind: MeteredKind;
  /** Boundary #1 — the model call; receives the outer 80s abort signal. */
  call: (signal: AbortSignal) => Promise<R>;
  /** Boundary #2 — persist the model result. A THROW refunds; a returned
   *  value (any shape, incl. a "decided" marker) is a success the route maps. */
  persist: (result: R) => Promise<P>;
  /** Guarded cleanup on ANY failure (e.g. delete a stranded placeholder). Its
   *  own errors are swallowed + logged — never mask the original failure. */
  onFailure?: (o: AiFailureOutcome) => Promise<void>;
}

async function settle(
  userId: string,
  kind: MeteredKind,
  periodStart: string,
  o: AiFailureOutcome,
  onFailure?: (o: AiFailureOutcome) => Promise<void>,
): Promise<void> {
  const refund = await refundUsage(userId, kind, periodStart, o.refundMode);
  // Structured quota_refund line — no user_id (log.ts convention).
  console.info(
    JSON.stringify({
      event: "quota_refund",
      op: kind,
      class: o.class,
      refunded: refund.refunded,
      ...(refund.reason ? { reason: refund.reason } : {}),
    }),
  );
  if (onFailure) {
    try {
      await onFailure(o);
    } catch (cleanupErr) {
      console.error(
        JSON.stringify({
          event: "quota_cleanup_error",
          op: kind,
          class: o.class,
          message:
            cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr),
        }),
      );
    }
  }
}

/**
 * Meter → model call → persist, with refund-on-failure. See the file header
 * for the full contract. Throws only NoLiveUserError (from the meter) — the
 * route maps it to 401; every other failure is a returned outcome.
 */
export async function runMeteredAi<R, P>(
  args: RunMeteredAiArgs<R, P>,
): Promise<MeteredResult<P>> {
  const { userId, kind } = args;

  const gate = await checkAndIncrement(userId, kind);
  if (!gate.ok) {
    return { ok: false, capped: true, cap: gate.cap, used: gate.used };
  }
  const periodStart = gate.periodStart;

  // Boundary #1 — model call under the hard outer abort.
  let modelResult: R;
  try {
    modelResult = await args.call(AbortSignal.timeout(HARD_ABORT_MS));
  } catch (err) {
    const o = classifyAiFailure(err);
    // Raw provider/validation error stays server-side (a ReplanValidationError
    // carries the raw model output); the client only sees the constant body.
    // not_configured is a deploy misconfiguration (key unset), not a model
    // failure — don't spam ai_error on every request when the key is missing.
    if (o.class !== "not_configured") logAiError(kind, err);
    await settle(userId, kind, periodStart, o, args.onFailure);
    return { ok: false, capped: false, outcome: o };
  }

  // Boundary #2 — persist. A throw is C8; a returned value is a success.
  let value: P;
  try {
    value = await args.persist(modelResult);
  } catch (err) {
    logAiError(kind, err);
    const o = classifyAiFailure(new MeteredPersistError(err));
    await settle(userId, kind, periodStart, o, args.onFailure);
    return { ok: false, capped: false, outcome: o };
  }

  return { ok: true, value };
}
