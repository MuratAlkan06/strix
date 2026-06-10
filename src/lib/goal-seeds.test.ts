/**
 * goal-seeds unit tests.
 *
 * The empty-state tiles and the (Slice 3) server-side seed whitelist share one
 * source of truth here, so the load-bearing invariants are tested at the data
 * level (same node-env, no-DB posture as scoped.test.ts / the inngest sweep
 * test): the five tiles, their seed slugs, the one non-identity mapping
 * (mountain → climb), and the `isGoalSeed` guard's accept/reject behaviour.
 */
import { describe, expect, it } from "vitest";
import {
  EXAMPLE_TILES,
  GOAL_SEEDS,
  isGoalSeed,
  type GoalSeed,
} from "./goal-seeds";

describe("GOAL_SEEDS whitelist", () => {
  it("is exactly {climb, language, race, book, instrument}", () => {
    expect([...GOAL_SEEDS]).toEqual([
      "climb",
      "language",
      "race",
      "book",
      "instrument",
    ]);
  });

  it("has no duplicate slugs", () => {
    expect(new Set(GOAL_SEEDS).size).toBe(GOAL_SEEDS.length);
  });
});

describe("EXAMPLE_TILES", () => {
  it("has exactly five tiles", () => {
    expect(EXAMPLE_TILES).toHaveLength(5);
  });

  it("maps Scene variant 'mountain' to seed 'climb' (the one non-identity case)", () => {
    const mountain = EXAMPLE_TILES.find((t) => t.variant === "mountain");
    expect(mountain?.seed).toBe("climb");
  });

  it("uses identity variant↔seed for every tile except mountain", () => {
    for (const tile of EXAMPLE_TILES) {
      if (tile.variant === "mountain") continue;
      expect(tile.seed).toBe(tile.variant);
    }
  });

  it("renders the goal-shaped labels from the phase doc, in order", () => {
    expect(EXAMPLE_TILES.map((t) => t.label)).toEqual([
      "Climb a mountain",
      "Learn a language",
      "Run a race",
      "Write a book",
      "Learn an instrument",
    ]);
  });

  it("every tile seed is a whitelisted seed", () => {
    for (const tile of EXAMPLE_TILES) {
      expect(isGoalSeed(tile.seed)).toBe(true);
    }
  });

  it("covers every whitelisted seed exactly once", () => {
    expect(EXAMPLE_TILES.map((t) => t.seed).sort()).toEqual(
      [...GOAL_SEEDS].sort(),
    );
  });

  it("copy register: no exclamation marks in labels", () => {
    for (const tile of EXAMPLE_TILES) {
      expect(tile.label).not.toContain("!");
    }
  });
});

describe("isGoalSeed", () => {
  it("accepts each known seed", () => {
    for (const seed of GOAL_SEEDS) {
      expect(isGoalSeed(seed)).toBe(true);
    }
  });

  it("rejects an arbitrary string (the prompt-injection case Slice 3 guards)", () => {
    expect(isGoalSeed("evil_payload")).toBe(false);
    expect(isGoalSeed("mountain")).toBe(false); // the variant name is NOT a seed
    expect(isGoalSeed("")).toBe(false);
  });

  it("rejects non-string values", () => {
    expect(isGoalSeed(undefined)).toBe(false);
    expect(isGoalSeed(null)).toBe(false);
    expect(isGoalSeed(42)).toBe(false);
    expect(isGoalSeed(["climb"])).toBe(false);
  });

  it("narrows the type for downstream use", () => {
    const value: string = "race";
    if (isGoalSeed(value)) {
      const seed: GoalSeed = value; // compiles only if narrowed
      expect(seed).toBe("race");
    }
  });
});
