/**
 * scopedDb unit tests — covers the synchronous validation paths that fire
 * BEFORE any DB roundtrip. DB-dependent tests (cross-user reads, EXISTS
 * subquery semantics) need a live Neon branch and live in a separate
 * `.integration.test.ts` file added in Phase 1 when the test DB is wired up.
 *
 * The point of these tests: PLAN.md §4 explicitly trades RLS away on the
 * bet that scopedDb correctly injects user_id on every read/write. Every
 * one of these tests verifies one slice of that bet. A future refactor
 * that loosens the synchronous guards will fail loudly here instead of
 * shipping silently and being discovered by a bug report.
 */
// DATABASE_URL placeholder is set by vitest.setup.ts before any imports
// resolve. The synchronous tests below never actually call the DB.
import { describe, expect, it } from "vitest";
import { scopedDb, ScopedDbError } from "./scoped";
import {
  equipment,
  goals,
  intake_summaries,
  milestones,
  recurring_tasks,
  replan_proposals,
  task_completions,
} from "./schema";

describe("scopedDb — userId requirement", () => {
  it("throws on empty string", () => {
    expect(() => scopedDb("")).toThrow(ScopedDbError);
  });

  it("throws on undefined", () => {
    // @ts-expect-error — testing the runtime guard, not the type system.
    expect(() => scopedDb(undefined)).toThrow(ScopedDbError);
  });

  it("throws on null", () => {
    // @ts-expect-error — testing the runtime guard, not the type system.
    expect(() => scopedDb(null)).toThrow(ScopedDbError);
  });

  it("accepts a non-empty string", () => {
    expect(() => scopedDb("user_abc")).not.toThrow();
  });
});

describe("scopedDb.update — forbidden-keys (H1 fix)", () => {
  const sdb = scopedDb("user_A");

  it("rejects user_id in opts.set on direct-ownership table", async () => {
    await expect(
      sdb.update(goals, {
        set: { user_id: "user_VICTIM" } as never,
        where: undefined,
      }),
    ).rejects.toThrow(/forbidden key/i);
  });

  it("rejects id in opts.set", async () => {
    await expect(
      sdb.update(goals, {
        set: { id: "some-uuid" } as never,
      }),
    ).rejects.toThrow(/forbidden key/i);
  });

  it("rejects goal_id in opts.set on transitive table (re-parenting attack)", async () => {
    await expect(
      sdb.update(milestones, {
        set: { goal_id: "victim-goal-uuid" } as never,
      }),
    ).rejects.toThrow(/forbidden key/i);
  });

  it("rejects recurring_task_id in opts.set on task_completions", async () => {
    await expect(
      sdb.update(task_completions, {
        set: { recurring_task_id: "forged-task-uuid" } as never,
      }),
    ).rejects.toThrow(/forbidden key/i);
  });

  it("rejects user_id in opts.set on replan_proposals (denormalized column)", async () => {
    await expect(
      sdb.update(replan_proposals, {
        set: { user_id: "user_VICTIM" } as never,
      }),
    ).rejects.toThrow(/forbidden key/i);
  });
});

describe("scopedDb.insert — synchronous validation", () => {
  const sdb = scopedDb("user_A");

  it("rejects mismatched user_id on direct-ownership insert", async () => {
    await expect(
      sdb.insert(goals, {
        user_id: "user_VICTIM",
        color_index: 0,
        title: "evil",
      } as never),
    ).rejects.toThrow(/does not match scoped userId/i);
  });

  it("rejects transitive insert without goal_id", async () => {
    await expect(
      sdb.insert(milestones, { title: "no parent" } as never),
    ).rejects.toThrow(/goal_id/i);
  });

  it("rejects task_completions insert without recurring_task_id", async () => {
    await expect(
      sdb.insert(task_completions, {
        goal_id: "some-goal",
        user_id: "user_A",
        for_date: "2026-01-01",
      } as never),
    ).rejects.toThrow(/recurring_task_id/i);
  });

  // goal_id on task_completions is now DERIVED from the recurring task's
  // parent inside the atomic INSERT…SELECT (a supplied value is validated
  // in-SQL; mismatch inserts zero rows → throws). The omitted-goal_id and
  // mismatched-goal_id paths are DB-dependent and covered by
  // scripts/smoke-scoped-db.ts against a live branch.

  it("rejects unknown column keys in insert payloads", async () => {
    await expect(
      sdb.insert(goals, {
        user_id: "user_A",
        title: "x",
        color_index: 0,
        not_a_real_column: 1,
      } as never),
    ).rejects.toThrow(/unknown column/i);
  });

  it("rejects mismatched user_id on replan_proposals transitive insert", async () => {
    await expect(
      sdb.insert(replan_proposals, {
        goal_id: "some-goal",
        user_id: "user_VICTIM",
        trigger: "structural_edit",
        proposed_changes: {},
      } as never),
    ).rejects.toThrow(/does not match scoped userId/i);
  });
});

describe("scopedDb.updateSelf — forbidden keys", () => {
  const sdb = scopedDb("user_A");

  it("rejects tier in the self-update payload", async () => {
    await expect(
      sdb.updateSelf({ tier: "max" } as never),
    ).rejects.toThrow(/forbidden key/i);
  });

  it("rejects deleted_at in the self-update payload", async () => {
    await expect(
      sdb.updateSelf({ deleted_at: null } as never),
    ).rejects.toThrow(/forbidden key/i);
  });

  it("rejects email and stripe_customer_id in the self-update payload", async () => {
    await expect(
      sdb.updateSelf({ email: "evil@x.test" } as never),
    ).rejects.toThrow(/forbidden key/i);
    await expect(
      sdb.updateSelf({ stripe_customer_id: "cus_evil" } as never),
    ).rejects.toThrow(/forbidden key/i);
  });
});

describe("scopedDb — table classification", () => {
  // The classification maps are private, but we can verify their effects:
  // a transitive-ownership insert path requires goal_id, a direct-ownership
  // insert path doesn't. If a table ever gets misclassified, one of these
  // tests will surface the regression.
  const sdb = scopedDb("user_A");

  it("treats intake_summaries as transitive (requires goal_id)", async () => {
    await expect(
      sdb.insert(intake_summaries, {
        one_sentence_goal: "x",
        starting_point: "y",
        confirmed_intensity: "challenging",
        activity_type: "running",
        raw_transcript: [],
      } as never),
    ).rejects.toThrow(/goal_id/i);
  });

  it("treats recurring_tasks as transitive (requires goal_id)", async () => {
    await expect(
      sdb.insert(recurring_tasks, {
        title: "x",
        cadence: "daily",
      } as never),
    ).rejects.toThrow(/goal_id/i);
  });

  it("treats equipment as transitive (requires goal_id)", async () => {
    await expect(
      sdb.insert(equipment, { title: "x" } as never),
    ).rejects.toThrow(/goal_id/i);
  });
});
