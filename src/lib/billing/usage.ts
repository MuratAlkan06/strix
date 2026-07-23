import "server-only";

/**
 * usage.ts — the Free-tier quota gate (SPEC §10; Phase-3 slice S1, issue #96).
 *
 * checkAndIncrement is a SINGLE atomic conditional UPDATE (no read-then-write
 * TOCTOU window): the `WHERE … AND used < limit` clause is what makes two
 * concurrent requests unable to both pass — Postgres serializes the row-level
 * UPDATE and only one increment lands per free slot. It goes through scopedDb
 * (usage_counters is a direct-ownership table; the counter columns are not
 * forbidden keys), never unscopedDb — this is single-user work.
 *
 * refundUsage is the failure-path counterpart: when a metered AI call fails
 * AFTER a successful increment, a 502/503/504/500 must not burn a Free user's
 * monthly quota. It NEVER throws (a broken refund must not mask the original
 * failure), targets the periodStart captured AT increment time (a failure
 * straddling local midnight on the 1st must not touch the new month's row),
 * and floors at 0 (`AND col > 0`) so a double-refund can't drive a counter
 * negative and silently satisfy `used < limit` forever.
 *
 * Pro/Max pass through uncapped: checkAndIncrement returns
 * `{ ok: true, periodStart: "" }` and refundUsage short-circuits on the empty
 * periodStart as `not_metered` BEFORE any DB access.
 */
import { and, eq, sql } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { usage_counters } from "@/db/schema";
import { monthStartFor, monthEndFor } from "./period";
import {
  freeLimitFor,
  VALIDATION_REFUND_LIMIT,
  type MeteredKind,
} from "./usage-limits";

export {
  FREE_PLAN_GENERATION_LIMIT,
  FREE_REPLAN_LIMIT,
  VALIDATION_REFUND_LIMIT,
  CAP_KIND_LABEL,
  freeLimitFor,
  type MeteredKind,
} from "./usage-limits";

/**
 * Thrown by checkAndIncrement when getSelf() is null — the session no longer
 * maps to a live users row (soft-deleted). Soft-deleted users cannot consume
 * quota; the route translates this into a 401 at the boundary.
 */
export class NoLiveUserError extends Error {
  constructor() {
    super("no live user — a soft-deleted user cannot consume quota");
    this.name = "NoLiveUserError";
  }
}

export type CheckAndIncrementResult =
  | { ok: true; periodStart: string }
  | { ok: false; cap: number; used: number };

export type RefundMode = "unconditional" | "validation_limited";

export interface RefundResult {
  refunded: boolean;
  /** Present only when refunded=false: why the decrement was a no-op. */
  reason?: "not_metered" | "floor" | "rate_limited" | "error";
}

/**
 * True for a Postgres unique-constraint violation (23505), wherever the
 * driver/ORM left the code — mirrors check-task.ts's recognizer. Used to turn
 * ensureCurrentMonthCounter's insert into a get-or-create against the
 * (user_id, period_start) unique index.
 */
