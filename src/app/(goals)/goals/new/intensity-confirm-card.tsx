/**
 * intensity-confirm-card.tsx — the required intensity confirmation card shown
 * after intake completes and before plan generation (phase-1-golden-path
 * "Intensity confirmation step"; DESIGN.md §8 "AI suggests, user chooses").
 *
 * Self-contained one-off (per the phase-kickoff product-architect pass): NO
 * generic suggest-confirm base, no temperament extension points. The AI's
 * suggestion is pre-selected with its one-sentence reasoning; the user must
 * pick explicitly and click Continue — pre-selection is a filled-in radio, not
 * auto-proceed.
 *
 * Crisp chrome, dusk tokens only, no illustration (DESIGN.md §4.5: this is
 * working UI under the page's one h1). Radios and Continue clear ≥44×44px.
 * Motion is the restrained transition the shared button primitive already
 * carries — no Motion runtime here.
 */
"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  initialSelection,
  intensityDescriptions,
  intensityLabel,
  type Intensity,
} from "./intensity-confirm";
import { INTENSITY_LEVELS } from "@/lib/ai/intake-schema";

interface IntensityConfirmCardProps {
  suggestedIntensity: Intensity;
  reasoning: string;
  goalContext: string;
  /**
   * Persist the user's final pick. Resolves to true on success; the card flips
   * to its calm interim state. A false result surfaces a plain retry line.
   */
  onConfirm: (intensity: Intensity) => Promise<boolean>;
  /**
   * The radio filled in on first render. Defaults to the AI's suggestion (the
   * pre-selection rule). A resume that already carries the user's pick — or the
   * design-review harness showing a changed selection — passes it explicitly.
   */
  initialIntensity?: Intensity;
}

export function IntensityConfirmCard({
  suggestedIntensity,
  reasoning,
  goalContext,
  onConfirm,
  initialIntensity,
}: IntensityConfirmCardProps) {
  const [selected, setSelected] = useState<Intensity>(
    initialIntensity ?? initialSelection(suggestedIntensity),
  );
  const [pending, setPending] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const descriptions = intensityDescriptions(goalContext);

  async function handleConfirm() {
    if (pending || confirmed) return;
    setPending(true);
    setError(null);
    try {
      const ok = await onConfirm(selected);
      if (ok) {
        setConfirmed(true);
      } else {
        setError("That didn't save. Try once more.");
      }
    } catch {
      setError("That didn't save. Try once more.");
    } finally {
      setPending(false);
    }
  }

  if (confirmed) {
    return <IntensityInterim />;
  }

  return (
    <section
      aria-labelledby="intensity-confirm-heading"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id="intensity-confirm-heading"
        className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
      >
        Pick your intensity for this goal.
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {reasoning}
      </p>

      <fieldset className="mt-5 flex flex-col gap-2">
        <legend className="sr-only">Intensity</legend>
        {INTENSITY_LEVELS.map((level) => {
          const isSelected = selected === level;
          const isSuggested = level === suggestedIntensity;
          return (
            <label
              key={level}
              className={
                // Keyboard focus renders as the brand ring on the whole row
                // (DESIGN.md §11: 2–4px, ring token — same treatment as the
                // Continue button), not the UA outline on the 20px glyph. The
                // input's outline-none below is safe only because of this
                // visible replacement. Selection stays distinct: border + fill
                // + filled glyph, vs the translucent focus halo.
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 " +
                (isSelected
                  ? "border-ring bg-accent/40"
                  : "border-border hover:bg-accent/20")
              }
            >
              <input
                type="radio"
                name="intensity"
                value={level}
                checked={isSelected}
                onChange={() => setSelected(level)}
                disabled={pending}
                className="mt-0.5 size-5 shrink-0 cursor-pointer outline-none accent-primary"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-2 text-base font-medium text-foreground">
                  {intensityLabel(level)}
                  {isSuggested && (
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal text-secondary-foreground">
                      Suggested
                    </span>
                  )}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {descriptions[level]}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {error && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {error}
        </p>
      )}

      <div className="mt-6">
        <Button
          type="button"
          size="lg"
          onClick={handleConfirm}
          disabled={pending}
          className="h-11 min-h-11 w-full px-5 sm:w-auto"
        >
          {pending
            ? "Saving"
            : `Continue with ${intensityLabel(selected)}`}
        </Button>
      </div>
    </section>
  );
}

/**
 * The calm post-confirm state the card renders internally. In the live flow
 * the parent (IntakeFlow) advances to the plan-generation surface on a
 * successful confirm, so this only ever shows in the design-review harness —
 * a quiet line, never a dead button or a faked call.
 */
export function IntensityInterim() {
  return (
    <section
      aria-labelledby="intensity-interim-heading"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id="intensity-interim-heading"
        className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
      >
        Your intensity is set.
      </h2>
      <p className="mt-2 text-base leading-relaxed text-foreground">
        From here we&apos;ll build the plan around it.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        The next step is coming together.
      </p>
    </section>
  );
}
