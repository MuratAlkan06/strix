/**
 * period.ts — usage-period date math (SPEC §10 / §3.5: usage counters reset on
 * the calendar 1st in the USER's timezone).
 *
 * Hoisted out of the check-in view-model so BOTH the client-safe check-in
 * surface and the server-only usage gate (src/lib/billing/usage.ts) share one
 * definition of a period boundary — no duplicated timezone logic. Pure and
 * client-safe: depends only on todayInTimeZone (itself client-safe), never on
 * the DB.
 */
import { todayInTimeZone } from "@/lib/equipment-urgency";

/**
 * Calendar-1st (YYYY-MM-01) of the user's current month in their timezone —
 * the usage_counters.period_start key. UTC fallback for a missing/invalid
 * timezone rides on todayInTimeZone.
 */
export function monthStartFor(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  return `${todayInTimeZone(timeZone, now).slice(0, 7)}-01`;
}

/**
 * Last calendar day (YYYY-MM-DD, inclusive) of the user's current month in
 * their timezone — the usage_counters.period_end value written at row
 * creation. Computed by calendar arithmetic on the YYYY-MM of monthStartFor
 * (day 0 of the following month = the last day of this month), so it agrees
 * byte-for-byte with the `date_trunc('month') + 1 month - 1 day` the reset
 * cron computes in SQL.
 */
export function monthEndFor(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  const start = monthStartFor(timeZone, now); // YYYY-MM-01
  const year = Number(start.slice(0, 4));
  const month = Number(start.slice(5, 7)); // 1-indexed
  // Date.UTC month is 0-indexed, so `month` (1-indexed) IS next month; day 0
  // rolls back to the last day of the current month.
  const last = new Date(Date.UTC(year, month, 0));
  const mm = String(last.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(last.getUTCDate()).padStart(2, "0");
  return `${last.getUTCFullYear()}-${mm}-${dd}`;
}
