/**
 * equipment-model tests — the aggregated-equipment view model: active-goals-
 * only filtering, deadline derivation through equipment-deadline.ts, urgency
 * grouping (incl. the no-date and dangling-milestone edges), purchased rows
 * staying in place, and group ordering/omission.
 */
import { describe, expect, it } from "vitest";

import {
  buildEquipmentModel,
  type EquipmentRowLike,
  type GoalLike,
  type MilestoneDateLike,
} from "./equipment-model";

const TODAY = "2026-06-10";

const GOALS: GoalLike[] = [
  { id: "g-1", title: "Climb Mont Blanc", status: "active", color_index: 0 },
  { id: "g-2", title: "Trail half marathon", status: "active", color_index: 1 },
  { id: "g-3", title: "Old goal", status: "archived", color_index: 2 },
];

const MILESTONES: MilestoneDateLike[] = [
  { id: "ms-dated", target_date: "2026-06-17" },
  { id: "ms-undated", target_date: null },
];

let seq = 0;
function eq(over: Partial<EquipmentRowLike> = {}): EquipmentRowLike {
  seq += 1;
  return {
    id: `eq-${seq}`,
    goal_id: "g-1",
    title: `Item ${seq}`,
    cost_usd: null,
    milestone_id: null,
    standalone_deadline: "2026-06-12",
    purchased_at: null,
    ...over,
  };
}

function build(equipment: EquipmentRowLike[]) {
  return buildEquipmentModel({
    equipment,
    milestones: MILESTONES,
    goals: GOALS,
    today: TODAY,
  });
}

describe("buildEquipmentModel — scope and derivation", () => {
  it("includes ACTIVE goals' equipment only", () => {
    const groups = build([
      eq({ id: "eq-active", goal_id: "g-1" }),
      eq({ id: "eq-archived", goal_id: "g-3" }),
      eq({ id: "eq-unknown", goal_id: "g-nope" }),
    ]);
    const ids = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(ids).toEqual(["eq-active"]);
  });

  it("derives milestone-linked deadlines from the milestone's target_date", () => {
    const groups = build([
      eq({ id: "eq-ms", milestone_id: "ms-dated", standalone_deadline: null }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.urgency).toBe("this_week"); // exactly +7
    expect(groups[0]!.rows[0]).toMatchObject({
      deadline: "2026-06-17",
      overdue: false,
    });
  });

  it("milestone-linked with NULL target_date → the honest no_date group", () => {
    const groups = build([
      eq({ id: "eq-nd", milestone_id: "ms-undated", standalone_deadline: null }),
    ]);
    expect(groups).toEqual([
      {
        urgency: "no_date",
        rows: [expect.objectContaining({ id: "eq-nd", deadline: null })],
      },
    ]);
  });

  it("a dangling milestone reference degrades to no_date instead of throwing", () => {
    const groups = build([
      eq({ id: "eq-dang", milestone_id: "ms-gone", standalone_deadline: null }),
    ]);
    expect(groups[0]!.urgency).toBe("no_date");
  });

  it("carries goal attribution and cost through to the row", () => {
    const groups = build([
      eq({ id: "eq-attr", goal_id: "g-2", cost_usd: "145.00" }),
    ]);
    expect(groups[0]!.rows[0]).toMatchObject({
      goalId: "g-2",
      goalTitle: "Trail half marathon",
      goalColorIndex: 1,
      costUsd: "145.00",
    });
  });
});

describe("buildEquipmentModel — grouping and ordering", () => {
  it("groups by urgency in display order and omits empty groups", () => {
    const groups = build([
      eq({ id: "eq-later", standalone_deadline: "2026-07-11" }), // +31
      eq({ id: "eq-week", standalone_deadline: "2026-06-17" }), // +7
      eq({ id: "eq-month", standalone_deadline: "2026-06-18" }), // +8
    ]);
    expect(groups.map((g) => g.urgency)).toEqual([
      "this_week",
      "this_month",
      "later",
    ]);
  });

  it("overdue items ride in this_week with the overdue flag set", () => {
    const groups = build([
      eq({ id: "eq-over", standalone_deadline: "2026-06-07" }),
      eq({ id: "eq-soon", standalone_deadline: "2026-06-14" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.urgency).toBe("this_week");
    // Sorted by deadline ascending → the overdue item leads.
    expect(groups[0]!.rows.map((r) => [r.id, r.overdue])).toEqual([
      ["eq-over", true],
      ["eq-soon", false],
    ]);
  });

  it("purchased items STAY in their urgency group, flagged purchased", () => {
    const groups = build([
      eq({
        id: "eq-bought",
        standalone_deadline: "2026-06-14",
        purchased_at: "2026-06-05T09:00:00.000Z",
      }),
      eq({ id: "eq-open", standalone_deadline: "2026-06-15" }),
    ]);
    expect(groups[0]!.rows.map((r) => [r.id, r.purchased])).toEqual([
      ["eq-bought", true],
      ["eq-open", false],
    ]);
  });

  it("deadline ties and the no_date group sort by title", () => {
    const groups = build([
      eq({ id: "eq-b", title: "Boots", standalone_deadline: "2026-06-14" }),
      eq({ id: "eq-a", title: "Axe", standalone_deadline: "2026-06-14" }),
      eq({
        id: "eq-z",
        title: "Zip bag",
        milestone_id: "ms-undated",
        standalone_deadline: null,
      }),
      eq({
        id: "eq-h",
        title: "Headlamp",
        milestone_id: "ms-undated",
        standalone_deadline: null,
      }),
    ]);
    expect(groups[0]!.rows.map((r) => r.title)).toEqual(["Axe", "Boots"]);
    const noDate = groups.find((g) => g.urgency === "no_date")!;
    expect(noDate.rows.map((r) => r.title)).toEqual(["Headlamp", "Zip bag"]);
  });

  it("no equipment → no groups (the page renders its honest empty)", () => {
    expect(build([])).toEqual([]);
  });
});
