/**
 * /playground/intake-chat — auth-exempt design-review harness for the Slice 3
 * intake chat surface.
 *
 * KEPT (not throwaway), like /playground/empty-dashboard: this is the verify:ui
 * harness surface for the intake chat until that harness re-targets the real
 * product surfaces (phase-1 Design-system handoff). It renders the EXACT same
 * <IntakeChat /> the authenticated /goals/new renders — same component, same
 * global dusk chrome (root layout + globals.css), same page frame — but
 * deterministically: fixtureMode short-circuits PostHog and the live
 * /api/ai/intake call, and the transcript is hardcoded, so both review states
 * are reachable and byte-stable with no auth, no DB, and no model call.
 *
 * Two states, selected by ?state=:
 *   default        — mid-conversation (seed=race opener + ~4 turns), input enabled
 *   ?state=complete — the completion handoff shown after intake_summary_draft
 *
 * The /playground(.*) Clerk matcher (src/proxy.ts) makes it reachable without
 * auth; the segment layout (src/app/playground/layout.tsx) noindexes it. The
 * frame mirrors /goals/new so the composition renders identically.
 *
 * Fixture copy is Patagonia register: declarative, plain, no exclamation.
 */
import type { TranscriptTurn } from "@/lib/ai/transcript";

import { IntakeChat } from "../../(goals)/goals/new/intake-chat";

// Mid-conversation, seed=race. The first assistant line is the real seed=race
// opener from intake-chat's opener(); the rest is ~4 turns of plain intake.
const RACE_TRANSCRIPT: TranscriptTurn[] = [
  {
    role: "assistant",
    content:
      "A race. What distance, and is there a date you're aiming for? Tell me where your training is today.",
  },
  {
    role: "user",
    content:
      "A half marathon. There's a local one in October. Right now I run about 15 km a week, three short runs.",
  },
  {
    role: "assistant",
    content:
      "October gives us a solid runway from here. Two things to place the starting line: your most comfortable single run lately, and whether you've raced a distance before.",
  },
  {
    role: "user",
    content:
      "My longest recent run is 7 km, and it felt fine. I did a 10 km a couple of years ago, nothing since.",
  },
];

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundIntakeChatPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const complete = Array.isArray(state) ? state.includes("complete") : state === "complete";

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

      <IntakeChat
        fixtureMode
        goalDraftId="playground-fixture"
        seed="race"
        initialTranscript={RACE_TRANSCRIPT}
        initiallyCompleted={complete}
      />
    </main>
  );
}
