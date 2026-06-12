/**
 * replan.ts — generateReplan (phase-2-close-the-loop "Replan flow"; ADR-0001).
 *
 * Mirrors plan.ts: a single NON-streaming Sonnet call whose cached system
 * block (prompts/replan.ts) is byte-stable per build; ALL per-request
 * variability — the goal, intake summary, current plan, adherence aggregate,
 * trigger payload, resolved intensity, and the date anchor — travels in the
 * user message, so the cache prefix hits on every generation.
 *
 * Structured output: client.messages.parse with the REPLAN_JSON_SCHEMA
 * output_config grammar-constrains the response; message.parsed_output is
 * then zod-validated (ReplanDiffSchema) before anything is persisted. A zod
 * failure throws ReplanValidationError carrying the RAW model output in its
 * message, so the route's logAiError call puts the raw response in the server
 * log (the phase doc's 502 contract) while the client sees only a constant
 * string.
 *
 * Intensity source (spec §5 flags #2/#6): goals.intensity_override →
 * intake_summaries.confirmed_intensity → users.intensity_preference. The
 * route resolves the chain via resolveIntensity(); generateReplan logs WHICH
 * source won as a structured line (event: "replan_intensity_source") — the
 * phase verification step greps for it.
 *
 * Feeling signal: only the TRIGGERING check-in's feeling/notes enter the
 * prompt — no check-in history — and buildReplanMessages refuses a 'skipped'
 * triggering row defensively (skips are not sentiment data; the skip path
 * never creates proposals, so reaching that throw means a caller bug).
 */
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

import { getClient } from "./client";
import { MODEL_SONNET } from "./models";
import { replanSystem } from "./prompts/replan";
import { INTENSITY_LEVELS } from "./intake-schema";
import {
  ReplanDiffSchema,
  replanOutputFormat,
  type ReplanDiff,
} from "./replan-diff";
import type { AdherenceRow } from "./adherence";
import { logAiUsage, toUsageLog } from "./log";

/** Diffs are smaller than full plans; 4096 leaves comfortable headroom. */
const MAX_TOKENS = 4096;

export type IntensityLevel = (typeof INTENSITY_LEVELS)[number];

/** Thrown when no client is configured (ANTHROPIC_API_KEY unset) — the route
 *  translates this into a 503 at the boundary, mirroring generatePlan. */
export class ReplanUnavailableError extends Error {
  constructor() {
    super(
      "AI client is not configured (ANTHROPIC_API_KEY unset). " +
        "generateReplan requires a live client.",
    );
    this.name = "ReplanUnavailableError";
  }
}

/** Thrown when the model's output fails the zod gate. The message carries the
 *  zod issues AND the raw model output so the route's logAiError puts the raw
 *  response in the server log (phase-doc 502 contract); the client only ever
 *  sees the route's constant error string. */
export class ReplanValidationError extends Error {
  constructor(detail: string, rawOutput: unknown) {
    super(
      `Replan output failed validation: ${detail}. ` +
        `Raw response: ${JSON.stringify(rawOutput)}`,
    );
    this.name = "ReplanValidationError";
  }
}

// ---------------------------------------------------------------------------
// Intensity resolution (spec §5 flags #2/#6)
// ---------------------------------------------------------------------------

export type IntensitySource = "override" | "intake" | "user";

export interface ResolvedIntensity {
  /** Null only when every source in the chain is unset. */
  intensity: IntensityLevel | null;
  /** Which chain link produced the value (the LAST link when all are null). */
  source: IntensitySource;
}

/**
 * goals.intensity_override → intake_summaries.confirmed_intensity →
 * users.intensity_preference. confirmed_intensity is NOT NULL at the schema
 * level, so the third branch is only reachable when NO intake_summaries row
 * exists for the goal — callers pass `intakeSummary: null` for that absence.
 */
export function resolveIntensity(input: {
  override: IntensityLevel | null;
  intakeSummary: { confirmed_intensity: IntensityLevel } | null;
  userPreference: IntensityLevel | null;
}): ResolvedIntensity {
  if (input.override !== null) {
    return { intensity: input.override, source: "override" };
  }
  if (input.intakeSummary !== null) {
    return {
      intensity: input.intakeSummary.confirmed_intensity,
      source: "intake",
    };
  }
  return { intensity: input.userPreference, source: "user" };
}

// ---------------------------------------------------------------------------
// User-message inputs — plain projected shapes (the route maps drizzle rows;
// tests pass fixtures). Ids are included so modify/remove diff entries can
// reference real rows.
// ---------------------------------------------------------------------------

export interface ReplanGoalInput {
  title: string;
  description: string | null;
  /** YYYY-MM-DD or null. */
  target_date: string | null;
}

export interface ReplanTaskInput {
  id: string;
  title: string;
  cadence: "daily" | "weekly";
  weekday: number | null;
  estimated_duration_min: number | null;
  active: boolean;
}

export interface ReplanMilestoneInput {
  id: string;
  title: string;
  target_date: string | null;
  position: number;
  completed: boolean;
}

export interface ReplanEquipmentInput {
  id: string;
  title: string;
  cost_usd: string | number | null;
  milestone_id: string | null;
  standalone_deadline: string | null;
  purchased: boolean;
}

