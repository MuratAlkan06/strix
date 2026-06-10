/**
 * intake-flow.tsx — the client orchestrator for /goals/new's three surfaces
 * (phase-1-golden-path "Intensity confirmation step" integration).
 *
 * One client boundary owns the live transition that the server can't observe
 * mid-session: chat → intensity confirmation card → calm interim. The server
 * page seeds the initial surface (so a returning visit resumes at the right
 * place) and this component carries it forward within the session:
 *   - chat:    renders IntakeChat; on completion it lifts the summary and
 *              switches to the card (replacing Slice 3's inline handoff).
 *   - confirm: renders IntensityConfirmCard, binding the confirmIntensity
 *              server action to its onConfirm. An explicit Continue is required.
 *   - interim: plan generation (Slice 6) — PlanGeneration auto-kicks
 *              POST /api/ai/plan and renders generating / ready / error.
 *
 * The card stays prop-driven (suggestion + reasoning + onConfirm) so the
 * design-review harness can render it deterministically with no server action.
 * A successful confirm advances the surface here (interim → generation kick);
 * the card's internal post-confirm interim only ever shows in the harness.
 */
"use client";

import { useState } from "react";

import { IntakeChat } from "./intake-chat";
import { IntensityConfirmCard } from "./intensity-confirm-card";
import { PlanGeneration } from "./plan-generation";
import { confirmIntensity } from "./confirm-intensity";
import { decideSafety } from "./decide-safety";
import {
  asIntakeSummaryDraft,
  type IntakeSummaryDraft,
  type Intensity,
} from "./intensity-confirm";
import type { SafetyFlagPayload } from "@/lib/ai/safety-flags";
import type { TranscriptTurn } from "@/lib/ai/transcript";

type Surface = "chat" | "confirm" | "interim";

interface IntakeFlowProps {
  goalDraftId: string;
  seed: string | null;
  initialTranscript: TranscriptTurn[];
  /** Server-derived starting surface (resumable). */
  initialSurface: Surface;
  /** Present when initialSurface is "confirm" or "interim". */
  initialSummary: IntakeSummaryDraft | null;
  /** Server-derived undecided safety flag (resume mid-decision), or null. */
  initialPendingFlag: SafetyFlagPayload | null;
  /** True when plan_draft already exists — interim resumes at "ready". */
  initialPlanReady: boolean;
}

export function IntakeFlow({
  goalDraftId,
  seed,
  initialTranscript,
  initialSurface,
  initialSummary,
  initialPendingFlag,
  initialPlanReady,
}: IntakeFlowProps) {
  const [surface, setSurface] = useState<Surface>(initialSurface);
  const [summary, setSummary] = useState<IntakeSummaryDraft | null>(
    initialSummary,
  );

  if (surface === "interim") {
    // A surface reached by a fresh confirm has no plan yet (generation kicks
    // off); a server-resumed one starts at "ready" when plan_draft exists.
    return (
      <PlanGeneration
        initialState={initialPlanReady ? "ready" : "generating"}
      />
    );
  }

  if (surface === "confirm" && summary) {
    return (
      <IntensityConfirmCard
        suggestedIntensity={summary.suggested_intensity}
        reasoning={summary.suggested_intensity_reasoning}
        goalContext={summary.one_sentence_goal}
        onConfirm={async (intensity: Intensity) => {
          const result = await confirmIntensity(intensity);
          if (result.ok) {
            // Advance to the interim surface here so the live flow proceeds
            // straight into plan generation (the card's own confirmed state
            // remains the harness's terminal rendering).
            setSurface("interim");
          }
          return result.ok;
        }}
      />
    );
  }

  return (
    <IntakeChat
      goalDraftId={goalDraftId}
      seed={seed}
      initialTranscript={initialTranscript}
      initiallyCompleted={false}
      initialPendingFlag={initialPendingFlag}
      onDecideSafety={async (userOverrode: boolean) => {
        const result = await decideSafety(userOverrode);
        return result.ok;
      }}
      onIntakeComplete={(raw) => {
        const parsed = asIntakeSummaryDraft(raw);
        if (parsed) {
          setSummary(parsed);
          setSurface("confirm");
        }
      }}
    />
  );
}
