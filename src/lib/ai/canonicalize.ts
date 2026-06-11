/**
 * canonicalize.ts — the single Haiku classifier (ADR-0001; phase-1 doc
 * "Location and activity_type extraction").
 *
 * After the Sonnet intake terminates via submit_intake, the loose fields the
 * conversational model emitted (free-text location, an activity_type it may
 * have guessed at) are tightened by a forced-tool Haiku pass over the full
 * transcript. This is the only Haiku usage in the system ("a lightweight call
 * no tier would notice", PLAN §10).
 *
 * The classifier is deterministic in spirit: tool_choice forces the tool, so
 * Haiku always returns the structured shape; it never free-narrates.
 */
import { z } from "zod";
import type {
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";

import { getClient } from "./client";
import { MODEL_HAIKU } from "./models";
import { ACTIVITY_TYPES } from "./intake-schema";
import { logAiUsage, toUsageLog } from "./log";

const CANONICALIZE_TOOL_NAME = "canonical_fields" as const;

export const canonicalFieldsSchema = z.object({
  location_city: z.string().nullable(),
  location_region: z.string().nullable(),
  location_country: z.string().nullable(),
  activity_type: z.enum(ACTIVITY_TYPES),
  activity_type_other_label: z.string().nullable(),
});

export type CanonicalFields = z.infer<typeof canonicalFieldsSchema>;

const CANONICALIZE_TOOL: Tool = {
  name: CANONICALIZE_TOOL_NAME,
  description:
    "Return the canonical location and activity_type for this goal, derived " +
    "from the full conversation.",
  input_schema: {
    type: "object",
    properties: {
      location_city: { type: ["string", "null"] },
      location_region: {
        type: ["string", "null"],
        description: "State / province / region.",
      },
      location_country: { type: ["string", "null"] },
      activity_type: {
        type: "string",
        enum: [...ACTIVITY_TYPES],
        description: "The single closest fixed activity type; 'other' if none.",
      },
      activity_type_other_label: {
        type: ["string", "null"],
        description: "Short label when activity_type is 'other'.",
      },
    },
    required: [
      "location_city",
      "location_region",
      "location_country",
      "activity_type",
      "activity_type_other_label",
    ],
  },
};

const CANONICALIZE_SYSTEM =
  "You normalize one goal's location and activity type from a transcript. " +
  "Map free-text locations to city / region / country parts (use null for any " +
  "part the user never gave). Choose the single closest activity_type from the " +
  "fixed enum; use 'other' with a short label only when none fit. Call the " +
  "canonical_fields tool. Do not add anything the transcript does not support.";

/**
 * Run the Haiku canonicalizer over the full transcript. Returns the validated
 * canonical fields, or null when no client is configured (key-less env) or the
 * tool input fails validation — callers fall back to the Sonnet-emitted values.
 */
export async function canonicalize(
  transcript: MessageParam[],
): Promise<CanonicalFields | null> {
  const client = getClient();
  if (!client) return null;

  const message = await client.messages.create({
    model: MODEL_HAIKU,
    max_tokens: 512,
    system: CANONICALIZE_SYSTEM,
    messages: transcript,
    tools: [CANONICALIZE_TOOL],
    tool_choice: { type: "tool", name: CANONICALIZE_TOOL_NAME },
  });

  logAiUsage(toUsageLog("canonicalize", MODEL_HAIKU, message.usage));

  const toolUse = message.content.find(
    (block) => block.type === "tool_use" && block.name === CANONICALIZE_TOOL_NAME,
  );
  if (!toolUse || toolUse.type !== "tool_use") return null;

  const parsed = canonicalFieldsSchema.safeParse(toolUse.input);
  return parsed.success ? parsed.data : null;
}
