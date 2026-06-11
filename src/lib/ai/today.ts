/**
 * today.ts — the per-request date anchor for AI calls (phase-1 date-anchoring
 * fix). Without an explicit "today", the model assumes its training-era year
 * and calibrates plans/milestones into the past.
 *
 * The date is injected ONLY into the uncached, per-request side of a call
 * (the user messages built by buildIntakeMessages / buildPlanMessages). It
 * must NEVER be imported by prompts/* — the cached system blocks are
 * byte-stable build-time constants, and a date there would invalidate the
 * prompt cache on every calendar day (and the stability tests would fail).
 */

/** Today's date as ISO 8601 (YYYY-MM-DD), in the server's local timezone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
