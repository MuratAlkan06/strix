/**
 * adherence.ts — the expected-vs-actual adherence aggregate the replan prompt
 * reads (phase-2-close-the-loop "Replan prompt structure (sketch)":
 * `last_4_weeks_task_completions: aggregated as expected_vs_actual per task`).
 *
 * Window: the last ADHERENCE_WINDOW_DAYS (28) calendar days ENDING on the
 * user's today (todayInTimeZone — the route resolves it), inclusive on both
 * ends. Expected per ACTIVE recurring task:
 *   daily  → every day in the window (28);
 *   weekly → the occurrences of the task's weekday in the window (0 = Sunday,
 *            the schema convention) — exactly 4 in a 28-day window, but
 *            counted, not assumed, so a window change stays correct.
 * Actual = task_completions rows for the task whose for_date falls inside the
 * window (the route queries; this module only counts).
 *
 * Inactive tasks are excluded — they set no expectation, so their silence is
 * not a signal. A weekly task with a NULL weekday is malformed (the schema
 * requires one) and is skipped rather than given an invented expectation.
 *
 * Pure date-string arithmetic in UTC on YYYY-MM-DD (the dashboard-model
 * posture: no DST or wall-clock drift). No DB, no React.
 */
import { addDays, weekdayOfIso } from "@/app/(dashboard)/dashboard/dashboard-model";

/** Four weeks — the phase doc's adherence signal window. */
export const ADHERENCE_WINDOW_DAYS = 28;

export interface AdherenceTaskLike {
  id: string;
  title: string;
  cadence: "daily" | "weekly";
  /** 0–6 with 0 = Sunday; null for daily (and malformed weekly) tasks. */
  weekday: number | null;
  active: boolean;
}

export interface AdherenceCompletionLike {
  recurring_task_id: string;
  /** YYYY-MM-DD (drizzle date columns come back as strings). */
  for_date: string;
}

export interface AdherenceRow {
  recurring_task_id: string;
  title: string;
  cadence: "daily" | "weekly";
  /** Sessions the cadence called for inside the window. */
  expected: number;
  /** Completions recorded inside the window. */
  actual: number;
}

/** First day (YYYY-MM-DD) of the window ending on `today`, inclusive — the
 *  route's task_completions query lower bound. */
export function adherenceWindowStart(today: string): string {
  return addDays(today, -(ADHERENCE_WINDOW_DAYS - 1));
}

/** Days of the window ending on `today`, oldest first, inclusive. */
function windowDays(today: string): string[] {
  const start = adherenceWindowStart(today);
  const days: string[] = [];
  for (let i = 0; i < ADHERENCE_WINDOW_DAYS; i++) {
    days.push(addDays(start, i));
  }
  return days;
}

/**
 * Aggregate expected-vs-actual per active recurring task over the window
 * ending on `today`. Completions outside the window (or for unknown/inactive
 * tasks) are ignored, so callers may pass an over-fetched list safely.
 */
export function aggregateAdherence(input: {
  tasks: readonly AdherenceTaskLike[];
  completions: readonly AdherenceCompletionLike[];
  /** The USER's today (todayInTimeZone), YYYY-MM-DD. */
  today: string;
}): AdherenceRow[] {
  const days = windowDays(input.today);
  const start = days[0]!;
  const end = days[days.length - 1]!;

  // Weekday occurrence counts inside the window (counted, never assumed).
  const weekdayCounts = new Map<number, number>();
  for (const day of days) {
    const wd = weekdayOfIso(day);
    weekdayCounts.set(wd, (weekdayCounts.get(wd) ?? 0) + 1);
  }

  // ISO date strings compare lexicographically — the window check is a
  // plain string range test.
  const actualByTask = new Map<string, number>();
  for (const c of input.completions) {
    if (c.for_date < start || c.for_date > end) continue;
    actualByTask.set(
      c.recurring_task_id,
      (actualByTask.get(c.recurring_task_id) ?? 0) + 1,
    );
  }

  const rows: AdherenceRow[] = [];
  for (const task of input.tasks) {
    if (!task.active) continue;
    let expected: number;
    if (task.cadence === "daily") {
      expected = days.length;
    } else if (task.weekday === null) {
      // Malformed weekly (schema requires a weekday) — no honest expectation.
      continue;
    } else {
      expected = weekdayCounts.get(task.weekday) ?? 0;
    }
    rows.push({
      recurring_task_id: task.id,
      title: task.title,
      cadence: task.cadence,
      expected,
      actual: actualByTask.get(task.id) ?? 0,
    });
  }
  return rows;
}
