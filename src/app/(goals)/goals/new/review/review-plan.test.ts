/**
 * review-plan tests — the pure logic behind the draft-plan review/edit
 * surface: the medical-disclaimer predicate (both activity-type lists), the
 * edit reducer (edits_count semantics, weekday bounds, the equipment
 * exactly-one invariant, read-only daily/weekly descriptions, reorder),
 * serialization, and the save-path
 * normalization (sequential positions; deterministic first-match resolution
 * of colliding milestone positions).
 */
import { describe, expect, it } from "vitest";

import type { PlanDraft } from "@/lib/ai/plan-schema";
import {
  MEDICAL_DISCLAIMER,
  normalizePlanForSave,
  planEditReducer,
  requiresMedicalDisclaimer,
  serializeEditablePlan,
  toEditablePlan,
  validateEditablePlan,
  type EditablePlan,
  type PlanEditAction,
} from "./review-plan";

const BASE_PLAN: PlanDraft = {
  daily: [
    { title: "Morning mobility", description: "Hips and ankles.", estimated_duration_min: 15 },
  ],
  weekly: [
    { title: "Long hike", description: null, weekday: 6, estimated_duration_min: 180 },
  ],
  milestones: [
    { title: "First", target_date: "2026-08-15", position: 0 },
    { title: "Second", target_date: "2026-09-20", position: 1 },
    { title: "Third", target_date: "2027-06-15", position: 2 },
  ],
  equipment: [
    { title: "Boots", cost_usd: 450, milestone_position: 1, standalone_deadline: null },
    { title: "Poles", cost_usd: 90, milestone_position: null, standalone_deadline: "2026-07-30" },
  ],
};

function freshState(): EditablePlan {
  return toEditablePlan(BASE_PLAN);
}

// ---------------------------------------------------------------------------
// Medical disclaimer predicate — both lists, exhaustively
// ---------------------------------------------------------------------------

describe("requiresMedicalDisclaimer", () => {
  const physical = [
    "climbing",
    "mountaineering",
    "running",
    "cycling",
    "swimming",
    "strength",
  ];
  const nonPhysical = [
    "language",
    "writing",
    "instrument",
    "business",
    "study",
    "other",
  ];

  it.each(physical)("physical type %s → disclaimer", (t) => {
    expect(requiresMedicalDisclaimer(t)).toBe(true);
  });

  it.each(nonPhysical)("non-physical type %s → no disclaimer", (t) => {
    expect(requiresMedicalDisclaimer(t)).toBe(false);
  });

  it("copy is the phase-doc line, verbatim", () => {
    expect(MEDICAL_DISCLAIMER).toBe(
      "This plan is generated guidance, not medical advice. Check with a " +
        "physician before starting a demanding physical program.",
    );
  });
});

// ---------------------------------------------------------------------------
// Reducer — edits_count counts applied modifications exactly once
// ---------------------------------------------------------------------------

describe("planEditReducer — edits_count", () => {
  it("starts at zero", () => {
    expect(freshState().editsCount).toBe(0);
  });

  it("counts an applied field update once", () => {
    const next = planEditReducer(freshState(), {
      type: "update",
      section: "daily",
      id: "d0",
      patch: { title: "Evening mobility" },
    });
    expect(next.editsCount).toBe(1);
    expect(next.daily[0]!.title).toBe("Evening mobility");
  });

  it("does NOT count a no-op update (identical values)", () => {
    const state = freshState();
    const next = planEditReducer(state, {
      type: "update",
      section: "daily",
      id: "d0",
      patch: { title: "Morning mobility" },
    });
    expect(next).toBe(state);
    expect(next.editsCount).toBe(0);
  });

  it("does NOT count an update to an unknown id", () => {
    const state = freshState();
    expect(
      planEditReducer(state, {
        type: "update",
        section: "daily",
        id: "nope",
        patch: { title: "x" },
      }),
    ).toBe(state);
  });

  it("counts add and remove one each", () => {
    let state = freshState();
    state = planEditReducer(state, { type: "add", section: "daily" });
    expect(state.editsCount).toBe(1);
    expect(state.daily).toHaveLength(2);
    state = planEditReducer(state, {
      type: "remove",
      section: "daily",
      id: state.daily[1]!.id,
    });
    expect(state.editsCount).toBe(2);
    expect(state.daily).toHaveLength(1);
  });

  it("counts a milestone move once; no-op moves at the edges don't count", () => {
    let state = freshState();
    state = planEditReducer(state, {
      type: "moveMilestone",
      id: "m1",
      direction: "up",
    });
    expect(state.editsCount).toBe(1);
    expect(state.milestones.map((m) => m.title)).toEqual([
      "Second",
      "First",
      "Third",
    ]);
    const after = planEditReducer(state, {
      type: "moveMilestone",
      id: "m1",
      direction: "up",
    });
    expect(after).toBe(state); // already first — nothing applied
  });
});

