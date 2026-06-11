/**
 * replan-diff.ts — the Zod-typed diff structure stored in
 * replan_proposals.proposed_changes (phase-2-close-the-loop "Replan flow").
 * The AI always proposes a DIFF — add / modify / remove arrays per type —
 * never an absolute replacement; the AI's response is validated against this
 * schema before persisting.
 *
 * Two faces of one shape, mirroring plan-schema.ts:
 *   - ReplanDiffSchema (zod): the gate generateReplan runs on the model's
 *     parsed output before anything is written to proposed_changes.
 *   - REPLAN_JSON_SCHEMA / replanOutputFormat(): the strict JSON schema handed
 *     to the Messages API as `output_config.format` (structured outputs), so
 *     the model is grammar-constrained to the shape. Hand-written (not
 *     generated) to keep it readable and to pin the descriptions the model
 *     reads. The `changes` objects deliberately leave every field optional
 *     (omitted from `required`) — a modify entry carries ONLY what changes.
 *
 * EMPTY_REPLAN_DIFF: Phase-2 Slice-1 (weekly check-in) inserts it as the
 * placeholder proposed_changes on every proposal it creates — the replan-
 * consumer slice (POST /api/ai/replan) is what writes real diffs. A pending
 * proposal with the empty diff means "requested, not yet generated".
 */
import { z } from "zod";
import type { AutoParseableOutputFormat } from "@anthropic-ai/sdk/lib/parser";

export const ReplanDiffSchema = z.object({
  recurring_tasks: z.object({
    add: z.array(
      z.object({
        title: z.string(),
        cadence: z.enum(["daily", "weekly"]),
        weekday: z.number().int().min(0).max(6).nullable(),
        estimated_duration_min: z.number().int().positive(),
      }),
    ),
    modify: z.array(
      z.object({
        id: z.string(),
        changes: z.object({
          title: z.string().optional(),
          weekday: z.number().int().min(0).max(6).nullable().optional(),
          estimated_duration_min: z.number().int().positive().optional(),
          active: z.boolean().optional(),
        }),
      }),
    ),
    remove: z.array(z.object({ id: z.string() })),
  }),
  milestones: z.object({
    add: z.array(
      z.object({
        title: z.string(),
        target_date: z.string(),
        position: z.number().int(),
      }),
    ),
    modify: z.array(
      z.object({
        id: z.string(),
        changes: z.object({
          title: z.string().optional(),
          target_date: z.string().optional(),
          position: z.number().int().optional(),
        }),
      }),
    ),
    remove: z.array(z.object({ id: z.string() })),
  }),
  equipment: z.object({
    add: z.array(
      z.object({
        title: z.string(),
        cost_usd: z.number().nullable(),
        milestone_id: z.string().nullable(),
        standalone_deadline: z.string().nullable(),
      }),
    ),
    modify: z.array(
      z.object({
        id: z.string(),
        changes: z.object({
          title: z.string().optional(),
          cost_usd: z.number().nullable().optional(),
          milestone_id: z.string().nullable().optional(),
          standalone_deadline: z.string().nullable().optional(),
        }),
      }),
    ),
    remove: z.array(z.object({ id: z.string() })),
  }),
});

export type ReplanDiff = z.infer<typeof ReplanDiffSchema>;

/** The all-empty diff Slice 1 persists as the pending placeholder. */
export const EMPTY_REPLAN_DIFF: ReplanDiff = {
  recurring_tasks: { add: [], modify: [], remove: [] },
  milestones: { add: [], modify: [], remove: [] },
  equipment: { add: [], modify: [], remove: [] },
};

// ---------------------------------------------------------------------------
// The structured-outputs face (output_config.format)
// ---------------------------------------------------------------------------

/** A `{ remove: [{ id }] }` item — shared by all three sections. */
const REMOVE_ITEM = {
  type: "object",
  additionalProperties: false,
  required: ["id"],
  properties: {
    id: {
      type: "string",
      description: "The id of the existing item, copied from the current plan.",
    },
  },
} as const;

/**
 * The strict JSON schema for `output_config.format` — the grammar twin of
 * ReplanDiffSchema above (plan-schema posture: `type` on every node,
 * `additionalProperties: false` on every object; numeric bounds live in
 * descriptions because the grammar does not support them — the zod gate
 * holds them). `changes` properties are OPTIONAL by omission from `required`:
 * the model emits only the fields that change.
 */
