/**
 * plan-schema tests (no DB, node env — repo posture).
 *
 * Pins the application invariants the JSON-Schema grammar cannot express:
 * the equipment exactly-one rule (both directions), weekday bounds, and
 * milestone position-reference resolution — plus a full valid fixture so the
 * happy path stays honest.
 */
import { describe, expect, it } from "vitest";
import { planDraftSchema, planEquipmentSchema } from "./plan-schema";

/** A complete, valid plan fixture (the shape Slice 7 will render and save). */
const VALID_PLAN = {
  daily: [
    {
      title: "Walk 20 minutes",
      description: "Easy pace; this is base-building, not training.",
      estimated_duration_min: 20,
    },
    { title: "Log how the body feels", description: null, estimated_duration_min: null },
  ],
  weekly: [
    {
      title: "Run-walk intervals",
      description: "Alternate 2 minutes running, 3 walking.",
      weekday: 2,
      estimated_duration_min: 40,
    },
    {
      title: "Long slow run",
      description: null,
      weekday: 6,
      estimated_duration_min: 60,
    },
  ],
  milestones: [
    { title: "Run 5k without stopping", target_date: "2026-08-15", position: 0 },
    { title: "Finish a 10k race", target_date: "2026-10-10", position: 1 },
  ],
  equipment: [
    {
      title: "Running shoes",
      cost_usd: 90,
      milestone_position: 0,
      standalone_deadline: null,
    },
    {
      title: "Race registration",
      cost_usd: 45,
      milestone_position: null,
      standalone_deadline: "2026-09-01",
    },
  ],
};

describe("planDraftSchema", () => {
  it("accepts a complete valid plan", () => {
    const result = planDraftSchema.safeParse(VALID_PLAN);
    expect(result.success).toBe(true);
  });

  it("accepts weekday bounds 0 and 6, rejects -1 and 7", () => {
    for (const weekday of [0, 6]) {
      const plan = {
        ...VALID_PLAN,
        weekly: [{ ...VALID_PLAN.weekly[0]!, weekday }],
      };
      expect(planDraftSchema.safeParse(plan).success).toBe(true);
    }
    for (const weekday of [-1, 7]) {
      const plan = {
        ...VALID_PLAN,
        weekly: [{ ...VALID_PLAN.weekly[0]!, weekday }],
      };
      expect(planDraftSchema.safeParse(plan).success).toBe(false);
    }
  });

  it("rejects an equipment item with BOTH milestone link and standalone deadline", () => {
    const result = planEquipmentSchema.safeParse({
      title: "Running shoes",
      cost_usd: 90,
      milestone_position: 0,
      standalone_deadline: "2026-09-01",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an equipment item with NEITHER milestone link nor standalone deadline", () => {
    const result = planEquipmentSchema.safeParse({
      title: "Running shoes",
      cost_usd: 90,
      milestone_position: null,
      standalone_deadline: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts each side of the exactly-one invariant alone", () => {
    expect(
      planEquipmentSchema.safeParse({
        title: "Running shoes",
        cost_usd: null,
        milestone_position: 1,
        standalone_deadline: null,
      }).success,
    ).toBe(true);
    expect(
      planEquipmentSchema.safeParse({
        title: "Race registration",
        cost_usd: 45,
        milestone_position: null,
        standalone_deadline: "2026-09-01",
      }).success,
    ).toBe(true);
  });

  it("rejects a milestone_position that resolves to no milestone", () => {
    const plan = {
      ...VALID_PLAN,
      equipment: [
        {
          title: "Running shoes",
          cost_usd: 90,
          milestone_position: 5, // milestones only define 0 and 1
          standalone_deadline: null,
        },
      ],
    };
    const result = planDraftSchema.safeParse(plan);
    expect(result.success).toBe(false);
  });

  it("rejects malformed dates (must be YYYY-MM-DD)", () => {
    const plan = {
      ...VALID_PLAN,
      milestones: [
        { title: "Run 5k", target_date: "August 15th", position: 0 },
      ],
      equipment: [],
    };
    expect(planDraftSchema.safeParse(plan).success).toBe(false);
  });

  it("accepts empty arrays (a goal can honestly need no equipment)", () => {
    const plan = { ...VALID_PLAN, equipment: [] };
    expect(planDraftSchema.safeParse(plan).success).toBe(true);
  });
});
