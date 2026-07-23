/**
 * saveGoal server-action tests (no DB, no React, node env — the
 * decide-safety/confirm-intensity mocking posture).
 *
 * Pins the load-bearing behaviors of the commit step:
 *   - guards (auth / cookie / draft / plan / confirmed intake / invalid edited
 *     plan / active-goal cap) all fail with ZERO writes;
 *   - the transaction composition: goals + intake_summaries (FK set, merged
 *     safety_flags) + recurring_tasks + milestones (normalized positions) +
 *     equipment (positions resolved to milestone ids, collisions by first
 *     match) written, then the goal_drafts row deleted — and a vanished draft
 *     aborts the whole save;
 *   - color assignment runs on the active goals' used set (gap-filling);
 *   - PostHog plan_accepted { goal_id, edits_count } always,
 *     first_goal_created only when the post-save goal count is 1;
 *   - success clears the draft cookie and redirects to /goals.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  equipment,
  goals,
  goal_drafts,
  intake_summaries,
  milestones,
  recurring_tasks,
} from "@/db/schema";
import type { PlanDraft } from "@/lib/ai/plan-schema";

// --- mocks ---------------------------------------------------------------

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockUserId })),
}));

let mockToken: string | undefined = "draft-token-1";
const cookieDeletes: string[] = [];
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: () => (mockToken === undefined ? undefined : { value: mockToken }),
    delete: (name: string) => {
      cookieDeletes.push(name);
    },
  })),
}));

const redirects: string[] = [];
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    redirects.push(url);
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
}));

const captures: Array<{ event: string; properties: Record<string, unknown> }> =
  [];
vi.mock("@/lib/analytics/server", () => ({
  capture: vi.fn(async (_id: string, event: string, properties = {}) => {
    captures.push({ event, properties });
  }),
}));

// Recorded transaction writes.
const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const deletes: Array<{ table: unknown }> = [];
let mockDraftRow: Record<string, unknown> | null;
let activeGoalsFixture: Array<{ color_index: number }> = [];
let totalGoalsAfterSave = 1;
let draftDeleteSucceeds = true;
let transactionCalls = 0;
let mockTier: "free" | "pro" | "max" = "free";

vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn((userId: string) => {
    let milestoneSeq = 0;
    const tx = {
      userId,
      getSelf: vi.fn(async () => ({
        id: userId,
        tier: mockTier,
        timezone: "UTC",
      })),
      selectFrom: vi.fn(async (table: unknown) =>
        table === goals ? activeGoalsFixture : [],
      ),
      insert: vi.fn(async (table: unknown, values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const id = table === milestones ? `ms-${milestoneSeq++}` : "goal-1";
        return [{ id, ...values }];
      }),
      delete: vi.fn(async (table: unknown) => {
        deletes.push({ table });
        return draftDeleteSucceeds ? [{ id: "draft-uuid-1" }] : [];
      }),
      count: vi.fn(async () => totalGoalsAfterSave),
    };
    return {
      userId,
      selectFrom: vi.fn(async (table: unknown) => {
        if (table === goal_drafts) return mockDraftRow ? [mockDraftRow] : [];
        return [];
      }),
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
        transactionCalls++;
        return fn(tx);
      }),
    };
  }),
}));

// --- import under test (after mocks) ------------------------------------

import { saveGoal } from "./save-goal";

// --- fixtures -------------------------------------------------------------

const DECIDED_FLAG = {
  type: "safety_flag",
  concern: "the compressed acclimatization timeline",
  alternative: "Target the summit a season later.",
  reasoning: "Altitude adaptation does not compress well.",
  user_overrode: true,
  decided_at: "2026-06-01T10:00:00.000Z",
};

const RAW_TRANSCRIPT = [
  { role: "user", content: "I want to climb Mont Blanc next July." },
  { role: "assistant", content: "That timeline is tight. Worth a look." },
  DECIDED_FLAG,
];

const INTAKE_SUMMARY = {
  one_sentence_goal: "Climb Mont Blanc next July",
  starting_point: "Hikes regularly; no alpine experience.",
  prior_experience: null,
  days_per_week: 4,
  time_per_session_min: 90,
  budget_usd: 2000,
  target_date: "2027-07-15",
  location_city: "Geneva",
  location_region: null,
  location_country: "Switzerland",
  activity_type: "climbing",
  activity_type_other_label: null,
  suggested_intensity: "challenging",
  suggested_intensity_reasoning: "A year is workable with steady volume.",
  confirmed_intensity: "brutal",
  safety_flags: [
    {
      // Same concern as the staged flag — must be SUBSUMED by the decided one.
      concern: "The compressed acclimatization timeline",
      alternative: "Target the summit a season later.",
      user_overrode: null,
      decided_at: null,
    },
    {
      // Model-only flag — appended with decision fields nulled.
      concern: "the budget for guided travel",
      alternative: "A guided course first, summit attempt later.",
      user_overrode: null,
      decided_at: null,
    },
  ],
};

/** Valid edited plan, including a milestone-position COLLISION (both at 1). */
const EDITED_PLAN: PlanDraft = {
  daily: [
    { title: "Morning mobility", description: "Hips and ankles.", estimated_duration_min: 15 },
  ],
  weekly: [
    { title: "Long hike", description: null, weekday: 6, estimated_duration_min: 180 },
  ],
  milestones: [
    { title: "First-at-1", target_date: "2026-08-15", position: 1 },
    { title: "Second-at-1", target_date: "2026-09-20", position: 1 },
    { title: "At-0", target_date: "2026-07-01", position: 0 },
  ],
  equipment: [
    { title: "Boots", cost_usd: 450, milestone_position: 1, standalone_deadline: null },
    { title: "Poles", cost_usd: 90, milestone_position: null, standalone_deadline: "2026-07-30" },
  ],
};

