/**
 * dashboard-model tests — the Today / This week / Upcoming bucketing
 * (phase-1-golden-path "Dashboard (active state)").
 *
 * Pins:
 *   - weekday convention: 0 = Sunday … 6 = Saturday (the schema/review-UI
 *     convention), week runs Sunday → Saturday;
 *   - TODAY: daily tasks; weekly tasks whose weekday matches today;
 *     milestones/equipment due today; OVERDUE dues riding here flagged;
 *     completed-today tasks flagged (struck in the view) but present;
 *   - THIS WEEK: weekly tasks strictly ahead of today within the week (a past
 *     weekday is gone; today's belongs to TODAY); dues through Saturday
 *     inclusive; an already-completed weekly excluded defensively;
 *   - UPCOMING: dues after the week through today+14 INCLUSIVE; +15 is out;
 *   - exclusions: inactive tasks, non-active goals, completed milestones,
 *     purchased equipment, dateless/dangling equipment;
 *   - hero countdown: earliest STRICTLY-future incomplete milestone;
 *   - deep-link hrefs via goalHref.
 */
import { describe, expect, it } from "vitest";

import {
  addDays,
  buildDashboardModel,
  dashboardDateLabel,
  goalHref,
  greetingForHour,
  weekdayOfIso,
  weekEndOf,
  weekStartOf,
  type DashboardEquipmentLike,
  type DashboardGoalLike,
  type DashboardMilestoneLike,
  type DashboardTaskLike,
} from "./dashboard-model";

// 2026-06-10 is a Wednesday → weekday 3. Week: Sun 06-07 … Sat 06-13.
const TODAY = "2026-06-10";

const GOAL_A: DashboardGoalLike = {
  id: "goal-a",
  title: "Climb Mont Blanc",
  status: "active",
  color_index: 0,
};
const GOAL_B: DashboardGoalLike = {
  id: "goal-b",
  title: "Half marathon",
  status: "active",
  color_index: 1,
};
const GOAL_DONE: DashboardGoalLike = {
  id: "goal-done",
  title: "Finished",
  status: "completed",
  color_index: 2,
};

function task(over: Partial<DashboardTaskLike>): DashboardTaskLike {
  return {
    id: "t-1",
    goal_id: GOAL_A.id,
    title: "Task",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: null,
    active: true,
    ...over,
  };
}

function milestone(
  over: Partial<DashboardMilestoneLike>,
): DashboardMilestoneLike {
  return {
    id: "m-1",
    goal_id: GOAL_A.id,
    title: "Milestone",
    target_date: null,
    completed_at: null,
    ...over,
  };
}

function equip(over: Partial<DashboardEquipmentLike>): DashboardEquipmentLike {
  return {
    id: "e-1",
    goal_id: GOAL_A.id,
    title: "Equipment",
    milestone_id: null,
    standalone_deadline: null,
    purchased_at: null,
    ...over,
  };
}

function build(input?: {
  goals?: DashboardGoalLike[];
  tasks?: DashboardTaskLike[];
  milestones?: DashboardMilestoneLike[];
  equipment?: DashboardEquipmentLike[];
  completions?: { recurring_task_id: string; for_date: string }[];
  today?: string;
}) {
  return buildDashboardModel({
    goals: input?.goals ?? [GOAL_A, GOAL_B],
    tasks: input?.tasks ?? [],
    milestones: input?.milestones ?? [],
    equipment: input?.equipment ?? [],
    completions: input?.completions ?? [],
    today: input?.today ?? TODAY,
  });
}

describe("date helpers — the weekday/week convention", () => {
  it("weekdayOfIso uses 0 = Sunday … 6 = Saturday", () => {
    expect(weekdayOfIso("2026-06-07")).toBe(0); // Sunday
    expect(weekdayOfIso("2026-06-10")).toBe(3); // Wednesday
    expect(weekdayOfIso("2026-06-13")).toBe(6); // Saturday
  });

  it("the week containing today runs Sunday → Saturday", () => {
    expect(weekStartOf(TODAY)).toBe("2026-06-07");
    expect(weekEndOf(TODAY)).toBe("2026-06-13");
    // A Sunday is its own week start; a Saturday its own week end.
    expect(weekStartOf("2026-06-07")).toBe("2026-06-07");
    expect(weekEndOf("2026-06-13")).toBe("2026-06-13");
  });

  it("addDays crosses month boundaries without drift", () => {
    expect(addDays("2026-06-25", 14)).toBe("2026-07-09");
    expect(addDays("2026-06-10", -3)).toBe("2026-06-07");
  });
});

