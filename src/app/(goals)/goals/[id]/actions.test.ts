/**
 * Goal-detail server-action tests (no DB, node env — the toggle-purchased
 * mocking posture, extended with a transaction-capable scopedDb mock).
 *
 * Pins, per the slice contract:
 *   - every guard (no auth, malformed ids, invalid enum, weekday bounds,
 *     equipment exactly-one, empty titles) rejects with ZERO DB calls;
 *   - ownership failures (scope filter → zero rows, or a thrown atomic-insert
 *     proof) surface as calm failures with nothing written and no revalidate;
 *   - setGoalIntensity writes goals.intensity_override on every explicit
 *     valid call — including a pick equal to the current effective intensity;
 *   - removeTask DEACTIVATES (active=false) and never deletes — the
 *     task_completions history survives;
 *   - addMilestone appends at max(position)+1; moveMilestone swaps positions;
 *   - removeMilestone re-homes linked equipment to the milestone's date
 *     (deadline-preserving) and blocks when there is no date to inherit;
 *   - equipment actions enforce exactly-one and same-goal milestone links;
 *   - revalidatePath fires only after a successful write.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import {
  equipment,
  goals,
  milestones,
  recurring_tasks,
} from "@/db/schema";

// --- mocks -----------------------------------------------------------------

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

interface RecordedUpdate {
  table: unknown;
  set: Record<string, unknown>;
  where: unknown;
}
const updates: RecordedUpdate[] = [];
const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const deletes: Array<{ table: unknown; where: unknown }> = [];
const selects: Array<{ table: unknown; where: unknown }> = [];

let updateResult: Array<Record<string, unknown>> = [];
let insertResult: Array<Record<string, unknown>> = [];
let deleteResult: Array<Record<string, unknown>> = [];
/** Queue of selectFrom results, shifted per call (deterministic per action). */
let selectQueue: Array<Array<Record<string, unknown>>> = [];
let insertThrows = false;

function makeSurface() {
  return {
    selectFrom: vi.fn(async (table: unknown, opts?: { where?: unknown }) => {
      selects.push({ table, where: opts?.where });
      return selectQueue.shift() ?? [];
    }),
    insert: vi.fn(async (table: unknown, values: Record<string, unknown>) => {
      // A thrown insert models scopedDb's failed atomic ownership proof —
      // zero rows landed, so nothing is recorded as written.
      if (insertThrows) throw new Error("ownership proof failed");
      inserts.push({ table, values });
      return insertResult;
    }),
    update: vi.fn(
      async (
        table: unknown,
        opts: { set: Record<string, unknown>; where: unknown },
      ) => {
        updates.push({ table, set: opts.set, where: opts.where });
        return updateResult;
      },
    ),
    delete: vi.fn(async (table: unknown, opts?: { where?: unknown }) => {
      deletes.push({ table, where: opts?.where });
      return deleteResult;
    }),
  };
}

vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn((userId: string) => {
    const surface = makeSurface();
    return {
      ...surface,
      userId,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(surface),
    };
  }),
}));

// --- import under test (after mocks) ----------------------------------------

import {
  addEquipment,
  addMilestone,
  addTask,
  completeGoal,
  moveMilestone,
  removeEquipment,
  removeMilestone,
  removeTask,
  setGoalIntensity,
  updateEquipment,
  updateMilestone,
  updateTask,
} from "./actions";

const GOAL_ID = "5f9c2c4a-7a1b-4f4e-9b2d-3c8d1e6f0a12";
const TASK_ID = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MILESTONE_ID = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const MILESTONE_ID_2 = "2c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const MILESTONE_ID_3 = "3d4e5f6a-7b8c-4d9e-a0f1-2b3c4d5e6f7a";
const EQUIPMENT_ID = "4e5f6a7b-8c9d-4e0f-a1b2-3c4d5e6f7a8b";

function zeroDbCalls() {
  expect(updates).toHaveLength(0);
  expect(inserts).toHaveLength(0);
  expect(deletes).toHaveLength(0);
  expect(selects).toHaveLength(0);
  expect(revalidated).toHaveLength(0);
}

