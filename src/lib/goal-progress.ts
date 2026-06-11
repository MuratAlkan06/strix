/**
 * goal-progress.ts — milestone-derived goal progress + next-milestone
 * selection (phase-1-golden-path "Goals list": progress bar =
 * completed_milestones / total_milestones; next milestone = earliest
 * incomplete by position).
 *
 * A milestone is COMPLETE iff completed_at is set. A goal with zero
 * milestones has no progress fraction — percent is null, and the UI renders
 * an honest no-milestones state instead of a fake 0% bar.
 *
 * Pure and client-safe, like equipment-deadline.ts — the goals list uses it
 * now; goal detail (Slice 9) can reuse it.
 */

interface MilestoneProgressLike {
  completed_at: Date | string | null;
}

interface NextMilestoneLike extends MilestoneProgressLike {
  position: number;
}

export interface MilestoneProgress {
  total: number;
  completed: number;
  /** Rounded 0–100, or null when there are no milestones (no fake 0% bar). */
  percent: number | null;
}

function isComplete(m: MilestoneProgressLike): boolean {
  return m.completed_at != null;
}

/** Completed / total across a goal's milestones. */
export function milestoneProgress(
  milestones: readonly MilestoneProgressLike[],
): MilestoneProgress {
  const total = milestones.length;
  const completed = milestones.filter(isComplete).length;
  return {
    total,
    completed,
    percent: total === 0 ? null : Math.round((completed / total) * 100),
  };
}

/**
 * The next milestone: earliest INCOMPLETE one by position (input order breaks
 * ties). Null when every milestone is complete — or there are none.
 */
export function nextMilestone<T extends NextMilestoneLike>(
  milestones: readonly T[],
): T | null {
  let next: T | null = null;
  for (const m of milestones) {
    if (isComplete(m)) continue;
    if (next === null || m.position < next.position) next = m;
  }
  return next;
}
