/**
 * list-model.ts — the pure view-model behind the goals list
 * (phase-1-golden-path "Goals list"). No DB, no React: the /goals page feeds
 * it scopedDb rows; the /playground/goals-list harness feeds it fixtures.
 *
 * Decisions encoded here:
 *   - Active cards carry milestone progress (completed/total via
 *     goal-progress.ts — percent null for 0-milestone goals, so the view can
 *     render an honest no-milestones state, never a fake 0% bar) and the next
 *     milestone (earliest incomplete by position).
 *   - The "Add new goal" tile exists only while count(active) < ACTIVE_GOAL_CAP
 *     (5, hardcoded Phase 1) and previews the color a new goal WOULD get —
 *     the same pickColorIndex the save path runs (gap-filling min available).
 *     At cap there is no tile (Phase 3 adds upgrade messaging; nothing fake
 *     now).
 *   - Goals sort by started_at ascending (oldest first) within each status
 *     section — stable, creation-ordered.
 */
import { milestoneProgress, nextMilestone } from "@/lib/goal-progress";
import { ACTIVE_GOAL_CAP, pickColorIndex } from "@/lib/goal-colors";

export interface GoalRowLike {
  id: string;
  title: string;
  status: "active" | "completed" | "archived";
  color_index: number;
  target_date: string | null;
  started_at?: Date | string | null;
}

export interface MilestoneRowLike {
  goal_id: string;
  title: string;
  completed_at: Date | string | null;
  position: number;
}

export interface ActiveGoalCardModel {
  id: string;
  title: string;
  colorIndex: number;
  targetDate: string | null;
  milestonesTotal: number;
  milestonesCompleted: number;
  /** null when total is 0 — render the honest no-milestones state. */
  progressPercent: number | null;
  /** Earliest incomplete milestone title; null when none remain (or none exist). */
  nextMilestoneTitle: string | null;
}

export interface InactiveGoalRowModel {
  id: string;
  title: string;
  colorIndex: number;
}

export interface GoalsListModel {
  active: ActiveGoalCardModel[];
  completed: InactiveGoalRowModel[];
  archived: InactiveGoalRowModel[];
  /** Color the next goal would get, or null at the active-goal cap. */
  addTileColorIndex: number | null;
}

function startedAtMs(g: GoalRowLike): number {
  if (g.started_at == null) return Number.MAX_SAFE_INTEGER;
  const ms = new Date(g.started_at).getTime();
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
}

function byStartedAt(a: GoalRowLike, b: GoalRowLike): number {
  return startedAtMs(a) - startedAtMs(b);
}

export function buildGoalsListModel(
  goals: readonly GoalRowLike[],
  milestones: readonly MilestoneRowLike[],
): GoalsListModel {
  const byGoal = new Map<string, MilestoneRowLike[]>();
  for (const m of milestones) {
    const list = byGoal.get(m.goal_id);
    if (list) list.push(m);
    else byGoal.set(m.goal_id, [m]);
  }

  const active = goals
    .filter((g) => g.status === "active")
    .sort(byStartedAt)
    .map((g): ActiveGoalCardModel => {
      const ms = byGoal.get(g.id) ?? [];
      const progress = milestoneProgress(ms);
      const next = nextMilestone(ms);
      return {
        id: g.id,
        title: g.title,
        colorIndex: g.color_index,
        targetDate: g.target_date,
        milestonesTotal: progress.total,
        milestonesCompleted: progress.completed,
        progressPercent: progress.percent,
        nextMilestoneTitle: next?.title ?? null,
      };
    });

  const inactive = (status: "completed" | "archived") =>
    goals
      .filter((g) => g.status === status)
      .sort(byStartedAt)
      .map(
        (g): InactiveGoalRowModel => ({
          id: g.id,
          title: g.title,
          colorIndex: g.color_index,
        }),
      );

  return {
    active,
    completed: inactive("completed"),
    archived: inactive("archived"),
    addTileColorIndex:
      active.length < ACTIVE_GOAL_CAP
        ? pickColorIndex(active.map((g) => g.colorIndex))
        : null,
  };
}