describe("TODAY bucketing", () => {
  it("daily tasks of every active goal land in TODAY", () => {
    const model = build({
      tasks: [
        task({ id: "t-a", goal_id: GOAL_A.id, title: "Stairs" }),
        task({ id: "t-b", goal_id: GOAL_B.id, title: "Run" }),
      ],
    });
    expect(model.today.map((r) => r.id).sort()).toEqual(["t-a", "t-b"]);
    expect(model.todayTaskCount).toBe(2);
    expect(model.thisWeek).toEqual([]);
  });

  it("a weekly task whose weekday matches today is TODAY, not this week", () => {
    const model = build({
      tasks: [task({ id: "t-wed", cadence: "weekly", weekday: 3 })],
    });
    expect(model.today.map((r) => r.id)).toEqual(["t-wed"]);
    expect(model.thisWeek).toEqual([]);
  });

  it("milestones and equipment due exactly today are TODAY (not overdue)", () => {
    const model = build({
      milestones: [milestone({ id: "m-today", target_date: TODAY })],
      equipment: [equip({ id: "e-today", standalone_deadline: TODAY })],
    });
    const dues = model.today.filter((r) => r.kind !== "task");
    expect(dues.map((r) => r.id).sort()).toEqual(["e-today", "m-today"]);
    expect(dues.every((r) => r.overdue === false)).toBe(true);
  });

  it("OVERDUE milestones/equipment ride in TODAY with the overdue flag", () => {
    const model = build({
      milestones: [milestone({ id: "m-late", target_date: "2026-06-08" })],
      equipment: [equip({ id: "e-late", standalone_deadline: "2026-06-01" })],
    });
    const dues = model.today.filter((r) => r.kind !== "task");
    expect(dues.map((r) => r.id).sort()).toEqual(["e-late", "m-late"]);
    expect(dues.every((r) => r.overdue === true)).toBe(true);
  });

  it("a task completed today is flagged, stays visible, and counts as done", () => {
    const model = build({
      tasks: [
        task({ id: "t-done", title: "Words" }),
        task({ id: "t-open", title: "Stairs" }),
      ],
      completions: [{ recurring_task_id: "t-done", for_date: TODAY }],
    });
    const done = model.today.find((r) => r.id === "t-done");
    expect(done).toMatchObject({ kind: "task", completedToday: true });
    expect(model.todayTaskCount).toBe(2);
    expect(model.todayDoneCount).toBe(1);
  });

  it("a completion for another date does not mark today", () => {
    const model = build({
      tasks: [task({ id: "t-1" })],
      completions: [{ recurring_task_id: "t-1", for_date: "2026-06-09" }],
    });
    expect(model.today[0]).toMatchObject({ completedToday: false });
    expect(model.todayDoneCount).toBe(0);
  });

  it("checkable tasks stay contiguous ahead of due rows", () => {
    const model = build({
      tasks: [task({ id: "t-1", title: "Zz task" })],
      milestones: [milestone({ id: "m-1", target_date: TODAY, title: "Aa" })],
    });
    expect(model.today.map((r) => r.kind)).toEqual(["task", "milestone"]);
  });
});

describe("THIS WEEK bucketing", () => {
  it("weekly tasks strictly ahead of today are remaining; past weekdays are gone", () => {
    const model = build({
      tasks: [
        task({ id: "t-thu", cadence: "weekly", weekday: 4 }),
        task({ id: "t-sat", cadence: "weekly", weekday: 6 }),
        task({ id: "t-mon", cadence: "weekly", weekday: 1 }), // passed
        task({ id: "t-sun", cadence: "weekly", weekday: 0 }), // passed
      ],
    });
    expect(model.thisWeek.map((r) => r.id)).toEqual(["t-thu", "t-sat"]);
    expect(model.today).toEqual([]);
  });

  it("a weekly task already completed this week is not remaining (defensive)", () => {
    const model = build({
      tasks: [task({ id: "t-fri", cadence: "weekly", weekday: 5 })],
      completions: [{ recurring_task_id: "t-fri", for_date: "2026-06-12" }],
    });
    expect(model.thisWeek).toEqual([]);
  });

  it("dues after today through Saturday (inclusive) are this week", () => {
    const model = build({
      milestones: [
        milestone({ id: "m-thu", target_date: "2026-06-11" }),
        milestone({ id: "m-sat", target_date: "2026-06-13" }), // week end
      ],
      equipment: [equip({ id: "e-fri", standalone_deadline: "2026-06-12" })],
    });
    expect(model.thisWeek.map((r) => r.id)).toEqual([
      "m-thu",
      "e-fri",
      "m-sat",
    ]);
    expect(model.upcoming).toEqual([]);
  });

  it("on a Saturday the week has nothing remaining — next-day dues are upcoming", () => {
    const model = build({
      today: "2026-06-13", // Saturday, weekday 6
      tasks: [task({ id: "t-sat", cadence: "weekly", weekday: 6 })],
      milestones: [milestone({ id: "m-sun", target_date: "2026-06-14" })],
    });
    expect(model.today.map((r) => r.id)).toEqual(["t-sat"]); // today's session
    expect(model.thisWeek).toEqual([]);
    expect(model.upcoming.map((r) => r.id)).toEqual(["m-sun"]);
  });
});

