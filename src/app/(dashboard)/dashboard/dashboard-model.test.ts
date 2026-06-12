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

import { todayInTimeZone } from "@/lib/equipment-urgency";
import {
  addDays,
  buildAccomplishedCards,
  buildDashboardModel,
  dashboardDateLabel,
  dayUnit,
  goalHref,
  greetingForHour,
  shouldShowCheckInPrompt,
  weekdayOfIso,
  weekEndOf,
  weekStartOf,
  type AccomplishedGoalLike,
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

  it("dayUnit pluralizes the countdown label at the 0/1/2 boundary", () => {
    expect(dayUnit(0)).toBe("days");
    expect(dayUnit(1)).toBe("day");
    expect(dayUnit(2)).toBe("days");
  });
});

// ---------------------------------------------------------------------------
// Accomplished section (phase 2 slice 6)
// ---------------------------------------------------------------------------

function accomplished(
  over: Partial<AccomplishedGoalLike>,
): AccomplishedGoalLike {
  return {
    id: "g-1",
    title: "Goal",
    status: "completed",
    color_index: 0,
    completed_at: null,
    archived_at: null,
    ...over,
  };
}

describe("buildAccomplishedCards — completed/archived wins", () => {
  it("returns no cards for active-only goals (section hidden at 0)", () => {
    expect(
      buildAccomplishedCards([accomplished({ status: "active" })]),
    ).toEqual([]);
  });

  it("includes BOTH completed and archived goals (≥1 ⇒ section renders)", () => {
    const cards = buildAccomplishedCards([
      accomplished({
        id: "g-done",
        title: "Done",
        status: "completed",
        completed_at: "2026-06-01T09:00:00.000Z",
      }),
      accomplished({
        id: "g-arch",
        title: "Archived",
        status: "archived",
        completed_at: "2026-05-01T09:00:00.000Z",
        archived_at: "2026-05-08T03:00:00.000Z",
      }),
      accomplished({ id: "g-live", status: "active" }),
    ]);
    expect(cards.map((c) => c.goalId)).toEqual(["g-done", "g-arch"]);
    expect(cards.length).toBeGreaterThanOrEqual(1);
  });

  it("uses completed_at as the win date — it SURVIVES auto-archive", () => {
    const [card] = buildAccomplishedCards([
      accomplished({
        status: "archived",
        completed_at: new Date("2026-05-01T09:00:00.000Z"),
        archived_at: "2026-05-08T03:00:00.000Z",
      }),
    ]);
    expect(card).toMatchObject({ dateIso: "2026-05-01", dateKind: "completed" });
  });

  it("falls back to archived_at with the honest 'archived' kind when completed_at is NULL", () => {
    const [card] = buildAccomplishedCards([
      accomplished({
        status: "archived",
        completed_at: null,
        archived_at: "2026-05-08T03:00:00.000Z",
      }),
    ]);
    expect(card).toMatchObject({ dateIso: "2026-05-08", dateKind: "archived" });
  });

  it("renders NO date when both timestamps are missing — never a fake one", () => {
    const [card] = buildAccomplishedCards([
      accomplished({ status: "archived" }),
    ]);
    expect(card).toMatchObject({ dateIso: null, dateKind: null });
  });

  it("carries title + color for the GoalChip-convention card", () => {
    const [card] = buildAccomplishedCards([
      accomplished({
        id: "g-race",
        title: "Half marathon",
        color_index: 3,
        completed_at: "2026-06-01T09:00:00.000Z",
      }),
    ]);
    expect(card).toMatchObject({
      goalId: "g-race",
      title: "Half marathon",
      colorIndex: 3,
    });
    expect(goalHref(card!.goalId)).toBe("/goals/g-race");
  });

  it("orders most recent win first; undated cards last; title tiebreak", () => {
    const cards = buildAccomplishedCards([
      accomplished({
        id: "g-old",
        title: "Older win",
        completed_at: "2026-04-01T09:00:00.000Z",
      }),
      accomplished({ id: "g-undated", title: "Undated", status: "archived" }),
      accomplished({
        id: "g-new",
        title: "Newest win",
        completed_at: "2026-06-01T09:00:00.000Z",
      }),
      accomplished({
        id: "g-b-same-day",
        title: "B same day",
        completed_at: "2026-06-01T11:00:00.000Z",
      }),
    ]);
    expect(cards.map((c) => c.goalId)).toEqual([
      "g-b-same-day", // 2026-06-01, "B…" < "Newest…"
      "g-new",
      "g-old",
      "g-undated",
    ]);
  });
});

