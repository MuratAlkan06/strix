/**
 * /playground/goal-complete — auth-exempt, deterministic harness for the
 * Phase 2 goal-completion moment (the goal-detail/check-in harness scheme).
 * No DB: fixture rows run through the REAL buildGoalDetailModel into the REAL
 * <GoalDetail /> behind local always-ok actions (harness.tsx). Every date is
 * pinned so screenshots never shift.
 *
 * ?state= variants:
 *   pre         — an ACTIVE goal: the header shows "Mark complete" with its
 *                 two-tap inline confirm; the local completeGoal always
 *                 succeeds, so the full sunrise is playable in a browser.
 *   celebrating — status completed + initialCelebration: the CompletionScene
 *                 mounted in the header scene area, exactly the state right
 *                 after a confirmed Mark complete. The e2e captures this
 *                 SETTLED (Playwright's global `reducedMotion: "reduce"`
 *                 context pins the 250ms reduced path — DESIGN.md §4.3 — and
 *                 the spec waits for the "Well done." opacity to land before
 *                 screenshotting; no mid-animation pixels). The full 900ms
 *                 rise is reviewed manually here without that emulation.
 *   completed   — the settled state a RELOAD shows: plain non-active status
 *                 treatment ("Completed"), no scene, no Mark complete.
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import {
  buildGoalDetailModel,
  type EquipmentRowLike,
  type GoalRowLike,
  type MilestoneRowLike,
  type TaskRowLike,
} from "../../(goals)/goals/[id]/detail-model";
import { GoalCompleteHarness } from "./harness";

const GOAL_BASE: Omit<GoalRowLike, "status"> = {
  id: "g-climb",
  title: "Climb Mont Blanc",
  intensity_override: null,
  color_index: 0,
  target_date: "2026-07-15",
};

const TASKS: TaskRowLike[] = [
  {
    id: "t-core",
    title: "Core and mobility work",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 20,
    active: true,
    created_at: "2026-06-01T08:00:00.000Z",
  },
  {
    id: "t-longhike",
    title: "Long hike with elevation gain",
    cadence: "weekly",
    weekday: 6,
    estimated_duration_min: 240,
    active: true,
    created_at: "2026-06-01T08:01:00.000Z",
  },
];

const MILESTONES: MilestoneRowLike[] = [
  {
    id: "ms-base",
    title: "Build a 10-mile hiking base",
    target_date: "2026-03-01",
    completed_at: "2026-02-20T10:00:00.000Z",
    position: 0,
    created_at: "2026-06-01T08:00:00.000Z",
  },
  {
    id: "ms-summit",
    title: "Summit day",
    target_date: "2026-07-10",
    completed_at: "2026-06-08T10:00:00.000Z",
    position: 1,
    created_at: "2026-06-01T08:01:00.000Z",
  },
];

const EQUIPMENT: EquipmentRowLike[] = [
  {
    id: "eq-boots",
    title: "Mountaineering boots",
    cost_usd: "450.00",
    milestone_id: "ms-summit",
    standalone_deadline: null,
    purchased_at: "2026-06-01T09:00:00.000Z",
    created_at: "2026-06-01T08:00:00.000Z",
  },
];

const STATES = {
  /** Active goal — Mark complete visible, the moment playable live. */
  pre: { status: "active", initialCelebration: false },
  /** Right after Mark complete — scene mounted, status already flipped. */
  celebrating: { status: "completed", initialCelebration: true },
  /** What a reload of a completed goal shows — no scene, status note only. */
  completed: { status: "completed", initialCelebration: false },
} satisfies Record<
  string,
  { status: GoalRowLike["status"]; initialCelebration: boolean }
>;

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundGoalCompletePage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const requested = Array.isArray(state) ? state[0] : state;
  const selected: keyof typeof STATES =
    requested && requested in STATES
      ? (requested as keyof typeof STATES)
      : "pre";

  const model = buildGoalDetailModel({
    goal: { ...GOAL_BASE, status: STATES[selected].status },
    intakeConfirmed: "challenging",
    accountPreference: null,
    activityType: "mountaineering", // → the mountain scene variant
    tasks: TASKS,
    milestones: MILESTONES,
    equipment: EQUIPMENT,
  });

  return (
    <GoalCompleteHarness
      model={model}
      initialCelebration={STATES[selected].initialCelebration}
    />
  );
}