function resetState() {
  mockUserId = "user_test_1";
  mockToken = "draft-token-1";
  mockDraftRow = {
    id: "draft-uuid-1",
    session_token: "draft-token-1",
    raw_transcript: RAW_TRANSCRIPT.map((e) => ({ ...e })),
    intake_summary_draft: { ...INTAKE_SUMMARY },
    plan_draft: { marker: "present" },
  };
  activeGoalsFixture = [];
  totalGoalsAfterSave = 1;
  draftDeleteSucceeds = true;
  transactionCalls = 0;
  mockTier = "free";
  inserts.length = 0;
  deletes.length = 0;
  captures.length = 0;
  redirects.length = 0;
  cookieDeletes.length = 0;
}

beforeEach(resetState);

function insertsFor(table: unknown) {
  return inserts.filter((i) => i.table === table).map((i) => i.values);
}

async function saveExpectingRedirect(editsCount = 0) {
  await expect(
    saveGoal({ plan: EDITED_PLAN, editsCount }),
  ).rejects.toThrow("NEXT_REDIRECT:/goals");
}

// --- guards: zero writes ---------------------------------------------------

describe("saveGoal — guards reject with zero writes", () => {
  async function expectRejected(error?: RegExp) {
    const result = await saveGoal({ plan: EDITED_PLAN, editsCount: 0 });
    expect(result.ok).toBe(false);
    if (error && !result.ok) expect(result.error).toMatch(error);
    expect(inserts).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    expect(captures).toHaveLength(0);
    expect(redirects).toHaveLength(0);
  }

  it("no auth", async () => {
    mockUserId = null;
    await expectRejected(/sign in/i);
    expect(transactionCalls).toBe(0);
  });

  it("no draft cookie", async () => {
    mockToken = undefined;
    await expectRejected(/draft/i);
    expect(transactionCalls).toBe(0);
  });

  it("no draft row for the cookie", async () => {
    mockDraftRow = null;
    await expectRejected(/draft/i);
    expect(transactionCalls).toBe(0);
  });

  it("draft without plan_draft", async () => {
    mockDraftRow = { ...mockDraftRow!, plan_draft: null };
    await expectRejected(/plan/i);
    expect(transactionCalls).toBe(0);
  });

  it("draft without a confirmed intake", async () => {
    const summary: Record<string, unknown> = { ...INTAKE_SUMMARY };
    delete summary.confirmed_intensity;
    mockDraftRow = { ...mockDraftRow!, intake_summary_draft: summary };
    await expectRejected(/intake/i);
    expect(transactionCalls).toBe(0);
  });

  it("per-tier cap: a Free user's 4th active goal hits the cap (structured cap_hit + PostHog)", async () => {
    // Free cap = 3; 3 active already → the 4th save is blocked.
    mockTier = "free";
    activeGoalsFixture = [0, 1, 2].map((color_index) => ({ color_index }));
    const result = await saveGoal({ plan: EDITED_PLAN, editsCount: 0 });
    expect(result).toEqual({
      ok: false,
      error: "cap_hit",
      cap: 3,
      used: 3,
      kind: "active_goals",
    });
    // Re-checked INSIDE the transaction; no goal/intake/task rows written.
    expect(transactionCalls).toBe(1);
    expect(inserts).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    expect(redirects).toHaveLength(0);
    // Server capture chokepoint fired exactly once.
    expect(
      captures.filter((c) => c.event === "free_tier_cap_hit"),
    ).toEqual([{ event: "free_tier_cap_hit", properties: { cap: "active_goals" } }]);
  });

  it("per-tier cap: a Pro user is allowed a 4th active goal (3 < 5), redirects", async () => {
    mockTier = "pro";
    activeGoalsFixture = [0, 1, 2].map((color_index) => ({ color_index }));
    await saveExpectingRedirect();
    // Wrote the goal (proceeded past the cap check).
    expect(inserts.filter((i) => i.table === goals)).toHaveLength(1);
  });

  it("per-tier cap: a Max user's 6th active goal hits the cap:5", async () => {
    mockTier = "max";
    activeGoalsFixture = [0, 1, 2, 3, 4].map((color_index) => ({ color_index }));
    const result = await saveGoal({ plan: EDITED_PLAN, editsCount: 0 });
    expect(result).toEqual({
      ok: false,
      error: "cap_hit",
      cap: 5,
      used: 5,
      kind: "active_goals",
    });
    expect(transactionCalls).toBe(1);
    expect(inserts).toHaveLength(0);
  });
});