/** The trigger payload — only the TRIGGERING check-in's feeling/notes, or the
 *  structural-edit summary. 'skipped' is excluded at the type level AND
 *  refused at runtime (skips are not sentiment data). */
export type ReplanTriggerPayload =
  | {
      kind: "weekly_check_in";
      feeling: "too_easy" | "right" | "too_hard";
      notes: string | null;
    }
  | { kind: "structural_edit"; summary: string };

export interface GenerateReplanArgs {
  goal: ReplanGoalInput;
  /** Projected intake_summaries row, or null when the goal has none. */
  intakeSummary: Record<string, unknown> | null;
  recurringTasks: ReplanTaskInput[];
  milestones: ReplanMilestoneInput[];
  equipment: ReplanEquipmentInput[];
  /** Last-28-days expected-vs-actual per active task (adherence.ts). */
  adherence: AdherenceRow[];
  trigger: ReplanTriggerPayload;
  intensity: ResolvedIntensity;
  /** The USER's today (todayInTimeZone), YYYY-MM-DD — the date anchor. */
  today: string;
}

const INTENSITY_SOURCE_LABELS: Record<IntensitySource, string> = {
  override: "goals.intensity_override",
  intake: "intake_summaries.confirmed_intensity",
  user: "users.intensity_preference",
};

function triggerSection(trigger: ReplanTriggerPayload): string {
  if (trigger.kind === "structural_edit") {
    return (
      `Trigger: the user made a structural edit to this goal.\n` +
      `Structural change (JSON):\n` +
      `${JSON.stringify({ summary: trigger.summary }, null, 2)}`
    );
  }
  return (
    `Trigger: the user's weekly check-in.\n` +
    `Check-in (JSON):\n` +
    `${JSON.stringify(
      { feeling: trigger.feeling, notes: trigger.notes },
      null,
      2,
    )}`
  );
}

/**
 * Build the single user message: the date anchor, then every per-request
 * input as JSON. All variability lives here, never in the cached system
 * block. Throws if the triggering check-in is a skip — skipped weeks must
 * never reach the feeling signal (DECISIONS: skips are not sentiment data).
 */
export function buildReplanMessages(args: GenerateReplanArgs): MessageParam[] {
  if (
    args.trigger.kind === "weekly_check_in" &&
    (args.trigger.feeling as string) === "skipped"
  ) {
    throw new Error(
      "buildReplanMessages: a 'skipped' check-in is not a replan trigger — " +
        "skips are excluded from the feeling signal.",
    );
  }

  const { intensity, source } = args.intensity;
  const intensityLine =
    intensity === null
      ? `Effective intensity: not set (no source in the chain resolved a value).`
      : `Effective intensity: ${intensity} ` +
        `(source: ${INTENSITY_SOURCE_LABELS[source]}).`;

  const content = [
    `Today's date: ${args.today}. Every proposed date (milestone target ` +
      `dates, equipment deadlines) must fall after this date.`,
    `Goal (JSON):\n${JSON.stringify(args.goal, null, 2)}`,
    args.intakeSummary === null
      ? `Intake summary: none on file for this goal.`
      : `Intake summary (JSON):\n${JSON.stringify(args.intakeSummary, null, 2)}`,
    `Current plan (JSON):\n${JSON.stringify(
      {
        recurring_tasks: args.recurringTasks,
        milestones: args.milestones,
        equipment: args.equipment,
      },
      null,
      2,
    )}`,
    `Adherence, last 28 days — expected vs actual per active task (JSON):\n` +
      `${JSON.stringify(args.adherence, null, 2)}`,
    triggerSection(args.trigger),
    intensityLine,
    `Generate the replan diff.`,
  ].join("\n\n");

  return [{ role: "user", content }];
}

/**
 * Generate the replan diff. Returns the zod-validated ReplanDiff; throws
 * ReplanUnavailableError (no client) or ReplanValidationError (bad model
 * output — raw response in the message) — provider errors propagate as-is.
 * The route owns translating all of these into constant client strings.
 */
export async function generateReplan(
  args: GenerateReplanArgs,
): Promise<ReplanDiff> {
  const client = getClient();
  if (!client) {
    throw new ReplanUnavailableError();
  }

  // Phase verification step 3 greps for this line: which intensity source won.
  console.info(
    JSON.stringify({
      event: "replan_intensity_source",
      source: args.intensity.source,
    }),
  );

  const startedAt = Date.now();
  const message = await client.messages.parse({
    model: MODEL_SONNET,
    max_tokens: MAX_TOKENS,
    system: replanSystem(),
    messages: buildReplanMessages(args),
    output_config: { format: replanOutputFormat() },
  });

  logAiUsage(
    toUsageLog("replan", MODEL_SONNET, message.usage, Date.now() - startedAt),
  );

  // Zod gate before anything persists: the grammar constrained the shape, but
  // the bounds JSON Schema can't carry (positive durations, weekday 0–6) are
  // proven here.
  const parsed = ReplanDiffSchema.safeParse(message.parsed_output);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ReplanValidationError(issues, message.parsed_output);
  }
  return parsed.data;
}
