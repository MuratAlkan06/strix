/**
 * archiveDueGoals unit tests (the sweep-expired-goal-drafts posture: no live
 * DB; the mock client records the chain and the test compiles the captured
 * clauses with drizzle's Postgres dialect).
 *
 * The job's load-bearing guarantees are properties of one UPDATE:
 *   - only status='completed' rows match (active never touched; archived
 *     rows no longer match → idempotent re-runs by construction);
 *   - only rows whose auto_archive_at has passed, cutoff evaluated IN the
 *     database by default (now() — no worker/DB clock skew), with a Date
 *     seam for the phase-doc manual-run verification;
 *   - goals whose owner is soft-deleted (users.deleted_at set) are excluded
 *     via NOT EXISTS.
 * The full INSERT/UPDATE round-trip against live Postgres — including the
 * idempotent re-run and the soft-deleted-owner fixture — is covered by
 * archive-completed-goals.integration.test.ts (env-gated).
 */
import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { archiveDueGoals } from "./archive-completed-goals";
import { goals } from "@/db/schema";

const dialect = new PgDialect();

/**
 * Minimal stand-in for the drizzle update chain:
 *   db.update(table).set(values).where(clause).returning(cols) -> rows
 */
function mockDb(returnedRows: Array<{ id: string }>) {
  const calls: {
    table?: unknown;
    set?: Record<string, unknown>;
    where?: SQL;
  } = {};
  const counts = { update: 0, set: 0, where: 0 };
  const chain = {
    set(values: Record<string, unknown>) {
      counts.set += 1;
      calls.set = values;
      return chain;
    },
    where(clause: SQL) {
      counts.where += 1;
      calls.where = clause;
      return chain;
    },
    returning() {
      return Promise.resolve(returnedRows);
    },
  };
  const db = {
    update(table: unknown) {
      counts.update += 1;
      calls.table = table;
      return chain;
    },
  };
  return { db: db as never, calls, counts };
}

describe("archiveDueGoals", () => {
  it("updates the goals table, exactly once", async () => {
    const { db, calls, counts } = mockDb([]);
    await archiveDueGoals(db);
    expect(calls.table).toBe(goals);
    expect(counts).toEqual({ update: 1, set: 1, where: 1 });
  });

  it("sets status='archived' + archived_at, nothing else", async () => {
    const { db, calls } = mockDb([]);
    await archiveDueGoals(db);
    expect(Object.keys(calls.set!).sort()).toEqual(["archived_at", "status"]);
    expect(calls.set!.status).toBe("archived");
    // Default: archived_at is the DB's now(), not a worker timestamp.
    const archivedAt = dialect.sqlToQuery(calls.set!.archived_at as SQL);
    expect(archivedAt.sql).toBe("now()");
  });

  it("WHERE = completed AND auto_archive_at <= now() AND owner not soft-deleted", async () => {
    const { db, calls } = mockDb([]);
    await archiveDueGoals(db);
    const { sql, params } = dialect.sqlToQuery(calls.where!);
    // The exact predicate: archives ONLY completed goals already past their
    // auto_archive_at (DB-evaluated cutoff), never active goals (status
    // mismatch), never twice (archived rows no longer match), and never a
    // soft-deleted owner's goals.
    expect(sql).toBe(
      '("goals"."status" = $1 and "goals"."auto_archive_at" <= now() and ' +
        'not exists (select 1 from "users" where "users"."id" = "goals"."user_id" ' +
        'and "users"."deleted_at" is not null))',
    );
    expect(params).toEqual(["completed"]);
  });

  it("the now-seam replaces BOTH the cutoff and archived_at (phase-doc manual run)", async () => {
    const { db, calls } = mockDb([]);
    const frozen = new Date("2026-06-18T03:00:01.000Z");
    await archiveDueGoals(db, frozen);
    expect(calls.set!.archived_at).toBe(frozen);
    const { sql, params } = dialect.sqlToQuery(calls.where!);
    expect(sql).toContain('"goals"."auto_archive_at" <= $2');
    // The dialect maps the Date param to its ISO driver value.
    expect(params).toEqual(["completed", frozen.toISOString()]);
  });

  it("returns the number of rows archived", async () => {
    const { db } = mockDb([{ id: "a" }, { id: "b" }]);
    await expect(archiveDueGoals(db)).resolves.toBe(2);
  });

  it("returns 0 when nothing is due", async () => {
    const { db } = mockDb([]);
    await expect(archiveDueGoals(db)).resolves.toBe(0);
  });
});
