/**
 * resetMonthlyUsageCounters tests (S1 — the real local-midnight-window reset).
 *
 * The timezone SQL (`now() AT TIME ZONE u.timezone`, `date_trunc`) can only be
 * proven against a real Postgres — that lives in the env-gated
 * reset-monthly-usage-counters.integration.test.ts. Here we pin the
 * ORCHESTRATION against a mock db: due users get a create; the create is
 * idempotent (ON CONFLICT DO NOTHING → 0 returned rows aren't counted); an
 * empty due-set writes nothing; and the function id/schedule are stable.
 */
import { describe, expect, it, vi } from "vitest";
import {
  resetDueMonthlyUsageCounters,
  resetMonthlyUsageCounters,
} from "./reset-monthly-usage-counters";

type DueRow = { userId: string; periodStart: string; periodEnd: string };
type ResetDb = Parameters<typeof resetDueMonthlyUsageCounters>[0];

/** A drizzle-shaped mock: select().from().where() resolves the due rows;
 *  insert().values().onConflictDoNothing().returning() resolves `inserted`. */
function mockDb(
  due: DueRow[],
  inserted: (row: DueRow) => Array<{ id: string }>,
) {
  const insertValues: DueRow[] = [];
  const db = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(due),
      }),
    }),
    insert: () => ({
      values: (v: {
        user_id: string;
        period_start: string;
        period_end: string;
      }) => {
        const row = due.find((d) => d.userId === v.user_id)!;
        insertValues.push(row);
        return {
          onConflictDoNothing: () => ({
            returning: () => Promise.resolve(inserted(row)),
          }),
        };
      },
    }),
  };
  return { db, insertValues };
}

describe("resetDueMonthlyUsageCounters — orchestration", () => {
  it("creates a row for each due user and counts the creates", async () => {
    const due: DueRow[] = [
      { userId: "u1", periodStart: "2026-07-01", periodEnd: "2026-07-31" },
      { userId: "u2", periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    ];
    const { db, insertValues } = mockDb(due, (r) => [{ id: `c-${r.userId}` }]);

    const result = await resetDueMonthlyUsageCounters(db as unknown as ResetDb);

    expect(result.resetCount).toBe(2);
    expect(insertValues.map((r) => r.userId)).toEqual(["u1", "u2"]);
  });

  it("is idempotent — a conflict (0 returned rows) is not counted", async () => {
    const due: DueRow[] = [
      { userId: "u1", periodStart: "2026-07-01", periodEnd: "2026-07-31" },
    ];
    // ON CONFLICT DO NOTHING → the row already existed → returning() is empty.
    const { db } = mockDb(due, () => []);

    const result = await resetDueMonthlyUsageCounters(db as unknown as ResetDb);

    expect(result.resetCount).toBe(0);
  });

  it("writes nothing when no user is at a local-month boundary", async () => {
    const insertSpy = vi.fn();
    const db = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([]) }) }),
      insert: insertSpy,
    };

    const result = await resetDueMonthlyUsageCounters(db as unknown as ResetDb);

    expect(result.resetCount).toBe(0);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("resetMonthlyUsageCounters — registration", () => {
  it("is registered under the contract id", () => {
    expect(resetMonthlyUsageCounters.id()).toBe("reset-monthly-usage-counters");
  });
});
