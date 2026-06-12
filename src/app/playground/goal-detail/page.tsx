/**
 * /playground/goal-detail — auth-exempt, deterministic harness for the
 * Slice 9 goal-detail surface. No DB: fixture rows run through the REAL
 * buildGoalDetailModel into the REAL <GoalDetail /> behind local no-op
 * actions (harness.tsx).
 *
 * Default state: an active goal with intensity_override UNSET — the control
 * shows the intake intensity ("challenging") as the active selection with
 * the contract's exact copy "Follows your intake intensity". Sections are
 * populated, including a COMPLETED milestone (Done note) and a PURCHASED
 * equipment item (struck, still visible).
 *
 * ?state=overridden — intensity_override set ("brutal"): the control shows
 * the override as active with "Set for this goal."
 *
 * ?state=completed-readonly — the SAME populated fixtures with goal status
 * "completed" (phase 2 slice 6: an accomplished card opens read-only
 * detail): zero edit affordances — no Edit/Add, no milestone reorder, no
 * intensity radios (plain value text), no Mark complete, no Adjust plan.
 * The status badge + quiet treatment render as on a real reload.
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
import { GoalDetailHarness } from "./harness";

const GOAL_BASE: Omit<GoalRowLike, "intensity_override"> = {
  id: "g-climb",
  title: "Climb Mont Blanc next July",
  status: "active",
  color_index: 0,
  target_date: "2027-07-15",
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
    id: "t-steps",
    title: "Stair climbs with a loaded pack",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 30,
    active: true,
    created_at: "2026-06-01T08:01:00.000Z",
  },
  // A removed task — must NOT render (remove = active=false, history kept).
  {
    id: "t-removed",
    title: "Retired drill",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 10,
    active: false,
    created_at: "2026-06-01T08:02:00.000Z",
  },
  {
    id: "t-longhike",
    title: "Long hike with elevation gain",
    cadence: "weekly",
    weekday: 6,
    estimated_duration_min: 240,
    active: true,
    created_at: "2026-06-01T08:03:00.000Z",
  },
  {
    id: "t-gym",
    title: "Strength session at the gym",
    cadence: "weekly",
    weekday: 2,
    estimated_duration_min: 60,
    active: true,
    created_at: "2026-06-01T08:04:00.000Z",
  },
];

const MILESTONES: MilestoneRowLike[] = [
  {
    id: "ms-base",
    title: "Build a 10-mile hiking base",
    target_date: "2026-09-01",
    completed_at: "2026-06-05T10:00:00.000Z", // completed — shows the Done note
    position: 0,
    created_at: "2026-06-01T08:00:00.000Z",
  },
  {
    id: "ms-glacier",
    title: "Complete a glacier-travel course",
    target_date: "2026-12-15",
    completed_at: null,
    position: 1,
    created_at: "2026-06-01T08:01:00.000Z",
  },
  {
    id: "ms-tete",
    title: "Summit Tête Blanche as a shakedown",
    target_date: "2027-05-20",
    completed_at: null,
    position: 2,
    created_at: "2026-06-01T08:02:00.000Z",
  },
];

const EQUIPMENT: EquipmentRowLike[] = [
  {
    id: "eq-boots",
    title: "Mountaineering boots",
    cost_usd: "450.00",
    milestone_id: "ms-glacier", // milestone-linked deadline
    standalone_deadline: null,
    purchased_at: null,
    created_at: "2026-06-01T08:00:00.000Z",
  },
  {
    id: "eq-harness",
    title: "Climbing harness",
    cost_usd: "95.50",
    milestone_id: null,
    standalone_deadline: "2026-11-01", // standalone date
    purchased_at: "2026-06-05T09:00:00.000Z", // purchased — struck, visible
    created_at: "2026-06-01T08:01:00.000Z",
  },
  {
    id: "eq-crampons",
    title: "Crampons",
    cost_usd: null, // optional cost — renders nothing
    milestone_id: "ms-tete",
    standalone_deadline: null,
    purchased_at: null,
    created_at: "2026-06-01T08:02:00.000Z",
  },
];

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundGoalDetailPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const selected = Array.isArray(state) ? state[0] : state;

  const model = buildGoalDetailModel({
    goal: {
      ...GOAL_BASE,
      // completed-readonly: the read-only gate engages off the status alone.
      status:
        selected === "completed-readonly" ? "completed" : GOAL_BASE.status,
      // Default: override UNSET → effective = intake ("challenging"),
      // copy "Follows your intake intensity".
      intensity_override: selected === "overridden" ? "brutal" : null,
    },
    intakeConfirmed: "challenging",
    accountPreference: "comfortable",
    activityType: "mountaineering", // → the mountain scene variant
    tasks: TASKS,
    milestones: MILESTONES,
    equipment: EQUIPMENT,
  });

  return <GoalDetailHarness model={model} />;
}
