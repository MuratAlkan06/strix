/**
 * INTEGRATION TEST — scopedDb live-DB proofs (env-gated; real Postgres).
 *
 * Completes the deferral noted in scoped.test.ts: the synchronous unit tests
 * cannot verify that the EXISTS subqueries and the atomic INSERT … SELECT
 * actually scope correctly when executed by Postgres. These tests do, against
 * the database in DATABASE_URL (phase-1-golden-path "Automated (Vitest)"
 * items: cross-user isolation, the task_completions unique constraint, and
 * forged/derived goal_id on check-off).
 *
 * Skips cleanly when DATABASE_URL is unset (vitest.setup.ts fills in a
 * placeholder URL, which counts as unset here), so the default
 * `pnpm test:run` is unaffected — same gating posture as
 * caching.integration.test.ts. Run locally with .env.local loaded:
 *
 *   set -a; source .env.local; set +a; pnpm vitest run src/db/scoped.integration.test.ts
 *
 * Fixture lifecycle (smoke-scoped-db.ts conventions): self-contained seed of
 * two users + goals + a recurring task under unique-suffixed IDs, and
 * GUARANTEED cleanup in afterAll — which also asserts zero residue, so a
 * leaky run fails loudly instead of littering the dev DB.
 *
 * unscopedDb is used for fixture lifecycle ONLY (creating/deleting users is
 * outside scopedDb's surface by design) and for neutral row-count
 * verification. Every assertion about scoping behavior goes through scopedDb.
 * This file is on the check-unscoped-db.mjs Layer 1 allowlist for exactly
 * that reason.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { scopedDb, ScopedDbError } from "./scoped";
import { unscopedDb } from "@/db/unscoped";
import {
  goal_drafts,
  goals,
  recurring_tasks,
  task_completions,
  users,
} from "./schema";
import { mintOrReuseDraft } from "@/app/(goals)/goals/new/bootstrap/single-flight";

// vitest.setup.ts assigns this placeholder when DATABASE_URL is unset; a
// placeholder DB is "no DB" for gating purposes.
const url = process.env.DATABASE_URL ?? "";
const hasRealDb = url.length > 0 && !url.includes("placeholder");
const run = hasRealDb ? describe : describe.skip;

// Unique-suffixed fixture IDs: parallel/aborted runs can never collide, and
// any residue is attributable to one specific run.
const SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const USER_A = `vitest-int-${SUFFIX}-user-A`;
const USER_B = `vitest-int-${SUFFIX}-user-B`;
const FIXTURE_USERS = [USER_A, USER_B];

let goalA = ""; // owned by A — parent of taskA
let goalA2 = ""; // owned by A — the "wrong parent" for the mismatch test
let goalB = ""; // owned by B
let taskA = ""; // recurring task under goalA

/** True for a Postgres unique-constraint violation (23505), wherever the
 *  driver/ORM left the code — mirrors check-task.ts's recognizer. */
