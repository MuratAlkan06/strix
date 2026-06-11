/**
 * Color-assignment tests (phase-1-golden-path "Color assignment" + the
 * automated-verification bullet: distinct colors for goals 1–5; the Phase 1
 * algorithm never reaches an "all archived" branch because cap=5 — there IS
 * no such branch here, by design).
 */
import { describe, expect, it } from "vitest";

import {
  ACTIVE_GOAL_CAP,
  GOAL_COLOR_COUNT,
  pickColorIndex,
} from "./goal-colors";

describe("pickColorIndex — min available slot", () => {
  it("picks 0 for the first goal", () => {
    expect(pickColorIndex([])).toBe(0);
  });

  it("picks the minimum available index", () => {
    expect(pickColorIndex([0])).toBe(1);
    expect(pickColorIndex([0, 1, 2])).toBe(3);
  });

  it("fills gaps before higher slots: used {0,2} → 1", () => {
    expect(pickColorIndex([0, 2])).toBe(1);
  });

  it("fills the low gap even when high slots are used: used {1,2,3,4} → 0", () => {
    expect(pickColorIndex([1, 2, 3, 4])).toBe(0);
  });

  it("assigns distinct colors across goals 1–5 created sequentially", () => {
    const used: number[] = [];
    for (let i = 0; i < ACTIVE_GOAL_CAP; i++) {
      const next = pickColorIndex(used);
      expect(used).not.toContain(next);
      used.push(next);
    }
    expect([...used].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(new Set(used).size).toBe(GOAL_COLOR_COUNT);
  });

  it("throws when every slot is used (the cap must gate first)", () => {
    expect(() => pickColorIndex([0, 1, 2, 3, 4])).toThrow(/cap/i);
  });

  it("ignores duplicate used values (collision-tolerant)", () => {
    expect(pickColorIndex([0, 0, 1])).toBe(2);
  });
});

describe("Phase 1 constants", () => {
  it("cap and palette size are both 5 (the cap keeps the palette coherent)", () => {
    expect(ACTIVE_GOAL_CAP).toBe(5);
    expect(GOAL_COLOR_COUNT).toBe(5);
  });
});
