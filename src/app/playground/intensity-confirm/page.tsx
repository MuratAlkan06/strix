/**
 * /playground/intensity-confirm — auth-exempt design-review harness for the
 * Slice 4 intensity confirmation card.
 *
 * Renders the EXACT same <IntensityConfirmCard /> the authenticated /goals/new
 * flow renders, under the same global dusk chrome and page frame — but
 * deterministically: onConfirm is a local no-op that resolves true (no server
 * action, no DB, no model call), so the card's full interaction is reachable
 * without auth.
 *
 * States, selected by ?state=:
 *   default           — suggestion = comfortable, pre-selected with reasoning.
 *   ?state=changed    — the same suggestion with a non-suggested pick (brutal)
 *                       selected, showing the "changed pick" affordance.
 *   ?state=generating — the Slice 6 plan-generation states, rendered by the
 *   ?state=plan-ready   SAME <PlanGeneration /> the live interim surface uses,
 *   ?state=plan-error   in fixtureMode (zero network; retry flips the visual
 *                       back to generating locally).
 *
 * The /playground(.*) Clerk matcher (src/proxy.ts) makes it reachable without
 * auth; the segment layout (src/app/playground/layout.tsx) noindexes it. The
 * frame mirrors /goals/new so the composition renders identically.
 *
 * Fixture copy is Patagonia register: declarative, plain, no exclamation.
 */
import type { Intensity } from "../../(goals)/goals/new/intensity-confirm";
import {
  PlanGeneration,
  type PlanGenerationState,
} from "../../(goals)/goals/new/plan-generation";
import { IntensityConfirmHarness } from "./harness";

const SUGGESTED: Intensity = "comfortable";
const REASONING =
  "For a half marathon in October starting from short weekly runs, comfortable is the realistic call.";
const GOAL_CONTEXT = "Finish a half marathon in October";

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundIntensityConfirmPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const selected = Array.isArray(state) ? state[0] : state;
  const changed = selected === "changed";
  const planStates: Record<string, PlanGenerationState> = {
    generating: "generating",
    "plan-ready": "ready",
    "plan-error": "error",
  };
  const planState = selected ? planStates[selected] : undefined;

  return (
    <main className="mx-auto flex h-[calc(100dvh-1px)] w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Let&apos;s shape your goal
        </h1>
        <p className="text-sm text-muted-foreground">
          A few questions, then a plan. Take your time.
        </p>
      </header>

      {planState ? (
        <PlanGeneration initialState={planState} fixtureMode />
      ) : (
        <IntensityConfirmHarness
          suggestedIntensity={SUGGESTED}
          reasoning={REASONING}
          goalContext={GOAL_CONTEXT}
          initialIntensity={changed ? "brutal" : undefined}
        />
      )}
    </main>
  );
}
