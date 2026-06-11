/**
 * detail-model tests — the pure goal-detail rules (no DB, no React):
 *
 *   - Effective-intensity chain at all three positions (override → intake →
 *     account) plus the degenerate all-null case; the support copy carries
 *     the contract's exact "Follows your intake intensity" line when the
 *     override is unset and the intake pick is in play.
 *   - 404 path at the model level: a malformed id never resolves; an unknown
 *     OR foreign id (scopedDb's ownership filter → zero rows) resolves to
 *     the same null, so the page's notFound() leaks nothing.
 *   - View-model construction: removed (active=false) tasks are excluded,
 *     daily/weekly split, milestone position ordering, completed/purchased
 *     surfacing.
 *   - Replan banner gate: flag !== "true" never renders, regardless of
 *     structural edits; "true" renders only after a structural edit
 *     (verification step 12's automated counterpart).
 */
import { describe, expect, it } from "vitest";

import {
  buildGoalDetailModel,
  effectiveIntensity,
  intensitySupportCopy,
  isUuid,
  nextIntensityOnKey,
  resolveGoalRow,
  shouldShowReplanBanner,
  type EquipmentRowLike,
  type GoalRowLike,
  type MilestoneRowLike,
  type TaskRowLike,
} from "./detail-model";

// ---------------------------------------------------------------------------
// Effective intensity — the chain in order
// ---------------------------------------------------------------------------

describe("effectiveIntensity — the override → intake → account chain", () => {
  it("override set → override wins over both others", () => {
    expect(
      effectiveIntensity({
        override: "brutal",
        intakeConfirmed: "challenging",
        accountPreference: "comfortable",
      }),
    ).toEqual({ value: "brutal", source: "override" });
  });

  it("override unset → the goal's intake confirmed_intensity (NOT the account preference)", () => {
    expect(
      effectiveIntensity({
        override: null,
        intakeConfirmed: "challenging",
        accountPreference: "comfortable",
      }),
    ).toEqual({ value: "challenging", source: "intake" });
  });

  it("override + intake unset → users.intensity_preference is the final fallback", () => {
    expect(
      effectiveIntensity({
        override: null,
        intakeConfirmed: null,
        accountPreference: "comfortable",
      }),
    ).toEqual({ value: "comfortable", source: "account" });
  });

  it("all unset → honest none (no invented default)", () => {
    expect(
      effectiveIntensity({
        override: null,
        intakeConfirmed: null,
        accountPreference: null,
      }),
    ).toEqual({ value: null, source: "none" });
  });

  it("override set with nothing else → still the override", () => {
    expect(
      effectiveIntensity({
        override: "comfortable",
        intakeConfirmed: null,
        accountPreference: null,
      }),
    ).toEqual({ value: "comfortable", source: "override" });
  });
});

describe("intensitySupportCopy", () => {
  it('unset override following the intake pick → the contract\'s exact copy "Follows your intake intensity"', () => {
    expect(intensitySupportCopy("intake")).toBe("Follows your intake intensity");
  });

  it("override → states it is set for this goal", () => {
    expect(intensitySupportCopy("override")).toBe("Set for this goal.");
  });

  it('account fallback → says "account preference", never the intake line', () => {
    expect(intensitySupportCopy("account")).toContain("account preference");
    expect(intensitySupportCopy("account")).not.toContain("intake");
  });
});

// ---------------------------------------------------------------------------
// Intensity keyboard (APG radiogroup arrows)
// ---------------------------------------------------------------------------

