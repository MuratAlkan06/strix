/**
 * aggregateAdherence tests (no DB, node env — the dashboard-model posture).
 *
 * Pins the contract's adherence math:
 *   - window = last 28 days INCLUSIVE of the user's today;
 *   - daily expected = 28 (window days);
 *   - weekly expected = occurrences of the task's weekday in the window
 *     (0 = Sunday), counted across month boundaries;
 *   - actual counts only in-window completions for that task;
 *   - inactive tasks and weekly tasks with a NULL weekday are excluded.
 */
import { describe, expect, it } from "vitest";

import {
  ADHERENCE_WINDOW_DAYS,
  adherenceWindowStart,
  aggregateAdherence,
  type AdherenceTaskLike,
} from "./adherence";

const daily = (id: string, over?: Partial<AdherenceTaskLike>): AdherenceTaskLike => ({
  id,
  title: `daily-${id}`,
  cadence: "daily",
  weekday: null,
  active: true,
  ...over,
});

const weekly = (
  id: string,
  weekday: number | null,
  over?: Partial<AdherenceTaskLike>,
): AdherenceTaskLike => ({
  id,
  title: `weekly-${id}`,
  cadence: "weekly",
  weekday,
  active: true,
  ...over,
});

describe("adherenceWindowStart", () => {
  it("is 27 days before today (28-day window, both ends inclusive)", () => {
    expect(adherenceWindowStart("2026-06-10")).toBe("2026-05-14");
  });

  it("crosses month and February boundaries by calendar arithmetic", () => {
    // 2026 is not a leap year: window ending Mar 10 opens Feb 11.
    expect(adherenceWindowStart("2026-03-10")).toBe("2026-02-11");
    // Year boundary.
    expect(adherenceWindowStart("2026-01-15")).toBe("2025-12-19");
  });
});

describe("aggregateAdherence — expected", () => {
  it("daily tasks expect one per window day", () => {
    const rows = aggregateAdherence({
      tasks: [daily("t1")],
      completions: [],
      today: "2026-06-10",
    });
    expect(rows).toEqual([
      {
        recurring_task_id: "t1",
        title: "daily-t1",
        cadence: "daily",
        expected: ADHERENCE_WINDOW_DAYS,
        actual: 0,
      },
    ]);
  });

  it("weekly tasks expect the count of their weekday in the window (every weekday, across a month boundary)", () => {
    // Window 2026-02-11 .. 2026-03-10 spans Feb→Mar. 28 days = exactly four
    // of each weekday — counted by the function, asserted here per weekday.
    const tasks = [0, 1, 2, 3, 4, 5, 6].map((wd) => weekly(`w${wd}`, wd));
    const rows = aggregateAdherence({
      tasks,
      completions: [],
      today: "2026-03-10",
    });
    expect(rows).toHaveLength(7);
    for (const row of rows) {
      expect(row.expected).toBe(4);
    }
  });

  it("excludes inactive tasks and malformed weekly tasks (null weekday)", () => {
    const rows = aggregateAdherence({
      tasks: [
        daily("paused", { active: false }),
        weekly("malformed", null),
        daily("live"),
      ],
      completions: [],
      today: "2026-06-10",
    });
    expect(rows.map((r) => r.recurring_task_id)).toEqual(["live"]);
  });
});

describe("aggregateAdherence — actual", () => {
  it("counts only in-window completions, per task", () => {
    const rows = aggregateAdherence({
      tasks: [daily("t1"), weekly("t2", 3)],
      completions: [
        // In window (2026-05-14 .. 2026-06-10):
        { recurring_task_id: "t1", for_date: "2026-05-14" }, // first day
        { recurring_task_id: "t1", for_date: "2026-06-10" }, // last day
        { recurring_task_id: "t2", for_date: "2026-06-03" },
        // Out of window:
        { recurring_task_id: "t1", for_date: "2026-05-13" }, // day before
        { recurring_task_id: "t2", for_date: "2026-06-11" }, // day after
        // Unknown task — ignored:
        { recurring_task_id: "ghost", for_date: "2026-06-01" },
      ],
      today: "2026-06-10",
    });
    expect(rows).toEqual([
      expect.objectContaining({ recurring_task_id: "t1", actual: 2 }),
      expect.objectContaining({ recurring_task_id: "t2", actual: 1 }),
    ]);
  });

  it("ignores completions for inactive tasks (no row at all)", () => {
    const rows = aggregateAdherence({
      tasks: [daily("paused", { active: false })],
      completions: [{ recurring_task_id: "paused", for_date: "2026-06-01" }],
      today: "2026-06-10",
    });
    expect(rows).toEqual([]);
  });
});
