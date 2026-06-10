/**
 * seed-guard tests (no DB, node env).
 *
 * The /goals/new ?seed= decision: each whitelisted seed is accepted; an absent
 * or empty seed opens neutrally; a non-empty, non-whitelisted seed
 * ("evil_payload", "mountain") takes the 400 path (verification step 2).
 */
import { describe, expect, it } from "vitest";
import { decideSeed } from "./seed-guard";
import { GOAL_SEEDS } from "@/lib/goal-seeds";

describe("decideSeed", () => {
  it("accepts every whitelisted seed", () => {
    for (const seed of GOAL_SEEDS) {
      expect(decideSeed(seed)).toEqual({ ok: true, seed });
    }
  });

  it("accepts an absent seed (opens neutrally)", () => {
    expect(decideSeed(undefined)).toEqual({ ok: true, seed: null });
  });

  it("accepts an empty seed as neutral (not a 400)", () => {
    expect(decideSeed("")).toEqual({ ok: true, seed: null });
  });

  it("rejects evil_payload with the 400 path", () => {
    expect(decideSeed("evil_payload")).toEqual({ ok: false });
  });

  it("rejects 'mountain' — the Scene variant name is NOT a seed slug", () => {
    expect(decideSeed("mountain")).toEqual({ ok: false });
  });

  it("uses the first value when the param repeats, and judges it", () => {
    expect(decideSeed(["race", "evil"])).toEqual({ ok: true, seed: "race" });
    expect(decideSeed(["evil", "race"])).toEqual({ ok: false });
  });
});