export const REPLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["recurring_tasks", "milestones", "equipment"],
  properties: {
    recurring_tasks: {
      type: "object",
      additionalProperties: false,
      required: ["add", "modify", "remove"],
      properties: {
        add: {
          type: "array",
          description: "New recurring tasks. Empty when none.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "cadence", "weekday", "estimated_duration_min"],
            properties: {
              title: { type: "string", description: "Short imperative title." },
              cadence: { type: "string", enum: ["daily", "weekly"] },
              weekday: {
                type: ["integer", "null"],
                description:
                  "0–6 where 0 = Sunday; required for weekly, null for daily.",
              },
              estimated_duration_min: {
                type: "integer",
                description: "Positive minutes the task takes.",
              },
            },
          },
        },
        modify: {
          type: "array",
          description: "Changes to existing recurring tasks. Empty when none.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "changes"],
            properties: {
              id: {
                type: "string",
                description: "Existing task id from the current plan.",
              },
              changes: {
                type: "object",
                additionalProperties: false,
                description: "ONLY the fields that change.",
                properties: {
                  title: { type: "string" },
                  weekday: {
                    type: ["integer", "null"],
                    description: "0–6 where 0 = Sunday, or null for daily.",
                  },
                  estimated_duration_min: {
                    type: "integer",
                    description: "Positive minutes.",
                  },
                  active: {
                    type: "boolean",
                    description: "false pauses the task; true reactivates it.",
                  },
                },
              },
            },
          },
        },
        remove: {
          type: "array",
          description: "Recurring tasks to delete outright. Empty when none.",
          items: REMOVE_ITEM,
        },
      },
    },
    milestones: {
      type: "object",
      additionalProperties: false,
      required: ["add", "modify", "remove"],
      properties: {
        add: {
          type: "array",
          description: "New milestones. Empty when none.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "target_date", "position"],
            properties: {
              title: {
                type: "string",
                description: "A concrete, checkable state.",
              },
              target_date: {
                type: "string",
                description: "ISO 8601 date, YYYY-MM-DD.",
              },
              position: {
                type: "integer",
                description: "0-based slot in the milestone timeline.",
              },
            },
          },
        },
        modify: {
          type: "array",
          description: "Changes to existing milestones. Empty when none.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "changes"],
            properties: {
              id: {
                type: "string",
                description: "Existing milestone id from the current plan.",
              },
              changes: {
                type: "object",
                additionalProperties: false,
                description: "ONLY the fields that change.",
                properties: {
                  title: { type: "string" },
                  target_date: {
                    type: "string",
                    description: "ISO 8601 date, YYYY-MM-DD.",
                  },
                  position: { type: "integer", description: "0-based slot." },
                },
              },
            },
          },
        },
        remove: {
          type: "array",
          description: "Milestones to delete. Empty when none.",
          items: REMOVE_ITEM,
        },
      },
    },
    equipment: {
      type: "object",
      additionalProperties: false,
      required: ["add", "modify", "remove"],
      properties: {
        add: {
          type: "array",
          description: "New equipment items. Empty when none.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["title", "cost_usd", "milestone_id", "standalone_deadline"],
            properties: {
              title: { type: "string", description: "The item, named plainly." },
              cost_usd: {
                type: ["number", "null"],
                description: "Rough cost in USD, or null when unknown.",
              },
              milestone_id: {
                type: ["string", "null"],
                description:
                  "An EXISTING milestone id the item must arrive before, " +
                  "or null. Never an id of a milestone added in this diff.",
              },
              standalone_deadline: {
                type: ["string", "null"],
                description:
                  "ISO 8601 date (YYYY-MM-DD) when no milestone fits, else null.",
              },
            },
          },
        },
        modify: {
          type: "array",
          description: "Changes to existing equipment. Empty when none.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "changes"],
            properties: {
              id: {
                type: "string",
                description: "Existing equipment id from the current plan.",
              },
              changes: {
                type: "object",
                additionalProperties: false,
                description: "ONLY the fields that change.",
                properties: {
                  title: { type: "string" },
                  cost_usd: { type: ["number", "null"] },
                  milestone_id: {
                    type: ["string", "null"],
                    description: "Existing milestone id, or null.",
                  },
                  standalone_deadline: {
                    type: ["string", "null"],
                    description: "ISO 8601 date (YYYY-MM-DD), or null.",
                  },
                },
              },
            },
          },
        },
        remove: {
          type: "array",
          description: "Equipment items to delete. Empty when none.",
          items: REMOVE_ITEM,
        },
      },
    },
  },
} as const;

/**
 * The `output_config.format` value for client.messages.parse(). The parse
 * callback only decodes JSON — generateReplan() runs the zod gate explicitly
 * so validation failures surface as one typed, loggable path before
 * persisting (the planOutputFormat posture).
 */
export function replanOutputFormat(): AutoParseableOutputFormat<unknown> {
  return {
    type: "json_schema",
    schema: REPLAN_JSON_SCHEMA as unknown as Record<string, unknown>,
    parse: (content: string) => JSON.parse(content) as unknown,
  };
}
