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
 * Three states, selected by ?state=:
 *   default        — mid-conversation (seed=race opener + ~4 turns), input enabled
 *   ?state=complete — the completion handoff shown after intake_summary_draft
 *   ?state=safety  — the safety-override decision card (Slice 5): a risky
 *                    goal+timeline exchange with an undecided flag. Both
 *                    buttons are interactive and flip local state only
 *                    (fixtureMode: no server action) — the card settles into
 *                    the decision status line and the composer releases.
 *
 * The /playground(.*) Clerk matcher (src/proxy.ts) makes it reachable without
 * auth; the segment layout (src/app/playground/layout.tsx) noindexes it. The
 * frame mirrors /goals/new so the composition renders identically.
 *
 * Fixture copy is Patagonia register: declarative, plain, no exclamation.
 */
import type { SafetyFlagPayload } from "@/lib/ai/safety-flags";
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

// The safety state: a risky goal+timeline exchange, frozen at the assistant's
// pushback. The flag mirrors the prompt's worked example (prompts/intake.ts
// <safety>): concern is the short noun phrase completing the card header.
const SAFETY_TRANSCRIPT: TranscriptTurn[] = [
  {
    role: "assistant",
    content:
      "Tell me what you want to work toward, and where you're starting from today.",
  },
  {
    role: "user",
    content:
      "I want to lose 20 pounds in two weeks. There's a wedding coming up.",
  },
  {
    role: "assistant",
    content:
      "Twenty pounds in two weeks isn't safe to target — most of it would be water, and the rebound is rough. We can aim for four to six pounds in those two weeks and set up the habit that keeps going after the wedding. Want to plan it that way?",
  },
];

const SAFETY_FLAG: SafetyFlagPayload = {
  concern: "the 20-pound target in two weeks",
  alternative: "4-6 lbs in 2 weeks plus a continuing habit",
  reasoning:
    "Twenty pounds in two weeks isn't safe to target — most of it would be water weight, and the rebound is rough.",
};

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundIntakeChatPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const pick = (s: string) =>
    Array.isArray(state) ? state.includes(s) : state === s;
  const complete = pick("complete");
  const safety = pick("safety");

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
        seed={safety ? null : "race"}
        initialTranscript={safety ? SAFETY_TRANSCRIPT : RACE_TRANSCRIPT}
        initiallyCompleted={complete}
        initialPendingFlag={safety ? SAFETY_FLAG : null}
      />
    </main>
  );
}
