/**
 * goal-seeds.ts — the empty-state example tiles as DATA.
 *
 * The five example-goal tiles on the empty-state dashboard ARE the existing
 * Scene variants (DESIGN.md §4.4) rendered in pre-dawn state. Each tile pairs a
 * Scene `variant` with a whitelisted `seed` slug and the goal-shaped label.
 *
 * Note the one non-identity mapping the contract calls out: the Scene variant
 * "mountain" maps to the seed slug "climb". Every other variant's name equals
 * its seed.
 *
 * The `GOAL_SEEDS` set is the SAME whitelist Slice 3 enforces server-side
 * ({climb, language, race, book, instrument}) before any value reaches the AI
 * prompt — it lives here so the link source and the server guard share one
 * source of truth.
 */
import type { SceneVariant } from "@/components/scene-data";

/** The whitelisted seed slugs (DESIGN.md / phase-1 doc). */
export const GOAL_SEEDS = [
  "climb",
  "language",
  "race",
  "book",
  "instrument",
] as const;

export type GoalSeed = (typeof GOAL_SEEDS)[number];

/** Narrow an arbitrary string to a known seed (the shape Slice 3's guard uses). */
export function isGoalSeed(value: unknown): value is GoalSeed {
  return (
    typeof value === "string" && (GOAL_SEEDS as readonly string[]).includes(value)
  );
}

/** One example tile: a Scene variant, its seed slug, and its label. */
export interface ExampleTile {
  /** Scene variant rendered pre-dawn (DESIGN.md §4.4). */
  variant: Exclude<SceneVariant, "header">;
  /** Whitelisted seed slug passed to /goals/new?seed=… */
  seed: GoalSeed;
  /** Goal-shaped label, declarative register (no exclamation). */
  label: string;
}

/**
 * The five tiles, in the order the phase-1 doc lists them. `mountain` → `climb`
 * is the only place variant and seed differ.
 */
export const EXAMPLE_TILES: readonly ExampleTile[] = [
  { variant: "mountain", seed: "climb", label: "Climb a mountain" },
  { variant: "language", seed: "language", label: "Learn a language" },
  { variant: "race", seed: "race", label: "Run a race" },
  { variant: "book", seed: "book", label: "Write a book" },
  { variant: "instrument", seed: "instrument", label: "Learn an instrument" },
] as const;
