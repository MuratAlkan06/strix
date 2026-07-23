/**
 * metered.ts tests — the C1..C9 failure classifier, the constant-body response
 * matrix, and the runMeteredAi wrapper (Phase-3 slice S1 frozen contract, issue
 * #96). Real Anthropic SDK error classes (re-exported through the ADR-0001
 * chokepoint @/lib/ai/client) drive the classifier so the instanceof ordering
 * is proven against genuine class identities, not stand-ins.
 *
 * The billing gate (@/lib/billing/usage) is mocked so the wrapper's meter →
 * call → persist → settle path is exercised in isolation: checkAndIncrement
 * drives ok/cap and NoLiveUserError propagation; refundUsage records the
 * (userId, kind, periodStart, mode) tuple the wrapper threads. The real
 * increment/refund SQL semantics live in usage.test.ts / usage.integration.
 *
 * Coverage note vs. the route tests (plan/replan/route.test.ts): those run the
 * REAL wrapper + classifier end-to-end for C1 (503), C7 (502 validation_limited)
 * and C9 (500), plus the 402 cap short-circuit and unconditional-refund
 * threading. This file adds the classes the routes never surface with genuine
 * SDK errors — C2/C3/C4/C5/C6/C8 — and the wrapper edge cases (captured
 * periodStart, Pro/Max empty-period threading, onFailure-throw swallowed,
 * NoLiveUserError propagation, the request-option pin).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks (hoisted above imports by vitest) --------------------------------

const checkAndIncrementMock = vi.fn();
const refundUsageMock = vi.fn();
vi.mock("@/lib/billing/usage", async (importOriginal) => {
  // Keep the real NoLiveUserError + constants; override only the two DB fns.
  const actual = await importOriginal<typeof import("@/lib/billing/usage")>();
  return {
    ...actual,
    checkAndIncrement: (...args: unknown[]) => checkAndIncrementMock(...args),
    refundUsage: (...args: unknown[]) => refundUsageMock(...args),
  };
});

const logAiErrorMock = vi.fn();
vi.mock("@/lib/ai/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/log")>();
  return { ...actual, logAiError: (...args: unknown[]) => logAiErrorMock(...args) };
});

// --- imports under test (after mocks) ---------------------------------------

import {
  classifyAiFailure,
  meteredErrorResponse,
  runMeteredAi,
  MeteredPersistError,
  type AiFailureClass,
} from "./metered";
import {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  RateLimitError,
  InternalServerError,
  AI_REQUEST_OPTIONS,
} from "./client";
import { PlanUnavailableError, PlanValidationError } from "./plan";
import { ReplanUnavailableError, ReplanValidationError } from "./replan";
import { NoLiveUserError } from "@/lib/billing/usage";

// ---------------------------------------------------------------------------
// The C1..C9 taxonomy — one instanceof per error, most-specific first.
// ---------------------------------------------------------------------------

describe("classifyAiFailure — C1..C9", () => {
  const cases: Array<{
    name: string;
    err: unknown;
    cls: AiFailureClass;
    status: number;
    refundMode: "unconditional" | "validation_limited";
  }> = [
    {
      name: "C1 not_configured — PlanUnavailableError",
      err: new PlanUnavailableError(),
      cls: "not_configured",
      status: 503,
      refundMode: "unconditional",
    },
    {
      name: "C1 not_configured — ReplanUnavailableError",
      err: new ReplanUnavailableError(),
      cls: "not_configured",
      status: 503,
      refundMode: "unconditional",
    },
    {
      name: "C7 output_invalid — PlanValidationError (the only validation_limited refund)",
      err: new PlanValidationError("equipment: exactly one required"),
      cls: "output_invalid",
      status: 502,
      refundMode: "validation_limited",
    },
    {
      name: "C7 output_invalid — ReplanValidationError",
      err: new ReplanValidationError("recurring_tasks.add.0.weekday: too big", {
        bad: "output",
      }),
      cls: "output_invalid",
      status: 502,
      refundMode: "validation_limited",
    },
    {
      name: "C8 persist_failed — MeteredPersistError wraps a persist throw",
      err: new MeteredPersistError(new Error("db down")),
      cls: "persist_failed",
      status: 500,
      refundMode: "unconditional",
    },
    {
      name: "C2 timeout — APIConnectionTimeoutError (single-request timeout)",
      err: new APIConnectionTimeoutError(),
      cls: "timeout",
      status: 504,
      refundMode: "unconditional",
    },
    {
      name: "C2 timeout — APIUserAbortError (the outer 80s abort fired)",
      err: new APIUserAbortError(),
      cls: "timeout",
      status: 504,
      refundMode: "unconditional",
    },
    {
      name: "C3 transport — APIConnectionError (non-timeout)",
      err: new APIConnectionError({ message: "socket hang up" }),
      cls: "transport",
      status: 503,
      refundMode: "unconditional",
    },
    {
      name: "C4 upstream_rate_limited — RateLimitError (429)",
      err: new RateLimitError(429, undefined, "Rate limited", new Headers()),
      cls: "upstream_rate_limited",
      status: 503,
      refundMode: "unconditional",
    },
    {
      name: "C5 upstream_unavailable — InternalServerError with 529 (overloaded)",
      err: new InternalServerError(529, undefined, "Overloaded", new Headers()),
      cls: "upstream_unavailable",
      status: 503,
      refundMode: "unconditional",
    },
    {
      name: "C5 upstream_unavailable — InternalServerError with 500",
      err: new InternalServerError(500, undefined, "Server error", new Headers()),
      cls: "upstream_unavailable",
      status: 503,
      refundMode: "unconditional",
    },
    {
      name: "C6 request_rejected — a bare 4xx APIError (our bug)",
      err: new APIError(400, undefined, "Bad request", new Headers()),
      cls: "request_rejected",
      status: 500,
      refundMode: "unconditional",
    },
    {
      name: "C9 internal — a plain Error",
      err: new Error("something unexpected"),
      cls: "internal",
      status: 500,
      refundMode: "unconditional",
    },
    {
      name: "C9 internal — a non-Error throw (string)",
      err: "boom",
      cls: "internal",
      status: 500,
      refundMode: "unconditional",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const out = classifyAiFailure(c.err);
      expect(out).toEqual({
        class: c.cls,
        status: c.status,
        refundMode: c.refundMode,
      });
    });
  }

  it("the timeout subclass wins over its APIConnectionError base (ordering is load-bearing)", () => {
    // APIConnectionTimeoutError extends APIConnectionError — a naive base-first
    // check would misclassify it as C3 transport instead of C2 timeout.
    const err = new APIConnectionTimeoutError();
    expect(err).toBeInstanceOf(APIConnectionError);
    expect(classifyAiFailure(err).class).toBe("timeout");
  });
});

// ---------------------------------------------------------------------------
// Response matrix — constant bodies (the 402 cap_hit is the ONLY JSON body,
// built by the routes, never here).
// ---------------------------------------------------------------------------

describe("meteredErrorResponse — constant status+body matrix", () => {
  const outcome = (status: number) => ({
    class: "internal" as AiFailureClass,
    status,
    refundMode: "unconditional" as const,
  });

  it("503 → constant 'AI service unavailable.'", async () => {
    const res = meteredErrorResponse(outcome(503), "plan");
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("AI service unavailable.");
  });

  it("504 → constant 'AI service timed out. Try again.'", async () => {
    const res = meteredErrorResponse(outcome(504), "replan");
    expect(res.status).toBe(504);
    expect(await res.text()).toBe("AI service timed out. Try again.");
  });

  it("502 → the kind's constant '<Noun> generation failed.'", async () => {
    expect(await meteredErrorResponse(outcome(502), "plan").text()).toBe(
      "Plan generation failed.",
    );
    expect(await meteredErrorResponse(outcome(502), "replan").text()).toBe(
      "Replan generation failed.",
    );
  });

  it("500 → the kind's constant '<Noun> generation failed.'", async () => {
    const plan = meteredErrorResponse(outcome(500), "plan");
    expect(plan.status).toBe(500);
    expect(await plan.text()).toBe("Plan generation failed.");
    const replan = meteredErrorResponse(outcome(500), "replan");
    expect(replan.status).toBe(500);
    expect(await replan.text()).toBe("Replan generation failed.");
  });
});

// ---------------------------------------------------------------------------
// The wrapper — meter → call → persist → settle(refund + log + onFailure).
// ---------------------------------------------------------------------------

describe("runMeteredAi — wrapper behaviors", () => {
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    checkAndIncrementMock.mockReset();
    refundUsageMock.mockReset();
    refundUsageMock.mockResolvedValue({ refunded: true });
    logAiErrorMock.mockReset();
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    infoSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("cap hit short-circuits: no model call, no persist, no refund", async () => {
    checkAndIncrementMock.mockResolvedValue({ ok: false, cap: 3, used: 3 });
    const call = vi.fn();
    const persist = vi.fn();

    const result = await runMeteredAi({
      userId: "u1",
      kind: "plan",
      call,
      persist,
    });

    expect(result).toEqual({ ok: false, capped: true, cap: 3, used: 3 });
    expect(call).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(refundUsageMock).not.toHaveBeenCalled();
  });

  it("happy path: returns the persisted value; no refund on success", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    const result = await runMeteredAi({
      userId: "u1",
      kind: "plan",
      call: async () => "raw",
      persist: async (raw) => ({ persisted: raw }),
    });
    expect(result).toEqual({ ok: true, value: { persisted: "raw" } });
    expect(refundUsageMock).not.toHaveBeenCalled();
  });

  it("threads the outer AbortSignal into the model call", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    let seen: unknown;
    await runMeteredAi({
      userId: "u1",
      kind: "plan",
      call: async (signal) => {
        seen = signal;
        return "ok";
      },
      persist: async (r) => r,
    });
    expect(seen).toBeInstanceOf(AbortSignal);
  });

  it("refunds on the CAPTURED periodStart (not 'now') and logs quota_refund without a user_id", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-06-01", // the row the increment hit
    });
    const result = await runMeteredAi({
      userId: "u1",
      kind: "replan",
      call: async () => {
        throw new APIConnectionError({ message: "reset" });
      },
      persist: async (r) => r,
    });

    expect(result).toEqual({
      ok: false,
      capped: false,
      outcome: { class: "transport", status: 503, refundMode: "unconditional" },
    });
    // Refund targets the captured period, unconditional mode.
    expect(refundUsageMock).toHaveBeenCalledWith(
      "u1",
      "replan",
      "2026-06-01",
      "unconditional",
    );
    // Structured log line: quota_refund shape, and PII-free (no user_id).
    const line = infoSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((s: string) => s.includes("quota_refund"));
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line as string);
    expect(parsed).toMatchObject({
      event: "quota_refund",
      op: "replan",
      class: "transport",
      refunded: true,
    });
    expect(parsed).not.toHaveProperty("user_id");
  });

  it("Pro/Max not-metered: threads the empty periodStart sentinel into the refund", async () => {
    checkAndIncrementMock.mockResolvedValue({ ok: true, periodStart: "" });
    await runMeteredAi({
      userId: "pro_user",
      kind: "plan",
      call: async () => {
        throw new APIConnectionTimeoutError();
      },
      persist: async (r) => r,
    });
    // The wrapper always calls refundUsage; the "" sentinel makes refundUsage
    // itself short-circuit as not_metered (proven in usage.test.ts).
    expect(refundUsageMock).toHaveBeenCalledWith(
      "pro_user",
      "plan",
      "",
      "unconditional",
    );
  });

  it("timeout via APIUserAbortError → outcome timeout(504), unconditional refund, logged", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    const result = await runMeteredAi({
      userId: "u1",
      kind: "plan",
      call: async () => {
        throw new APIUserAbortError();
      },
      persist: async (r) => r,
    });
    expect(result).toEqual({
      ok: false,
      capped: false,
      outcome: { class: "timeout", status: 504, refundMode: "unconditional" },
    });
    expect(refundUsageMock).toHaveBeenCalledWith(
      "u1",
      "plan",
      "2026-07-01",
      "unconditional",
    );
    expect(logAiErrorMock).toHaveBeenCalledTimes(1);
  });

  it("output_invalid (Zod gate) → validation_limited refund mode", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    const result = await runMeteredAi({
      userId: "u1",
      kind: "plan",
      call: async () => {
        throw new PlanValidationError("bad shape");
      },
      persist: async (r) => r,
    });
    expect(result).toMatchObject({
      ok: false,
      capped: false,
      outcome: { class: "output_invalid", status: 502 },
    });
    expect(refundUsageMock).toHaveBeenCalledWith(
      "u1",
      "plan",
      "2026-07-01",
      "validation_limited",
    );
  });

  it("not_configured (C1) is NOT logged via logAiError (key-unset noise suppression)", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    const result = await runMeteredAi({
      userId: "u1",
      kind: "plan",
      call: async () => {
        throw new PlanUnavailableError();
      },
      persist: async (r) => r,
    });
    expect(result).toMatchObject({
      outcome: { class: "not_configured", status: 503 },
    });
    // Still refunds unconditionally…
    expect(refundUsageMock).toHaveBeenCalledWith(
      "u1",
      "plan",
      "2026-07-01",
      "unconditional",
    );
    // …but does not spam ai_error on every request when the key is missing.
    expect(logAiErrorMock).not.toHaveBeenCalled();
  });

  it("a persist THROW is C8 persist_failed(500), refunded unconditionally, logged", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    const call = vi.fn(async () => "raw");
    const result = await runMeteredAi({
      userId: "u1",
      kind: "replan",
      call,
      persist: async () => {
        throw new Error("insert exploded");
      },
    });
    expect(call).toHaveBeenCalledTimes(1); // the model call succeeded…
    expect(result).toEqual({
      ok: false,
      capped: false,
      outcome: {
        class: "persist_failed",
        status: 500,
        refundMode: "unconditional",
      },
    });
    expect(refundUsageMock).toHaveBeenCalledWith(
      "u1",
      "replan",
      "2026-07-01",
      "unconditional",
    );
    expect(logAiErrorMock).toHaveBeenCalledTimes(1);
  });

  it("runs onFailure cleanup on failure, passing the outcome", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    const onFailure = vi.fn(async () => {});
    await runMeteredAi({
      userId: "u1",
      kind: "replan",
      call: async () => {
        throw new APIConnectionTimeoutError();
      },
      persist: async (r) => r,
      onFailure,
    });
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.objectContaining({ class: "timeout", status: 504 }),
    );
  });

  it("an onFailure that THROWS is swallowed (never masks the AI failure) and logged as quota_cleanup_error", async () => {
    checkAndIncrementMock.mockResolvedValue({
      ok: true,
      periodStart: "2026-07-01",
    });
    const result = await runMeteredAi({
      userId: "u1",
      kind: "replan",
      call: async () => {
        throw new APIConnectionError({ message: "down" });
      },
      persist: async (r) => r,
      onFailure: async () => {
        throw new Error("cleanup blew up");
      },
    });
    // The original failure outcome is returned unchanged.
    expect(result).toMatchObject({
      ok: false,
      capped: false,
      outcome: { class: "transport", status: 503 },
    });
    // The cleanup error is logged, not thrown.
    const cleanupLine = errorSpy.mock.calls
      .map((c: unknown[]) => String(c[0]))
      .find((s: string) => s.includes("quota_cleanup_error"));
    expect(cleanupLine).toBeTruthy();
    expect(JSON.parse(cleanupLine as string)).toMatchObject({
      event: "quota_cleanup_error",
      op: "replan",
    });
  });

  it("propagates NoLiveUserError from the meter (never swallowed as an outcome)", async () => {
    checkAndIncrementMock.mockRejectedValue(new NoLiveUserError());
    const call = vi.fn();
    await expect(
      runMeteredAi({ userId: "gone", kind: "plan", call, persist: async (r) => r }),
    ).rejects.toBeInstanceOf(NoLiveUserError);
    // Never reached the model call, never refunded.
    expect(call).not.toHaveBeenCalled();
    expect(refundUsageMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Request-option pin — the per-request timeout/retry budget the routes thread
// into messages.parse (proven present at the call site by plan/replan tests;
// the signal reaches the model call, asserted above and in the route tests).
// ---------------------------------------------------------------------------

describe("AI_REQUEST_OPTIONS — the frozen per-request budget", () => {
  it("pins { timeout: 60_000, maxRetries: 1 }", () => {
    expect(AI_REQUEST_OPTIONS).toEqual({ timeout: 60_000, maxRetries: 1 });
  });
});
