/**
 * safety-flags.ts — pure helpers for the safety-override flow (Slice 5;
 * phase-1-golden-path "Safety-override flow").
 *
 * goal_drafts.raw_transcript is treated as an EVENT LOG: conversational turns
 * ({ role, content }) interleaved with staged safety flags ({ type:
 * "safety_flag", … }). asTranscript() (transcript.ts) filters the log down to
 * the conversational view the model sees; the helpers here read and write the
 * flag entries. Staging flags inside raw_transcript (rather than a new
 * column) preserves the load-bearing "intake_summary_draft != null ⇔ intake
 * completed" invariant the surface routing depends on, and keeps flags in
 * conversation order — the pending flag is always the last event, because the
 * composer holds until it is decided.
 *
 * Everything here is pure and side-effect-free (client-safe). The intake
 * route and the decide-safety server action own persistence.
 */
import type { TranscriptTurn } from "./transcript";
import type { FlagSafetyInput } from "./intake-schema";

/** A safety flag staged in the draft's event log. user_overrode/decided_at
 *  are null until the user decides on the card. */
export interface StagedSafetyFlag {
  type: "safety_flag";
  concern: string;
  alternative: string;
  reasoning: string;
  user_overrode: boolean | null;
  decided_at: string | null;
}

/** The final-summary entry shape (mirrors safetyFlagSchema in
 *  intake-schema.ts): what intake_summary_draft.safety_flags carries. */
export interface SafetyFlagRecord {
  concern: string;
  alternative: string;
  user_overrode: boolean | null;
  decided_at: string | null;
}

/** What the decision card (and the safety_flag SSE event) carries. */
export interface SafetyFlagPayload {
  concern: string;
  alternative: string;
  reasoning: string;
}

export type IntakeEvent = TranscriptTurn | StagedSafetyFlag;

export function isStagedSafetyFlag(value: unknown): value is StagedSafetyFlag {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.type === "safety_flag" &&
    typeof v.concern === "string" &&
    typeof v.alternative === "string" &&
    typeof v.reasoning === "string" &&
    (typeof v.user_overrode === "boolean" || v.user_overrode === null) &&
    (typeof v.decided_at === "string" || v.decided_at === null)
  );
}

function isTranscriptTurn(value: unknown): value is TranscriptTurn {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.role === "user" || v.role === "assistant") &&
    typeof v.content === "string"
  );
}

/**
 * Narrow unknown jsonb (goal_drafts.raw_transcript) into the event log,
 * keeping well-formed turns AND staged flags, dropping malformed entries.
 * The conversational view is asTranscript(log) — it drops the flag entries.
 */
export function asEventLog(value: unknown): IntakeEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is IntakeEvent => isTranscriptTurn(e) || isStagedSafetyFlag(e),
  );
}

/** Append an undecided staged flag (a new array — no mutation). */
export function appendFlag(
  log: IntakeEvent[],
  input: FlagSafetyInput,
): IntakeEvent[] {
  return [
    ...log,
    {
      type: "safety_flag",
      concern: input.concern,
      alternative: input.alternative,
      reasoning: input.reasoning,
      user_overrode: null,
      decided_at: null,
    },
  ];
}

/** All staged flags, in conversation (chronological) order. */
export function stagedFlags(log: IntakeEvent[]): StagedSafetyFlag[] {
  return log.filter(isStagedSafetyFlag);
}

/**
 * The undecided flag the chat must hold the composer for, or null. The last
 * one is authoritative — an undecided flag can only be the latest event,
 * since the composer holds until it is decided.
 */
export function pendingFlag(log: IntakeEvent[]): StagedSafetyFlag | null {
  const undecided = stagedFlags(log).filter((f) => f.decided_at === null);
  return undecided[undecided.length - 1] ?? null;
}

export function toFlagPayload(flag: StagedSafetyFlag): SafetyFlagPayload {
  return {
    concern: flag.concern,
    alternative: flag.alternative,
    reasoning: flag.reasoning,
  };
}

/**
 * Record the user's decision on the pending (last undecided) flag. Returns
 * the new log plus the decided flag, or null when nothing is pending (a
 * stale/duplicate submission — the caller treats it as a no-op error, never
 * a silent write).
 */
export function decideFlag(
  log: IntakeEvent[],
  userOverrode: boolean,
  decidedAt: string,
): { log: IntakeEvent[]; flag: StagedSafetyFlag } | null {
  const target = pendingFlag(log);
  if (!target) return null;
  const decided: StagedSafetyFlag = {
    ...target,
    user_overrode: userOverrode,
    decided_at: decidedAt,
  };
  return {
    log: log.map((e) => (e === target ? decided : e)),
    flag: decided,
  };
}

/**
 * The decision conveyed back into the conversation: a user-role turn the
 * model reads (so intake continues with the chosen direction as the working
 * goal) and the chat renders as a quiet status line. kind: "decision" keeps
 * it out of the user-turn cap.
 */
export function decisionTurn(
  flag: Pick<StagedSafetyFlag, "concern" | "alternative">,
  userOverrode: boolean,
): TranscriptTurn {
  const content = userOverrode
    ? `Decision: proceed with the original plan despite the concern ` +
      `(${flag.concern}). The original goal stands.`
    : `Decision: use the safer plan — ${flag.alternative}. That is the ` +
      `working goal now.`;
  return { role: "user", kind: "decision", content };
}

const normalize = (s: string) => s.trim().toLowerCase();

/**
 * Merge staged decisions into the final summary's safety_flags at
 * submit_intake time. Staged flags are the base — they are what the user saw
 * on the card, and they carry the decided user_overrode/decided_at values
 * (undecided ones keep null). Model-listed flags that match a staged concern
 * are subsumed by it; unmatched model flags are appended with their decision
 * fields forced to null — the product records decisions, never the model.
 */
export function mergeSafetyFlags(
  staged: StagedSafetyFlag[],
  modelFlags: SafetyFlagRecord[],
): SafetyFlagRecord[] {
  const base: SafetyFlagRecord[] = staged.map((f) => ({
    concern: f.concern,
    alternative: f.alternative,
    user_overrode: f.user_overrode,
    decided_at: f.decided_at,
  }));
  const extras: SafetyFlagRecord[] = modelFlags
    .filter(
      (mf) => !staged.some((sf) => normalize(sf.concern) === normalize(mf.concern)),
    )
    .map((mf) => ({
      concern: mf.concern,
      alternative: mf.alternative,
      user_overrode: null,
      decided_at: null,
    }));
  return [...base, ...extras];
}
