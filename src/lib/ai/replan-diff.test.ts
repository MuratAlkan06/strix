/**
 * replan-diff tests — the persisted-diff contract for
 * replan_proposals.proposed_changes.
 *
 * Pins:
 *   - EMPTY_REPLAN_DIFF (the Slice-1 pending placeholder) parses;
 *   - a fully populated valid diff parses;
 *   - malformed AI output is REJECTED before persisting: wrong cadence enum,
 *     a missing add/modify/remove array, non-positive durations, weekday out
 *     of the 0–6 convention.
 */
import { describe, expect, it } from "vitest";

import { EMPTY_REPLAN_DIFF, ReplanDiffSchema } from "./replan-diff";

/** A populated, valid diff exercising every section and branch. */
function validDiff() {
  return {
    recurring_tasks: {
      add: [
        {
          title: "Zone-2 run",
          cadence: "weekly",
          weekday: 6,
          estimated_duration_min: 40,
        },
        {
          title: "Mobility",
          cadence: "daily",
          weekday: null,
          estimated_duration_min: 15,
        },
      ],
      modify: [
        {
          id: "rt-1",
          changes: { title: "Long run 18 km", weekday: 0, active: true },
        },
        { id: "rt-2", changes: { estimated_duration_min: 25 } },
      ],
      remove: [{ id: "rt-3" }],
    },
    milestones: {
      add: [{ title: "10k time-trial", target_date: "2026-07-04", position: 2 }],
      modify: [{ id: "ms-1", changes: { target_date: "2026-08-01" } }],
      remove: [{ id: "ms-2" }],
    },
    equipment: {
      add: [
        {
          title: "Hydration vest",
          cost_usd: 89.5,
          milestone_id: null,
          standalone_deadline: "2026-06-20",
        },
        {
          title: "Glacier glasses",
          cost_usd: null,
          milestone_id: "ms-1",
          standalone_deadline: null,
        },
      ],
      modify: [{ id: "eq-1", changes: { cost_usd: null, milestone_id: null } }],
      remove: [{ id: "eq-2" }],
    },
  };
}

describe("ReplanDiffSchema — accepts valid diffs", () => {
  it("accepts EMPTY_REPLAN_DIFF (the Slice-1 placeholder)", () => {
    const result = ReplanDiffSchema.safeParse(EMPTY_REPLAN_DIFF);
    expect(result.success).toBe(true);
  });

  it("accepts a populated valid diff and round-trips it", () => {
    const result = ReplanDiffSchema.safeParse(validDiff());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(validDiff());
    }
  });
});

describe("ReplanDiffSchema — rejects malformed AI output", () => {
  it("rejects a wrong cadence enum value", () => {
    const diff = validDiff();
    diff.recurring_tasks.add[0]!.cadence = "monthly";
    expect(ReplanDiffSchema.safeParse(diff).success).toBe(false);
  });

  it("rejects a missing add/modify/remove array", () => {
    const diff = validDiff() as unknown as Record<
      string,
      Record<string, unknown>
    >;
    delete diff.milestones!.remove;
    expect(ReplanDiffSchema.safeParse(diff).success).toBe(false);
  });

  it("rejects a negative estimated duration", () => {
    const diff = validDiff();
    diff.recurring_tasks.add[0]!.estimated_duration_min = -10;
    expect(ReplanDiffSchema.safeParse(diff).success).toBe(false);
  });

  it("rejects a zero estimated duration (positive means > 0)", () => {
    const diff = validDiff();
    diff.recurring_tasks.add[0]!.estimated_duration_min = 0;
    expect(ReplanDiffSchema.safeParse(diff).success).toBe(false);
  });

  it("rejects weekday 7 (the convention is 0–6, 0 = Sunday)", () => {
    const diff = validDiff();
    diff.recurring_tasks.add[0]!.weekday = 7;
    expect(ReplanDiffSchema.safeParse(diff).success).toBe(false);
  });

  it("rejects weekday 7 inside a modify changes payload", () => {
    const diff = validDiff();
    diff.recurring_tasks.modify[0]!.changes.weekday = 7;
    expect(ReplanDiffSchema.safeParse(diff).success).toBe(false);
  });
});
