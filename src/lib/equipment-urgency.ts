/**
 * equipment-urgency.ts — urgency grouping for the aggregated equipment view
 * (phase-1-golden-path "Equipment aggregated view").
 *
 * Buckets, from the DERIVED deadline (equipment-deadline.ts):
 *   this_week  — deadline within 7 days, INCLUDING overdue (an overdue item
 *                is the most urgent thing on the page; it stays in the
 *                nearest bucket with an honest overdue note, never hidden in
 *                a separate tail section).
 *   this_month — within 30 days.
 *   later      — beyond 30 days.
 *   no_date    — no derivable deadline (milestone-linked, but the milestone
 *                has no target_date yet). Honest bucket, not a fake date.
 *
 * Boundaries are inclusive: exactly 7 days out is "this week"; exactly 30 is
 * "this month". Day math is calendar-date arithmetic in UTC — inputs are
 * ISO `YYYY-MM-DD` strings, so no DST or wall-clock drift.
 *
 * Pure and client-safe.
 */

export type EquipmentUrgency = "this_week" | "this_month" | "later" | "no_date";

/** Display order of the urgency groups. */
export const URGENCY_ORDER: readonly EquipmentUrgency[] = [
  "this_week",
  "this_month",
  "later",
  "no_date",
];

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseIsoDateUtc(iso: string): number {
  if (!ISO_DATE_RE.test(iso)) {
    throw new Error(`equipment-urgency: expected YYYY-MM-DD, got "${iso}"`);
  }
  return Date.parse(`${iso}T00:00:00Z`);
}

/** Whole calendar days from `today` to `deadline` (negative = overdue). */
export function daysUntil(deadline: string, today: string): number {
  return Math.round(
    (parseIsoDateUtc(deadline) - parseIsoDateUtc(today)) / DAY_MS,
  );
}

/** Bucket a derived deadline (null = no derivable date). */
export function equipmentUrgency(
  deadline: string | null,
  today: string,
): EquipmentUrgency {
  if (deadline === null) return "no_date";
  const days = daysUntil(deadline, today);
  if (days <= 7) return "this_week";
  if (days <= 30) return "this_month";
  return "later";
}

/** True when the deadline is strictly before today. */
export function isOverdue(deadline: string | null, today: string): boolean {
  return deadline !== null && daysUntil(deadline, today) < 0;
}

/**
 * Today's calendar date (YYYY-MM-DD) in the given IANA timezone — deadlines
 * are date-only, so "within 7 days" must be judged against the USER's day,
 * not the server's. Falls back to UTC for a missing/invalid timezone.
 */
export function todayInTimeZone(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now);
    } catch {
      // Invalid IANA name — fall through to UTC.
    }
  }
  return now.toISOString().slice(0, 10);
}
