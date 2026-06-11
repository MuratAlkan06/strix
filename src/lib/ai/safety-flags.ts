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

// ---------------------------------------------------------------------------
// Concern matching — the duplicate-flag suppression predicate.
//
// The model re-states the same concern with drifting phrasing turn to turn
// ("the 20-pound target in two weeks" / "losing 20 pounds in 2 weeks"), so
// exact string equality under-matches. Tokens are normalized (lowercase,
// punctuation stripped, number words → digits, crude singularization,
// stopwords dropped) and compared by Jaccard overlap plus a containment rule
// for tightened restatements. Deliberately conservative: two genuinely
// distinct concerns share at most incidental tokens and stay below the
// threshold.
// ---------------------------------------------------------------------------

const CONCERN_STOPWORDS = new Set([
  "the", "a", "an", "in", "of", "to", "for", "from", "at", "on", "with",
  "and", "or", "that", "this", "is", "are", "be", "it", "its", "their",
  "your", "into", "by",
]);

const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

function concernTokens(s: string): Set<string> {
  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => NUMBER_WORDS[t] ?? t)
    .map((t) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t))
    .filter((t) => !CONCERN_STOPWORDS.has(t));
  return new Set(tokens);
}

/** True when two concern phrasings name the same underlying concern. */
export function matchesConcern(a: string, b: string): boolean {
  if (normalize(a) === normalize(b)) return true;
  const ta = concernTokens(a);
  const tb = concernTokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  if (intersection / union >= 0.6) return true;
  // Containment: one phrasing is a tightened subset of the other ("the
  // 20-pound target" ⊂ "the 20-pound target in two weeks").
  const minSize = Math.min(ta.size, tb.size);
  return intersection === minSize && minSize >= 2;
}

/**
 * The most recent staged flag (decided OR undecided) matching `concern`, or
 * null. The intake route uses this to suppress duplicate flag_safety calls:
 * a match means the concern was already raised on a card — re-staging it
 * would re-render the card and re-litigate a decision the user already made.
 */
export function findStagedMatch(
  staged: StagedSafetyFlag[],
  concern: string,
): StagedSafetyFlag | null {
  for (let i = staged.length - 1; i >= 0; i--) {
    if (matchesConcern(staged[i]!.concern, concern)) return staged[i]!;
  }
  return null;
}

/**
 * The tool_result content sent back when a duplicate flag_safety call is
 * suppressed: it names the user's recorded decision (the product is the
 * decider's pen) and instructs the model to continue the intake without
 * re-raising — the continuation request is what turns a flag-only response
 * into productive prose.
 */
export function duplicateFlagToolResultText(flag: StagedSafetyFlag): string {
  if (flag.decided_at === null) {
    return (
      "This concern was already raised in this intake and is in front of the " +
      "user as a decision card now. Do not raise it again. Continue the intake."
    );
  }
  const decision = flag.user_overrode
    ? "they chose to proceed with the original goal despite the concern"
    : `they chose the safer alternative: ${flag.alternative}`;
  return (
    `This concern was already raised in this intake and the user has ` +
    `decided — ${decision}. That decision is final for this intake; do not ` +
    `raise this concern again. Continue the intake with the decided ` +
    `direction as the working goal — ask the next question, or call ` +
    `submit_intake if every required field is filled.`
  );
}

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
    .filter((mf) => !staged.some((sf) => matchesConcern(sf.concern, mf.concern)))
    .map((mf) => ({
      concern: mf.concern,
      alternative: mf.alternative,
      user_overrode: null,
      decided_at: null,
    }));
  return [...base, ...extras];
}
