/**
 * safety-decision-card.tsx — the safety-override decision card rendered
 * inline in the intake chat when the AI flags a risky goal+timeline
 * (phase-1-golden-path "Safety-override flow"; SPEC §7A: the user is the
 * decider — the AI never refuses).
 *
 * Header is the contract template "We should reconsider {concern}." (concern
 * arrives as a short noun phrase, per the prompt). Body = the AI's reasoning
 * + the safer alternative. Two explicit choices: primary "Use the safer
 * plan", secondary "Proceed with the original plan" — NEITHER is
 * destructive-styled (proceeding with one's own goal is a decision, not a
 * deletion).
 *
 * Crisp chrome, dusk tokens only (DESIGN.md §4.5: chat is working UI). Both
 * buttons ≥44×44px with the primitive's cursor-pointer + brand focus ring;
 * motion is the primitive's restrained transition. Register: declarative, no
 * exclamation.
 */
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";

interface SafetyDecisionCardProps {
  /** Short noun phrase completing "We should reconsider {concern}." */
  concern: string;
  /** The safer plan, in one plain sentence. */
  alternative: string;
  /** The AI's one- or two-sentence case for the concern. */
  reasoning: string;
  /**
   * Persist the decision. userOverrode false = safer plan, true = original
   * plan. Resolves true on success (the parent clears the card and conveys
   * the decision into the conversation); false surfaces a plain retry line.
   */
  onDecide: (userOverrode: boolean) => Promise<boolean>;
}

export function SafetyDecisionCard({
  concern,
  alternative,
  reasoning,
  onDecide,
}: SafetyDecisionCardProps) {
  const [pending, setPending] = useState<"safer" | "original" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handle(userOverrode: boolean) {
    if (pending) return;
    setPending(userOverrode ? "original" : "safer");
    setError(null);
    try {
      const ok = await onDecide(userOverrode);
      if (!ok) setError("That didn't save. Try once more.");
    } catch {
      setError("That didn't save. Try once more.");
    } finally {
      setPending(null);
    }
  }

  return (
    <section
      aria-labelledby="safety-decision-heading"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id="safety-decision-heading"
        className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
      >
        We should reconsider {concern}.
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {reasoning}
      </p>
      <p className="mt-3 text-base leading-relaxed text-foreground">
        The safer plan: {alternative}
      </p>

      {error && (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          size="lg"
          disabled={pending !== null}
          onClick={() => void handle(false)}
          className="h-11 min-h-11 w-full px-5 sm:w-auto"
        >
          {pending === "safer" ? "Saving" : "Use the safer plan"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="lg"
          disabled={pending !== null}
          onClick={() => void handle(true)}
          className="h-11 min-h-11 w-full px-5 sm:w-auto"
        >
          {pending === "original" ? "Saving" : "Proceed with the original plan"}
        </Button>
      </div>
    </section>
  );
}
