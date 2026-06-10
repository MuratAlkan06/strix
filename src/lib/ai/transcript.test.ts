/**
 * transcript tests (no DB, node env).
 *
 * The transcript helpers are pure, so the append behaviour and the hard turn
 * cap (10 user turns) are tested at the data level — the same posture as the
 * goal-seeds and inngest-sweep tests.
 */
import { describe, expect, it } from "vitest";
import {
  appendTurn,
  asTranscript,
  countUserTurns,
  isAtUserTurnCap,
  MAX_USER_TURNS,
  toMessageParams,
  type TranscriptTurn,
} from "./transcript";

const userTurns = (n: number): TranscriptTurn[] =>
  Array.from({ length: n }, (_, i) => ({
    role: "user" as const,
    content: `turn ${i}`,
  }));

describe("asTranscript", () => {
  it("returns [] for non-array input", () => {
    expect(asTranscript(null)).toEqual([]);
    expect(asTranscript(undefined)).toEqual([]);
    expect(asTranscript("nope")).toEqual([]);
    expect(asTranscript({})).toEqual([]);
  });

  it("keeps well-formed turns and drops malformed entries", () => {
    const raw = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "system", content: "nope" }, // bad role
      { role: "user", content: 42 }, // bad content
      "garbage",
      null,
    ];
    expect(asTranscript(raw)).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("appendTurn", () => {
  it("appends without mutating the input array", () => {
    const base: TranscriptTurn[] = [{ role: "user", content: "a" }];
    const next = appendTurn(base, { role: "assistant", content: "b" });
    expect(base).toHaveLength(1);
    expect(next).toHaveLength(2);
    expect(next[1]).toEqual({ role: "assistant", content: "b" });
  });
});

describe("countUserTurns", () => {
  it("counts only user turns", () => {
    const t: TranscriptTurn[] = [
      { role: "user", content: "1" },
      { role: "assistant", content: "x" },
      { role: "user", content: "2" },
    ];
    expect(countUserTurns(t)).toBe(2);
  });
});

describe("isAtUserTurnCap (hard cap 10)", () => {
  it("exposes the cap as 10", () => {
    expect(MAX_USER_TURNS).toBe(10);
  });

  it("is false below the cap", () => {
    expect(isAtUserTurnCap(userTurns(9))).toBe(false);
  });

  it("is true at the cap (prevents an 11th turn)", () => {
    expect(isAtUserTurnCap(userTurns(10))).toBe(true);
    expect(isAtUserTurnCap(userTurns(11))).toBe(true);
  });

  it("ignores assistant turns when counting toward the cap", () => {
    const t: TranscriptTurn[] = [
      ...userTurns(9),
      { role: "assistant", content: "x" },
      { role: "assistant", content: "y" },
    ];
    expect(isAtUserTurnCap(t)).toBe(false);
  });
});

describe("toMessageParams", () => {
  it("maps to the API { role, content } shape", () => {
    const t: TranscriptTurn[] = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ];
    expect(toMessageParams(t)).toEqual([
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ]);
  });
});
