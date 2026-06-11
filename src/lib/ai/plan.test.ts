/**
 * buildPlanMessages tests (no DB, no API, node env — repo posture).
 *
 * Pins the date-anchoring fix on the plan-generation side: the single user
 * message carries today's date alongside the intake-summary JSON — the
 * UNCACHED side of the call (prompts/plan.test.ts pins that the cached block
 * stays date-free). Without the anchor, milestones land in the model's
 * training-era past and everything renders overdue.
 */
import { describe, expect, it } from "vitest";

import { buildPlanMessages } from "./plan";
import { todayIso } from "./today";

const SUMMARY = {
  one_sentence_goal: "Finish a 10k race at the end of October.",
  confirmed_intensity: "comfortable",
};

describe("buildPlanMessages — date anchoring (uncached side)", () => {
  it("is a single user message carrying today's date", () => {
    const messages = buildPlanMessages({ intakeSummary: SUMMARY });
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(messages[0]!.content).toContain(`Today's date: ${todayIso()}.`);
  });

  it("instructs future-dating relative to today", () => {
    const [msg] = buildPlanMessages({ intakeSummary: SUMMARY });
    expect(msg!.content).toContain("must fall after this date");
  });

  it("keeps the intake summary JSON and the confirmed intensity callout", () => {
    const [msg] = buildPlanMessages({ intakeSummary: SUMMARY });
    const content = msg!.content as string;
    expect(content).toContain("Intake summary (JSON):");
    expect(content).toContain('"one_sentence_goal"');
    expect(content).toContain("Confirmed intensity: comfortable");
    expect(content).toContain("Generate the plan.");
  });
});
