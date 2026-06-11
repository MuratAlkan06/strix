/**
 * confirm-intensity server-action tests (no DB, no React, node env).
 *
 * The scoped DB, Clerk auth, and the cookie jar are mocked so the action's two
 * load-bearing effects are pinned headlessly:
 *   1. it stages suggested_intensity + confirmed_intensity (the user's pick)
 *      back into goal_drafts.intake_summary_draft, preserving the other intake
 *      fields and NOT creating an intake_summaries row;
 *   2. it updates users.intensity_preference to the user's pick via
 *      updateSelf (the chain's final fallback + Settings default).
 *
 * It also pins the guards: no auth, no cookie, no draft, and a draft whose
 * intake isn't finished all fail without writing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks ---------------------------------------------------------------

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockUserId })),
}));

let mockToken: string | undefined = "draft-token-1";
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () =>
      mockToken === undefined ? undefined : { value: mockToken },
  })),
}));

// Captured scoped-DB interactions.
const draftUpdateSets: Array<Record<string, unknown>> = [];
const updateSelfCalls: Array<Record<string, unknown>> = [];
let mockDraftRow: Record<string, unknown> | null;

vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn((userId: string) => ({
    userId,
    selectFrom: vi.fn(async () => (mockDraftRow ? [mockDraftRow] : [])),
    update: vi.fn(async (_table: unknown, opts: { set: Record<string, unknown> }) => {
      draftUpdateSets.push(opts.set);
      return [];
    }),
    updateSelf: vi.fn(async (set: Record<string, unknown>) => {
      updateSelfCalls.push(set);
      return [];
    }),
  })),
}));

// --- import under test (after mocks) ------------------------------------

import { confirmIntensity } from "./confirm-intensity";

const COMPLETE_DRAFT_SUMMARY = {
  one_sentence_goal: "Finish a half marathon in October",
  starting_point: "short weekly runs",
  activity_type: "running",
  suggested_intensity: "comfortable",
  suggested_intensity_reasoning: "Realistic for the timeline.",
  safety_flags: [],
};

function resetState() {
  mockUserId = "user_test_1";
  mockToken = "draft-token-1";
  mockDraftRow = {
    id: "draft-uuid-1",
    session_token: "draft-token-1",
    intake_summary_draft: { ...COMPLETE_DRAFT_SUMMARY },
  };
  draftUpdateSets.length = 0;
  updateSelfCalls.length = 0;
}

beforeEach(resetState);

describe("confirmIntensity — happy path (changed pick)", () => {
  it("stages suggested + the user's changed pick into the draft, preserving other fields", async () => {
    // suggested = comfortable, user picks challenging.
    const result = await confirmIntensity("challenging");
    expect(result).toEqual({ ok: true });

    expect(draftUpdateSets).toHaveLength(1);
    const staged = draftUpdateSets[0]!.intake_summary_draft as Record<
      string,
      unknown
    >;
    expect(staged.suggested_intensity).toBe("comfortable");
    expect(staged.confirmed_intensity).toBe("challenging");
    // Other intake fields are preserved, not dropped.
    expect(staged.one_sentence_goal).toBe("Finish a half marathon in October");
    expect(staged.activity_type).toBe("running");
  });

  it("updates users.intensity_preference to the user's pick (not the suggestion)", async () => {
    await confirmIntensity("challenging");
    expect(updateSelfCalls).toEqual([{ intensity_preference: "challenging" }]);
  });

  it("does not create an intake_summaries row (staging only)", async () => {
    await confirmIntensity("brutal");
    // Only the draft jsonb is written; updateSelf is the only other write.
    expect(draftUpdateSets).toHaveLength(1);
    expect(draftUpdateSets[0]).toHaveProperty("intake_summary_draft");
    expect(draftUpdateSets[0]).not.toHaveProperty("goal_id");
  });
});

describe("confirmIntensity — pre-selected (unchanged) pick", () => {
  it("persists the suggestion as the confirmed pick when unchanged", async () => {
    await confirmIntensity("comfortable");
    const staged = draftUpdateSets[0]!.intake_summary_draft as Record<
      string,
      unknown
    >;
    expect(staged.suggested_intensity).toBe("comfortable");
    expect(staged.confirmed_intensity).toBe("comfortable");
    expect(updateSelfCalls).toEqual([{ intensity_preference: "comfortable" }]);
  });
});

describe("confirmIntensity — guards (no silent write)", () => {
  it("rejects an invalid intensity value", async () => {
    const result = await confirmIntensity("extreme" as never);
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
    expect(updateSelfCalls).toHaveLength(0);
  });

  it("rejects when not signed in", async () => {
    mockUserId = null;
    const result = await confirmIntensity("comfortable");
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });

  it("rejects when there is no draft cookie", async () => {
    mockToken = undefined;
    const result = await confirmIntensity("comfortable");
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });

  it("rejects when the draft is not found (forged/foreign token)", async () => {
    mockDraftRow = null;
    const result = await confirmIntensity("comfortable");
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
  });

  it("rejects when intake isn't finished (no usable summary)", async () => {
    mockDraftRow = {
      id: "draft-uuid-1",
      session_token: "draft-token-1",
      intake_summary_draft: null,
    };
    const result = await confirmIntensity("comfortable");
    expect(result.ok).toBe(false);
    expect(draftUpdateSets).toHaveLength(0);
    expect(updateSelfCalls).toHaveLength(0);
  });
});
