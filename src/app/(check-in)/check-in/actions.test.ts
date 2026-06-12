/**
 * Weekly check-in server-action tests (no DB, node env — the check-task
 * mocking posture). The phase's write surface: upsert + proposal fan-out.
 *
 * Pins:
 *   - guards (no auth, 'skipped' as a submitted feeling, malformed goal ids,
 *     oversized notes) reject with ZERO DB calls;
 *   - the upsert runs INSIDE one transaction holding the
 *     lockScope("weekly-check-in") advisory lock; insert when no row exists,
 *     update (with updated_at) when one does;
 *   - week_start_date is the Sunday of the USER's week (users.timezone);
 *   - notes are trimmed; empty → NULL;
 *   - one replan_proposals row per NEWLY-selected goal with the exact
 *     payload (trigger, weekly_check_in_id, EMPTY_REPLAN_DIFF, pending);
 *     already-proposed goals are skipped on resubmit;
 *   - zero selections is a VALID submit (row written, no proposals);
 *   - the Free cap is re-checked server-side against the current month's
 *     usage_counters: over-cap refuses the WHOLE submission (no partial
 *     write); Pro never reads counters;
 *   - a selected goal that isn't an active own goal refuses the whole write;
 *   - first_weekly_check_in_completed fires ONLY when the PRE-write
 *     non-skipped count is 0 and the submission is real — resubmits never
 *     re-fire; a real submission after only-skips fires;
 *   - skipCheckIn upserts { feeling: 'skipped', notes: null } with NO
 *     proposals and NO analytics.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks ---------------------------------------------------------------

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockUserId })),
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidated.push(path);
  }),
}));

const captured: Array<{
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
}> = [];
vi.mock("@/lib/analytics/server", () => ({
  capture: vi.fn(
    async (
      distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captured.push({ distinctId, event, properties });
    },
  ),
}));

// Table-routed scopedDb mock: selectFrom/count answer per table; writes are
// recorded for assertion. getSelf carries timezone + tier.
let getSelfResult: { timezone: string; tier: "free" | "pro" | "max" } | null = {
  timezone: "UTC",
  tier: "free",
};
let activeGoalsResult: Array<{ id: string }> = [];
let existingWeekRows: Array<Record<string, unknown>> = [];
let proposalRows: Array<{ goal_id: string }> = [];
let counterRows: Array<{ replans_used: number }> = [];
let preNonSkippedCount = 0;
let insertThrows: unknown = null;

const lockScopes: string[] = [];
const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];

vi.mock("@/db/scoped", async () => {
  const schema = await import("@/db/schema");
  const tx = {
    lockScope: vi.fn(async (ns: string) => {
      lockScopes.push(ns);
    }),
    selectFrom: vi.fn(async (table: unknown) => {
      if (table === schema.goals) return activeGoalsResult;
      if (table === schema.weekly_check_ins) return existingWeekRows;
      if (table === schema.replan_proposals) return proposalRows;
      if (table === schema.usage_counters) return counterRows;
      throw new Error("unexpected table in selectFrom mock");
    }),
    count: vi.fn(async () => preNonSkippedCount),
    insert: vi.fn(async (table: unknown, values: Record<string, unknown>) => {
      if (insertThrows) throw insertThrows;
      inserts.push({ table, values });
      return [{ id: "new-row-id", ...values }];
    }),
    update: vi.fn(
      async (table: unknown, opts: { set: Record<string, unknown> }) => {
        updates.push({ table, set: opts.set });
        return [{ id: "updated-row-id" }];
      },
    ),
  };
  return {
    scopedDb: vi.fn((userId: string) => ({
      userId,
      getSelf: vi.fn(async () => getSelfResult),
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    })),
  };
});

// --- import under test (after mocks) ------------------------------------

import { replan_proposals, weekly_check_ins } from "@/db/schema";
import { EMPTY_REPLAN_DIFF } from "@/lib/ai/replan-diff";
import { skipCheckIn, submitCheckIn } from "./actions";

const GOAL_A = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const GOAL_B = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const GOAL_C = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

function submit(over?: Partial<Parameters<typeof submitCheckIn>[0]>) {
  return submitCheckIn({
    feeling: "too_hard",
    notes: "Long runs felt heavy.",
    selectedGoalIds: [GOAL_A],
    ...over,
  });
}

/** This week's Sunday in UTC — what the action computes for a UTC user. */
function utcWeekStart(): string {
  const today = new Date().toISOString().slice(0, 10);
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  return new Date(Date.parse(`${today}T00:00:00Z`) - dow * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

beforeEach(() => {
  mockUserId = "user_test_1";
  getSelfResult = { timezone: "UTC", tier: "free" };
  activeGoalsResult = [{ id: GOAL_A }, { id: GOAL_B }, { id: GOAL_C }];
  existingWeekRows = [];
  proposalRows = [];
  counterRows = [];
  preNonSkippedCount = 5;
  insertThrows = null;
  lockScopes.length = 0;
  inserts.length = 0;
  updates.length = 0;
  revalidated.length = 0;
  captured.length = 0;
});

describe("submitCheckIn — guards reject with zero writes", () => {
  it("no auth → failure, no DB call", async () => {
    mockUserId = null;
    const result = await submit();
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(captured).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it("'skipped' is not a submittable feeling", async () => {
    const result = await submit({ feeling: "skipped" });
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it.each([
    ["not a uuid", ["goal-1"]],
    ["sql-ish payload", ["' OR 1=1 --"]],
    ["mixed valid + invalid", [GOAL_A, "nope"]],
  ])("malformed goal id (%s) → failure, no DB call", async (_label, ids) => {
    const result = await submit({ selectedGoalIds: ids as string[] });
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it("notes over 2000 chars (post-trim) → failure, no DB call", async () => {
    const result = await submit({ notes: "x".repeat(2001) });
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it("a selected goal that is not an active own goal → whole write refused", async () => {
    activeGoalsResult = [{ id: GOAL_B }];
    const result = await submit({ selectedGoalIds: [GOAL_A] });
    expect(result).toEqual({
      ok: false,
      error: "We couldn't find one of those goals.",
    });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("submitCheckIn — fresh week insert", () => {
  it("locks the check-in scope, inserts the week row, fans out proposals", async () => {
    const result = await submit({ selectedGoalIds: [GOAL_A, GOAL_B] });
    // The created proposals ride back for the confirmation's generation
    // fan-out (one POST /api/ai/replan per row).
    expect(result).toEqual({
      ok: true,
      createdProposals: [
        { proposalId: "new-row-id", goalId: GOAL_A, weeklyCheckInId: "new-row-id" },
        { proposalId: "new-row-id", goalId: GOAL_B, weeklyCheckInId: "new-row-id" },
      ],
    });
    expect(lockScopes).toEqual(["weekly-check-in"]);

    const weekInserts = inserts.filter((i) => i.table === weekly_check_ins);
    expect(weekInserts).toHaveLength(1);
    expect(weekInserts[0]!.values).toEqual({
      user_id: "user_test_1",
      week_start_date: utcWeekStart(),
      feeling: "too_hard",
      notes: "Long runs felt heavy.",
    });

    const proposalInserts = inserts.filter(
      (i) => i.table === replan_proposals,
    );
    expect(proposalInserts).toHaveLength(2);
    expect(proposalInserts.map((p) => p.values.goal_id)).toEqual([
      GOAL_A,
      GOAL_B,
    ]);
    for (const p of proposalInserts) {
      expect(p.values).toMatchObject({
        user_id: "user_test_1",
        trigger: "weekly_check_in",
        weekly_check_in_id: "new-row-id",
        proposed_changes: EMPTY_REPLAN_DIFF,
        status: "pending",
      });
    }
    expect(revalidated).toEqual(["/check-in"]);
  });

  it("week_start_date is the Sunday of the USER's week (timezone from getSelf)", async () => {
    // UTC+14: Kiritimati can be a day (and a week) ahead of UTC.
    getSelfResult = { timezone: "Pacific/Kiritimati", tier: "free" };
    await submit();
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Kiritimati",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const expected = new Date(
      Date.parse(`${today}T00:00:00Z`) - dow * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    const weekInsert = inserts.find((i) => i.table === weekly_check_ins);
    expect(weekInsert!.values.week_start_date).toBe(expected);
  });

  it("notes are trimmed; empty/whitespace → NULL", async () => {
    await submit({ notes: "  kept  " });
    await submit({ notes: "   " });
    const weekInserts = inserts.filter((i) => i.table === weekly_check_ins);
    expect(weekInserts[0]!.values.notes).toBe("kept");
    expect(weekInserts[1]!.values.notes).toBeNull();
  });

  it("zero selections is a valid check-in: row written, no proposals", async () => {
    const result = await submit({ selectedGoalIds: [] });
    expect(result).toEqual({ ok: true, createdProposals: [] });
    expect(inserts.filter((i) => i.table === weekly_check_ins)).toHaveLength(1);
    expect(inserts.filter((i) => i.table === replan_proposals)).toHaveLength(0);
  });

  it("a duplicated goal id inserts ONE proposal", async () => {
    await submit({ selectedGoalIds: [GOAL_A, GOAL_A] });
    expect(inserts.filter((i) => i.table === replan_proposals)).toHaveLength(1);
  });

  it("a thrown write (scope proof, transport) → calm failure, nothing fired", async () => {
    insertThrows = new Error("ScopedDbError: user soft-deleted");
    const result = await submit();
    expect(result).toEqual({
      ok: false,
      error: "That didn't save. Try once more.",
    });
    expect(captured).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });
});

describe("submitCheckIn — re-submission upserts", () => {
  beforeEach(() => {
    existingWeekRows = [
      {
        id: "ci-week-1",
        week_start_date: utcWeekStart(),
        feeling: "right",
        notes: "old",
      },
    ];
  });

  it("updates the existing row (with updated_at), never inserts a second", async () => {
    const result = await submit({ selectedGoalIds: [], notes: "" });
    expect(result).toEqual({ ok: true, createdProposals: [] });
    expect(inserts.filter((i) => i.table === weekly_check_ins)).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(weekly_check_ins);
    expect(updates[0]!.set).toMatchObject({
      feeling: "too_hard",
      notes: null,
    });
    expect(updates[0]!.set.updated_at).toBeInstanceOf(Date);
  });

  it("triggers proposals ONLY for newly-selected goals", async () => {
    proposalRows = [{ goal_id: GOAL_A }];
    const result = await submit({ selectedGoalIds: [GOAL_A, GOAL_B] });
    const proposalInserts = inserts.filter(
      (i) => i.table === replan_proposals,
    );
    expect(proposalInserts).toHaveLength(1);
    expect(proposalInserts[0]!.values.goal_id).toBe(GOAL_B);
    expect(proposalInserts[0]!.values.weekly_check_in_id).toBe("ci-week-1");
    // createdProposals mirrors exactly the NEW rows — already-proposed goals
    // never re-enter the generation fan-out.
    expect(result).toEqual({
      ok: true,
      createdProposals: [
        { proposalId: "new-row-id", goalId: GOAL_B, weeklyCheckInId: "ci-week-1" },
      ],
    });
  });

  it("a real submission after a skip upserts over it and proposes for ALL selected", async () => {
    existingWeekRows = [
      {
        id: "ci-week-1",
        week_start_date: utcWeekStart(),
        feeling: "skipped",
        notes: null,
      },
    ];
    proposalRows = []; // a skip never created proposals
    await submit({ selectedGoalIds: [GOAL_A, GOAL_B] });
    expect(updates[0]!.set).toMatchObject({ feeling: "too_hard" });
    expect(inserts.filter((i) => i.table === replan_proposals)).toHaveLength(2);
  });
});

describe("submitCheckIn — the Free cap re-check (SPEC §10)", () => {
  it("over-cap refuses the WHOLE submission with the cap line — no partial write", async () => {
    counterRows = [{ replans_used: 2 }];
    const result = await submit({ selectedGoalIds: [GOAL_A] });
    expect(result).toEqual({
      ok: false,
      error: "You've used 2 of 2 replans this month. Upgrade for unlimited.",
    });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(captured).toHaveLength(0);
  });

  it("missing counters row means 0 used — up to 2 newly-selected pass", async () => {
    const result = await submit({ selectedGoalIds: [GOAL_A, GOAL_B] });
    expect(result).toMatchObject({ ok: true });
  });

  it("used 1 of 2: two newly-selected goals are one too many", async () => {
    counterRows = [{ replans_used: 1 }];
    const result = await submit({ selectedGoalIds: [GOAL_A, GOAL_B] });
    expect(result).toEqual({
      ok: false,
      error: "You've used 1 of 2 replans this month. Upgrade for unlimited.",
    });
    expect(inserts).toHaveLength(0);
  });

  it("already-proposed goals cost nothing against the cap", async () => {
    counterRows = [{ replans_used: 2 }];
    existingWeekRows = [
      { id: "ci-week-1", week_start_date: utcWeekStart(), feeling: "right", notes: null },
    ];
    proposalRows = [{ goal_id: GOAL_A }];
    // GOAL_A is already proposed → zero NEW replans → cap can't refuse.
    const result = await submit({ selectedGoalIds: [GOAL_A] });
    expect(result).toEqual({ ok: true, createdProposals: [] });
  });

  it("pro is uncapped and never reads usage_counters", async () => {
    getSelfResult = { timezone: "UTC", tier: "pro" };
    counterRows = [{ replans_used: 99 }];
    const result = await submit({
      selectedGoalIds: [GOAL_A, GOAL_B, GOAL_C],
    });
    expect(result).toMatchObject({ ok: true });
    expect(inserts.filter((i) => i.table === replan_proposals)).toHaveLength(3);
  });
});

describe("submitCheckIn — first_weekly_check_in_completed gate", () => {
  it("PRE-write count 0 + real submission → fires once with feeling + count", async () => {
    preNonSkippedCount = 0;
    await submit({ feeling: "right", selectedGoalIds: [GOAL_A, GOAL_B] });
    expect(captured).toEqual([
      {
        distinctId: "user_test_1",
        event: "first_weekly_check_in_completed",
        properties: { feeling: "right", goals_selected_count: 2 },
      },
    ]);
  });

  it("PRE-write count ≥ 1 (resubmit after a real week) → never re-fires", async () => {
    preNonSkippedCount = 1;
    await submit();
    expect(captured).toHaveLength(0);
  });

  it("real submission after only-skips fires (skips don't count)", async () => {
    preNonSkippedCount = 0; // non-skipped count — skip rows are excluded
    existingWeekRows = [
      {
        id: "ci-week-1",
        week_start_date: utcWeekStart(),
        feeling: "skipped",
        notes: null,
      },
    ];
    await submit({ feeling: "too_easy", selectedGoalIds: [] });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.properties).toEqual({
      feeling: "too_easy",
      goals_selected_count: 0,
    });
  });
});

describe("skipCheckIn — the skip path", () => {
  it("fresh week: inserts { feeling: 'skipped', notes: null }, no proposals, no analytics", async () => {
    const result = await skipCheckIn();
    expect(result).toEqual({ ok: true });
    expect(lockScopes).toEqual(["weekly-check-in"]);
    const weekInserts = inserts.filter((i) => i.table === weekly_check_ins);
    expect(weekInserts).toHaveLength(1);
    expect(weekInserts[0]!.values).toEqual({
      user_id: "user_test_1",
      week_start_date: utcWeekStart(),
      feeling: "skipped",
      notes: null,
    });
    expect(inserts.filter((i) => i.table === replan_proposals)).toHaveLength(0);
    expect(captured).toHaveLength(0);
    expect(revalidated).toEqual(["/check-in"]);
  });

  it("existing row: updates to skipped with NULL notes", async () => {
    existingWeekRows = [
      {
        id: "ci-week-1",
        week_start_date: utcWeekStart(),
        feeling: "skipped",
        notes: null,
      },
    ];
    const result = await skipCheckIn();
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set).toMatchObject({ feeling: "skipped", notes: null });
    expect(updates[0]!.set.updated_at).toBeInstanceOf(Date);
    expect(captured).toHaveLength(0);
  });

  it("no auth → failure, no DB call", async () => {
    mockUserId = null;
    const result = await skipCheckIn();
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});
