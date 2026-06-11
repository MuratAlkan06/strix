/**
 * plan-schema.ts — the plan-generation structured-output contract (ADR-0001;
 * phase-1-golden-path "Plan generation").
 *
 * Two faces of one shape, mirroring intake-schema.ts:
 *   - planDraftSchema (zod): validates the model's parsed output before
 *     anything is written to goal_drafts.plan_draft. The application
 *     invariants that JSON Schema can't express live here as refinements —
 *     most importantly the equipment exactly-one rule.
 *   - PLAN_JSON_SCHEMA / planOutputFormat(): the strict JSON schema handed to
 *     the Messages API as `output_config.format` (structured outputs), so the
 *     model is grammar-constrained to the shape. Hand-written (not generated)
 *     to keep it readable and to pin the descriptions the model reads.
 *
 * Equipment linkage: each item carries EXACTLY ONE of milestone_position /
 * standalone_deadline (the schema-level application invariant on the
 * `equipment` table — schema.ts documents the same rule for the saved rows).
 * Linkage is by milestone POSITION reference because no milestone rows exist
 * yet at draft stage; the review/save slice (Slice 7) resolves positions to
 * milestone ids when it materializes the plan.
 */
import { z } from "zod";
import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk/lib/parser";

/** ISO 8601 calendar date (YYYY-MM-DD) — matches the `date` columns the plan
 *  materializes into at save time. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(ISO_DATE_RE, "expected YYYY-MM-DD");

/** Daily habit (cadence=daily — no weekday). */
export const planDailySchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  estimated_duration_min: z.number().int().positive().nullable(),
});

/** Weekly session (cadence=weekly, weekday 0–6 where 0 = Sunday). */
export const planWeeklySchema = z.object({
  title: z.string().min(1),
  description: z.string().nullable(),
  weekday: z.number().int().min(0).max(6),
  estimated_duration_min: z.number().int().positive().nullable(),
});

/** Milestone — position is the 0-based order key equipment links against. */
export const planMilestoneSchema = z.object({
  title: z.string().min(1),
  target_date: isoDate,
  position: z.number().int().nonnegative(),
});

/**
 * Equipment item. EXACTLY ONE of milestone_position / standalone_deadline is
 * non-null — enforced by the refinement below (JSON Schema describes the rule;
 * zod is the gate that holds it).
 */
export const planEquipmentSchema = z
  .object({
    title: z.string().min(1),
    cost_usd: z.number().nonnegative().nullable(),
    milestone_position: z.number().int().nonnegative().nullable(),
    standalone_deadline: isoDate.nullable(),
  })
  .superRefine((item, ctx) => {
    const linked = item.milestone_position !== null;
    const standalone = item.standalone_deadline !== null;
    if (linked === standalone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "exactly one of milestone_position / standalone_deadline must be set",
      });
    }
  });

export const planDraftSchema = z
  .object({
    daily: z.array(planDailySchema),
    weekly: z.array(planWeeklySchema),
    milestones: z.array(planMilestoneSchema),
    equipment: z.array(planEquipmentSchema),
  })
  .superRefine((plan, ctx) => {
    // Every milestone_position reference must resolve to a milestone in the
    // same plan — Slice 7 resolves positions to ids at save, and a dangling
    // reference there would be a broken review screen, not a typed error.
    const positions = new Set(plan.milestones.map((m) => m.position));
    plan.equipment.forEach((item, i) => {
      if (
        item.milestone_position !== null &&
        !positions.has(item.milestone_position)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["equipment", i, "milestone_position"],
          message: `milestone_position ${item.milestone_position} does not match any milestone`,
        });
      }
    });
  });

export type PlanDraft = z.infer<typeof planDraftSchema>;

/**
 * The strict JSON schema for `output_config.format`. Written pre-transformed
 * for the structured-outputs grammar: a `type` on every node, every property
 * required (nullable where optional in spirit), `additionalProperties: false`
 * on every object.
 */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["daily", "weekly", "milestones", "equipment"],
  properties: {
    daily: {
      type: "array",
      description: "Daily habits (cadence=daily).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "estimated_duration_min"],
        properties: {
          title: { type: "string", description: "Short imperative title." },
          description: {
            type: ["string", "null"],
            description: "One plain sentence of how/why, or null.",
          },
          estimated_duration_min: {
            type: ["integer", "null"],
            description: "Minutes the habit takes, or null.",
          },
        },
      },
    },
    weekly: {
      type: "array",
      description: "Weekly sessions (cadence=weekly), pinned to a weekday.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "description", "weekday", "estimated_duration_min"],
        properties: {
          title: { type: "string", description: "Short imperative title." },
          description: {
            type: ["string", "null"],
            description: "One plain sentence of how/why, or null.",
          },
          weekday: {
            type: "integer",
            description: "0–6 where 0 = Sunday and 6 = Saturday.",
          },
          estimated_duration_min: {
            type: ["integer", "null"],
            description: "Minutes the session takes, or null.",
          },
        },
      },
    },
    milestones: {
      type: "array",
      description: "Dated checkpoints, ordered by position (0-based).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "target_date", "position"],
        properties: {
          title: { type: "string", description: "A concrete, checkable state." },
          target_date: {
            type: "string",
            description: "ISO 8601 date, YYYY-MM-DD.",
          },
          position: {
            type: "integer",
            description: "0-based order; sequential and unique.",
          },
        },
      },
    },
    equipment: {
      type: "array",
      description:
        "Gear/resources to acquire. EXACTLY ONE of milestone_position / " +
        "standalone_deadline is non-null per item.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "title",
          "cost_usd",
          "milestone_position",
          "standalone_deadline",
        ],
        properties: {
          title: { type: "string", description: "The item, named plainly." },
          cost_usd: {
            type: ["number", "null"],
            description: "Rough cost in USD, or null when unknown.",
          },
          milestone_position: {
            type: ["integer", "null"],
            description:
              "The position of the milestone this item must arrive before. " +
              "Null only when standalone_deadline is set.",
          },
          standalone_deadline: {
            type: ["string", "null"],
            description:
              "ISO 8601 date (YYYY-MM-DD), ONLY when no milestone fits. " +
              "Null when milestone_position is set.",
          },
        },
      },
    },
  },
} as const;

/**
 * The `output_config.format` value for client.messages.parse(). The parse
 * callback only decodes JSON — generatePlan() runs the zod gate explicitly so
 * validation failures surface as one typed, loggable path before persisting.
 */
export function planOutputFormat(): AutoParseableOutputFormat<unknown> {
  return {
    type: "json_schema",
    schema: PLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: (content: string) => JSON.parse(content) as unknown,
  };
}
