/**
 * sweepExpiredGoalDrafts unit tests.
 *
 * Same posture as src/db/scoped.test.ts: no live DB. The sweep's one load-
 * bearing guarantee — it deletes ONLY rows whose `expires_at` is in the past —
 * is a property of the WHERE clause, so these tests capture the clause the
 * function builds, compile it with drizzle's Postgres dialect, and assert the
 * exact predicate. The full INSERT…SELECT/DELETE round-trip against a real
 * branch is covered by the live-DB integration harness (a later slice).
 *
 * DATABASE_URL placeholder is set by vitest.setup.ts before any imports
 * resolve; the mock client below means no query ever leaves the process.
 */
import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { deleteExpiredGoalDrafts } from "./sweep-expired-goal-drafts";
import { goal_drafts } from "@/db/schema";

const dialect = new PgDialect();

/**
 * Minimal stand-in for the drizzle delete chain:
 *   db.delete(table).where(clause).returning(cols) -> rows
 * Records the table passed to delete() and the clause passed to where(),
 * and resolves returning() with the supplied fixture rows.
 */
function mockDb(returnedRows: Array<{ id: string }>) {
  const calls: { table?: unknown; where?: SQL } = {};
  const chain = {
    where(clause: SQL) {
      calls.where = clause;
      return chain;
    },
    returning() {
      return Promise.resolve(returnedRows);
    },
  };
  const db = {
    delete(table: unknown) {
      calls.table = table;
      return chain;
    },
  };
  return { db: db as never, calls };
}

describe("deleteExpiredGoalDrafts", () => {
  it("deletes from the goal_drafts table", async () => {
    const { db, calls } = mockDb([]);
    await deleteExpiredGoalDrafts(db);
    expect(calls.table).toBe(goal_drafts);
  });

  it("filters on expires_at < now() — only expired rows, cutoff in the DB", async () => {
    const { db, calls } = mockDb([]);
    await deleteExpiredGoalDrafts(db);
    expect(calls.where).toBeDefined();
    const { sql } = dialect.sqlToQuery(calls.where as SQL);
    // Exact predicate: never deletes a row whose expires_at is in the future,
    // and the cutoff is evaluated server-side (no worker/DB clock skew).
    expect(sql).toBe('"goal_drafts"."expires_at" < now()');
  });

  it("returns the number of rows swept", async () => {
    const { db } = mockDb([{ id: "a" }, { id: "b" }, { id: "c" }]);
    await expect(deleteExpiredGoalDrafts(db)).resolves.toBe(3);
  });

  it("returns 0 when nothing is expired", async () => {
    const { db } = mockDb([]);
    await expect(deleteExpiredGoalDrafts(db)).resolves.toBe(0);
  });

  it("issues exactly one delete and one where call", async () => {
    const deleteSpy = vi.fn();
    const whereSpy = vi.fn();
    const chain = {
      where(clause: SQL) {
        whereSpy(clause);
        return chain;
      },
      returning: () => Promise.resolve([]),
    };
    const db = {
      delete(table: unknown) {
        deleteSpy(table);
        return chain;
      },
    } as never;
    await deleteExpiredGoalDrafts(db);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(whereSpy).toHaveBeenCalledTimes(1);
  });
});
