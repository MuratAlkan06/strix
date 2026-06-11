/**
 * submit_intake schema tests (no DB, node env).
 *
 * The zod schema is the gate between the model's tool output and what gets
 * written to goal_drafts.intake_summary_draft: a valid fixture passes; a
 * fixture missing the required suggested_intensity fails.
 */
import { describe, expect, it } from "vitest";
import {
  flagSafetySchema,
  submitIntakeSchema,
  FLAG_SAFETY_TOOL,
  FLAG_SAFETY_TOOL_NAME,
  SUBMIT_INTAKE_TOOL,
  SUBMIT_INTAKE_TOOL_NAME,
  type SubmitIntakeInput,
} from "./intake-schema";

const validFixture: SubmitIntakeInput = {
  one_sentence_goal: "Run a sub-4-hour marathon in Berlin.",
  starting_point: "Currently running 15 miles a week, no marathon yet.",
  prior_experience: "Two half-marathons in the last year.",
  days_per_week: 4,
  time_per_session_min: 60,
  budget_usd: 300,
  target_date: "2026-09-27",
  location_city: "Berlin",
  location_region: "Berlin",
  location_country: "Germany",
  activity_type: "running",
  activity_type_other_label: null,
  suggested_intensity: "challenging",
  suggested_intensity_reasoning:
    "Sub-4 from a 15-mile base in a year is a real but reachable stretch.",
  safety_flags: [],
};

describe("submitIntakeSchema", () => {
  it("accepts a complete valid fixture", () => {
    const result = submitIntakeSchema.safeParse(validFixture);
    expect(result.success).toBe(true);
  });

  it("rejects a fixture missing suggested_intensity", () => {
    const { suggested_intensity: _omit, ...withoutIntensity } = validFixture;
    void _omit;
    const result = submitIntakeSchema.safeParse(withoutIntensity);
    expect(result.success).toBe(false);
  });

  it("rejects an out-of-enum activity_type", () => {
    const result = submitIntakeSchema.safeParse({
      ...validFixture,
      activity_type: "knitting",
    });
    expect(result.success).toBe(false);
  });

  it("defaults safety_flags to an empty array when absent", () => {
    const { safety_flags: _omit, ...withoutFlags } = validFixture;
    void _omit;
    const result = submitIntakeSchema.safeParse(withoutFlags);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.safety_flags).toEqual([]);
  });

  it("validates safety_flags entries (concern + alternative, nullable decision)", () => {
    const result = submitIntakeSchema.safeParse({
      ...validFixture,
      safety_flags: [
        {
          concern: "Twelve weeks is aggressive for a first marathon.",
          alternative: "Target a half first, then the full next cycle.",
          user_overrode: null,
          decided_at: null,
        },
      ],
    });
    expect(result.success).toBe(true);
  });
});

describe("flagSafetySchema", () => {
  const validFlag = {
    concern: "the 20-pound target in two weeks",
    alternative: "4-6 lbs in 2 weeks plus a continuing habit",
    reasoning: "Most of it would be water weight, and the rebound is rough.",
  };

  it("accepts a complete flag", () => {
    expect(flagSafetySchema.safeParse(validFlag).success).toBe(true);
  });

  it("rejects a flag missing reasoning", () => {
    const { reasoning: _omit, ...withoutReasoning } = validFlag;
    void _omit;
    expect(flagSafetySchema.safeParse(withoutReasoning).success).toBe(false);
  });

  it("rejects empty strings (a card needs all three lines)", () => {
    expect(
      flagSafetySchema.safeParse({ ...validFlag, concern: "" }).success,
    ).toBe(false);
    expect(
      flagSafetySchema.safeParse({ ...validFlag, alternative: "" }).success,
    ).toBe(false);
  });

  it("does not carry decision fields — the product, not the model, decides", () => {
    expect(Object.keys(flagSafetySchema.shape)).toEqual([
      "concern",
      "alternative",
      "reasoning",
    ]);
  });
});

describe("FLAG_SAFETY_TOOL", () => {
  it("is named flag_safety and is an object schema", () => {
    expect(FLAG_SAFETY_TOOL.name).toBe(FLAG_SAFETY_TOOL_NAME);
    expect(FLAG_SAFETY_TOOL.input_schema.type).toBe("object");
  });

  it("requires concern + alternative + reasoning in the JSON schema", () => {
    const required = FLAG_SAFETY_TOOL.input_schema.required ?? [];
    expect(required).toContain("concern");
    expect(required).toContain("alternative");
    expect(required).toContain("reasoning");
  });
});

describe("SUBMIT_INTAKE_TOOL", () => {
  it("is named submit_intake and is an object schema", () => {
    expect(SUBMIT_INTAKE_TOOL.name).toBe(SUBMIT_INTAKE_TOOL_NAME);
    expect(SUBMIT_INTAKE_TOOL.input_schema.type).toBe("object");
  });

  it("requires suggested_intensity + its reasoning in the JSON schema", () => {
    const required = SUBMIT_INTAKE_TOOL.input_schema.required ?? [];
    expect(required).toContain("suggested_intensity");
    expect(required).toContain("suggested_intensity_reasoning");
  });
});