describe("UPCOMING bucketing — the 14-day window", () => {
  it("dues after the week through today+14 inclusive; +15 is out", () => {
    const model = build({
      milestones: [
        milestone({ id: "m-next-sun", target_date: "2026-06-14" }), // week end + 1
        milestone({ id: "m-boundary", target_date: "2026-06-24" }), // today + 14
        milestone({ id: "m-beyond", target_date: "2026-06-25" }), // today + 15
      ],
      equipment: [equip({ id: "e-mid", standalone_deadline: "2026-06-20" })],
    });
    expect(model.upcoming.map((r) => r.id)).toEqual([
      "m-next-sun",
      "e-mid",
      "m-boundary",
    ]);
  });

  it("equipment deadlines derive from linked milestones", () => {
    const model = build({
      milestones: [
        milestone({ id: "m-far", target_date: "2026-06-20" }),
      ],
      equipment: [equip({ id: "e-linked", milestone_id: "m-far" })],
    });
    const linked = model.upcoming.find((r) => r.id === "e-linked");
    expect(linked).toMatchObject({ kind: "equipment", deadline: "2026-06-20" });
  });
});

describe("exclusions — nothing fake, nothing leaked", () => {
  it("inactive tasks and tasks of non-active goals never surface", () => {
    const model = build({
      goals: [GOAL_A, GOAL_DONE],
      tasks: [
        task({ id: "t-inactive", active: false }),
        task({ id: "t-ghost", goal_id: GOAL_DONE.id }),
        task({ id: "t-orphan", goal_id: "goal-unknown" }),
      ],
    });
    expect(model.today).toEqual([]);
  });

  it("completed milestones and purchased equipment never surface", () => {
    const model = build({
      milestones: [
        milestone({
          id: "m-done",
          target_date: TODAY,
          completed_at: "2026-06-01T00:00:00Z",
        }),
      ],
      equipment: [
        equip({
          id: "e-bought",
          standalone_deadline: TODAY,
          purchased_at: new Date("2026-06-01T00:00:00Z"),
        }),
      ],
    });
    expect(model.today).toEqual([]);
    expect(model.nextMilestone).toBeNull();
  });

  it("dateless milestones and dangling equipment links are omitted, not fatal", () => {
    const model = build({
      milestones: [milestone({ id: "m-nodate", target_date: null })],
      equipment: [equip({ id: "e-dangling", milestone_id: "m-vanished" })],
    });
    expect(model.today).toEqual([]);
    expect(model.thisWeek).toEqual([]);
    expect(model.upcoming).toEqual([]);
  });

  it("empty inputs produce three empty sections (honest empties, no throw)", () => {
    const model = build();
    expect(model.today).toEqual([]);
    expect(model.thisWeek).toEqual([]);
    expect(model.upcoming).toEqual([]);
    expect(model.todayTaskCount).toBe(0);
    expect(model.nextMilestone).toBeNull();
  });
});

describe("hero countdown — next strictly-future milestone", () => {
  it("picks the earliest future milestone with goal attribution", () => {
    const model = build({
      milestones: [
        milestone({ id: "m-today", target_date: TODAY, title: "Today one" }),
        milestone({
          id: "m-near",
          goal_id: GOAL_B.id,
          target_date: "2026-06-13",
          title: "Time trial",
        }),
        milestone({ id: "m-far", target_date: "2026-09-20", title: "Summit" }),
      ],
    });
    expect(model.nextMilestone).toMatchObject({
      title: "Time trial",
      date: "2026-06-13",
      daysUntil: 3,
      goalId: GOAL_B.id,
      goalTitle: GOAL_B.title,
      goalColorIndex: 1,
    });
  });

  it("a milestone due today is NOT the hero (it leads TODAY instead)", () => {
    const model = build({
      milestones: [milestone({ id: "m-today", target_date: TODAY })],
    });
    expect(model.nextMilestone).toBeNull();
    expect(model.today.map((r) => r.id)).toEqual(["m-today"]);
  });
});

describe("deep links + display helpers", () => {
  it("goalHref targets the goal-detail route", () => {
    expect(goalHref("abc-123")).toBe("/goals/abc-123");
  });

  it("rows carry the goalId the view links through", () => {
    const model = build({
      tasks: [task({ id: "t-1", goal_id: GOAL_B.id })],
    });
    const row = model.today[0]!;
    expect(goalHref(row.goalId)).toBe("/goals/goal-b");
  });

  it("dashboardDateLabel is deterministic (en-US, UTC)", () => {
    expect(dashboardDateLabel("2026-06-10")).toBe("Wednesday, June 10");
  });

  it("greetingForHour covers the three dayparts and the name suffix", () => {
    expect(greetingForHour(6)).toBe("Good morning.");
    expect(greetingForHour(13, "Murat")).toBe("Good afternoon, Murat.");
    expect(greetingForHour(22)).toBe("Good evening.");
    expect(greetingForHour(3, "  ")).toBe("Good evening.");
  });
});