function isUniqueViolation(err: unknown, depth = 0): boolean {
  if (depth > 3 || typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  if (
    typeof e.message === "string" &&
    e.message.includes("task_completions_task_for_date_uniq")
  ) {
    return true;
  }
  return isUniqueViolation(e.cause, depth + 1);
}

/** Delete every fixture row, children before parents (RESTRICT FKs).
 *  Idempotent — safe to run after a partial seed. */
async function cleanup() {
  await unscopedDb
    .delete(goal_drafts)
    .where(inArray(goal_drafts.user_id, FIXTURE_USERS));
  await unscopedDb
    .delete(task_completions)
    .where(inArray(task_completions.user_id, FIXTURE_USERS));
  await unscopedDb.delete(recurring_tasks).where(
    inArray(
      recurring_tasks.goal_id,
      unscopedDb
        .select({ id: goals.id })
        .from(goals)
        .where(inArray(goals.user_id, FIXTURE_USERS)),
    ),
  );
  await unscopedDb.delete(goals).where(inArray(goals.user_id, FIXTURE_USERS));
  await unscopedDb.delete(users).where(inArray(users.id, FIXTURE_USERS));
}

run("scopedDb (integration, live DB)", () => {
  beforeAll(async () => {
    const userRows = await unscopedDb
      .insert(users)
      .values([
        { id: USER_A, email: `${USER_A}@vitest-int.invalid`, timezone: "UTC" },
        { id: USER_B, email: `${USER_B}@vitest-int.invalid`, timezone: "UTC" },
      ])
      .returning({ id: users.id });
    expect(userRows).toHaveLength(2);

    const goalRows = await unscopedDb
      .insert(goals)
      .values([
        { user_id: USER_A, title: `vitest-int ${SUFFIX} goal A`, color_index: 0 },
        { user_id: USER_A, title: `vitest-int ${SUFFIX} goal A2`, color_index: 1 },
        { user_id: USER_B, title: `vitest-int ${SUFFIX} goal B`, color_index: 0 },
      ])
      .returning({ id: goals.id, user_id: goals.user_id, title: goals.title });
    goalA = goalRows.find((r) => r.title.endsWith("goal A"))!.id;
    goalA2 = goalRows.find((r) => r.title.endsWith("goal A2"))!.id;
    goalB = goalRows.find((r) => r.user_id === USER_B)!.id;

    const taskRows = await unscopedDb
      .insert(recurring_tasks)
      .values([{ goal_id: goalA, title: "vitest-int task", cadence: "daily" }])
      .returning({ id: recurring_tasks.id });
    taskA = taskRows[0]!.id;
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    // Residue proof: the dev DB must hold ZERO fixture rows after this file,
    // pass or fail. (cleanup() above runs even when a test failed.)
    const residue = {
      drafts: await unscopedDb
        .select({ id: goal_drafts.id })
        .from(goal_drafts)
        .where(inArray(goal_drafts.user_id, FIXTURE_USERS)),
      users: await unscopedDb
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, FIXTURE_USERS)),
      goals: await unscopedDb
        .select({ id: goals.id })
        .from(goals)
        .where(inArray(goals.user_id, FIXTURE_USERS)),
      completions: await unscopedDb
        .select({ id: task_completions.id })
        .from(task_completions)
        .where(inArray(task_completions.user_id, FIXTURE_USERS)),
      tasks: taskA
        ? await unscopedDb
            .select({ id: recurring_tasks.id })
            .from(recurring_tasks)
            .where(eq(recurring_tasks.id, taskA))
        : [],
    };
    expect(residue).toEqual({
      drafts: [],
      users: [],
      goals: [],
      completions: [],
      tasks: [],
    });
  }, 60_000);

  // -------------------------------------------------------------------------
  // Phase-doc item: "scopedDb queries cannot return another user's goals"
  // (seeded fixture with two users).
  // -------------------------------------------------------------------------
  describe("cross-user isolation", () => {
    it("user A's selectFrom(goals) returns exactly A's goals — B's goal is invisible", async () => {
      const rows = await scopedDb(USER_A).selectFrom(goals);
      expect(rows.map((g) => g.id).sort()).toEqual([goalA, goalA2].sort());
      expect(rows.every((g) => g.user_id === USER_A)).toBe(true);
      expect(rows.some((g) => g.id === goalB)).toBe(false);
    }, 30_000);

    it("user B cannot read A's goal even by naming its id in a where clause", async () => {
      const rows = await scopedDb(USER_B).selectFrom(goals, {
        where: eq(goals.id, goalA),
      });
      expect(rows).toEqual([]);
    }, 30_000);

    it("transitive scope: B's selectFrom(recurring_tasks) cannot see tasks under A's goal", async () => {
      const asB = await scopedDb(USER_B).selectFrom(recurring_tasks);
      expect(asB).toEqual([]);
      const asA = await scopedDb(USER_A).selectFrom(recurring_tasks);
      expect(asA.map((t) => t.id)).toEqual([taskA]);
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Phase-doc item: "task_completions unique constraint rejects
  // double-completion" — at the DB level, not just the 23505 handler.
  // -------------------------------------------------------------------------
  describe("task_completions unique constraint", () => {
    it("the DB-level unique (recurring_task_id, for_date) rejects a double-completion with 23505", async () => {
      const sdbA = scopedDb(USER_A);
      const payload = {
        recurring_task_id: taskA,
        for_date: "2026-06-01",
      } as typeof task_completions.$inferInsert;

      const first = await sdbA.insert(task_completions, payload);
      expect(first).toHaveLength(1);

      let thrown: unknown = null;
      try {
        await sdbA.insert(task_completions, payload);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).not.toBeNull();
      expect(isUniqueViolation(thrown)).toBe(true);

      // Exactly one row exists — the constraint, not the app, held the line.
      const stored = await unscopedDb
        .select({ id: task_completions.id })
        .from(task_completions)
        .where(
          and(
            eq(task_completions.recurring_task_id, taskA),
            eq(task_completions.for_date, "2026-06-01"),
          ),
        );
      expect(stored).toHaveLength(1);
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Phase-doc item: "forged recurring_task_id → atomic insert lands zero rows
  // → throws; stored goal_id always equals the task's parent goal (derived,
  // not trusted)."
  // -------------------------------------------------------------------------
  describe("task_completions ownership + derived goal_id", () => {
    it("forged recurring_task_id: the atomic INSERT…SELECT lands zero rows and throws", async () => {
      let thrown: unknown = null;
      try {
        // User B attempts a completion against A's task.
        await scopedDb(USER_B).insert(task_completions, {
          recurring_task_id: taskA,
          for_date: "2026-06-03",
        } as typeof task_completions.$inferInsert);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ScopedDbError);

      const stored = await unscopedDb
        .select({ id: task_completions.id })
        .from(task_completions)
        .where(
          and(
            eq(task_completions.recurring_task_id, taskA),
            eq(task_completions.for_date, "2026-06-03"),
          ),
        );
      expect(stored).toEqual([]);
    }, 30_000);

    it("stored goal_id is derived from the task's parent goal, not supplied by the caller", async () => {
      const rows = await scopedDb(USER_A).insert(task_completions, {
        recurring_task_id: taskA,
        for_date: "2026-06-02",
      } as typeof task_completions.$inferInsert);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.goal_id).toBe(goalA);
      expect(rows[0]!.user_id).toBe(USER_A);

      const stored = await unscopedDb
        .select({ goal_id: task_completions.goal_id })
        .from(task_completions)
        .where(
          and(
            eq(task_completions.recurring_task_id, taskA),
            eq(task_completions.for_date, "2026-06-02"),
          ),
        );
      expect(stored).toEqual([{ goal_id: goalA }]);
    }, 30_000);

    it("a caller-supplied goal_id that disagrees with the task's parent inserts zero rows and throws", async () => {
      let thrown: unknown = null;
      try {
        // A's own task, A's own OTHER goal — still a mismatch, still rejected.
        await scopedDb(USER_A).insert(task_completions, {
          recurring_task_id: taskA,
          goal_id: goalA2,
          for_date: "2026-06-04",
        } as typeof task_completions.$inferInsert);
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(ScopedDbError);

      const stored = await unscopedDb
        .select({ id: task_completions.id })
        .from(task_completions)
        .where(eq(task_completions.for_date, "2026-06-04"));
      expect(stored).toEqual([]);
    }, 30_000);
  });

  // -------------------------------------------------------------------------
  // Gate re-verification fix: bootstrap single-flight. Two PARALLEL mints for
  // the same user+seed (the tile-click double-request) must serialize on the
  // per-user advisory xact lock (ScopedTx.lockScope) and land exactly ONE
  // goal_drafts row — the loser reuses the winner's token. Two separate
  // websocket transactions genuinely contend on the Postgres lock here.
  // -------------------------------------------------------------------------
  describe("goal_drafts bootstrap single-flight (advisory xact lock)", () => {
    it("two parallel mints land exactly one row and agree on the token", async () => {
      const [tokenA, tokenB] = await Promise.all([
        mintOrReuseDraft(scopedDb(USER_A), "climb"),
        mintOrReuseDraft(scopedDb(USER_A), "climb"),
      ]);
      expect(tokenA).toBe(tokenB);

      const rows = await unscopedDb
        .select({ token: goal_drafts.session_token, seed: goal_drafts.seed })
        .from(goal_drafts)
        .where(inArray(goal_drafts.user_id, [USER_A]));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.token).toBe(tokenA);
      expect(rows[0]!.seed).toBe("climb");
    }, 60_000);

    it("a different seed is not reused — it mints its own row", async () => {
      const token = await mintOrReuseDraft(scopedDb(USER_A), "language");
      const existing = await unscopedDb
        .select({ token: goal_drafts.session_token })
        .from(goal_drafts)
        .where(inArray(goal_drafts.user_id, [USER_A]));
      expect(existing).toHaveLength(2);
      expect(existing.map((r) => r.token)).toContain(token);
    }, 30_000);
  });

});
