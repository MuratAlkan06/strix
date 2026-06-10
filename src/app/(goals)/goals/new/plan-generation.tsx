/**
 * plan-generation.tsx — the post-confirm surface that runs plan generation
 * (phase-1-golden-path "Plan generation"; DESIGN.md §8 state philosophy).
 *
 * Auto-kicks POST /api/ai/plan on entering the interim state (the phase doc's
 * "then proceeds to plan generation") and renders three calm states:
 *   generating — quiet line + pulsing muted blocks (no fake progress %;
 *                shimmer collapses to static under reduced motion, §7).
 *   ready      — "Your plan is ready." The review route is Slice 7; nothing
 *                here links to it yet (no dead buttons).
 *   error      — a calm card with a constant line + retry (§8: never a red
 *                screen; destructive red is reserved for destructive acts).
 *
 * Resumable: the server derives the initial state from the draft (plan_draft
 * present → ready), so a reload during/after generation lands correctly; a
 * reload mid-flight re-kicks, and the route's in-flight guard absorbs overlap.
 *
 * fixtureMode is the /playground design-review harness path: never touches
 * the network; retry flips back to the generating visual locally.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

export type PlanGenerationState = "generating" | "ready" | "error";

interface PlanGenerationProps {
  /** Server-derived starting state: "ready" when plan_draft already exists. */
  initialState?: PlanGenerationState;
  /** Design-review harness mode — deterministic, zero network. */
  fixtureMode?: boolean;
}

export function PlanGeneration({
  initialState = "generating",
  fixtureMode = false,
}: PlanGenerationProps) {
  const [state, setState] = useState<PlanGenerationState>(initialState);
  const kickedRef = useRef(false);

  const generate = useCallback(async () => {
    setState("generating");
    if (fixtureMode) return;
    try {
      const res = await fetch("/api/ai/plan", { method: "POST" });
      if (!res.ok) throw new Error("plan generation failed");
      setState("ready");
    } catch {
      setState("error");
    }
  }, [fixtureMode]);

  // Auto-kick once on entering the surface mid-generation-needed. Strict-mode
  // double-mount and re-renders are absorbed by the ref; a regenerate is only
  // ever an explicit retry.
  useEffect(() => {
    if (fixtureMode || initialState !== "generating" || kickedRef.current) {
      return;
    }
    kickedRef.current = true;
    void generate();
  }, [fixtureMode, initialState, generate]);

  return (
    <section
      aria-labelledby="plan-generation-heading"
      aria-live="polite"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      {state === "generating" && (
        <>
          <h2
            id="plan-generation-heading"
            className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
          >
            Building your plan.
          </h2>
          <p className="mt-2 text-base leading-relaxed text-foreground">
            Calibrated to where you&apos;re starting and the intensity you
            picked.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This takes a moment.
          </p>
          <div aria-hidden="true" className="mt-5 flex flex-col gap-2">
            <div className="h-4 w-3/4 rounded bg-muted motion-safe:animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-muted motion-safe:animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-muted motion-safe:animate-pulse" />
          </div>
        </>
      )}

      {state === "ready" && (
        <>
          <h2
            id="plan-generation-heading"
            className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
          >
            Your plan is ready.
          </h2>
          <p className="mt-2 text-base leading-relaxed text-foreground">
            Daily habits, weekly sessions, milestones, and the gear to line up.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            The review step is coming together.
          </p>
        </>
      )}

      {state === "error" && (
        <>
          <h2
            id="plan-generation-heading"
            className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
          >
            We couldn&apos;t build your plan just now.
          </h2>
          <p className="mt-2 text-base leading-relaxed text-foreground">
            Your answers are saved. Nothing was lost.
          </p>
          <div className="mt-5">
            <Button
              type="button"
              size="lg"
              onClick={() => void generate()}
              className="h-11 min-h-11 w-full px-5 sm:w-auto"
            >
              Try again
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