describe("nextIntensityOnKey — arrows move with wrap, everything else is the browser's", () => {
  it("ArrowRight/ArrowDown advance, wrapping from the last back to the first", () => {
    expect(nextIntensityOnKey("comfortable", "ArrowRight")).toBe("challenging");
    expect(nextIntensityOnKey("challenging", "ArrowDown")).toBe("brutal");
    expect(nextIntensityOnKey("brutal", "ArrowRight")).toBe("comfortable");
    expect(nextIntensityOnKey("brutal", "ArrowDown")).toBe("comfortable");
  });

  it("ArrowLeft/ArrowUp retreat, wrapping from the first back to the last", () => {
    expect(nextIntensityOnKey("brutal", "ArrowLeft")).toBe("challenging");
    expect(nextIntensityOnKey("challenging", "ArrowUp")).toBe("comfortable");
    expect(nextIntensityOnKey("comfortable", "ArrowLeft")).toBe("brutal");
    expect(nextIntensityOnKey("comfortable", "ArrowUp")).toBe("brutal");
  });

  it("nothing selected (null) → the first option holds the tab stop and is the base", () => {
    expect(nextIntensityOnKey(null, "ArrowRight")).toBe("challenging");
    expect(nextIntensityOnKey(null, "ArrowDown")).toBe("challenging");
    expect(nextIntensityOnKey(null, "ArrowLeft")).toBe("brutal");
    expect(nextIntensityOnKey(null, "ArrowUp")).toBe("brutal");
  });

  it.each([["Tab"], ["Home"], ["End"], [" "], ["Enter"], ["Escape"], ["a"]])(
    "unrelated key (%j) → null so the browser default (and onClick selection) stands",
    (key) => {
      expect(nextIntensityOnKey("challenging", key)).toBeNull();
      expect(nextIntensityOnKey(null, key)).toBeNull();
    },
  );
});

// ---------------------------------------------------------------------------
// 404 path (model-level)
// ---------------------------------------------------------------------------

const GOAL_ID = "5f9c2c4a-7a1b-4f4e-9b2d-3c8d1e6f0a12";

describe("resolveGoalRow — foreign/unknown/malformed ids all 404 identically", () => {
  const row = { id: GOAL_ID };

  it("a well-formed id with an owned row resolves", () => {
    expect(resolveGoalRow(GOAL_ID, [row])).toBe(row);
  });

  it("foreign or unknown id → scopedDb returned zero rows → null (the page 404s)", () => {
    // The ownership filter makes another user's goal and a nonexistent goal
    // indistinguishable: both arrive here as an empty result set.
    expect(resolveGoalRow(GOAL_ID, [])).toBeNull();
  });

  it.each([
    ["empty string", ""],
    ["not a uuid", "goal-1"],
    ["sql-ish payload", "' OR 1=1 --"],
  ])("malformed id (%s) → null even if rows were somehow present", (_l, id) => {
    expect(resolveGoalRow(id, [row])).toBeNull();
  });
});

describe("isUuid", () => {
  it("accepts a canonical uuid (case-insensitive)", () => {
    expect(isUuid(GOAL_ID)).toBe(true);
    expect(isUuid(GOAL_ID.toUpperCase())).toBe(true);
  });

  it.each(["", "abc", 42, null, undefined, `${GOAL_ID} `])(
    "rejects %j",
    (v) => {
      expect(isUuid(v)).toBe(false);
    },
  );
});

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

const GOAL: GoalRowLike = {
  id: GOAL_ID,
  title: "Climb Mont Blanc",
  status: "active",
  color_index: 2,
  intensity_override: null,
  target_date: "2027-07-15",
};

const TASKS: TaskRowLike[] = [
  {
    id: "t2",
    title: "Stairs",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 30,
    active: true,
    created_at: "2026-06-01T08:01:00.000Z",
  },
  {
    id: "t1",
    title: "Core",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 20,
    active: true,
    created_at: "2026-06-01T08:00:00.000Z",
  },
  {
    id: "t3",
    title: "Removed drill",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 10,
    active: false, // removed — excluded from the model
    created_at: "2026-06-01T08:02:00.000Z",
  },
  {
    id: "t4",
    title: "Long hike",
    cadence: "weekly",
    weekday: 6,
    estimated_duration_min: 240,
    active: true,
    created_at: "2026-06-01T08:03:00.000Z",
  },
];

const MILESTONES: MilestoneRowLike[] = [
  {
    id: "m2",
    title: "Glacier course",
    target_date: "2026-12-15",
    completed_at: null,
    position: 1,
    created_at: "2026-06-01T08:01:00.000Z",
  },
  {
    id: "m1",
    title: "Hiking base",
    target_date: "2026-09-01",
    completed_at: "2026-06-05T10:00:00.000Z",
    position: 0,
    created_at: "2026-06-01T08:00:00.000Z",
  },
];