// --- server-side re-validation of the edited plan ---------------------------

describe("saveGoal — edited-plan re-validation (zero writes)", () => {
  async function expectInvalid(plan: unknown) {
    const result = await saveGoal({ plan, editsCount: 1 });
    expect(result).toEqual({
      ok: false,
      error: "Some items need attention before saving.",
    });
    expect(transactionCalls).toBe(0);
    expect(inserts).toHaveLength(0);
  }

  it("weekday out of bounds (7) rejects", async () => {
    await expectInvalid({
      ...EDITED_PLAN,
      weekly: [{ title: "x", description: null, weekday: 7, estimated_duration_min: null }],
    });
  });

  it("weekday out of bounds (-1) rejects", async () => {
    await expectInvalid({
      ...EDITED_PLAN,
      weekly: [{ title: "x", description: null, weekday: -1, estimated_duration_min: null }],
    });
  });

  it("equipment with BOTH milestone link and standalone date rejects", async () => {
    await expectInvalid({
      ...EDITED_PLAN,
      equipment: [
        { title: "x", cost_usd: null, milestone_position: 0, standalone_deadline: "2026-07-30" },
      ],
    });
  });

  it("equipment with NEITHER rejects", async () => {
    await expectInvalid({
      ...EDITED_PLAN,
      equipment: [
        { title: "x", cost_usd: null, milestone_position: null, standalone_deadline: null },
      ],
    });
  });

  it("dangling milestone_position rejects", async () => {
    await expectInvalid({
      ...EDITED_PLAN,
      equipment: [
        { title: "x", cost_usd: null, milestone_position: 99, standalone_deadline: null },
      ],
    });
  });
});

// --- transaction composition -------------------------------------------------

