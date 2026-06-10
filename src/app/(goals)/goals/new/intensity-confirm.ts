/**
 * intensity-confirm.ts — pure, side-effect-free logic for the intensity
 * confirmation step (phase-1-golden-path "Intensity confirmation step").
 *
 * Kept apart from the card component and the server action so the rules can be
 * unit-tested with no DB, no React, and no model call — mirroring transcript.ts.
 *
 * Two faces:
 *   - The CARD reads `intakeSummaryDraft` for its suggestion + reasoning and
 *     pre-selects the AI's `suggested_intensity` (never the user's account
 *     preference — every goal's card pre-selects that goal's own suggestion).
 *   - The PAGE reads a draft's shape and derives which of three surfaces to
 *     render: (a) chat, (b) confirmation card, (c) calm interim state.
 */
import { INTENSITY_LEVELS } from "@/lib/ai/intake-schema";

export type Intensity = (typeof INTENSITY_LEVELS)[number];

/** Type guard narrowing an unknown jsonb value to an Intensity enum member. */
export function isIntensity(value: unknown): value is Intensity {
  return (
    typeof value === "string" &&
    (INTENSITY_LEVELS as readonly string[]).includes(value)
  );
}

/**
 * One-line description per intensity, anchored to the goal context. `context`
 * is the one-sentence goal; descriptions stay declarative and plain (Patagonia
 * register — no exclamation, no "crush it" energy).
 */
export function intensityDescriptions(
  context: string,
): Record<Intensity, string> {
  const goal = context.trim().length > 0 ? context.trim() : "this goal";
  return {
    comfortable: `A steady, sustainable pace toward ${goal}. Room for life around it.`,
    challenging: `A demanding pace toward ${goal}. Most weeks ask something of you.`,
    brutal: `An unrelenting pace toward ${goal}. Little slack, fastest timeline.`,
  };
}

/** Human label for an intensity, used in the "Continue with {label}" action. */
export function intensityLabel(intensity: Intensity): string {
  switch (intensity) {
    case "comfortable":
      return "Comfortable";
    case "challenging":
      return "Challenging";
    case "brutal":
      return "Brutal";
  }
}

/**
 * The card's initial selection: the AI's suggestion. Pre-selection counts as a
 * selection (the radio is filled in), but the page still requires an explicit
 * Continue — pre-selection is not auto-proceed (see the page's state routing).
 */
export function initialSelection(suggested: Intensity): Intensity {
  return suggested;
}

/** What the confirm path writes/emits — the suggestion on record plus the
 *  user's final pick (which may differ from the suggestion). */
export interface ConfirmPayload {
  suggested_intensity: Intensity;
  confirmed_intensity: Intensity;
}

/**
 * Build the confirm payload from the AI's suggestion and the user's final
 * selection. `confirmed` is the user's pick — it reflects a changed choice when
 * they moved off the pre-selected suggestion.
 */
export function buildConfirmPayload(
  suggested: Intensity,
  confirmed: Intensity,
): ConfirmPayload {
  return { suggested_intensity: suggested, confirmed_intensity: confirmed };
}

/**
 * The minimal shape the card needs from goal_drafts.intake_summary_draft:
 * the AI's suggestion + its one-sentence reasoning + the goal context, plus
 * (once confirmed) the user's pick staged back into the same draft.
 */
export interface IntakeSummaryDraft {
  one_sentence_goal: string;
  suggested_intensity: Intensity;
  suggested_intensity_reasoning: string;
  /** Set by the confirm path; absent until the user picks. */
  confirmed_intensity?: Intensity;
}

/**
 * Narrow an unknown jsonb value (goal_drafts.intake_summary_draft) into the
 * subset the card needs, or null when intake has not produced a usable
 * suggestion yet. Tolerant of extra keys (the draft carries the full intake
 * payload); strict about the three the card depends on.
 */
export function asIntakeSummaryDraft(value: unknown): IntakeSummaryDraft | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (!isIntensity(v.suggested_intensity)) return null;
  if (typeof v.suggested_intensity_reasoning !== "string") return null;
  const goal =
    typeof v.one_sentence_goal === "string" ? v.one_sentence_goal : "";
  return {
    one_sentence_goal: goal,
    suggested_intensity: v.suggested_intensity,
    suggested_intensity_reasoning: v.suggested_intensity_reasoning,
    confirmed_intensity: isIntensity(v.confirmed_intensity)
      ? v.confirmed_intensity
      : undefined,
  };
}

/**
 * The three surfaces /goals/new can render, derived from the draft's shape:
 *   - "chat":    intake in progress (no usable intake summary draft yet).
 *   - "confirm": intake complete, intensity not yet confirmed → the card.
 *   - "interim": intensity confirmed → calm "plan is coming" state (Slice 6
 *                wires the actual generation; nothing dead is shown here).
 */
export type DraftSurface = "chat" | "confirm" | "interim";

/** What resolveSurface needs from the draft (server-derived, resumable). */
export interface DraftShape {
  summary: IntakeSummaryDraft | null;
}

/**
 * Route a draft to its surface. Server-derived so a returning visit resumes at
 * the right place: a completed-intake draft with an unconfirmed intensity
 * resumes at the card, not back in the chat and not skipped past it.
 */
export function resolveSurface(draft: DraftShape): DraftSurface {
  if (!draft.summary) return "chat";
  if (draft.summary.confirmed_intensity) return "interim";
  return "confirm";
}