// ---------------------------------------------------------------------------
// Friday check-in prompt (phase 2 slice 7)
// ---------------------------------------------------------------------------

describe("shouldShowCheckInPrompt — the Fri/Sat banner predicate", () => {
  // The week of TODAY: Sun 2026-06-07 … Sat 2026-06-13.
  const WEEK = [
    ["2026-06-07", 0, false], // Sunday
    ["2026-06-08", 1, false], // Monday
    ["2026-06-09", 2, false], // Tuesday
    ["2026-06-10", 3, false], // Wednesday
    ["2026-06-11", 4, false], // Thursday
    ["2026-06-12", 5, true], // Friday
    ["2026-06-13", 6, true], // Saturday
  ] as const;

  it("with NO current-week row: shows only on Friday and Saturday", () => {
    for (const [iso, weekday, expected] of WEEK) {
      expect(weekdayOfIso(iso)).toBe(weekday); // pin the convention
      expect(shouldShowCheckInPrompt(iso, [])).toBe(expected);
    }
  });

  it("ANY current-week row hides it — on every weekday", () => {
    for (const [iso] of WEEK) {
      expect(shouldShowCheckInPrompt(iso, [{ feeling: "right" }])).toBe(false);
    }
  });

  it("a SKIPPED row counts as handled (the skip row exists for this prompt)", () => {
    expect(
      shouldShowCheckInPrompt("2026-06-12", [{ feeling: "skipped" }]),
    ).toBe(false);
    expect(
      shouldShowCheckInPrompt("2026-06-13", [{ feeling: "skipped" }]),
    ).toBe(false);
  });

  it("judges the USER's calendar day: UTC Thursday is already Friday at UTC+14", () => {
    // 2026-06-11T22:00Z — Thursday on the server's clock…
    const now = new Date("2026-06-11T22:00:00.000Z");
    expect(todayInTimeZone(undefined, now)).toBe("2026-06-11"); // Thu → hidden
    expect(shouldShowCheckInPrompt(todayInTimeZone(undefined, now), [])).toBe(
      false,
    );
    // …but Friday 2026-06-12 on Kiritimati (UTC+14) → shown.
    const kiritimati = todayInTimeZone("Pacific/Kiritimati", now);
    expect(kiritimati).toBe("2026-06-12");
    expect(shouldShowCheckInPrompt(kiritimati, [])).toBe(true);
    // The week the row lookup keys on is THEIR week, too.
    expect(weekStartOf(kiritimati)).toBe("2026-06-07");
  });

  it("judges the USER's calendar day: UTC Saturday is still Friday at UTC-11", () => {
    // 2026-06-13T10:00Z — Saturday in UTC, Friday 23:00 on Midway (UTC-11).
    const now = new Date("2026-06-13T10:00:00.000Z");
    const midway = todayInTimeZone("Pacific/Midway", now);
    expect(midway).toBe("2026-06-12");
    expect(shouldShowCheckInPrompt(midway, [])).toBe(true);
  });

  it("the prompt window CLOSES when the user's week rolls to Sunday early at UTC+14", () => {
    // 2026-06-13T11:00Z — Saturday in UTC, already Sunday 01:00 on Kiritimati.
    const now = new Date("2026-06-13T11:00:00.000Z");
    const kiritimati = todayInTimeZone("Pacific/Kiritimati", now);
    expect(kiritimati).toBe("2026-06-14"); // Sunday — a NEW week
    expect(shouldShowCheckInPrompt(kiritimati, [])).toBe(false);
    expect(weekStartOf(kiritimati)).toBe("2026-06-14"); // the row key moves on
  });
});
