/**
 * completeTask server-action tests (no DB, node env — the toggle-purchased
 * mocking posture). THE security-sensitive write of the phase.
 *
 * Pins:
 *   - guards (no auth, malformed/non-string id) reject with ZERO DB calls;
 *   - the insert goes through scopedDb's task_completions path with ONLY
 *     { recurring_task_id, for_date } — goal_id is never supplied (it is
 *     derived server-side inside the atomic ownership proof);
 *   - for_date is the user's calendar day (users.timezone via getSelf);
 *   - a forged/foreign id (atomic proof → zero rows → ScopedDbError throw)
 *     surfaces as a calm failure — no capture, no revalidate;
 *   - a unique-constraint conflict (double-completion, Postgres 23505 — only
 *     reachable for an OWNED row) is a calm already-done no-op, NOT an error;
 *   - first_task_checked fires ONLY when count == 1 after the insert, with
 *     { task_id, goal_id } and goal_id taken from the INSERTED row.
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

const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
let getSelfResult: { timezone: string } | null = { timezone: "UTC" };
let insertThrows: unknown = null;
let insertResult: Array<Record<string, unknown>> = [];
let countResult = 5;

vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn((userId: string) => {
    const tx = {
      insert: vi.fn(
        async (table: unknown, values: Record<string, unknown>) => {
          if (insertThrows) throw insertThrows;
          inserts.push({ table, values });
          return insertResult;
        },
      ),
      count: vi.fn(async () => countResult),
    };
    return {
      userId,
      getSelf: vi.fn(async () => getSelfResult),
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    };
  }),
}));

// --- import under test (after mocks) ------------------------------------

import { task_completions } from "@/db/schema";
import { completeTask } from "./check-task";

const TASK_ID = "5f9c2c4a-7a1b-4f4e-9b2d-3c8d1e6f0a12";
const GOAL_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

class FakeScopedDbError extends Error {
  constructor() {
    super("not an owned (task, parent-goal) pair");
    this.name = "ScopedDbError";
  }
}

class FakeUniqueViolation extends Error {
  code = "23505";
  constructor() {
    super("duplicate key value violates unique constraint");
  }
}

beforeEach(() => {
  mockUserId = "user_test_1";
  getSelfResult = { timezone: "UTC" };
  insertThrows = null;
  insertResult = [{ id: "tc-1", goal_id: GOAL_ID }];
  countResult = 5;
  inserts.length = 0;
  revalidated.length = 0;
  captured.length = 0;
});

describe("completeTask — guards reject with zero writes", () => {
  it("no auth → failure, no DB call, no capture", async () => {
    mockUserId = null;
    const result = await completeTask({ taskId: TASK_ID });
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
    expect(captured).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it.each([
    ["empty string", ""],
    ["not a uuid", "task-1"],
    ["sql-ish payload", "' OR 1=1 --"],
  ])("malformed task id (%s) → failure, no DB call", async (_label, id) => {
    const result = await completeTask({ taskId: id });
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });

  it("non-string task id → failure, no DB call", async () => {
    const result = await completeTask({
      taskId: 42 as unknown as string,
    });
    expect(result).toMatchObject({ ok: false });
    expect(inserts).toHaveLength(0);
  });
});

describe("completeTask — ownership failure (atomic insert contract)", () => {
  it("forged/foreign id: ScopedDbError (zero rows) → calm failure, nothing fired", async () => {
    insertThrows = new FakeScopedDbError();
    const result = await completeTask({ taskId: TASK_ID });
    expect(result).toEqual({
      ok: false,
      error: "That didn't save. Try once more.",
    });
    expect(captured).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });
});

describe("completeTask — double-completion is a calm no-op", () => {
  it("unique violation (code 23505) → ok with alreadyDone, no capture", async () => {
    insertThrows = new FakeUniqueViolation();
    const result = await completeTask({ taskId: TASK_ID });
    expect(result).toEqual({ ok: true, alreadyDone: true });
    expect(captured).toHaveLength(0);
    expect(revalidated).toEqual(["/dashboard"]);
  });

  it("unique violation nested in cause is still recognized", async () => {
    insertThrows = new Error("query failed", {
      cause: new FakeUniqueViolation(),
    });
    const result = await completeTask({ taskId: TASK_ID });
    expect(result).toEqual({ ok: true, alreadyDone: true });
  });

  it("a non-23505 error is NOT mistaken for already-done", async () => {
    insertThrows = new Error("connection reset");
    const result = await completeTask({ taskId: TASK_ID });
    expect(result).toMatchObject({ ok: false });
  });
});

describe("completeTask — happy path", () => {
  it("inserts only { recurring_task_id, for_date } — goal_id is never supplied", async () => {
    const result = await completeTask({ taskId: TASK_ID });
    expect(result).toEqual({ ok: true, alreadyDone: false });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(task_completions);
    expect(inserts[0]!.values.recurring_task_id).toBe(TASK_ID);
    expect(inserts[0]!.values.for_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The atomic INSERT … SELECT derives goal_id server-side; supplying one
    // here would re-enter the (validated) caller path we don't use.
    expect("goal_id" in inserts[0]!.values).toBe(false);
    expect(inserts[0]!.values.user_id).toBeUndefined();
    expect(revalidated).toEqual(["/dashboard"]);
  });

  it("for_date is today on the USER's calendar (timezone from getSelf)", async () => {
    // Pick a timezone far from UTC; the action's date must match the date
    // computed in THAT zone at this instant.
    getSelfResult = { timezone: "Pacific/Kiritimati" }; // UTC+14
    await completeTask({ taskId: TASK_ID });
    const expected = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Pacific/Kiritimati",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    expect(inserts[0]!.values.for_date).toBe(expected);
  });

  it("count > 1 after insert → NO first_task_checked", async () => {
    countResult = 2;
    await completeTask({ taskId: TASK_ID });
    expect(captured).toHaveLength(0);
  });

  it("count == 1 after insert → first_task_checked { task_id, goal_id } once", async () => {
    countResult = 1;
    const result = await completeTask({ taskId: TASK_ID });
    expect(result).toEqual({ ok: true, alreadyDone: false });
    expect(captured).toEqual([
      {
        distinctId: "user_test_1",
        event: "first_task_checked",
        properties: { task_id: TASK_ID, goal_id: GOAL_ID },
      },
    ]);
  });
});
