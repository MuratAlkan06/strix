/**
 * safety-flags tests (no DB, node env — repo posture).
 *
 * The safety-override helpers are pure, so the load-bearing rules are pinned
 * at the data level: the event-log round trip (turns + flags coexist in
 * raw_transcript), the composer-hold derivation (an undecided flag holds the
 * composer), the decision write (user_overrode/decided_at for both buttons),
 * the decision turn conveyed back to the model, and the merge into the final
 * summary's safety_flags at submit_intake (decided + undecided + model-only
 * cases).
 */
import { describe, expect, it } from "vitest";
import {
  appendFlag,
  asEventLog,
  decideFlag,
  decisionTurn,
  isStagedSafetyFlag,
  mergeSafetyFlags,
  pendingFlag,
  stagedFlags,
  toFlagPayload,
  type IntakeEvent,
  type StagedSafetyFlag,
} from "./safety-flags";
import { asTranscript } from "./transcript";

const FLAG_INPUT = {
  concern: "the 20-pound target in two weeks",
  alternative: "4-6 lbs in 2 weeks plus a continuing habit",
  reasoning: "Most of it would be water weight, and the rebound is rough.",
};

const baseLog = (): IntakeEvent[] => [
  { role: "user", content: "I want to lose 20 pounds in two weeks." },
  { role: "assistant", content: "Twenty pounds in two weeks isn't safe." },
];

describe("asEventLog", () => {
  it("returns [] for non-array input", () => {
    expect(asEventLog(null)).toEqual([]);
    expect(asEventLog(undefined)).toEqual([]);
    expect(asEventLog("nope")).toEqual([]);
    expect(asEventLog({})).toEqual([]);
  });

  it("keeps turns AND staged flags, drops malformed entries", () => {
    const flag: StagedSafetyFlag = {
      type: "safety_flag",
      ...FLAG_INPUT,
      user_overrode: null,
      decided_at: null,
    };
    const raw = [
      { role: "user", content: "hi" },
      flag,
      { type: "safety_flag", concern: "x" }, // malformed flag
      { role: "system", content: "nope" }, // bad role
      "garbage",
      null,
    ];
    expect(asEventLog(raw)).toEqual([{ role: "user", content: "hi" }, flag]);
  });

  it("round-trips with asTranscript: flags are invisible to the model view", () => {
    const log = appendFlag(baseLog(), FLAG_INPUT);
    expect(asTranscript(log)).toEqual(baseLog());
  });
});

describe("appendFlag / stagedFlags", () => {
  it("appends an undecided flag without mutating the input", () => {
    const log = baseLog();
    const next = appendFlag(log, FLAG_INPUT);
    expect(log).toHaveLength(2);
    expect(next).toHaveLength(3);
    expect(stagedFlags(next)).toEqual([
      {
        type: "safety_flag",
        ...FLAG_INPUT,
        user_overrode: null,
        decided_at: null,
      },
    ]);
  });

  it("isStagedSafetyFlag rejects near-misses", () => {
    expect(isStagedSafetyFlag({ ...FLAG_INPUT, type: "safety_flag" })).toBe(
      false, // missing user_overrode / decided_at
    );
    expect(isStagedSafetyFlag({ role: "user", content: "x" })).toBe(false);
  });
});

describe("pendingFlag (the composer-hold derivation)", () => {
  it("derives no hold from a flag-free log", () => {
    expect(pendingFlag(baseLog())).toBeNull();
  });

  it("derives a hold from an undecided flag", () => {
    const log = appendFlag(baseLog(), FLAG_INPUT);
    expect(pendingFlag(log)).toMatchObject({
      ...FLAG_INPUT,
      user_overrode: null,
      decided_at: null,
    });
  });

  it("releases the hold once the flag is decided", () => {
    const log = appendFlag(baseLog(), FLAG_INPUT);
    const decided = decideFlag(log, true, "2026-06-10T12:00:00.000Z");
    expect(decided).not.toBeNull();
    expect(pendingFlag(decided!.log)).toBeNull();
  });
});