const EQUIPMENT: EquipmentRowLike[] = [
  {
    id: "e1",
    title: "Boots",
    cost_usd: "450.00",
    milestone_id: "m2",
    standalone_deadline: null,
    purchased_at: null,
    created_at: "2026-06-01T08:00:00.000Z",
  },
  {
    id: "e2",
    title: "Harness",
    cost_usd: null,
    milestone_id: null,
    standalone_deadline: "2026-11-01",
    purchased_at: "2026-06-05T09:00:00.000Z",
    created_at: "2026-06-01T08:01:00.000Z",
  },
];

describe("buildGoalDetailModel", () => {
  const model = buildGoalDetailModel({
    goal: GOAL,
    intakeConfirmed: "challenging",
    accountPreference: "comfortable",
    activityType: "mountaineering",
    tasks: TASKS,
    milestones: MILESTONES,
    equipment: EQUIPMENT,
  });

  it("carries the header fields and the derived intensity", () => {
    expect(model.id).toBe(GOAL_ID);
    expect(model.title).toBe("Climb Mont Blanc");
    expect(model.colorIndex).toBe(2);
    expect(model.targetDate).toBe("2027-07-15");
    expect(model.intensity).toEqual({ value: "challenging", source: "intake" });
  });

  it("maps the intake activity_type to the goal's scene variant", () => {
    expect(model.sceneVariant).toBe("mountain");
  });

  it("no intake summary (activityType null) → the default scene variant", () => {
    const noSummary = buildGoalDetailModel({
      goal: GOAL,
      intakeConfirmed: null,
      accountPreference: null,
      activityType: null,
      tasks: [],
      milestones: [],
      equipment: [],
    });
    expect(noSummary.sceneVariant).toBe("mountain");
  });

  it("excludes removed (active=false) tasks and splits daily/weekly in creation order", () => {
    expect(model.daily.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(model.weekly.map((t) => t.id)).toEqual(["t4"]);
    expect(model.daily.every((t) => t.weekday === null)).toBe(true);
    expect(model.weekly[0]!.weekday).toBe(6);
  });

  it("orders milestones by position and surfaces completion as an ISO date", () => {
    expect(model.milestones.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(model.milestones[0]!.completedOn).toBe("2026-06-05");
    expect(model.milestones[1]!.completedOn).toBeNull();
  });

  it("maps equipment with its exactly-one linkage and purchased state", () => {
    expect(model.equipment).toEqual([
      {
        id: "e1",
        title: "Boots",
        costUsd: "450.00",
        milestoneId: "m2",
        standaloneDeadline: null,
        purchased: false,
      },
      {
        id: "e2",
        title: "Harness",
        costUsd: null,
        milestoneId: null,
        standaloneDeadline: "2026-11-01",
        purchased: true,
      },
    ]);
  });

  it("override set on the goal → the model's intensity is the override", () => {
    const overridden = buildGoalDetailModel({
      goal: { ...GOAL, intensity_override: "brutal" },
      intakeConfirmed: "challenging",
      accountPreference: "comfortable",
      activityType: "mountaineering",
      tasks: [],
      milestones: [],
      equipment: [],
    });
    expect(overridden.intensity).toEqual({ value: "brutal", source: "override" });
  });
});

// ---------------------------------------------------------------------------
// Replan banner gate (NEXT_PUBLIC_REPLAN_ENABLED)
// ---------------------------------------------------------------------------

describe("shouldShowReplanBanner — the Phase 2 flag gate", () => {
  it.each([undefined, "", "false", "TRUE", "1", "yes"])(
    "flag %j → never renders, even after a structural edit",
    (flag) => {
      expect(shouldShowReplanBanner(flag as string | undefined, true)).toBe(
        false,
      );
      expect(shouldShowReplanBanner(flag as string | undefined, false)).toBe(
        false,
      );
    },
  );

  it('flag "true" with no structural edit → no banner', () => {
    expect(shouldShowReplanBanner("true", false)).toBe(false);
  });

  it('flag "true" after a structural edit → the banner renders (Phase 2 flips this on)', () => {
    expect(shouldShowReplanBanner("true", true)).toBe(true);
  });
});
