/**
 * replan-diff tests — the persisted-diff contract for
 * replan_proposals.proposed_changes.
 *
 * Pins:
 *   - EMPTY_REPLAN_DIFF (the Slice-1 pending placeholder) parses;
 *   - a fully populated valid diff parses;
 *   - malformed AI output is REJECTED before persisting: wrong cadence enum,
 *     a missing add/modify/remove array, non-positive durations, weekday out
 *     of the 0–6 convention;
 *   - the hand-written structured-outputs face (REPLAN_JSON_SCHEMA) stays in
 *     step with the zod face: same sections, add fields all required,
 *     modify.changes fields optional-by-omission, additionalProperties: false
 *     on every object node.
 */
import { describe, expect, it } from "vitest";

import {
  EMPTY_REPLAN_DIFF,
  REPLAN_JSON_SCHEMA,
  ReplanDiffSchema,
  replanOutputFormat,
} from "./replan-diff";

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

describe("REPLAN_JSON_SCHEMA — the structured-outputs face stays in step with zod", () => {
  it("mirrors the zod sections and the add/modify/remove triads", () => {
    expect(REPLAN_JSON_SCHEMA.required).toEqual([
      "recurring_tasks",
      "milestones",
      "equipment",
    ]);
    for (const section of ["recurring_tasks", "milestones", "equipment"] as const) {
      const node = REPLAN_JSON_SCHEMA.properties[section];
      expect(node.required).toEqual(["add", "modify", "remove"]);
    }
  });

  it("requires every add field but leaves all modify.changes fields optional", () => {
    const sections = REPLAN_JSON_SCHEMA.properties;
    expect(sections.recurring_tasks.properties.add.items.required).toEqual([
      "title",
      "cadence",
      "weekday",
      "estimated_duration_min",
    ]);
    expect(sections.milestones.properties.add.items.required).toEqual([
      "title",
      "target_date",
      "position",
    ]);
    expect(sections.equipment.properties.add.items.required).toEqual([
      "title",
      "cost_usd",
      "milestone_id",
      "standalone_deadline",
    ]);
    // changes objects: no `required` array — the model emits only what changes
    // (optional-by-omission; the zod gate accepts any subset).
    for (const section of ["recurring_tasks", "milestones", "equipment"] as const) {
      const changes =
        sections[section].properties.modify.items.properties.changes;
      expect("required" in changes).toBe(false);
      expect(changes.additionalProperties).toBe(false);
    }
  });

  it("pins additionalProperties: false on every object node (grammar strictness)", () => {
    const stack: unknown[] = [REPLAN_JSON_SCHEMA];
    let objects = 0;
    while (stack.length > 0) {
      const node = stack.pop();
      if (typeof node !== "object" || node === null) continue;
      const rec = node as Record<string, unknown>;
      if (rec.type === "object") {
        objects += 1;
        expect(rec.additionalProperties).toBe(false);
      }
      for (const value of Object.values(rec)) stack.push(value);
    }
    expect(objects).toBeGreaterThan(10); // the walk really visited the tree
  });

  it("replanOutputFormat parses raw JSON and carries the schema", () => {
    const format = replanOutputFormat();
    expect(format.type).toBe("json_schema");
    expect(format.schema).toBe(REPLAN_JSON_SCHEMA);
    expect(format.parse!('{"a":1}')).toEqual({ a: 1 });
  });
});
