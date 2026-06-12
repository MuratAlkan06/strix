/**
 * /playground/replan-diff — auth-exempt, deterministic harness for the
 * Phase 2 replan diff UI (the check-in harness scheme). No DB, no live AI:
 * pinned fixture rows run through the REAL buildReplanPageModel into the
 * REAL <ReplanDiffView /> behind local stub handlers. Every date is pinned
 * (the repo's standard 2026-06 fixture week) so screenshots never shift.
 *
 * ?state= variants:
 *   proposal      — a pending proposal with a FULL diff: all three sections
 *                   (recurring tasks / milestones / equipment), each with an
 *                   add (green treatment), a modify (side-by-side
 *                   before/after), and a remove (struck-through gray).
 *                   Per-change ✓/✎/✕, Accept all, the commit bar.
 *   empty-pending — a pending proposal still holding the Slice-1 placeholder
 *                   diff: the Generate CTA, never an empty diff.
 *   decided       — a partially_accepted proposal: the read-only summary
 *                   (status + counts + the diff with no controls).
 *   error         — the generate surface after a failed POST (calm constant
 *                   line + Try again).
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import { EMPTY_REPLAN_DIFF, type ReplanDiff } from "@/lib/ai/replan-diff";
import {
  buildReplanPageModel,
  type CurrentEquipmentLike,
  type CurrentMilestoneLike,
  type CurrentTaskLike,
  type ProposalRowLike,
} from "../../(check-in)/replan/[goalId]/replan-model";
import { ReplanDiffHarness } from "./harness";

const GOAL = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Climb Mont Blanc",
  color_index: 0,
  status: "active" as const,
};

const CHECK_IN_ID = "44444444-4444-4444-8444-444444444444";

// Current plan rows — what the modify/remove entries resolve against.
const TASKS: CurrentTaskLike[] = [
  {
    id: "aaaaaaa1-0000-4000-8000-000000000001",
    title: "Morning mobility routine",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 15,
    active: true,
  },
  {
    id: "aaaaaaa1-0000-4000-8000-000000000002",
    title: "Long endurance hike",
    cadence: "weekly",
    weekday: 6,
    estimated_duration_min: 180,
    active: true,
  },
  {
    id: "aaaaaaa1-0000-4000-8000-000000000003",
    title: "Hangboard session",
    cadence: "weekly",
    weekday: 2,
    estimated_duration_min: 30,
    active: true,
  },
];

const MILESTONES: CurrentMilestoneLike[] = [
  {
    id: "bbbbbbb1-0000-4000-8000-000000000001",
    title: "Indoor climbing assessment",
    target_date: "2026-06-20",
    position: 0,
  },
  {
    id: "bbbbbbb1-0000-4000-8000-000000000002",
    title: "Complete a glacier skills course",
    target_date: "2026-07-15",
    position: 1,
  },
  {
    id: "bbbbbbb1-0000-4000-8000-000000000003",
    title: "Summit a 4000m peak",
    target_date: "2026-08-20",
    position: 2,
  },
];

const EQUIPMENT: CurrentEquipmentLike[] = [
  {
    id: "ccccccc1-0000-4000-8000-000000000001",
    title: "Mountaineering boots (B2/B3)",
    cost_usd: "450.00",
    milestone_id: "bbbbbbb1-0000-4000-8000-000000000002",
    standalone_deadline: null,
  },
  {
    id: "ccccccc1-0000-4000-8000-000000000002",
    title: "Crampons",
    cost_usd: "180.00",
    milestone_id: "bbbbbbb1-0000-4000-8000-000000000002",
    standalone_deadline: null,
  },
  {
    id: "ccccccc1-0000-4000-8000-000000000003",
    title: "Resistance bands",
    cost_usd: "25.00",
    milestone_id: null,
    standalone_deadline: "2026-07-01",
  },
];

/** The full fixture diff: every section carries an add, a modify, a remove. */
const FULL_DIFF: ReplanDiff = {
  recurring_tasks: {
    add: [
      {
        title: "Weighted pack carries",
        cadence: "weekly",
        weekday: 3,
        estimated_duration_min: 60,
      },
    ],
    modify: [
      {
        id: "aaaaaaa1-0000-4000-8000-000000000002",
        changes: { weekday: 0, estimated_duration_min: 240 },
      },
    ],
    remove: [{ id: "aaaaaaa1-0000-4000-8000-000000000003" }],
  },
  milestones: {
    add: [
      {
        title: "Acclimatization weekend at altitude",
        target_date: "2026-08-29",
        position: 3,
      },
    ],
    modify: [
      {
        id: "bbbbbbb1-0000-4000-8000-000000000003",
        changes: { target_date: "2026-08-27" },
      },
    ],
    remove: [{ id: "bbbbbbb1-0000-4000-8000-000000000001" }],
  },
  equipment: {
    add: [
      {
        title: "Climbing helmet",
        cost_usd: 90,
        milestone_id: "bbbbbbb1-0000-4000-8000-000000000002",
        standalone_deadline: null,
      },
    ],
    modify: [
      {
        id: "ccccccc1-0000-4000-8000-000000000002",
        changes: { title: "Technical crampons (C2)", cost_usd: 220 },
      },
    ],
    remove: [{ id: "ccccccc1-0000-4000-8000-000000000003" }],
  },
};

function proposalRow(over: Partial<ProposalRowLike>): ProposalRowLike {
  return {
    id: "99999999-9999-4999-8999-999999999999",
    status: "pending",
    trigger: "weekly_check_in",
    weekly_check_in_id: CHECK_IN_ID,
    proposed_changes: FULL_DIFF,
    created_at: "2026-06-08T09:00:00.000Z",
    decided_at: null,
    ...over,
  };
}

const STATES = {
  proposal: {
    proposal: proposalRow({}),
    diff: FULL_DIFF,
    initialGenerateError: undefined,
  },
  "empty-pending": {
    proposal: proposalRow({ proposed_changes: EMPTY_REPLAN_DIFF }),
    diff: EMPTY_REPLAN_DIFF,
    initialGenerateError: undefined,
  },
  decided: {
    proposal: proposalRow({
      status: "partially_accepted",
      decided_at: "2026-06-09T18:30:00.000Z",
    }),
    diff: FULL_DIFF,
    initialGenerateError: undefined,
  },
  // The generate surface after a failed POST — the endpoint's constant 503
  // line plus the calm retry.
  error: {
    proposal: proposalRow({ proposed_changes: EMPTY_REPLAN_DIFF }),
    diff: EMPTY_REPLAN_DIFF,
    initialGenerateError: "AI service unavailable.",
  },
} satisfies Record<
  string,
  {
    proposal: ProposalRowLike;
    diff: ReplanDiff;
    initialGenerateError: string | undefined;
  }
>;

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundReplanDiffPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const requested = Array.isArray(state) ? state[0] : state;
  const selected: keyof typeof STATES =
    requested && requested in STATES
      ? (requested as keyof typeof STATES)
      : "proposal";
  const fixture = STATES[selected];

  const model = buildReplanPageModel({
    goal: GOAL,
    proposal: fixture.proposal,
    diff: fixture.diff,
    tasks: TASKS,
    milestones: MILESTONES,
    equipment: EQUIPMENT,
  });

  return (
    <ReplanDiffHarness
      model={model}
      initialGenerateError={fixture.initialGenerateError}
    />
  );
}