describe("planEditReducer — weekday bounds 0–6", () => {
  it("rejects out-of-bounds weekday patches (state unchanged)", () => {
    const state = freshState();
    for (const weekday of [-1, 7, 3.5, Number.NaN]) {
      expect(
        planEditReducer(state, {
          type: "update",
          section: "weekly",
          id: "w0",
          patch: { weekday },
        }),
      ).toBe(state);
    }
  });

  it("accepts in-bounds weekdays", () => {
    const next = planEditReducer(freshState(), {
      type: "update",
      section: "weekly",
      id: "w0",
      patch: { weekday: 0 },
    });
    expect(next.weekly[0]!.weekday).toBe(0);
  });
});

describe("planEditReducer — daily/weekly descriptions are read-only", () => {
  // recurring_tasks has no description column, so a description edit would
  // silently evaporate at save ("nothing silent"). The patch type excludes
  // description AND the reducer strips it at runtime: stray patches never
  // land and never count toward edits_count.
  it("a description-only patch is a no-op (state identity, no edit counted)", () => {
    const state = freshState();
    for (const section of ["daily", "weekly"] as const) {
      const next = planEditReducer(state, {
        type: "update",
        section,
        id: section === "daily" ? "d0" : "w0",
        patch: { description: "rewritten" },
      } as unknown as PlanEditAction);
      expect(next).toBe(state);
      expect(next.editsCount).toBe(0);
    }
  });

  it("a mixed patch applies the other fields but never the description", () => {
    const next = planEditReducer(freshState(), {
      type: "update",
      section: "weekly",
      id: "w0",
      patch: { title: "Long trail run", description: "sneaky" },
    } as unknown as PlanEditAction);
    expect(next.weekly[0]!.title).toBe("Long trail run");
    expect(next.weekly[0]!.description).toBe(""); // fixture weekly has none
    expect(next.editsCount).toBe(1);
  });
});

