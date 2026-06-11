/**
 * intake prompt assembly tests (no DB, node env — repo posture).
 *
 * Two load-bearing invariants for prompt caching:
 *   1. The <voice> block is the FIRST content of the cached system block, so the
 *      voice can be re-toned later without invalidating downstream cached
 *      prefixes (the file's own code comment states this).
 *   2. The cached block carries ZERO per-request variability — no timestamps or
 *      random tokens — so two assemblies are byte-identical and the cache hits.
 */
import { describe, expect, it } from "vitest";
import { INTAKE_SYSTEM_TEXT, intakeSystem } from "./intake";

describe("intake system prompt", () => {
  it("places the <voice> block first in the cached system text", () => {
    expect(INTAKE_SYSTEM_TEXT.startsWith("<voice>")).toBe(true);
    // and before every other block
    const voiceIdx = INTAKE_SYSTEM_TEXT.indexOf("<voice>");
    for (const block of ["<pacing>", "<required_fields>", "<safety>", "<termination>"]) {
      expect(INTAKE_SYSTEM_TEXT.indexOf(block)).toBeGreaterThan(voiceIdx);
    }
  });

  it("emits a single cached text block with an ephemeral breakpoint", () => {
    const blocks = intakeSystem();
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe("text");
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });

  it("is stable across two assemblies (no Date/random in the cached block)", () => {
    const a = intakeSystem()[0]!;
    const b = intakeSystem()[0]!;
    expect(a.text).toBe(b.text);
    // Guard against accidental injection of volatile tokens.
    expect(a.text).not.toMatch(/\d{4}-\d{2}-\d{2}/); // ISO date
    expect(a.text).not.toMatch(/\b\d{10,}\b/); // epoch-ish timestamp
    expect(a.text.toLowerCase()).not.toContain("seed:");
    // The per-request date anchor lives in the messages (buildIntakeMessages),
    // never here — a date phrase in the cached block would re-version the
    // cache every calendar day.
    expect(a.text.toLowerCase()).not.toContain("today's date");
  });

  it("hardens the safety block: a decided flag is final for the intake", () => {
    // The route enforces duplicate-flag suppression mechanically; this line is
    // the prompt-side half of the same contract.
    expect(INTAKE_SYSTEM_TEXT).toContain(
      "that decision is final for\n  this intake",
    );
  });

  it("registers the voice-first caching note as a code comment, not prompt text", () => {
    // The note documents the invariant; it must not leak into the model prompt.
    expect(INTAKE_SYSTEM_TEXT).not.toContain("does not invalidate downstream");
  });
});