function isUniqueViolation(err: unknown, depth = 0): boolean {
  if (depth > 3 || typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  if (
    typeof e.message === "string" &&
    e.message.includes("usage_counters_user_period_uniq")
  ) {
    return true;
  }
  return isUniqueViolation(e.cause, depth + 1);
}

/** The current usage period's start (YYYY-MM-01, user TZ). */
export function currentPeriodStart(
  timeZone: string | null | undefined,
): string {
  return monthStartFor(timeZone);
}

/**
 * Get-or-create the current calendar month's usage_counters row for the user.
 * scopedDb has no onConflict surface, so this is a scoped INSERT that catches
 * the (user_id, period_start) unique violation and treats it as "already
 * exists" — the same check-then-nothing pattern check-task.ts uses for
 * task_completions. The atomic INSERT … SELECT the scoped insert issues also
 * proves the user is live, so a soft-deleted user's create is rejected.
 */
export async function ensureCurrentMonthCounter(
  userId: string,
  timeZone: string | null | undefined,
): Promise<void> {
  const sdb = scopedDb(userId);
  try {
    await sdb.insert(usage_counters, {
      user_id: userId,
      period_start: monthStartFor(timeZone),
      period_end: monthEndFor(timeZone),
    });
  } catch (err) {
    if (isUniqueViolation(err)) return; // row already exists — get-or-create
    throw err;
  }
}

/**
 * Reserve one unit of the metered quota. Free users: a single atomic
 * conditional UPDATE increments the counter iff it is still below the limit;
 * concurrent callers cannot both pass (the WHERE serializes on the row).
 * Pro/Max: pass through with an empty periodStart (the not-metered sentinel).
 *
 * Throws NoLiveUserError when the user is missing/soft-deleted.
 */
export async function checkAndIncrement(
  userId: string,
  kind: MeteredKind,
): Promise<CheckAndIncrementResult> {
  const sdb = scopedDb(userId);
  const user = await sdb.getSelf();
  if (!user) throw new NoLiveUserError();
  if (user.tier !== "free") return { ok: true, periodStart: "" };

  await ensureCurrentMonthCounter(userId, user.timezone);

  const periodStart = currentPeriodStart(user.timezone);
  const limit = freeLimitFor(kind);

  // Single atomic conditional UPDATE — `AND col < limit` is the race guard.
  const updated =
    kind === "plan"
      ? await sdb.update(usage_counters, {
          set: {
            plan_generations_used: sql`${usage_counters.plan_generations_used} + 1`,
          },
          where: and(
            eq(usage_counters.period_start, periodStart),
            sql`${usage_counters.plan_generations_used} < ${limit}`,
          ),
        })
      : await sdb.update(usage_counters, {
          set: { replans_used: sql`${usage_counters.replans_used} + 1` },
          where: and(
            eq(usage_counters.period_start, periodStart),
            sql`${usage_counters.replans_used} < ${limit}`,
          ),
        });

  if (updated.length === 0) {
    // At (or racily past) the cap: read the current value for the response
    // body. Missing row ⇔ a concurrent reset window; report the limit.
    const current = (
      await sdb.selectFrom(usage_counters, {
        where: eq(usage_counters.period_start, periodStart),
      })
    )[0];
    const used =
      kind === "plan"
        ? current?.plan_generations_used ?? limit
        : current?.replans_used ?? limit;
    return { ok: false, cap: limit, used };
  }
  return { ok: true, periodStart };
}

/**
 * Give back one unit previously reserved by checkAndIncrement, targeting the
 * CAPTURED periodStart (never "now" — a midnight-straddle failure must credit
 * the row the increment hit). Never throws.
 *
 * - periodStart === "" → not_metered (Pro/Max), short-circuit before any DB.
 * - mode "unconditional": one UPDATE `SET col = col - 1 WHERE period_start=$p
 *   AND col > 0`. 0 rows ⇒ floor no-op (never negative).
 * - mode "validation_limited" (Zod-failure refunds, D2): ONE atomic UPDATE
 *   `SET col = col - 1, validation_refunds_used = validation_refunds_used + 1
 *   WHERE period_start=$p AND col > 0 AND validation_refunds_used < LIMIT`.
 *   Over the shared per-period limit ⇒ 0 rows ⇒ rate_limited (increment stays
 *   consumed; the client response is byte-identical — no failure-farming
 *   feedback channel).
 */
export async function refundUsage(
  userId: string,
  kind: MeteredKind,
  periodStart: string,
  mode: RefundMode,
): Promise<RefundResult> {
  if (periodStart === "") return { refunded: false, reason: "not_metered" };
  try {
    const sdb = scopedDb(userId);
    if (mode === "unconditional") {
      const rows =
        kind === "plan"
          ? await sdb.update(usage_counters, {
              set: {
                plan_generations_used: sql`${usage_counters.plan_generations_used} - 1`,
              },
              where: and(
                eq(usage_counters.period_start, periodStart),
                sql`${usage_counters.plan_generations_used} > 0`,
              ),
            })
          : await sdb.update(usage_counters, {
              set: { replans_used: sql`${usage_counters.replans_used} - 1` },
              where: and(
                eq(usage_counters.period_start, periodStart),
                sql`${usage_counters.replans_used} > 0`,
              ),
            });
      return rows.length > 0
        ? { refunded: true }
        : { refunded: false, reason: "floor" };
    }

    // validation_limited — ONE atomic statement: decrement the kind's counter
    // AND consume one shared validation-refund grant, gated on both floors.
    const rows =
      kind === "plan"
        ? await sdb.update(usage_counters, {
            set: {
              plan_generations_used: sql`${usage_counters.plan_generations_used} - 1`,
              validation_refunds_used: sql`${usage_counters.validation_refunds_used} + 1`,
            },
            where: and(
              eq(usage_counters.period_start, periodStart),
              sql`${usage_counters.plan_generations_used} > 0`,
              sql`${usage_counters.validation_refunds_used} < ${VALIDATION_REFUND_LIMIT}`,
            ),
          })
        : await sdb.update(usage_counters, {
            set: {
              replans_used: sql`${usage_counters.replans_used} - 1`,
              validation_refunds_used: sql`${usage_counters.validation_refunds_used} + 1`,
            },
            where: and(
              eq(usage_counters.period_start, periodStart),
              sql`${usage_counters.replans_used} > 0`,
              sql`${usage_counters.validation_refunds_used} < ${VALIDATION_REFUND_LIMIT}`,
            ),
          });
    return rows.length > 0
      ? { refunded: true }
      : { refunded: false, reason: "rate_limited" };
  } catch {
    // Never throw: a broken refund must not mask the AI failure that caused
    // it. The wrapper logs the quota_refund line with this reason.
    return { refunded: false, reason: "error" };
  }
}
