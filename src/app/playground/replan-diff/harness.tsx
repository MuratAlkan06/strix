"use client";

/**
 * ReplanDiffHarness — client wrapper for the playground replan-diff surface.
 * Provides the REAL <ReplanDiffView /> deterministic local handlers (decide
 * always ok, generate always ok — no server action, no live AI, no DB) so
 * the whole interaction surface — per-change ✓/✎/✕, Accept all, the inline
 * editors, the commit bar, the Generate CTA and its error/retry state — is
 * exercisable without auth.
 */
import { ReplanDiffView } from "../../(check-in)/replan/[goalId]/replan-diff-view";
import type { ReplanPageModel } from "../../(check-in)/replan/[goalId]/replan-model";

export function ReplanDiffHarness({
  model,
  initialGenerateError,
}: {
  model: ReplanPageModel;
  initialGenerateError?: string;
}) {
  return (
    <ReplanDiffView
      model={model}
      onDecide={async () => ({ ok: true as const })}
      onGenerate={async () => ({ ok: true as const })}
      initialGenerateError={initialGenerateError}
    />
  );
}
