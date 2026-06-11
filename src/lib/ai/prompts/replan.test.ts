/**
 * replan prompt assembly tests (no DB, node env — repo posture).
 *
 * The same load-bearing caching invariants plan.test.ts pins:
 *   1. The <voice> block is the FIRST content of the cached system block, so
 *      the voice can be re-toned later without invalidating downstream cached
 *      prefixes.
 *   2. The cached block carries ZERO per-request variability — no timestamps
 *      or random tokens — so two assemblies are byte-identical and the cache
 *      hits. (The goal, adherence, trigger payload, and resolved intensity
 *      travel in the user message, never here.)
 *
 * Plus the slice-specific content invariants: the diff-format block describes
 *  the exact ReplanDiffSchema sections, the intensity rule states the
 *  override → intake → user chain verbatim, and the calibration block reads
 *  adherence + feeling.
 */
import { describe, expect, it } from "vitest";
import { REPLAN_SYSTEM_TEXT, replanSystem } from "./replan";

describe("replan system prompt", () => {
  it("places the <voice> block first in the cached system text", () => {
    expect(REPLAN_SYSTEM_TEXT.startsWith("<voice>")).toBe(true);
    const voiceIdx = REPLAN_SYSTEM_TEXT.indexOf("<voice>");
    for (const block of [
      "<diff_format>",
      "<intensity>",
      "<calibration>",
      "<output>",
    ]) {
      expect(REPLAN_SYSTEM_TEXT.indexOf(block)).toBeGreaterThan(voiceIdx);
    }
  });

  it("emits a single cached text block with an ephemeral breakpoint", () => {
    const blocks = replanSystem();
    expect(blocks).toHaveLength(1);
    const block = blocks[0]!;
    expect(block.type).toBe("text");
    expect(block.cache_control).toEqual({ type: "ephemeral" });
  });

  it("is stable across two assemblies (no Date/random in the cached block)", () => {
    const a = replanSystem()[0]!;
    const b = replanSystem()[0]!;
    expect(a.text).toBe(b.text);
    // Guard against accidental injection of volatile tokens.
    expect(a.text).not.toMatch(/\d{4}-\d{2}-\d{2}(?!["')])/); // a literal date
    expect(a.text).not.toMatch(/\b\d{10,}\b/); // epoch-ish timestamp
    // The per-request date anchor lives in the user message
    // (buildReplanMessages), never here — a date phrase in the cached block
    // would re-version the cache every calendar day.
    expect(a.text.toLowerCase()).not.toContain("today's date");
  });

  it("describes the exact ReplanDiffSchema sections as a diff, never a replacement", () => {
    for (const section of ["recurring_tasks", "milestones", "equipment"]) {
      for (const op of ["add", "modify", "remove"]) {
        expect(REPLAN_SYSTEM_TEXT).toContain(`${section}.${op}`);
      }
    }
    expect(REPLAN_SYSTEM_TEXT).toContain("never a replacement");
    // weekday convention matches the schema (0 = Sunday).
    expect(REPLAN_SYSTEM_TEXT).toContain("0 = Sunday");
  });

  it("states the intensity fallback chain verbatim (spec §5 flags #2/#6)", () => {
    const intensity = REPLAN_SYSTEM_TEXT.slice(
      REPLAN_SYSTEM_TEXT.indexOf("<intensity>"),
      REPLAN_SYSTEM_TEXT.indexOf("</intensity>"),
    );
    expect(intensity).toContain("goals.intensity_override");
    expect(intensity).toContain("intake_summaries.confirmed_intensity");
    expect(intensity).toContain("users.intensity_preference");
    // Chain order: override before intake before user preference.
    expect(intensity.indexOf("goals.intensity_override")).toBeLessThan(
      intensity.indexOf("intake_summaries.confirmed_intensity"),
    );
    expect(
      intensity.indexOf("intake_summaries.confirmed_intensity"),
    ).toBeLessThan(intensity.indexOf("users.intensity_preference"));
  });

  it("calibrates on adherence and the check-in feeling", () => {
    const calibration = REPLAN_SYSTEM_TEXT.slice(
      REPLAN_SYSTEM_TEXT.indexOf("<calibration>"),
      REPLAN_SYSTEM_TEXT.indexOf("</calibration>"),
    );
    expect(calibration.toLowerCase()).toContain("adherence");
    for (const feeling of ["too_hard", "too_easy", "right"]) {
      expect(calibration).toContain(feeling);
    }
  });

  it("clears the cache floor by a comfortable char margin (live count is integration-gated)", () => {
    // ~4 chars/token: 6000+ chars keeps the block safely above Anthropic's
    // 1024-token floor even with tokenizer drift. The env-gated
    // replan-caching integration test pins the real count.
    expect(REPLAN_SYSTEM_TEXT.length).toBeGreaterThan(6000);
  });
});