describe("decideFlag (both buttons)", () => {
  const NOW = "2026-06-10T12:00:00.000Z";

  it('"Use the safer plan" → user_overrode=false, decided_at=now', () => {
    const log = appendFlag(baseLog(), FLAG_INPUT);
    const result = decideFlag(log, false, NOW);
    expect(result).not.toBeNull();
    expect(stagedFlags(result!.log)).toEqual([
      { type: "safety_flag", ...FLAG_INPUT, user_overrode: false, decided_at: NOW },
    ]);
    expect(result!.flag.user_overrode).toBe(false);
    expect(result!.flag.decided_at).toBe(NOW);
  });

  it('"Proceed with the original plan" → user_overrode=true, decided_at=now', () => {
    const log = appendFlag(baseLog(), FLAG_INPUT);
    const result = decideFlag(log, true, NOW);
    expect(stagedFlags(result!.log)[0]).toMatchObject({
      user_overrode: true,
      decided_at: NOW,
    });
  });

  it("returns null when nothing is pending (stale submission)", () => {
    expect(decideFlag(baseLog(), true, NOW)).toBeNull();
    const decidedAlready = decideFlag(
      appendFlag(baseLog(), FLAG_INPUT),
      false,
      NOW,
    )!.log;
    expect(decideFlag(decidedAlready, true, NOW)).toBeNull();
  });

  it("decides the LAST undecided flag and does not mutate the input log", () => {
    const first = decideFlag(appendFlag(baseLog(), FLAG_INPUT), false, NOW)!.log;
    const second = appendFlag(first, {
      concern: "the six-week runway",
      alternative: "target a half first",
      reasoning: "The mileage ramp is too steep.",
    });
    const result = decideFlag(second, true, NOW)!;
    expect(result.flag.concern).toBe("the six-week runway");
    // The earlier decided flag is untouched.
    expect(stagedFlags(result.log)[0]!.user_overrode).toBe(false);
    // No mutation of the input.
    expect(stagedFlags(second)[1]!.user_overrode).toBeNull();
  });
});

describe("decisionTurn (the decision conveyed back to the model)", () => {
  it("is a user-role kind:decision turn excluded from the cap", () => {
    const turn = decisionTurn(FLAG_INPUT, false);
    expect(turn.role).toBe("user");
    expect(turn.kind).toBe("decision");
  });

  it("names the safer alternative when the user takes the safer plan", () => {
    const turn = decisionTurn(FLAG_INPUT, false);
    expect(turn.content.startsWith("Decision:")).toBe(true);
    expect(turn.content).toContain(FLAG_INPUT.alternative);
  });

  it("names the original direction when the user overrides", () => {
    const turn = decisionTurn(FLAG_INPUT, true);
    expect(turn.content.startsWith("Decision:")).toBe(true);
    expect(turn.content).toContain("original plan");
    expect(turn.content).toContain(FLAG_INPUT.concern);
  });
});

describe("mergeSafetyFlags (at submit_intake completion)", () => {
  const decidedStaged: StagedSafetyFlag = {
    type: "safety_flag",
    ...FLAG_INPUT,
    user_overrode: true,
    decided_at: "2026-06-10T12:00:00.000Z",
  };

  it("a model-listed flag matching a staged decision takes the decided values", () => {
    const merged = mergeSafetyFlags(
      [decidedStaged],
      [
        {
          concern: "The 20-pound target in two weeks", // case-insensitive match
          alternative: "4-6 lbs in 2 weeks plus a continuing habit",
          user_overrode: null,
          decided_at: null,
        },
      ],
    );
    expect(merged).toEqual([
      {
        concern: FLAG_INPUT.concern,
        alternative: FLAG_INPUT.alternative,
        user_overrode: true,
        decided_at: "2026-06-10T12:00:00.000Z",
      },
    ]);
  });

  it("an undecided staged flag keeps user_overrode null (completion-without-decision edge)", () => {
    const undecided: StagedSafetyFlag = {
      ...decidedStaged,
      user_overrode: null,
      decided_at: null,
    };
    const merged = mergeSafetyFlags([undecided], []);
    expect(merged).toEqual([
      {
        concern: FLAG_INPUT.concern,
        alternative: FLAG_INPUT.alternative,
        user_overrode: null,
        decided_at: null,
      },
    ]);
  });

  it("model-only flags are appended with decisions forced to null (the model never decides)", () => {
    const merged = mergeSafetyFlags(
      [decidedStaged],
      [
        {
          concern: "a separate concern the model raised only at termination",
          alternative: "its alternative",
          user_overrode: true, // a fabricated decision must not survive
          decided_at: "2026-06-10T13:00:00.000Z",
        },
      ],
    );
    expect(merged).toHaveLength(2);
    expect(merged[0]!.user_overrode).toBe(true); // staged decision first
    expect(merged[1]).toEqual({
      concern: "a separate concern the model raised only at termination",
      alternative: "its alternative",
      user_overrode: null,
      decided_at: null,
    });
  });

  it("verification target: override decision lands at safety_flags[0].user_overrode === true", () => {
    const merged = mergeSafetyFlags(
      [decidedStaged],
      [
        {
          concern: FLAG_INPUT.concern,
          alternative: FLAG_INPUT.alternative,
          user_overrode: null,
          decided_at: null,
        },
      ],
    );
    expect(merged[0]!.user_overrode).toBe(true);
  });
});

describe("toFlagPayload", () => {
  it("carries exactly what the card needs", () => {
    const staged = stagedFlags(appendFlag([], FLAG_INPUT))[0]!;
    expect(toFlagPayload(staged)).toEqual(FLAG_INPUT);
  });
});
