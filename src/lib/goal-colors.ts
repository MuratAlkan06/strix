/**
 * goal-colors.ts — the Phase 1 color-assignment algorithm + active-goal cap
 * (phase-1-golden-path "Color assignment").
 *
 * Phase 1 (cap = 5, no archived goals exist yet):
 *   used      = the active goals' color_index values
 *   available = [0..4] minus used
 *   pick min(available) — always exists while active count < 5
 *
 * The Phase 2 "all archived → recycle" branch is deliberately NOT here: with
 * the cap clamped to 5 the available set can never be empty at creation time,
 * so the branch would be dead code Phase 1 can't exercise. Phase 2 adds it
 * alongside archive support.
 *
 * The cap constant lives next to the palette math because they are one
 * decision: 5 distinct active colors per spec §8 — the cap is what keeps the
 * 5-slot palette from running out. Hardcoded in Phase 1 (matches the highest
 * paid-tier cap); gated to the true tier cap in Phase 3.
 *
 * Pure and client-safe: the goals-list "Add new goal" tile (Slice 8) previews
 * the next color with the same function.
 */

/** Phase 1 active-goal cap — hardcoded to the highest paid-tier cap. */
export const ACTIVE_GOAL_CAP = 5;

/** Size of the goal-attribution palette (DESIGN.md §5: indexes 0–4). */
export const GOAL_COLOR_COUNT = 5;

/**
 * Pick the color_index for a new goal: the lowest palette slot not used by
 * an active goal. Throws when every slot is taken — callers must enforce the
 * active-goal cap BEFORE assigning a color (the cap is what guarantees a free
 * slot exists).
 */
export function pickColorIndex(usedColorIndexes: readonly number[]): number {
  const used = new Set(usedColorIndexes);
  for (let i = 0; i < GOAL_COLOR_COUNT; i++) {
    if (!used.has(i)) return i;
  }
  throw new Error(
    `pickColorIndex: all ${GOAL_COLOR_COUNT} palette slots are in use — ` +
      `the active-goal cap (${ACTIVE_GOAL_CAP}) must be enforced before color assignment.`,
  );
}