describe("saveGoal — transaction composition", () => {
  it("creates the goal with assigned color, explicit active status, started_at", async () => {
    activeGoalsFixture = [{ color_index: 0 }, { color_index: 2 }];
    await saveExpectingRedirect();
    const goalInserts = insertsFor(goals);
    expect(goalInserts).toHaveLength(1);
    const goal = goalInserts[0]!;
    expect(goal.user_id).toBe("user_test_1");
    expect(goal.title).toBe("Climb Mont Blanc next July");
    expect(goal.status).toBe("active");
    expect(goal.color_index).toBe(1); // gap-filled: used {0,2} → 1
    expect(goal.target_date).toBe("2027-07-15");
    expect(goal.started_at).toBeInstanceOf(Date);
    expect(goal.intensity_override).toBeUndefined(); // never set at creation
  });

  it("creates the intake summary with FK set, both intensities, merged flags", async () => {
    await saveExpectingRedirect();
    const summaryInserts = insertsFor(intake_summaries);
    expect(summaryInserts).toHaveLength(1);
    const summary = summaryInserts[0]!;
    expect(summary.goal_id).toBe("goal-1");
    expect(summary.suggested_intensity).toBe("challenging");
    expect(summary.confirmed_intensity).toBe("brutal");
    expect(summary.activity_type).toBe("climbing");
    expect(summary.budget_usd).toBe("2000");
    expect(summary.raw_transcript).toEqual(RAW_TRANSCRIPT);

    // Merged: the staged DECIDED flag subsumes the matching model flag
    // (case-insensitive concern match); the model-only flag appends nulled.
    const flags = summary.safety_flags as Array<Record<string, unknown>>;
    expect(flags).toHaveLength(2);
    expect(flags[0]).toMatchObject({
      concern: DECIDED_FLAG.concern,
      user_overrode: true,
      decided_at: DECIDED_FLAG.decided_at,
    });
    expect(flags[1]).toMatchObject({
      concern: "the budget for guided travel",
      user_overrode: null,
      decided_at: null,
    });
  });

  it("creates daily + weekly recurring tasks with cadence and weekday", async () => {
    await saveExpectingRedirect();
    const tasks = insertsFor(recurring_tasks);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toMatchObject({
      goal_id: "goal-1",
      title: "Morning mobility",
      cadence: "daily",
      estimated_duration_min: 15,
    });
    expect(tasks[0]!.weekday).toBeUndefined();
    expect(tasks[1]).toMatchObject({
      goal_id: "goal-1",
      title: "Long hike",
      cadence: "weekly",
      weekday: 6,
      estimated_duration_min: 180,
    });
  });

  it("creates milestones with positions normalized sequentially", async () => {
    await saveExpectingRedirect();
    const rows = insertsFor(milestones);
    expect(rows.map((m) => [m.title, m.position])).toEqual([
      ["At-0", 0],
      ["First-at-1", 1],
      ["Second-at-1", 2],
    ]);
    expect(rows.every((m) => m.goal_id === "goal-1")).toBe(true);
  });

  it("resolves colliding equipment positions to the FIRST matching milestone id", async () => {
    await saveExpectingRedirect();
    const rows = insertsFor(equipment);
    expect(rows).toHaveLength(2);
    // Both First-at-1 and Second-at-1 had draft position 1; first match after
    // normalization is First-at-1, inserted second → ms-1.
    expect(rows[0]).toMatchObject({
      title: "Boots",
      cost_usd: "450",
      milestone_id: "ms-1",
      standalone_deadline: null,
    });
    expect(rows[1]).toMatchObject({
      title: "Poles",
      cost_usd: "90",
      milestone_id: null,
      standalone_deadline: "2026-07-30",
    });
  });

  it("deletes the goal_drafts row and clears the cookie", async () => {
    await saveExpectingRedirect();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.table).toBe(goal_drafts);
    expect(cookieDeletes).toContain("strix_goal_draft");
    expect(redirects).toEqual(["/goals"]);
  });

  it("aborts (no success path) when the draft vanished mid-save", async () => {
    draftDeleteSucceeds = false;
    const result = await saveGoal({ plan: EDITED_PLAN, editsCount: 0 });
    expect(result).toEqual({ ok: false, error: "That didn't save. Try once more." });
    expect(captures).toHaveLength(0);
    expect(redirects).toHaveLength(0);
    expect(cookieDeletes).toHaveLength(0);
  });
});

// --- analytics ----------------------------------------------------------------

describe("saveGoal — analytics", () => {
  it("fires plan_accepted with goal_id and edits_count", async () => {
    await saveExpectingRedirect(7);
    const accepted = captures.find((c) => c.event === "plan_accepted");
    expect(accepted?.properties).toEqual({ goal_id: "goal-1", edits_count: 7 });
  });

  it("coerces a bogus edits_count to 0", async () => {
    await expect(
      saveGoal({ plan: EDITED_PLAN, editsCount: -3.5 }),
    ).rejects.toThrow("NEXT_REDIRECT:/goals");
    const accepted = captures.find((c) => c.event === "plan_accepted");
    expect(accepted?.properties).toMatchObject({ edits_count: 0 });
  });

  it("fires first_goal_created when the post-save goal count is 1", async () => {
    totalGoalsAfterSave = 1;
    await saveExpectingRedirect();
    const first = captures.find((c) => c.event === "first_goal_created");
    expect(first?.properties).toEqual({
      goal_id: "goal-1",
      color_index: 0,
      activity_type: "climbing",
    });
  });

  it("does NOT fire first_goal_created for a later goal", async () => {
    totalGoalsAfterSave = 2;
    await saveExpectingRedirect();
    expect(captures.some((c) => c.event === "first_goal_created")).toBe(false);
    expect(captures.some((c) => c.event === "plan_accepted")).toBe(true);
  });
});
