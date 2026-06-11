/**
 * decide-safety server-action tests (no DB, no React, node env).
 *
 * The scoped DB, Clerk auth, and the cookie jar are mocked so the action's
 * load-bearing effects are pinned headlessly (same posture as
 * confirm-intensity.test.ts):
 *   1. both buttons persist the decision onto the staged flag in
 *      goal_drafts.raw_transcript — user_overrode false ("Use the safer
 *      plan") / true ("Proceed with the original plan"), decided_at = now();
 *   2. a kind:"decision" user-role turn is appended so the model continues
 *      with the chosen direction.
 *
 * It also pins the guards: no auth, no cookie, no draft, and no pending flag
 * all fail without writing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  stagedFlags,
  type IntakeEvent,
  type StagedSafetyFlag,
} from "@/lib/ai/safety-flags";
import type { TranscriptTurn } from "@/lib/ai/transcript";

// --- mocks ---------------------------------------------------------------

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockUserId })),
}));

let mockToken: string | undefined = "draft-token-1";
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (mockToken === undefined ? undefined : { value: mockToken }),
  })),
}));

const draftUpdateSets: Array<Record<string, unknown>> = [];
let mockDraftRow: Record<string, unknown> | null;

vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn((userId: string) => ({
    userId,
    selectFrom: vi.fn(async () => (mockDraftRow ? [mockDraftRow] : [])),
    update: vi.fn(
      async (_table: unknown, opts: { set: Record<string, unknown> }) => {
        draftUpdateSets.push(opts.set);
        return [];
      },
    ),
  })),
}));

// --- import under test (after mocks) ------------------------------------

import { decideSafety } from "./decide-safety";

const UNDECIDED_FLAG: StagedSafetyFlag = {
  type: "safety_flag",
  concern: "the 20-pound target in two weeks",
  alternative: "4-6 lbs in 2 weeks plus a continuing habit",
  reasoning: "Most of it would be water weight, and the rebound is rough.",
  user_overrode: null,
  decided_at: null,
};

const TRANSCRIPT_WITH_FLAG: IntakeEvent[] = [
  { role: "user", content: "I want to lose 20 pounds in two weeks." },
  { role: "assistant", content: "Twenty pounds in two weeks isn't safe." },
  UNDECIDED_FLAG,
];

function resetState() {
  mockUserId = "user_test_1";
  mockToken = "draft-token-1";
  mockDraftRow = {
    id: "draft-uuid-1",
    session_token: "draft-token-1",
    raw_transcript: TRANSCRIPT_WITH_FLAG.map((e) => ({ ...e })),
  };
  draftUpdateSets.length = 0;
}

beforeEach(resetState);

function writtenLog(): IntakeEvent[] {
  expect(draftUpdateSets).toHaveLength(1);
  return draftUpdateSets[0]!.raw_transcript as IntakeEvent[];
}

describe('decideSafety — "Use the safer plan"', () => {
  it("sets user_overrode=false and decided_at=now on the staged flag", async () => {
    const before = Date.now();
    const result = await decideSafety(false);
    expect(result).toEqual({ ok: true });

    const flags = stagedFlags(writtenLog());
    expect(flags).toHaveLength(1);
    expect(flags[0]!.user_overrode).toBe(false);
    const decidedAt = Date.parse(flags[0]!.decided_at!);
    expect(decidedAt).toBeGreaterThanOrEqual(before);
    expect(decidedAt).toBeLessThanOrEqual(Date.now());
  });

  it("appends a kind:decision user turn naming the safer alternative", async () => {
    await decideSafety(false);
    const log = writtenLog();
    const last = log[log.length - 1] as TranscriptTurn;
    expect(last.role).toBe("user");
    expect(last.kind).toBe("decision");
    expect(last.content).toContain(UNDECIDED_FLAG.alternative);
  });
});

describe('decideSafety — "Proceed with the original plan"', () => {
  it("sets user_overrode=true and decided_at=now on the staged flag", async () => {
    const result = await decideSafety(true);
    expect(result).toEqual({ ok: true });

    const flags = stagedFlags(writtenLog());
    expect(flags[0]!.user_overrode).toBe(true);
    expect(typeof flags[0]!.decided_at).toBe("string");
  });

  it("appends a kind:decision user turn keeping the original direction", async () => {
    await decideSafety(true);
    const log = writtenLog();
    const last = log[log.length - 1] as TranscriptTurn;
    expect(last.kind).toBe("decision");
    expect(last.content).toContain("original plan");
  });

  it("preserves the conversational turns around the flag", async () => {
    await decideSafety(true);
    const log = writtenLog();
    expect(log[0]).toEqual(TRANSCRIPT_WITH_FLAG[0]);
    expect(log[1]).toEqual(TRANSCRIPT_WITH_FLAG[1]);
  });
});

describe("decideSafety — guards (no silent write)", () => {
  it("rejects when not signed in", async () => {
    mockUserId = null;
    const result = await decideSafety(false);
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });

  it("rejects when there is no draft cookie", async () => {
    mockToken = undefined;
    const result = await decideSafety(false);
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });

  it("rejects when the draft is not found (forged/foreign token)", async () => {
    mockDraftRow = null;
    const result = await decideSafety(false);
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });

  it("rejects a non-boolean payload", async () => {
    const result = await decideSafety("yes" as never);
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });

  it("rejects when no flag is pending (stale/duplicate submission)", async () => {
    mockDraftRow = {
      id: "draft-uuid-1",
      session_token: "draft-token-1",
      raw_transcript: [
        { role: "user", content: "hello" },
        {
          ...UNDECIDED_FLAG,
          user_overrode: true,
          decided_at: "2026-06-10T12:00:00.000Z",
        },
      ],
    };
    const result = await decideSafety(false);
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });
});
