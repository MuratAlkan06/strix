/**
 * POST /api/ai/replan route tests (no DB, no live API, node env — the
 * check-in actions mocking posture; generateReplan is mocked at the
 * @/lib/ai/replan seam with the real resolveIntensity/error classes).
 *
 * Pins the frozen Slice-2 contract:
 *   - guards (no auth, malformed body, trigger-conditional payloads) reject
 *     with ZERO DB access and ZERO model calls;
 *   - goal must be owned AND active (404), the triggering check-in must exist
 *     (404) and must not be a skip (400 — skips are not sentiment data);
 *   - fill-vs-create: pending row for (goal, check-in) → UPDATE proposed_changes
 *     (status untouched); decided row → 409 with NO model call and NO write;
 *     no row → INSERT; structural_edit → always INSERT with NULL
 *     weekly_check_in_id;
 *   - checkAndIncrement(userId,'replan') is awaited BEFORE the model call and
 *     nothing ever writes usage_counters;
 *   - a ReplanValidationError → 502 with the raw response logged via
 *     logAiError and ZERO proposal writes (the pending row keeps its prior
 *     diff; the create path writes no row);
 *   - a missing client (ReplanUnavailableError) → 503;
 *   - the generate args carry the check-in feeling/notes (or the structural
 *     summary) and the resolved intensity.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks ---------------------------------------------------------------

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockUserId })),
}));

const callOrder: string[] = [];

const checkAndIncrementCalls: Array<{ userId: string; op: string }> = [];
vi.mock("@/lib/limits", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/limits")>();
  return {
    ...actual,
    checkAndIncrement: vi.fn(async (userId: string, op: string) => {
      callOrder.push("checkAndIncrement");
      checkAndIncrementCalls.push({ userId, op });
      return { ok: true } as const;
    }),
  };
});

const loggedAiErrors: Array<{ op: string; err: unknown }> = [];
vi.mock("@/lib/ai/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/log")>();
  return {
    ...actual,
    logAiError: vi.fn((op: string, err: unknown) => {
      loggedAiErrors.push({ op, err });
    }),
  };
});

// generateReplan is the only mocked export; resolveIntensity and the error
// classes stay real so the route exercises the genuine intensity chain.
let generateReplanImpl: (args: unknown) => Promise<unknown> = async () =>
  VALID_DIFF;
const generateCalls: unknown[] = [];
vi.mock("@/lib/ai/replan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/replan")>();
  return {
    ...actual,
    generateReplan: vi.fn(async (args: unknown) => {
      callOrder.push("generateReplan");
      generateCalls.push(args);
      return generateReplanImpl(args);
    }),
  };
});

// Table-routed scopedDb mock: selectFrom answers per table; writes are
// recorded for assertion. getSelf carries timezone + intensity_preference.
let getSelfResult: {
  timezone: string;
  intensity_preference: string | null;
} | null = { timezone: "UTC", intensity_preference: null };
let goalRows: Array<Record<string, unknown>> = [];
let checkInRows: Array<Record<string, unknown>> = [];
let proposalRows: Array<Record<string, unknown>> = [];
let intakeRows: Array<Record<string, unknown>> = [];
let taskRows: Array<Record<string, unknown>> = [];
let milestoneRows: Array<Record<string, unknown>> = [];
let equipmentRows: Array<Record<string, unknown>> = [];
let completionRows: Array<Record<string, unknown>> = [];

const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const updates: Array<{
  table: unknown;
  set: Record<string, unknown>;
  where: unknown;
}> = [];
let updateReturns: Array<Record<string, unknown>> | null = null;
let scopedDbInstances = 0;

vi.mock("@/db/scoped", async () => {
  const schema = await import("@/db/schema");
  return {
    scopedDb: vi.fn((userId: string) => {
      scopedDbInstances += 1;
      return {
        userId,
        getSelf: vi.fn(async () => getSelfResult),
        selectFrom: vi.fn(async (table: unknown) => {
          if (table === schema.goals) return goalRows;
          if (table === schema.weekly_check_ins) return checkInRows;
          if (table === schema.replan_proposals) return proposalRows;
          if (table === schema.intake_summaries) return intakeRows;
          if (table === schema.recurring_tasks) return taskRows;
          if (table === schema.milestones) return milestoneRows;
          if (table === schema.equipment) return equipmentRows;
          if (table === schema.task_completions) return completionRows;
          throw new Error("unexpected table in selectFrom mock");
        }),
        insert: vi.fn(
          async (table: unknown, values: Record<string, unknown>) => {
            inserts.push({ table, values });
            return [{ id: "inserted-proposal-id", ...values }];
          },
        ),
        update: vi.fn(
          async (
            table: unknown,
            opts: { set: Record<string, unknown>; where: unknown },
          ) => {
            updates.push({ table, set: opts.set, where: opts.where });
            return updateReturns ?? [{ id: "updated-proposal-id" }];
          },
        ),
      };
    }),
  };
});

// --- import under test (after mocks) --------------------------------------

import { replan_proposals, usage_counters } from "@/db/schema";
import {
  ReplanUnavailableError,
  ReplanValidationError,
} from "@/lib/ai/replan";
import { EMPTY_REPLAN_DIFF } from "@/lib/ai/replan-diff";
import { POST } from "./route";

const GOAL_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CHECK_IN_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const PROPOSAL_ID = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";

const VALID_DIFF = {
  ...EMPTY_REPLAN_DIFF,
  recurring_tasks: {
    add: [],
    modify: [{ id: "task-1", changes: { estimated_duration_min: 45 } }],
    remove: [],
  },
};

function activeGoal(over?: Record<string, unknown>) {
  return {
    id: GOAL_ID,
    title: "Run a 10k",
    description: null,
    status: "active",
    intensity_override: null,
    target_date: "2026-10-25",
    ...over,
  };
}

function realCheckIn(over?: Record<string, unknown>) {
  return {
    id: CHECK_IN_ID,
    feeling: "too_hard",
    notes: "can't fit the long run on Saturdays",
    ...over,
  };
}

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/ai/replan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const weeklyBody = {
  goal_id: GOAL_ID,
  trigger: "weekly_check_in",
  weekly_check_in_id: CHECK_IN_ID,
};

const structuralBody = {
  goal_id: GOAL_ID,
  trigger: "structural_edit",
  structural_change: { summary: "Target date moved 30 days later." },
};

beforeEach(() => {
  mockUserId = "user_test_1";
  getSelfResult = { timezone: "UTC", intensity_preference: null };
  goalRows = [activeGoal()];
  checkInRows = [realCheckIn()];
  proposalRows = [];
  intakeRows = [];
  taskRows = [];
  milestoneRows = [];
  equipmentRows = [];
  completionRows = [];
  inserts.length = 0;
  updates.length = 0;
  updateReturns = null;
  scopedDbInstances = 0;
  callOrder.length = 0;
  checkAndIncrementCalls.length = 0;
  generateCalls.length = 0;
  loggedAiErrors.length = 0;
  generateReplanImpl = async () => VALID_DIFF;
});

// ---------------------------------------------------------------------------
// Guards — zero DB, zero model calls
// ---------------------------------------------------------------------------

describe("POST /api/ai/replan — guards", () => {
  it("401 when unauthenticated, before any DB access", async () => {
    mockUserId = null;
    const res = await post(weeklyBody);
    expect(res.status).toBe(401);
    expect(scopedDbInstances).toBe(0);
    expect(generateCalls).toHaveLength(0);
  });

  it("400 on non-JSON and malformed bodies, before any DB access", async () => {
    for (const body of [
      "{not json",
      { ...weeklyBody, goal_id: "not-a-uuid" },
      { ...weeklyBody, trigger: "nonsense" },
      {},
    ]) {
      const res = await post(body);
      expect(res.status).toBe(400);
    }
    expect(scopedDbInstances).toBe(0);
    expect(generateCalls).toHaveLength(0);
  });

  it("400 trigger-conditional: weekly_check_in REQUIRES weekly_check_in_id and rejects structural_change", async () => {
    const missing = await post({ goal_id: GOAL_ID, trigger: "weekly_check_in" });
    expect(missing.status).toBe(400);
    const cross = await post({
      ...weeklyBody,
      structural_change: { summary: "x" },
    });
    expect(cross.status).toBe(400);
    expect(scopedDbInstances).toBe(0);
  });

  it("400 trigger-conditional: structural_edit REQUIRES structural_change (1..500) and rejects weekly_check_in_id", async () => {
    const missing = await post({ goal_id: GOAL_ID, trigger: "structural_edit" });
    expect(missing.status).toBe(400);
    const cross = await post({
      ...structuralBody,
      weekly_check_in_id: CHECK_IN_ID,
    });
    expect(cross.status).toBe(400);
    const empty = await post({
      goal_id: GOAL_ID,
      trigger: "structural_edit",
      structural_change: { summary: "   " },
    });
    expect(empty.status).toBe(400);
    const tooLong = await post({
      goal_id: GOAL_ID,
      trigger: "structural_edit",
      structural_change: { summary: "x".repeat(501) },
    });
    expect(tooLong.status).toBe(400);
    expect(scopedDbInstances).toBe(0);
  });

  it("401 when the users row is missing/soft-deleted", async () => {
    getSelfResult = null;
    const res = await post(weeklyBody);
    expect(res.status).toBe(401);
    expect(generateCalls).toHaveLength(0);
  });

  it("404 when the goal is not owned or not active — constant string, no model call", async () => {
    goalRows = [];
    const res = await post(weeklyBody);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Goal not found.");
    expect(generateCalls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("404 when the triggering check-in does not exist (or is another user's)", async () => {
    checkInRows = [];
    const res = await post(weeklyBody);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Check-in not found.");
    expect(generateCalls).toHaveLength(0);
  });

  it("400 when the triggering check-in is a skip — skips never reach the feeling signal", async () => {
    checkInRows = [realCheckIn({ feeling: "skipped", notes: null })];
    const res = await post(weeklyBody);
    expect(res.status).toBe(400);
    expect(generateCalls).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Fill-vs-create (the frozen semantics)
// ---------------------------------------------------------------------------

describe("POST /api/ai/replan — fill-vs-create", () => {
  it("pending row for (goal, check-in) → UPDATEs proposed_changes, status untouched, returns its id", async () => {
    proposalRows = [
      {
        id: PROPOSAL_ID,
        goal_id: GOAL_ID,
        weekly_check_in_id: CHECK_IN_ID,
        status: "pending",
        proposed_changes: EMPTY_REPLAN_DIFF,
      },
    ];
    const res = await post(weeklyBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, proposal_id: PROPOSAL_ID });

    expect(inserts).toHaveLength(0);
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(replan_proposals);
    expect(updates[0]!.set.proposed_changes).toEqual(VALID_DIFF);
    expect(updates[0]!.set.updated_at).toBeInstanceOf(Date);
    // Regeneration never re-decides: status stays whatever it was (pending).
    expect("status" in updates[0]!.set).toBe(false);
  });

  it("decided row → 409, row untouched, ZERO model calls", async () => {
    proposalRows = [
      {
        id: PROPOSAL_ID,
        goal_id: GOAL_ID,
        weekly_check_in_id: CHECK_IN_ID,
        status: "accepted",
      },
    ];
    const res = await post(weeklyBody);
    expect(res.status).toBe(409);
    expect(await res.text()).toBe("Replan proposal already decided.");
    expect(generateCalls).toHaveLength(0);
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("no row for (goal, check-in) → INSERTs a pending proposal linked to the check-in", async () => {
    const res = await post(weeklyBody);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      proposal_id: "inserted-proposal-id",
    });

    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(replan_proposals);
    expect(inserts[0]!.values).toEqual({
      goal_id: GOAL_ID,
      user_id: "user_test_1",
      trigger: "weekly_check_in",
      weekly_check_in_id: CHECK_IN_ID,
      proposed_changes: VALID_DIFF,
      status: "pending",
    });
  });

  it("structural_edit → ALWAYS inserts a new row with NULL weekly_check_in_id", async () => {
    const res = await post(structuralBody);
    expect(res.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.values).toEqual({
      goal_id: GOAL_ID,
      user_id: "user_test_1",
      trigger: "structural_edit",
      weekly_check_in_id: null,
      proposed_changes: VALID_DIFF,
      status: "pending",
    });
  });
});

// ---------------------------------------------------------------------------
// Quota stub ordering + prompt inputs
// ---------------------------------------------------------------------------

describe("POST /api/ai/replan — quota stub and generate args", () => {
  it("awaits checkAndIncrement(userId,'replan') BEFORE the model call; never writes usage_counters", async () => {
    const res = await post(weeklyBody);
    expect(res.status).toBe(200);
    expect(checkAndIncrementCalls).toEqual([
      { userId: "user_test_1", op: "replan" },
    ]);
    expect(callOrder.indexOf("checkAndIncrement")).toBeLessThan(
      callOrder.indexOf("generateReplan"),
    );
    const counterWrites = [...inserts, ...updates].filter(
      (w) => w.table === usage_counters,
    );
    expect(counterWrites).toHaveLength(0);
  });

  it("passes the check-in feeling/notes as the trigger payload", async () => {
    await post(weeklyBody);
    expect(generateCalls).toHaveLength(1);
    const args = generateCalls[0] as Record<string, unknown>;
    expect(args.trigger).toEqual({
      kind: "weekly_check_in",
      feeling: "too_hard",
      notes: "can't fit the long run on Saturdays",
    });
  });

  it("passes the structural summary as the trigger payload", async () => {
    await post(structuralBody);
    const args = generateCalls[0] as Record<string, unknown>;
    expect(args.trigger).toEqual({
      kind: "structural_edit",
      summary: "Target date moved 30 days later.",
    });
  });

  it("resolves intensity through the real chain (override beats intake beats preference)", async () => {
    goalRows = [activeGoal({ intensity_override: "brutal" })];
    intakeRows = [
      {
        confirmed_intensity: "comfortable",
        one_sentence_goal: "g",
        starting_point: "s",
        prior_experience: null,
        days_per_week: null,
        time_per_session_min: null,
        budget_usd: null,
        location_city: null,
        location_region: null,
        location_country: null,
        activity_type: "running",
        activity_type_other_label: null,
        safety_flags: [],
      },
    ];
    await post(weeklyBody);
    const args = generateCalls[0] as Record<string, unknown>;
    expect(args.intensity).toEqual({ intensity: "brutal", source: "override" });
  });

  it("falls back to users.intensity_preference ONLY when no intake row exists", async () => {
    getSelfResult = { timezone: "UTC", intensity_preference: "challenging" };
    intakeRows = []; // absence — the only path to the third branch
    await post(weeklyBody);
    const args = generateCalls[0] as Record<string, unknown>;
    expect(args.intensity).toEqual({
      intensity: "challenging",
      source: "user",
    });
    expect(args.intakeSummary).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Failure mapping — nothing corrupted
// ---------------------------------------------------------------------------

describe("POST /api/ai/replan — failure mapping", () => {
  it("502 on ReplanValidationError: raw response logged via logAiError, ZERO writes (pending row keeps its prior diff)", async () => {
    proposalRows = [
      {
        id: PROPOSAL_ID,
        goal_id: GOAL_ID,
        weekly_check_in_id: CHECK_IN_ID,
        status: "pending",
      },
    ];
    generateReplanImpl = async () => {
      throw new ReplanValidationError("recurring_tasks.add.0.weekday: too big", {
        bad: "output",
      });
    };
    const res = await post(weeklyBody);
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Replan generation failed.");
    expect(updates).toHaveLength(0);
    expect(inserts).toHaveLength(0);
    expect(loggedAiErrors).toHaveLength(1);
    expect(loggedAiErrors[0]!.op).toBe("replan");
    const message = (loggedAiErrors[0]!.err as Error).message;
    expect(message).toContain('Raw response: {"bad":"output"}');
  });

  it("502 on validation failure in the create path writes NO row", async () => {
    generateReplanImpl = async () => {
      throw new ReplanValidationError("x", {});
    };
    const res = await post(structuralBody);
    expect(res.status).toBe(502);
    expect(inserts).toHaveLength(0);
  });

  it("503 when the AI client is not configured", async () => {
    generateReplanImpl = async () => {
      throw new ReplanUnavailableError();
    };
    const res = await post(weeklyBody);
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("AI service unavailable.");
    expect(loggedAiErrors).toHaveLength(0);
    expect(inserts).toHaveLength(0);
  });

  it("502 (not a silent ok) when the pending row vanishes during the update", async () => {
    proposalRows = [
      {
        id: PROPOSAL_ID,
        goal_id: GOAL_ID,
        weekly_check_in_id: CHECK_IN_ID,
        status: "pending",
      },
    ];
    updateReturns = []; // ownership/scope returned nothing
    const res = await post(weeklyBody);
    expect(res.status).toBe(502);
    expect(loggedAiErrors).toHaveLength(1);
  });
});
