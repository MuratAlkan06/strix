/**
 * list-model tests — the goals-list view model: status grouping, per-card
 * progress/next-milestone composition, add-tile visibility below/at the cap,
 * and the gap-filled next-color preview.
 */
import { describe, expect, it } from "vitest";

import {
  FREE_ACTIVE_GOAL_CAP,
  PAID_ACTIVE_GOAL_CAP,
} from "@/lib/goal-colors";
import {
  buildGoalsListModel,
  type GoalRowLike,
  type MilestoneRowLike,
} from "./list-model";

let seq = 0;
function goal(over: Partial<GoalRowLike> = {}): GoalRowLike {
  seq += 1;
  return {
    id: `g-${seq}`,
    title: `Goal ${seq}`,
    status: "active",
    color_index: 0,
    target_date: null,
    started_at: `2026-05-${String(seq).padStart(2, "0")}T08:00:00.000Z`,
    ...over,
  };
}

describe("buildGoalsListModel — card composition", () => {
  it("computes progress and next milestone per active goal", () => {
    const g = goal({ id: "g-a", target_date: "2027-07-15" });
    const milestones: MilestoneRowLike[] = [
      {
        goal_id: "g-a",
        title: "Done first",
        completed_at: "2026-05-20T10:00:00.000Z",
        position: 0,
      },
      { goal_id: "g-a", title: "Up next", completed_at: null, position: 1 },
      { goal_id: "g-a", title: "Later", completed_at: null, position: 2 },
      // Another goal's milestone must not bleed in.
      { goal_id: "g-other", title: "Foreign", completed_at: null, position: 0 },
    ];
    const model = buildGoalsListModel([g], milestones);
    expect(model.active).toHaveLength(1);
    expect(model.active[0]).toMatchObject({
      id: "g-a",
      targetDate: "2027-07-15",
      milestonesTotal: 3,
      milestonesCompleted: 1,
      progressPercent: 33,
      nextMilestoneTitle: "Up next",
    });
  });

  it("0-milestone goal → percent null and no next milestone (honest state)", () => {
    const model = buildGoalsListModel([goal()], []);
    expect(model.active[0]).toMatchObject({
      milestonesTotal: 0,
      milestonesCompleted: 0,
      progressPercent: null,
      nextMilestoneTitle: null,
    });
  });

  it("all milestones complete → nextMilestoneTitle null, percent 100", () => {
    const g = goal({ id: "g-done" });
    const model = buildGoalsListModel(
      [g],
      [
        {
          goal_id: "g-done",
          title: "Only one",
          completed_at: "2026-06-01T00:00:00.000Z",
          position: 0,
        },
      ],
    );
    expect(model.active[0]).toMatchObject({
      progressPercent: 100,
      nextMilestoneTitle: null,
    });
  });

  it("sorts active goals by started_at ascending", () => {
    const later = goal({ id: "g-later", started_at: "2026-06-01T00:00:00.000Z" });
    const earlier = goal({
      id: "g-earlier",
      started_at: "2026-04-01T00:00:00.000Z",
    });
    const model = buildGoalsListModel([later, earlier], []);
    expect(model.active.map((g) => g.id)).toEqual(["g-earlier", "g-later"]);
  });

  it("groups by status: completed and archived never join the active grid", () => {
    const model = buildGoalsListModel(
      [
        goal({ id: "g-act", status: "active" }),
        goal({ id: "g-com", status: "completed", color_index: 1 }),
        goal({ id: "g-arc", status: "archived", color_index: 2 }),
      ],
      [],
    );
    expect(model.active.map((g) => g.id)).toEqual(["g-act"]);
    expect(model.completed.map((g) => g.id)).toEqual(["g-com"]);
    expect(model.archived.map((g) => g.id)).toEqual(["g-arc"]);
  });
});

describe("buildGoalsListModel — add tile (per-tier cap, S1)", () => {
  it("visible below the cap, previewing the gap-filled next color (Free)", () => {
    // Used colors {0, 2} → min available is 1; 2 active < Free cap 3.
    const model = buildGoalsListModel(
      [goal({ color_index: 0 }), goal({ color_index: 2 })],
      [],
      "free",
    );
    expect(model.addTileColorIndex).toBe(1);
  });

  it("first goal preview is color 0 (default tier = free)", () => {
    expect(buildGoalsListModel([], []).addTileColorIndex).toBe(0);
  });

  it("Free hides the tile at 3 active", () => {
    const three = [0, 1, 2].map((i) => goal({ color_index: i }));
    expect(three).toHaveLength(FREE_ACTIVE_GOAL_CAP);
    expect(buildGoalsListModel(three, [], "free").addTileColorIndex).toBeNull();
  });

  it("Pro/Max still show the tile at 3 active (cap 5)", () => {
    const three = [0, 1, 2].map((i) => goal({ color_index: i }));
    expect(buildGoalsListModel(three, [], "pro").addTileColorIndex).toBe(3);
    expect(buildGoalsListModel(three, [], "max").addTileColorIndex).toBe(3);
  });

  it("Pro/Max hide the tile at 5 active", () => {
    const five = [0, 1, 2, 3, 4].map((i) => goal({ color_index: i }));
    expect(five).toHaveLength(PAID_ACTIVE_GOAL_CAP);
    expect(buildGoalsListModel(five, [], "pro").addTileColorIndex).toBeNull();
    expect(buildGoalsListModel(five, [], "max").addTileColorIndex).toBeNull();
  });

  it("completed/archived goals do NOT count against the cap or palette", () => {
    const model = buildGoalsListModel(
      [
        goal({ color_index: 0, status: "active" }),
        goal({ color_index: 1, status: "completed" }),
      ],
      [],
      "free",
    );
    // Only the active goal's color is used → next is 1.
    expect(model.addTileColorIndex).toBe(1);
  });
});
