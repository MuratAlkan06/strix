/**
 * harness.tsx — the client boundary for the intensity-confirm design-review
 * harness. The page is a server component (it resolves searchParams); the card
 * needs an onConfirm function prop, which a server component cannot pass to a
 * client component — so this thin client wrapper supplies a deterministic
 * no-op (resolves true → the card flips to its calm interim state). No server
 * action, no DB, no model call.
 */
"use client";

import { IntensityConfirmCard } from "../../(goals)/goals/new/intensity-confirm-card";
import type { Intensity } from "../../(goals)/goals/new/intensity-confirm";

interface HarnessProps {
  suggestedIntensity: Intensity;
  reasoning: string;
  goalContext: string;
  initialIntensity?: Intensity;
}

export function IntensityConfirmHarness({
  suggestedIntensity,
  reasoning,
  goalContext,
  initialIntensity,
}: HarnessProps) {
  return (
    <IntensityConfirmCard
      suggestedIntensity={suggestedIntensity}
      reasoning={reasoning}
      goalContext={goalContext}
      initialIntensity={initialIntensity}
      onConfirm={async () => true}
    />
  );
}
