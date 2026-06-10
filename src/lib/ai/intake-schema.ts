/**
 * intake-schema.ts — the submit_intake structured-output contract (ADR-0001).
 *
 * Two faces of one shape:
 *   - submitIntakeSchema (zod): validates the tool input the model emits before
 *     anything is written to goal_drafts.intake_summary_draft.
 *   - SUBMIT_INTAKE_TOOL: the JSON-schema tool definition the model is given.
 *
 * The enums mirror src/db/schema.ts (activity_type, intensity_level). Keeping
 * the JSON schema hand-written (rather than generated) keeps it readable in the
 * prompt and lets us pin descriptions the model reads.
 */
import { z } from "zod";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";

/** activity_type enum — mirrors schema.ts `activityType`. */
export const ACTIVITY_TYPES = [
  "climbing",
  "mountaineering",
  "running",
  "cycling",
  "swimming",
  "strength",
  "language",
  "writing",
  "instrument",
  "business",
  "study",
  "other",
] as const;

/** intensity_level enum — mirrors schema.ts `intensityLevel`. */
export const INTENSITY_LEVELS = ["comfortable", "challenging", "brutal"] as const;

/** One safety pushback the model flagged; user_overrode/decided_at are filled
 *  by the product when the user decides (Slice 5), null at intake. */
export const safetyFlagSchema = z.object({
  concern: z.string().min(1),
  alternative: z.string().min(1),
  user_overrode: z.boolean().nullable(),
  decided_at: z.string().nullable(),
});

export const submitIntakeSchema = z.object({
  one_sentence_goal: z.string().min(1),
  starting_point: z.string().min(1),
  prior_experience: z.string().nullable().optional(),
  days_per_week: z.number().int().positive().nullable().optional(),
  time_per_session_min: z.number().int().positive().nullable().optional(),
  budget_usd: z.number().nonnegative().nullable().optional(),
  target_date: z.string().nullable().optional(),
  location_city: z.string().nullable().optional(),
  location_region: z.string().nullable().optional(),
  location_country: z.string().nullable().optional(),
  activity_type: z.enum(ACTIVITY_TYPES),
  activity_type_other_label: z.string().nullable().optional(),
  suggested_intensity: z.enum(INTENSITY_LEVELS),
  suggested_intensity_reasoning: z.string().min(1),
  safety_flags: z.array(safetyFlagSchema).default([]),
});

export type SubmitIntakeInput = z.infer<typeof submitIntakeSchema>;

export const SUBMIT_INTAKE_TOOL_NAME = "submit_intake" as const;

/**
 * The tool the model calls to terminate intake. tool_choice stays `auto` so the
 * model decides WHEN intake is complete; this schema constrains WHAT it emits.
 */
export const SUBMIT_INTAKE_TOOL: Tool = {
  name: SUBMIT_INTAKE_TOOL_NAME,
  description:
    "Submit the completed intake. Call this only when every required field " +
    "has been elicited (or reasonably inferred at the turn cap), including " +
    "suggested_intensity with one sentence of reasoning and any safety_flags.",
  input_schema: {
    type: "object",
    properties: {
      one_sentence_goal: {
        type: "string",
        description: "A single declarative sentence naming the goal.",
      },
      starting_point: {
        type: "string",
        description: "Where the user is today, including prior experience.",
      },
      prior_experience: {
        type: ["string", "null"],
        description: "Relevant prior experience, if distinct from starting_point.",
      },
      days_per_week: {
        type: ["integer", "null"],
        description: "Training/working days per week.",
      },
      time_per_session_min: {
        type: ["integer", "null"],
        description: "Minutes available per session.",
      },
      budget_usd: {
        type: ["number", "null"],
        description: "Rough budget in USD (0 is valid).",
      },
      target_date: {
        type: ["string", "null"],
        description: "Target date, ISO 8601 (YYYY-MM-DD).",
      },
      location_city: { type: ["string", "null"] },
      location_region: { type: ["string", "null"] },
      location_country: { type: ["string", "null"] },
      activity_type: {
        type: "string",
        enum: [...ACTIVITY_TYPES],
        description: "The closest fixed activity type; use 'other' if none fit.",
      },
      activity_type_other_label: {
        type: ["string", "null"],
        description: "Free-text label when activity_type is 'other'.",
      },
      suggested_intensity: {
        type: "string",
        enum: [...INTENSITY_LEVELS],
        description: "The realistic intensity for this goal + timeline.",
      },
      suggested_intensity_reasoning: {
        type: "string",
        description: "One sentence explaining the suggested intensity.",
      },
      safety_flags: {
        type: "array",
        description:
          "Risky goal+timeline pushbacks. Empty when nothing was flagged.",
        items: {
          type: "object",
          properties: {
            concern: { type: "string" },
            alternative: { type: "string" },
            user_overrode: { type: ["boolean", "null"] },
            decided_at: { type: ["string", "null"] },
          },
          required: ["concern", "alternative", "user_overrode", "decided_at"],
        },
      },
    },
    required: [
      "one_sentence_goal",
      "starting_point",
      "activity_type",
      "suggested_intensity",
      "suggested_intensity_reasoning",
      "safety_flags",
    ],
  },
};
