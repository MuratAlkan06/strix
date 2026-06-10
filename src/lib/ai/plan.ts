/**
 * plan.ts — generatePlan (ADR-0001; phase-1-golden-path "Plan generation").
 *
 * A single NON-streaming Sonnet call: the cached system block (prompts/plan.ts)
 * is byte-stable per build; all per-request variability (the intake summary +
 * confirmed intensity, as JSON) travels in the user message, so the cache
 * prefix hits on every generation.
 *
 * Structured output: client.messages.parse with a JSON-Schema output_config
 * grammar-constrains the response; message.parsed_output is then zod-validated
 * (planDraftSchema, which holds the invariants JSON Schema can't — the
 * equipment exactly-one rule) before anything is persisted.
 *
 * Intensity source: intake_summary_draft.confirmed_intensity — the user's
 * explicit pick from the confirmation card. The goal does not exist yet at
 * draft stage, so the full effective-intensity chain (goals.intensity_override
 * → intake_summaries.confirmed_intensity → users.intensity_preference) only
 * applies post-save; here the confirmed pick IS the effective intensity.
 */
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

import { getClient } from "./client";
import { MODEL_SONNET } from "./models";
import { planSystem } from "./prompts/plan";
import {
  planDraftSchema,
  planOutputFormat,
  type PlanDraft,
} from "./plan-schema";
import { logAiUsage, toUsageLog } from "./log";

/** Plans are a few KB of JSON; 4096 leaves comfortable headroom. */
const MAX_TOKENS = 4096;

/** Thrown when no client is configured (ANTHROPIC_API_KEY unset) — the route
 *  translates this into a 503 at the boundary, mirroring streamIntake. */
export class PlanUnavailableError extends Error {
  constructor() {
    super(
      "AI client is not configured (ANTHROPIC_API_KEY unset). " +
        "generatePlan requires a live client.",
    );
    this.name = "PlanUnavailableError";
  }
}

/** Thrown when the model's output fails the zod gate — logged server-side;
 *  the client only ever sees the route's constant error string. */
export class PlanValidationError extends Error {
  constructor(detail: string) {
    super(`Plan output failed validation: ${detail}`);
    this.name = "PlanValidationError";
  }
}

export interface GeneratePlanArgs {
  /**
   * The completed intake summary as staged in goal_drafts.intake_summary_draft
   * — including confirmed_intensity (the route guards its presence before
   * calling). Passed through as JSON; the model reads it, never the prompt.
   */
  intakeSummary: Record<string, unknown>;
}

/**
 * Build the single user message: the intake summary as JSON plus the confirmed
 * intensity called out explicitly (the phase doc's prompt sketch). All
 * per-request data lives here, never in the cached system block.
 */
export function buildPlanMessages(args: GeneratePlanArgs): MessageParam[] {
  const { intakeSummary } = args;
  const intensity = intakeSummary.confirmed_intensity;
  return [
    {
      role: "user",
      content:
        `Intake summary (JSON):\n${JSON.stringify(intakeSummary, null, 2)}\n\n` +
        `Confirmed intensity: ${String(intensity)}\n\n` +
        `Generate the plan.`,
    },
  ];
}

/**
 * Generate the draft plan. Returns the zod-validated PlanDraft; throws
 * PlanUnavailableError (no client) or PlanValidationError (bad model output) —
 * provider errors propagate as-is. The route owns translating all of these
 * into constant client-facing strings.
 */
export async function generatePlan(args: GeneratePlanArgs): Promise<PlanDraft> {
  const client = getClient();
  if (!client) {
    throw new PlanUnavailableError();
  }

  const message = await client.messages.parse({
    model: MODEL_SONNET,
    max_tokens: MAX_TOKENS,
    system: planSystem(),
    messages: buildPlanMessages(args),
    output_config: { format: planOutputFormat() },
  });

  logAiUsage(toUsageLog("plan", MODEL_SONNET, message.usage));

  // Zod gate before anything persists: the grammar constrained the shape, but
  // the application invariants (equipment exactly-one, position references,
  // weekday bounds) are proven here.
  const parsed = planDraftSchema.safeParse(message.parsed_output);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new PlanValidationError(issues);
  }
  return parsed.data;
}
