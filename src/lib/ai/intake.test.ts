/**
 * buildIntakeMessages tests (no DB, no API, node env — repo posture).
 *
 * Pins the date-anchoring fix: every intake request carries today's date in
 * the UNCACHED messages side (a [context: …] line on the first user turn),
 * never in the cached system block (prompts/intake.test.ts pins that side).
 * Without the anchor the model assumes its training-era year and places
 * target dates in the past.
 */
import { describe, expect, it } from "vitest";

import { buildIntakeMessages } from "./intake";
import { todayIso } from "./today";

const FIRST_TURN = { role: "user" as const, content: "I want to run a race." };

describe("buildIntakeMessages — date anchoring (uncached side)", () => {
  it("prepends today's date as a context line on the first user turn", () => {
    const [first] = buildIntakeMessages({ messages: [FIRST_TURN] });
    expect(first!.content).toContain(`Today's date is ${todayIso()}.`);
    expect(first!.content).toContain("[context:");
    expect(first!.content).toContain(FIRST_TURN.content);
  });

  it("anchors relative dates to their next future occurrence", () => {
    const [first] = buildIntakeMessages({ messages: [FIRST_TURN] });
    expect(first!.content).toContain("next future occurrence");
  });

  it("includes the seed context after the date when a seed is present", () => {
    const [first] = buildIntakeMessages({
      messages: [FIRST_TURN],
      seed: "race",
    });
    const content = first!.content as string;
    expect(content).toContain(`Today's date is ${todayIso()}.`);
    expect(content).toContain('"Run a race" starting point');
    expect(content.indexOf("Today's date")).toBeLessThan(
      content.indexOf("starting point"),
    );
  });

  it("leaves later turns untouched (the anchor lives on the first turn only)", () => {
    const messages = buildIntakeMessages({
      messages: [
        FIRST_TURN,
        { role: "assistant", content: "Which distance?" },
        { role: "user", content: "A 10k in October." },
      ],
    });
    expect(messages[1]!.content).toBe("Which distance?");
    expect(messages[2]!.content).toBe("A 10k in October.");
  });

  it("returns empty messages unchanged (nothing to anchor onto)", () => {
    expect(buildIntakeMessages({ messages: [] })).toEqual([]);
  });

  it("leaves a non-string first message unchanged (continuation shape safety)", () => {
    const blockMessage = {
      role: "user" as const,
      content: [
        { type: "tool_result" as const, tool_use_id: "tu_1", content: "ok" },
      ],
    };
    expect(buildIntakeMessages({ messages: [blockMessage] })).toEqual([
      blockMessage,
    ]);
  });
});