beforeEach(() => {
  mockUserId = "user_test_1";
  updates.length = 0;
  inserts.length = 0;
  deletes.length = 0;
  selects.length = 0;
  revalidated.length = 0;
  updateResult = [{ id: "row" }];
  insertResult = [{ id: "new-row-id" }];
  deleteResult = [{ id: "row" }];
  selectQueue = [];
  insertThrows = false;
});

// ---------------------------------------------------------------------------
// setGoalIntensity — the only intensity_override writer
// ---------------------------------------------------------------------------

describe("setGoalIntensity — guards reject with zero writes", () => {
  it("no auth → failure, no DB call", async () => {
    mockUserId = null;
    const result = await setGoalIntensity({
      goalId: GOAL_ID,
      intensity: "brutal",
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it.each(["", "goal-1", "' OR 1=1 --"])(
    "malformed goal id (%j) → failure, no DB call",
    async (id) => {
      const result = await setGoalIntensity({ goalId: id, intensity: "brutal" });
      expect(result).toMatchObject({ ok: false });
      zeroDbCalls();
    },
  );

  it.each(["extreme", "BRUTAL", "", 3])(
    "invalid intensity enum value (%j) → failure, no DB call",
    async (value) => {
      const result = await setGoalIntensity({
        goalId: GOAL_ID,
        intensity: value as string,
      });
      expect(result).toMatchObject({ ok: false });
      zeroDbCalls();
    },
  );

  it("foreign/unknown goal (scope filter → zero rows) → calm failure, no revalidate", async () => {
    updateResult = [];
    const result = await setGoalIntensity({
      goalId: GOAL_ID,
      intensity: "brutal",
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(revalidated).toHaveLength(0);
  });
});

describe("setGoalIntensity — explicit change writes the override", () => {
  it("challenging → brutal sets goals.intensity_override (verification step 8)", async () => {
    const result = await setGoalIntensity({
      goalId: GOAL_ID,
      intensity: "brutal",
    });
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(goals);
    expect(updates[0]!.set.intensity_override).toBe("brutal");
    expect(updates[0]!.set.updated_at).toBeInstanceOf(Date);
    expect(revalidated).toContain(`/goals/${GOAL_ID}`);
  });

  it("picking the value already effective is STILL an explicit override write (the action never skips)", async () => {
    // The contract: with the override unset, choosing the same value the
    // chain already yields pins it as an override — the action has no
    // "unchanged" short-circuit.
    const result = await setGoalIntensity({
      goalId: GOAL_ID,
      intensity: "challenging",
    });
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.set.intensity_override).toBe("challenging");
  });
});

// ---------------------------------------------------------------------------
// completeGoal — active → completed transition + the idempotent guard
// ---------------------------------------------------------------------------

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("completeGoal — guards reject with zero writes", () => {
  it("no auth → failure, no DB call", async () => {
    mockUserId = null;
    const result = await completeGoal({ goalId: GOAL_ID });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it.each(["", "goal-1", "' OR 1=1 --"])(
    "malformed goal id (%j) → failure, no DB call",
    async (id) => {
      const result = await completeGoal({ goalId: id });
      expect(result).toMatchObject({ ok: false });
      zeroDbCalls();
    },
  );

  it("non-active goal (status guard → zero rows) → ok:false, row untouched, no revalidate", async () => {
    // The WHERE's status='active' condition makes a completed or archived
    // goal match zero rows — the idempotent guard: nothing rewrites
    // completed_at/auto_archive_at on a second invocation.
    updateResult = [];
    const result = await completeGoal({ goalId: GOAL_ID });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(revalidated).toHaveLength(0);
  });

  it("foreign/unknown goal (scope filter → zero rows) → same calm failure", async () => {
    updateResult = [];
    const result = await completeGoal({ goalId: GOAL_ID });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
  });
});

describe("completeGoal — the transition writes the contract's exact fields", () => {
  it("sets status/completed_at/auto_archive_at/archive_reason in one update", async () => {
    const before = Date.now();
    const result = await completeGoal({ goalId: GOAL_ID });
    const after = Date.now();

    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(goals);

    const set = updates[0]!.set;
    expect(set.status).toBe("completed");
    expect(set.archive_reason).toBe("user_action");
    expect(set.completed_at).toBeInstanceOf(Date);
    expect(set.auto_archive_at).toBeInstanceOf(Date);
    expect(set.updated_at).toBeInstanceOf(Date);

    const completedAt = (set.completed_at as Date).getTime();
    expect(completedAt).toBeGreaterThanOrEqual(before);
    expect(completedAt).toBeLessThanOrEqual(after);
    // auto_archive_at = completed_at + EXACTLY 7 days (the field math).
    expect((set.auto_archive_at as Date).getTime() - completedAt).toBe(
      SEVEN_DAYS_MS,
    );
  });

  it("the WHERE transitions ONLY from status='active' (id + status, both in the clause)", async () => {
    await completeGoal({ goalId: GOAL_ID });
    const { sql, params } = new PgDialect().sqlToQuery(
      updates[0]!.where as SQL,
    );
    expect(sql).toBe('("goals"."id" = $1 and "goals"."status" = $2)');
    expect(params).toEqual([GOAL_ID, "active"]);
  });

  it("revalidates the detail page, the goals list, and the dashboard after success", async () => {
    await completeGoal({ goalId: GOAL_ID });
    expect(revalidated).toEqual(
      expect.arrayContaining([`/goals/${GOAL_ID}`, "/goals", "/dashboard"]),
    );
  });

});

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

describe("addTask — validation gates (zero writes)", () => {
  it("weekly without a weekday → rejected", async () => {
    const result = await addTask({
      goalId: GOAL_ID,
      cadence: "weekly",
      title: "Long hike",
      weekday: null,
      estimatedDurationMin: 60,
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it.each([-1, 7, 2.5])("weekday out of 0–6 bounds (%j) → rejected", async (weekday) => {
    const result = await addTask({
      goalId: GOAL_ID,
      cadence: "weekly",
      title: "Long hike",
      weekday,
      estimatedDurationMin: null,
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it("daily carrying a weekday → rejected (no silent garbage)", async () => {
    const result = await addTask({
      goalId: GOAL_ID,
      cadence: "daily",
      title: "Core",
      weekday: 3,
      estimatedDurationMin: null,
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it("blank title → rejected", async () => {
    const result = await addTask({
      goalId: GOAL_ID,
      cadence: "daily",
      title: "   ",
      weekday: null,
      estimatedDurationMin: null,
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it("foreign goal id — the atomic insert proof throws → calm failure, nothing written", async () => {
    insertThrows = true;
    const result = await addTask({
      goalId: GOAL_ID,
      cadence: "daily",
      title: "Core",
      weekday: null,
      estimatedDurationMin: 20,
    });
    expect(result).toEqual({
      ok: false,
      error: "That didn't save. Try once more.",
    });
    expect(inserts).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });
});

describe("addTask — happy paths", () => {
  it("daily: inserts with weekday null, returns the new id", async () => {
    const result = await addTask({
      goalId: GOAL_ID,
      cadence: "daily",
      title: "Core work",
      weekday: null,
      estimatedDurationMin: 20,
    });
    expect(result).toEqual({ ok: true, id: "new-row-id" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(recurring_tasks);
    expect(inserts[0]!.values).toMatchObject({
      goal_id: GOAL_ID,
      title: "Core work",
      cadence: "daily",
      weekday: null,
      estimated_duration_min: 20,
    });
    expect(revalidated).toContain(`/goals/${GOAL_ID}`);
  });

  it("weekly: persists the weekday", async () => {
    const result = await addTask({
      goalId: GOAL_ID,
      cadence: "weekly",
      title: "Long hike",
      weekday: 6,
      estimatedDurationMin: 240,
    });
    expect(result).toMatchObject({ ok: true });
    expect(inserts[0]!.values).toMatchObject({ cadence: "weekly", weekday: 6 });
  });
});

describe("updateTask", () => {
  it.each([-1, 7])("weekday out of bounds (%j) → rejected, zero writes", async (weekday) => {
    const result = await updateTask({
      goalId: GOAL_ID,
      taskId: TASK_ID,
      title: "Long hike",
      weekday,
      estimatedDurationMin: null,
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it("foreign/unknown task (zero rows) → calm failure, no revalidate", async () => {
    updateResult = [];
    const result = await updateTask({
      goalId: GOAL_ID,
      taskId: TASK_ID,
      title: "Long hike",
      estimatedDurationMin: null,
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(revalidated).toHaveLength(0);
  });

  it("weekly edit: title, weekday, and duration land in the set payload", async () => {
    const result = await updateTask({
      goalId: GOAL_ID,
      taskId: TASK_ID,
      title: "Long hike with gain",
      weekday: 0,
      estimatedDurationMin: 180,
    });
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(recurring_tasks);
    expect(updates[0]!.set).toMatchObject({
      title: "Long hike with gain",
      weekday: 0,
      estimated_duration_min: 180,
    });
    expect(revalidated).toContain(`/goals/${GOAL_ID}`);
  });

  it("daily edit (no weekday in input) → the set payload never touches weekday", async () => {
    await updateTask({
      goalId: GOAL_ID,
      taskId: TASK_ID,
      title: "Core",
      estimatedDurationMin: 25,
    });
    expect(updates[0]!.set).not.toHaveProperty("weekday");
  });
});

describe("removeTask — soft deactivation preserves history", () => {
  it("sets active=false via UPDATE; never issues a DELETE", async () => {
    const result = await removeTask({ goalId: GOAL_ID, taskId: TASK_ID });
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(recurring_tasks);
    expect(updates[0]!.set.active).toBe(false);
    // The load-bearing pin: task_completions hang off this row — removal
    // must NEVER hard-delete it.
    expect(deletes).toHaveLength(0);
    expect(revalidated).toContain(`/goals/${GOAL_ID}`);
  });

  it("foreign/unknown task (zero rows) → calm failure", async () => {
    updateResult = [];
    const result = await removeTask({ goalId: GOAL_ID, taskId: TASK_ID });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(revalidated).toHaveLength(0);
  });

  it("malformed task id → failure, no DB call", async () => {
    const result = await removeTask({ goalId: GOAL_ID, taskId: "task-1" });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });
});

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

describe("addMilestone", () => {
  it.each(["", "soon", "2026-1-1"])(
    "invalid target date (%j) → rejected, zero writes",
    async (targetDate) => {
      const result = await addMilestone({
        goalId: GOAL_ID,
        title: "Glacier course",
        targetDate,
      });
      expect(result).toMatchObject({ ok: false });
      zeroDbCalls();
    },
  );

  it("appends at max(position)+1", async () => {
    selectQueue = [[{ position: 0 }, { position: 4 }, { position: 2 }]];
    const result = await addMilestone({
      goalId: GOAL_ID,
      title: "Glacier course",
      targetDate: "2026-12-15",
    });
    expect(result).toEqual({ ok: true, id: "new-row-id" });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.table).toBe(milestones);
    expect(inserts[0]!.values).toMatchObject({
      goal_id: GOAL_ID,
      title: "Glacier course",
      target_date: "2026-12-15",
      position: 5,
    });
  });

  it("first milestone of a goal lands at position 0", async () => {
    selectQueue = [[]];
    await addMilestone({
      goalId: GOAL_ID,
      title: "Hiking base",
      targetDate: "2026-09-01",
    });
    expect(inserts[0]!.values).toMatchObject({ position: 0 });
  });
});

describe("updateMilestone", () => {
  it("happy path writes title + target_date", async () => {
    const result = await updateMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID,
      title: "Glacier travel course",
      targetDate: "2027-01-10",
    });
    expect(result).toEqual({ ok: true });
    expect(updates[0]!.table).toBe(milestones);
    expect(updates[0]!.set).toMatchObject({
      title: "Glacier travel course",
      target_date: "2027-01-10",
    });
    expect(revalidated).toContain(`/goals/${GOAL_ID}`);
  });

  it("foreign/unknown milestone (zero rows) → calm failure, no revalidate", async () => {
    updateResult = [];
    const result = await updateMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID,
      title: "Glacier travel course",
      targetDate: "2027-01-10",
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(revalidated).toHaveLength(0);
  });
});

const MILESTONE_ROWS = [
  { id: MILESTONE_ID, position: 0 },
  { id: MILESTONE_ID_2, position: 1 },
  { id: MILESTONE_ID_3, position: 2 },
];

describe("moveMilestone — the swap-with-neighbor reorder", () => {
  it("middle moved up → two position updates swapping with the row above", async () => {
    selectQueue = [MILESTONE_ROWS.map((r) => ({ ...r }))];
    const result = await moveMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID_2,
      direction: "up",
    });
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(2);
    // The moved row takes its neighbor's position and vice versa.
    expect(updates[0]!.set.position).toBe(0);
    expect(updates[1]!.set.position).toBe(1);
  });

  it("boundary move (first up) → ok no-op, zero writes", async () => {
    selectQueue = [MILESTONE_ROWS.map((r) => ({ ...r }))];
    const result = await moveMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID,
      direction: "up",
    });
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(0);
  });

  it("unknown milestone id → calm failure, zero writes", async () => {
    selectQueue = [MILESTONE_ROWS.map((r) => ({ ...r }))];
    const result = await moveMilestone({
      goalId: GOAL_ID,
      milestoneId: EQUIPMENT_ID, // a valid uuid that is not in the list
      direction: "up",
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(updates).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });
});

describe("removeMilestone — exactly-one survives removal", () => {
  it("no linked equipment → deletes the milestone, touches nothing else", async () => {
    selectQueue = [
      [{ id: MILESTONE_ID, target_date: "2026-12-15" }], // the milestone
      [], // no linked equipment
    ];
    const result = await removeMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID,
    });
    expect(result).toEqual({ ok: true });
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.table).toBe(milestones);
    expect(updates).toHaveLength(0);
    expect(revalidated).toContain(`/goals/${GOAL_ID}`);
  });

  it("linked equipment inherits the milestone's date as its standalone deadline", async () => {
    selectQueue = [
      [{ id: MILESTONE_ID, target_date: "2026-12-15" }],
      [{ id: EQUIPMENT_ID }], // one linked item
    ];
    const result = await removeMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID,
    });
    expect(result).toEqual({ ok: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(equipment);
    // Re-home: derived deadline identical before and after — the exactly-one
    // invariant holds with no silent shift.
    expect(updates[0]!.set).toMatchObject({
      milestone_id: null,
      standalone_deadline: "2026-12-15",
    });
    expect(deletes).toHaveLength(1);
  });

  it("dateless milestone with linked equipment → blocked, zero writes", async () => {
    selectQueue = [
      [{ id: MILESTONE_ID, target_date: null }],
      [{ id: EQUIPMENT_ID }],
    ];
    const result = await removeMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID,
    });
    expect(result).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it("foreign/unknown milestone → calm failure, zero writes", async () => {
    selectQueue = [[]];
    const result = await removeMilestone({
      goalId: GOAL_ID,
      milestoneId: MILESTONE_ID,
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(updates).toHaveLength(0);
    expect(deletes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

describe("equipment actions — the exactly-one invariant", () => {
  it("addEquipment with BOTH milestone link and standalone date → rejected, zero writes", async () => {
    const result = await addEquipment({
      goalId: GOAL_ID,
      title: "Boots",
      costUsd: 450,
      milestoneId: MILESTONE_ID,
      standaloneDeadline: "2026-11-01",
    });
    expect(result).toEqual({
      ok: false,
      error: "Tie this to a milestone or set a date — one or the other.",
    });
    zeroDbCalls();
  });

  it("addEquipment with NEITHER → rejected, zero writes", async () => {
    const result = await addEquipment({
      goalId: GOAL_ID,
      title: "Boots",
      costUsd: null,
      milestoneId: null,
      standaloneDeadline: null,
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });

  it("updateEquipment violating exactly-one → rejected, zero writes", async () => {
    const result = await updateEquipment({
      goalId: GOAL_ID,
      equipmentId: EQUIPMENT_ID,
      title: "Boots",
      costUsd: null,
      milestoneId: MILESTONE_ID,
      standaloneDeadline: "2026-11-01",
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });
});

describe("addEquipment", () => {
  it("milestone-linked: verifies the milestone is in THIS goal, then inserts", async () => {
    selectQueue = [[{ id: MILESTONE_ID }]];
    const result = await addEquipment({
      goalId: GOAL_ID,
      title: "Boots",
      costUsd: 450.5,
      milestoneId: MILESTONE_ID,
      standaloneDeadline: null,
    });
    expect(result).toEqual({ ok: true, id: "new-row-id" });
    expect(inserts[0]!.table).toBe(equipment);
    expect(inserts[0]!.values).toMatchObject({
      goal_id: GOAL_ID,
      title: "Boots",
      cost_usd: "450.5",
      milestone_id: MILESTONE_ID,
      standalone_deadline: null,
    });
    expect(revalidated).toContain("/equipment");
  });

  it("milestone from another goal (scoped lookup empty) → failure, zero inserts", async () => {
    selectQueue = [[]];
    const result = await addEquipment({
      goalId: GOAL_ID,
      title: "Boots",
      costUsd: null,
      milestoneId: MILESTONE_ID,
      standaloneDeadline: null,
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(inserts).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it("standalone: inserts with the date and a null link (no lookup needed)", async () => {
    const result = await addEquipment({
      goalId: GOAL_ID,
      title: "Headlamp",
      costUsd: null,
      milestoneId: null,
      standaloneDeadline: "2026-11-01",
    });
    expect(result).toMatchObject({ ok: true });
    expect(inserts[0]!.values).toMatchObject({
      milestone_id: null,
      standalone_deadline: "2026-11-01",
      cost_usd: null,
    });
  });
});

describe("updateEquipment", () => {
  it("re-linking to a milestone clears the standalone date in the same write", async () => {
    selectQueue = [[{ id: MILESTONE_ID }]];
    const result = await updateEquipment({
      goalId: GOAL_ID,
      equipmentId: EQUIPMENT_ID,
      title: "Boots",
      costUsd: 450,
      milestoneId: MILESTONE_ID,
      standaloneDeadline: null,
    });
    expect(result).toEqual({ ok: true });
    expect(updates[0]!.table).toBe(equipment);
    expect(updates[0]!.set).toMatchObject({
      milestone_id: MILESTONE_ID,
      standalone_deadline: null,
      cost_usd: "450",
    });
  });

  it("foreign/unknown equipment row (zero rows) → calm failure, no revalidate", async () => {
    updateResult = [];
    const result = await updateEquipment({
      goalId: GOAL_ID,
      equipmentId: EQUIPMENT_ID,
      title: "Boots",
      costUsd: null,
      milestoneId: null,
      standaloneDeadline: "2026-11-01",
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(revalidated).toHaveLength(0);
  });
});

describe("removeEquipment — hard delete (nothing references equipment)", () => {
  it("deletes the row and revalidates", async () => {
    const result = await removeEquipment({
      goalId: GOAL_ID,
      equipmentId: EQUIPMENT_ID,
    });
    expect(result).toEqual({ ok: true });
    expect(deletes).toHaveLength(1);
    expect(deletes[0]!.table).toBe(equipment);
    expect(revalidated).toContain(`/goals/${GOAL_ID}`);
  });

  it("foreign/unknown row (zero rows deleted) → calm failure", async () => {
    deleteResult = [];
    const result = await removeEquipment({
      goalId: GOAL_ID,
      equipmentId: EQUIPMENT_ID,
    });
    expect(result).toEqual({ ok: false, error: "We couldn't find that item." });
    expect(revalidated).toHaveLength(0);
  });

  it("no auth → failure, no DB call", async () => {
    mockUserId = null;
    const result = await removeEquipment({
      goalId: GOAL_ID,
      equipmentId: EQUIPMENT_ID,
    });
    expect(result).toMatchObject({ ok: false });
    zeroDbCalls();
  });
});