describe("planEditReducer — equipment exactly-one invariant", () => {
  it("linking to a milestone clears the standalone date", () => {
    const next = planEditReducer(freshState(), {
      type: "update",
      section: "equipment",
      id: "e1", // Poles: standalone 2026-07-30
      patch: { milestoneId: "m0" },
    });
    expect(next.equipment[1]!.milestoneId).toBe("m0");
    expect(next.equipment[1]!.standalone_deadline).toBeNull();
  });

  it("setting a standalone date clears the milestone link", () => {
    const next = planEditReducer(freshState(), {
      type: "update",
      section: "equipment",
      id: "e0", // Boots: linked to m1
      patch: { standalone_deadline: "2026-10-01" },
    });
    expect(next.equipment[0]!.standalone_deadline).toBe("2026-10-01");
    expect(next.equipment[0]!.milestoneId).toBeNull();
  });

  it("removing a milestone orphans its linked equipment (one edit total)", () => {
    const next = planEditReducer(freshState(), {
      type: "remove",
      section: "milestones",
      id: "m1",
    });
    expect(next.milestones).toHaveLength(2);
    expect(next.equipment[0]!.milestoneId).toBeNull();
    expect(next.equipment[0]!.standalone_deadline).toBeNull();
    expect(next.editsCount).toBe(1);
    // …and validation now holds the save until the user re-anchors it.
    const issues = validateEditablePlan(next);
    expect(issues.some((i) => i.section === "equipment" && i.id === "e0")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateEditablePlan", () => {
  it("passes the untouched fixture", () => {
    expect(validateEditablePlan(freshState())).toEqual([]);
  });

  it("flags empty titles, missing dates, and both-set equipment", () => {
    let state = freshState();
    state = planEditReducer(state, { type: "add", section: "milestones" });
    const added = state.milestones[state.milestones.length - 1]!;
    const issues = validateEditablePlan(state);
    expect(issues.filter((i) => i.id === added.id)).toHaveLength(2); // title + date
  });
});

// ---------------------------------------------------------------------------
// Serialization (client model → plan-draft wire shape)
// ---------------------------------------------------------------------------

describe("serializeEditablePlan", () => {
  it("emits sequential positions in display order and resolves links", () => {
    let state = freshState();
    state = planEditReducer(state, {
      type: "moveMilestone",
      id: "m2",
      direction: "up",
    }); // order: First, Third, Second
    const wire = serializeEditablePlan(state);
    expect(wire.milestones.map((m) => [m.title, m.position])).toEqual([
      ["First", 0],
      ["Third", 1],
      ["Second", 2],
    ]);
    // Boots were linked to "Second" (m1) — now at position 2.
    expect(wire.equipment[0]!.milestone_position).toBe(2);
    expect(wire.equipment[0]!.standalone_deadline).toBeNull();
    // Poles stay standalone.
    expect(wire.equipment[1]!.milestone_position).toBeNull();
    expect(wire.equipment[1]!.standalone_deadline).toBe("2026-07-30");
  });

  it("trims titles; read-only descriptions pass through (empty → null)", () => {
    let state = freshState();
    state = planEditReducer(state, {
      type: "update",
      section: "daily",
      id: "d0",
      patch: { title: "  Stretch  " },
    });
    state = planEditReducer(state, { type: "add", section: "daily" });
    const wire = serializeEditablePlan(state);
    expect(wire.daily[0]!.title).toBe("Stretch");
    // The AI's review-context description survives the round-trip untouched…
    expect(wire.daily[0]!.description).toBe("Hips and ankles.");
    // …and a freshly added item (description "") serializes to null.
    expect(wire.daily[1]!.description).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Save-path normalization — collisions resolve deterministically
// ---------------------------------------------------------------------------

describe("normalizePlanForSave", () => {
  it("reassigns positions sequentially from sparse draft positions", () => {
    const sparse: PlanDraft = {
      ...BASE_PLAN,
      milestones: [
        { title: "B", target_date: "2026-09-01", position: 10 },
        { title: "A", target_date: "2026-08-01", position: 2 },
      ],
      equipment: [
        { title: "Rope", cost_usd: null, milestone_position: 10, standalone_deadline: null },
      ],
    };
    const normalized = normalizePlanForSave(sparse);
    expect(normalized.milestones.map((m) => [m.title, m.position])).toEqual([
      ["A", 0],
      ["B", 1],
    ]);
    expect(normalized.equipment[0]!.milestoneIndex).toBe(1); // B, formerly 10
  });

  it("resolves COLLIDING positions by first match after normalization (deterministic)", () => {
    const colliding: PlanDraft = {
      ...BASE_PLAN,
      milestones: [
        { title: "First-at-1", target_date: "2026-08-01", position: 1 },
        { title: "Second-at-1", target_date: "2026-09-01", position: 1 },
        { title: "At-0", target_date: "2026-07-01", position: 0 },
      ],
      equipment: [
        { title: "Rack", cost_usd: null, milestone_position: 1, standalone_deadline: null },
      ],
    };
    const a = normalizePlanForSave(colliding);
    const b = normalizePlanForSave(colliding);
    // Stable order: At-0 first, then the colliding pair in draft order.
    expect(a.milestones.map((m) => m.title)).toEqual([
      "At-0",
      "First-at-1",
      "Second-at-1",
    ]);
    // First match for original position 1 is "First-at-1" at index 1.
    expect(a.equipment[0]!.milestoneIndex).toBe(1);
    expect(b.equipment[0]!.milestoneIndex).toBe(1); // run-to-run deterministic
  });

  it("passes daily/weekly through and keeps standalone equipment standalone", () => {
    const normalized = normalizePlanForSave(BASE_PLAN);
    expect(normalized.daily).toEqual(BASE_PLAN.daily);
    expect(normalized.weekly).toEqual(BASE_PLAN.weekly);
    expect(normalized.equipment[1]).toEqual({
      title: "Poles",
      cost_usd: 90,
      milestoneIndex: null,
      standalone_deadline: "2026-07-30",
    });
  });
});

// ---------------------------------------------------------------------------
// toEditablePlan — load-time linking mirrors the save-path resolution
// ---------------------------------------------------------------------------

describe("toEditablePlan", () => {
  it("links equipment to the first colliding milestone (same rule as save)", () => {
    const colliding: PlanDraft = {
      ...BASE_PLAN,
      milestones: [
        { title: "X", target_date: "2026-08-01", position: 0 },
        { title: "Y", target_date: "2026-09-01", position: 0 },
      ],
      equipment: [
        { title: "Rack", cost_usd: null, milestone_position: 0, standalone_deadline: null },
      ],
    };
    const state = toEditablePlan(colliding);
    expect(state.equipment[0]!.milestoneId).toBe(state.milestones[0]!.id);
    expect(state.milestones[0]!.title).toBe("X");
  });
});
