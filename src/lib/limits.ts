/**
 * limits.ts — free-tier usage caps (SPEC §10 "Free tier usage limits").
 *
 * Free users get **2 replans per calendar month** — weekly check-ins still
 * happen; the AI just doesn't propose changes more than twice. The counter
 * lives in usage_counters.replans_used with a calendar-1st reset in the
 * user's timezone (usage_counters.period_start). Pro/Max are uncapped.
 *
 * Phase 2 only ENFORCES the cap at check-in selection time (how many goals
 * may trigger a replan proposal); the increment itself ships with Phase 3's
 * checkAndIncrement.
 */
export const FREE_MONTHLY_REPLAN_LIMIT = 2;

/** Operations metered by usage_counters (SPEC §10). */
export type MeteredOp = "replan" | "plan_generation";

/**
 * Phase-2 STUB of the Phase-3 quota gate (phase-2-close-the-loop "Replan
 * flow"): POST /api/ai/replan awaits this BEFORE the model call so the
 * endpoint shape is stable when Phase 3 fills in the real check.
 *
 * TODO(Phase 3): enforce the cap for Free users — read/create the current
 * calendar month's usage_counters row (period_start in the user's timezone),
 * refuse when the op's counter is at its limit, otherwise increment
 * atomically and return ok. Pro/Max stay uncapped. Until then this performs
 * ZERO usage_counters reads or writes and always allows.
 */
export async function checkAndIncrement(
  userId: string,
  op: MeteredOp,
): Promise<{ ok: true }> {
  void userId;
  void op;
  return { ok: true };
}
