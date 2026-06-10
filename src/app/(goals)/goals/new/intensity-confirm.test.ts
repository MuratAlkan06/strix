/**
 * intensity-confirm logic tests (no DB, no React, node env).
 *
 * Covers the three rules the card and page depend on:
 *   - pre-selection: the card's initial selection is the AI's suggestion;
 *   - confirm payload: it reflects the user's FINAL pick, including a changed
 *     one (suggested = comfortable, user picks challenging);
 *   - resume-state derivation: a draft routes to chat / confirm / interim by
 *     shape (the page's server-derived, resumable surface routing).
 */
import { describe, expect, it } from "vitest";

import {
  asIntakeSummaryDraft,
  buildConfirmPayload,
  initialSelection,
  intensityDescriptions,
  intensityLabel,
  isIntensity,
  resolveSurface,
  type IntakeSummaryDraft,
} from "./intensity-confirm";

describe("initialSelection (pre-selection rule)", () => {
  it("pre-selects the AI's suggestion", () => {
    expect(initialSelection("comfortable")).toBe("comfortable");
    expect(initialSelection("challenging")).toBe("challenging");
    expect(initialSelection("brutal")).toBe("brutal");
  });
});

describe("buildConfirmPayload (final pick wins)", () => {
  it("keeps both the suggestion on record and an unchanged pick", () => {
    expect(buildConfirmPayload("comfortable", "comfortable")).toEqual({
      suggested_intensity: "comfortable",
      confirmed_intensity: "comfortable",
    });
  });

  it("reflects a changed pick distinct from the suggestion", () => {
    // suggested = comfortable, user picks challenging (verification step 4).
    expect(buildConfirmPayload("comfortable", "challenging")).toEqual({
      suggested_intensity: "comfortable",
      confirmed_intensity: "challenging",
    });
  });
});

describe("intensityLabel / intensityDescriptions (in register)", () => {
  it("labels each level", () => {
    expect(intensityLabel("comfortable")).toBe("Comfortable");
    expect(intensityLabel("challenging")).toBe("Challenging");
    expect(intensityLabel("brutal")).toBe("Brutal");
  });

  it("anchors descriptions to the goal context, no exclamation", () => {
    const d = intensityDescriptions("Finish a half marathon in October");
    for (const level of ["comfortable", "challenging", "brutal"] as const) {
      expect(d[level]).toContain("Finish a half marathon in October");
      expect(d[level]).not.toContain("!");
    }
  });

  it("falls back to a neutral noun when context is blank", () => {
    const d = intensityDescriptions("   ");
    expect(d.comfortable).toContain("this goal");
  });
});

describe("isIntensity guard", () => {
  it("accepts the three enum members", () => {
    expect(isIntensity("comfortable")).toBe(true);
    expect(isIntensity("challenging")).toBe(true);
    expect(isIntensity("brutal")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isIntensity("extreme")).toBe(false);
    expect(isIntensity("")).toBe(false);
    expect(isIntensity(null)).toBe(false);
    expect(isIntensity(3)).toBe(false);
    expect(isIntensity(undefined)).toBe(false);
  });
});

describe("asIntakeSummaryDraft", () => {
  const complete = {
    one_sentence_goal: "Finish a half marathon in October",
    starting_point: "short weekly runs",
    activity_type: "running",
    suggested_intensity: "comfortable",
    suggested_intensity_reasoning: "Realistic for the timeline.",
    safety_flags: [],
  };

  it("narrows a completed-intake draft to the card subset", () => {
    expect(asIntakeSummaryDraft(complete)).toEqual({
      one_sentence_goal: "Finish a half marathon in October",
      suggested_intensity: "comfortable",
      suggested_intensity_reasoning: "Realistic for the timeline.",
      confirmed_intensity: undefined,
    });
  });

  it("surfaces a staged confirmed_intensity when present", () => {
    const parsed = asIntakeSummaryDraft({
      ...complete,
      confirmed_intensity: "challenging",
    });
    expect(parsed?.confirmed_intensity).toBe("challenging");
  });

  it("returns null when the suggestion or reasoning is missing", () => {
    expect(asIntakeSummaryDraft(null)).toBeNull();
    expect(asIntakeSummaryDraft({})).toBeNull();
    expect(
      asIntakeSummaryDraft({ suggested_intensity: "comfortable" }),
    ).toBeNull();
    expect(
      asIntakeSummaryDraft({
        suggested_intensity: "nope",
        suggested_intensity_reasoning: "x",
      }),
    ).toBeNull();
  });
});

describe("resolveSurface (resumable a/b/c routing)", () => {
  const baseSummary: IntakeSummaryDraft = {
    one_sentence_goal: "Finish a half marathon in October",
    suggested_intensity: "comfortable",
    suggested_intensity_reasoning: "Realistic for the timeline.",
  };

  it("(a) routes to chat when intake is still in progress", () => {
    expect(resolveSurface({ summary: null })).toBe("chat");
  });

  it("(b) routes to the confirm card when intake is complete but unconfirmed", () => {
    expect(resolveSurface({ summary: baseSummary })).toBe("confirm");
  });

  it("(c) routes to interim once an intensity is confirmed", () => {
    expect(
      resolveSurface({
        summary: { ...baseSummary, confirmed_intensity: "challenging" },
      }),
    ).toBe("interim");
  });
});
