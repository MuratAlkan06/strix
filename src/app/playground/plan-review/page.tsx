/**
 * /playground/plan-review — auth-exempt design-review harness for the Slice 7
 * draft-plan review/edit screen.
 *
 * Renders the EXACT same <PlanReview /> the authenticated /goals/new/review
 * route renders, under the same page frame — but deterministically: the plan
 * is a fixed fixture and onSave is a local no-op (no server action, no DB),
 * so the full edit interaction (inline edit, add/remove, milestone reorder,
 * the validation notes, the saved terminal state) is reachable without auth.
 *
 * States, selected by ?state=:
 *   default            — physical fixture (activity_type=climbing) → the
 *                        medical disclaimer line renders under the header.
 *   ?state=nonphysical — language fixture → no disclaimer.
 *
 * The /playground(.*) Clerk matcher (src/proxy.ts) makes it reachable without
 * auth; the segment layout noindexes it. Fixture copy is Patagonia register.
 */
import type { PlanDraft } from "@/lib/ai/plan-schema";
import {
  MEDICAL_DISCLAIMER,
  requiresMedicalDisclaimer,
} from "../../(goals)/goals/new/review/review-plan";
import { PlanReviewHarness } from "./harness";

const PHYSICAL_FIXTURE: {
  goalSentence: string;
  activityType: string;
  plan: PlanDraft;
} = {
  goalSentence: "Climb Mont Blanc next July",
  activityType: "climbing",
  plan: {
    daily: [
      {
        title: "Morning mobility work",
        description:
          "Fifteen minutes of hips, ankles, and shoulders before breakfast.",
        estimated_duration_min: 15,
      },
      {
        title: "Log yesterday's training",
        description: null,
        estimated_duration_min: 5,
      },
    ],
    weekly: [
      {
        title: "Long approach hike with a loaded pack",
        description: "Build toward 1,200 m of gain carrying 12 kg.",
        weekday: 6,
        estimated_duration_min: 180,
      },
      {
        title: "Strength session: legs and core",
        description: null,
        weekday: 2,
        estimated_duration_min: 60,
      },
    ],
    milestones: [
      {
        title: "Hike 1,000 m of gain comfortably",
        target_date: "2026-08-15",
        position: 0,
      },
      {
        title: "Complete a glacier-skills course",
        target_date: "2026-09-20",
        position: 1,
      },
      {
        title: "Summit a 4,000 m training peak",
        target_date: "2027-06-15",
        position: 2,
      },
    ],
    equipment: [
      {
        title: "Mountaineering boots",
        cost_usd: 450,
        milestone_position: 1,
        standalone_deadline: null,
      },
      {
        title: "Crampons",
        cost_usd: 180,
        milestone_position: 1,
        standalone_deadline: null,
      },
      {
        title: "Trekking poles",
        cost_usd: 90,
        milestone_position: null,
        standalone_deadline: "2026-07-30",
      },
    ],
  },
};

const NONPHYSICAL_FIXTURE: typeof PHYSICAL_FIXTURE = {
  goalSentence: "Hold a thirty-minute conversation in Spanish",
  activityType: "language",
  plan: {
    daily: [
      {
        title: "Twenty minutes of vocabulary review",
        description: "Spaced repetition, every day, no exceptions.",
        estimated_duration_min: 20,
      },
    ],
    weekly: [
      {
        title: "One-hour conversation session with a tutor",
        description: null,
        weekday: 3,
        estimated_duration_min: 60,
      },
    ],
    milestones: [
      {
        title: "Finish the A2 course",
        target_date: "2026-09-01",
        position: 0,
      },
      {
        title: "First ten-minute conversation without English",
        target_date: "2026-11-01",
        position: 1,
      },
    ],
    equipment: [
      {
        title: "Three months of tutoring sessions",
        cost_usd: 120,
        milestone_position: null,
        standalone_deadline: "2026-08-01",
      },
    ],
  },
};

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundPlanReviewPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const selected = Array.isArray(state) ? state[0] : state;
  const fixture =
    selected === "nonphysical" ? NONPHYSICAL_FIXTURE : PHYSICAL_FIXTURE;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Review your plan
        </h1>
        <p className="text-sm text-muted-foreground">{fixture.goalSentence}</p>
        {requiresMedicalDisclaimer(fixture.activityType) && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {MEDICAL_DISCLAIMER}
          </p>
        )}
      </header>

      <PlanReviewHarness plan={fixture.plan} />
    </main>
  );
}
