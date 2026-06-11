/**
 * /playground/goals-list — auth-exempt, deterministic harness for the Slice 8
 * goals-list surface. No DB: fixture rows run through the REAL
 * buildGoalsListModel into the REAL <GoalsList /> the authenticated /goals
 * route renders.
 *
 * States, selected by ?state=:
 *   default        — 3 active goals with varied progress (partial, honest
 *                    0-milestone, near-complete) on colors {0,2,3}, so the
 *                    add-tile previews the GAP-FILLED next color (alpine
 *                    blue, index 1); completed/archived render their honest
 *                    empties.
 *   ?state=at-cap  — 5 active goals (cap) → no add tile.
 *   ?state=empty   — zero goals anywhere → honest empty pointing at
 *                    /goals/new.
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import {
  buildGoalsListModel,
  type GoalRowLike,
  type MilestoneRowLike,
} from "../../(goals)/goals/list-model";
import { GoalsList } from "../../(goals)/goals/goals-list";

const ACTIVE_THREE: GoalRowLike[] = [
  {
    id: "g-climb",
    title: "Climb Mont Blanc next July",
    status: "active",
    color_index: 0,
    target_date: "2027-07-15",
    started_at: "2026-04-02T08:00:00.000Z",
  },
  {
    id: "g-spanish",
    title: "Hold a thirty-minute conversation in Spanish",
    status: "active",
    color_index: 2,
    target_date: "2026-12-01",
    started_at: "2026-05-11T08:00:00.000Z",
  },
  {
    id: "g-book",
    title: "Finish the first draft of the book",
    status: "active",
    color_index: 3,
    target_date: null,
    started_at: "2026-06-01T08:00:00.000Z",
  },
];

const MILESTONES_THREE: MilestoneRowLike[] = [
  // Climb — 1 of 3 complete; next by position is the glacier course.
  {
    goal_id: "g-climb",
    title: "Hike 1,000 m of gain comfortably",
    completed_at: "2026-05-20T10:00:00.000Z",
    position: 0,
  },
  {
    goal_id: "g-climb",
    title: "Complete a glacier-skills course",
    completed_at: null,
    position: 1,
  },
  {
    goal_id: "g-climb",
    title: "Summit a 4,000 m training peak",
    completed_at: null,
    position: 2,
  },
  // Spanish — 3 of 4 complete, near the end.
  {
    goal_id: "g-spanish",
    title: "Finish the A2 course",
    completed_at: "2026-05-25T10:00:00.000Z",
    position: 0,
  },
  {
    goal_id: "g-spanish",
    title: "First ten-minute conversation without English",
    completed_at: "2026-05-30T10:00:00.000Z",
    position: 1,
  },
  {
    goal_id: "g-spanish",
    title: "Read a short story unaided",
    completed_at: "2026-06-05T10:00:00.000Z",
    position: 2,
  },
  {
    goal_id: "g-spanish",
    title: "Thirty minutes with a native speaker",
    completed_at: null,
    position: 3,
  },
  // Book — deliberately NO milestones: the honest no-milestones state.
];

const ACTIVE_AT_CAP: GoalRowLike[] = [0, 1, 2, 3, 4].map((i) => ({
  id: `g-cap-${i}`,
  title: [
    "Climb Mont Blanc next July",
    "Hold a thirty-minute conversation in Spanish",
    "Finish the first draft of the book",
    "Run the valley trail half marathon",
    "Play the first movement from memory",
  ][i]!,
  status: "active",
  color_index: i,
  target_date: "2027-01-15",
  started_at: `2026-05-0${i + 1}T08:00:00.000Z`,
}));

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundGoalsListPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const selected = Array.isArray(state) ? state[0] : state;

  const model =
    selected === "empty"
      ? buildGoalsListModel([], [])
      : selected === "at-cap"
        ? buildGoalsListModel(ACTIVE_AT_CAP, [])
        : buildGoalsListModel(ACTIVE_THREE, MILESTONES_THREE);

  return <GoalsList model={model} />;
}
