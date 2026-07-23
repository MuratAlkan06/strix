/**
 * usage.ts tests — the Free-tier quota gate (Phase-3 slice S1, issue #96).
 *
 * checkAndIncrement / refundUsage are single conditional UPDATEs whose atomic
 * guards (`col < limit`, `col > 0`, `validation_refunds_used < LIMIT`) only the
 * real Postgres row-lock can prove serialize correctly — that lives in
 * usage.integration.test.ts (env-gated, N-concurrent). Here we prove the two
 * complementary halves against an in-memory fake of usage_counters:
 *
 *   1. STRUCTURE — the exact SET expressions and WHERE guards each statement
 *      emits are compiled to SQL and pinned (a dropped `validation_refunds_used
 *      < LIMIT` guard, or a split into two statements, fails loudly here).
 *   2. BEHAVIOR — a stateful fake applies those same guards to an in-memory row
 *      so the pool arithmetic (grant 1..3 then deny, shared across kinds, floor
 *      at 0, per-period reset, midnight-straddle targeting) is observable end
 *      to end. The fake reads the guard threshold from VALIDATION_REFUND_LIMIT,
 *      never a magic number, so it tracks the source of truth.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

import { VALIDATION_REFUND_LIMIT } from "@/lib/billing/usage-limits";

// ---------------------------------------------------------------------------
// In-memory fake of the scoped usage_counters surface.
// ---------------------------------------------------------------------------

interface CounterRow {
  period_start: string;
  plan_generations_used: number;
  replans_used: number;
  validation_refunds_used: number;
}

interface FakeState {
  self: { tier: "free" | "pro" | "max"; timezone: string | null } | null;
  rows: Map<string, CounterRow>;
  scopedDbCalls: number;
  updateCalls: Array<{ set: Record<string, unknown>; where: unknown }>;
  insertCalls: number;
  /** When set, the next update throws it (proving refundUsage swallows). */
  updateThrows: unknown;
}

let state: FakeState;
const pg = new PgDialect();

/** Compile a drizzle SQL/where fragment into inspectable text + params. */
function compile(fragment: unknown): { sql: string; params: unknown[] } {
  const q = pg.sqlToQuery(fragment as SQL);
  return { sql: q.sql, params: q.params };
}

/** A 23505-shaped error so ensureCurrentMonthCounter's catch treats a repeat
 *  insert as get-or-create (mirrors the driver's unique-violation code). */
function uniqueViolation(): Error {
  return Object.assign(new Error("duplicate key"), { code: "23505" });
}

function makeFakeScopedDb(userId: string) {
  void userId;
  state.scopedDbCalls += 1;
  return {
    userId,
    getSelf: async () => state.self,
    insert: async (
      _table: unknown,
      values: { period_start: string },
    ): Promise<unknown[]> => {
      state.insertCalls += 1;
      if (state.rows.has(values.period_start)) throw uniqueViolation();
      state.rows.set(values.period_start, {
        period_start: values.period_start,
        plan_generations_used: 0,
        replans_used: 0,
        validation_refunds_used: 0,
      });
      return [{}];
    },
    selectFrom: async (
      _table: unknown,
      opts: { where: unknown },
    ): Promise<CounterRow[]> => {
      const period = String(compile(opts.where).params[0]);
      const row = state.rows.get(period);
      return row ? [{ ...row }] : [];
    },
    update: async (
      _table: unknown,
      opts: { set: Record<string, unknown>; where: unknown },
    ): Promise<CounterRow[]> => {
      if (state.updateThrows !== undefined) throw state.updateThrows;
      state.updateCalls.push({ set: opts.set, where: opts.where });

      const whereQ = compile(opts.where);
      const period = String(whereQ.params[0]);
      const row = state.rows.get(period);
      if (!row) return []; // no row for this period ⇒ 0 rows (floor no-op)

      const keys = Object.keys(opts.set);
      const counterKey = keys.find(
        (k) => k !== "validation_refunds_used",
      ) as "plan_generations_used" | "replans_used";
      const isValidationLimited = keys.includes("validation_refunds_used");
      const counterExpr = compile(opts.set[counterKey]).sql;
      const isIncrement = counterExpr.includes(" + 1");

      if (isIncrement) {
        // checkAndIncrement: `col < limit` — limit is the last where param.
        const limit = Number(whereQ.params[whereQ.params.length - 1]);
        if (row[counterKey] < limit) {
          row[counterKey] += 1;
          return [{ ...row }];
        }
        return [];
      }

      // Decrement (refund). Floor at 0; validation_limited also consumes one
      // shared grant, gated on validation_refunds_used < LIMIT — ONE statement.
      if (isValidationLimited) {
        if (
          row[counterKey] > 0 &&
          row.validation_refunds_used < VALIDATION_REFUND_LIMIT
        ) {
          row[counterKey] -= 1;
          row.validation_refunds_used += 1;
          return [{ ...row }];
        }
        return [];
      }

      if (row[counterKey] > 0) {
        row[counterKey] -= 1;
        return [{ ...row }];
      }
      return [];
    },
  };
}

vi.mock("@/db/scoped", () => ({
  scopedDb: (userId: string) => makeFakeScopedDb(userId),
}));

// Imports under test — after the mock.
import {
  checkAndIncrement,
  refundUsage,
  NoLiveUserError,
} from "./usage";

function seed(period: string, over: Partial<Omit<CounterRow, "period_start">> = {}) {
  state.rows.set(period, {
    period_start: period,
    plan_generations_used: 0,
    replans_used: 0,
    validation_refunds_used: 0,
    ...over,
  });
}

beforeEach(() => {
  state = {
    self: { tier: "free", timezone: "UTC" },
    rows: new Map(),
    scopedDbCalls: 0,
    updateCalls: [],
    insertCalls: 0,
    updateThrows: undefined,
  };
});

// ---------------------------------------------------------------------------
// checkAndIncrement — Free limits + Pro/Max pass-through + soft-delete.
// ---------------------------------------------------------------------------

describe("checkAndIncrement", () => {
  it("Free plan: 3 succeed, the 4th is capped with used=3", async () => {
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await checkAndIncrement("u1", "plan"));
    }
    expect(results.slice(0, 3).every((r) => r.ok)).toBe(true);
    expect(results[3]).toEqual({ ok: false, cap: 3, used: 3 });
    // The lazily-created row now sits exactly at the cap.
    const only = [...state.rows.values()][0]!;
    expect(only.plan_generations_used).toBe(3);
  });

  it("Free replan: 2 succeed, the 3rd is capped with used=2", async () => {
    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await checkAndIncrement("u1", "replan"));
    }
    expect(results.slice(0, 2).every((r) => r.ok)).toBe(true);
    expect(results[2]).toEqual({ ok: false, cap: 2, used: 2 });
  });

  it("returns the CAPTURED periodStart on success", async () => {
    const r = await checkAndIncrement("u1", "plan");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.periodStart).not.toBe("");
  });

  it("Pro passes through uncapped with the empty periodStart sentinel — zero DB writes", async () => {
    state.self = { tier: "pro", timezone: "UTC" };
    const r = await checkAndIncrement("u1", "plan");
    expect(r).toEqual({ ok: true, periodStart: "" });
    expect(state.insertCalls).toBe(0);
    expect(state.updateCalls).toHaveLength(0);
  });

  it("Max passes through uncapped with the empty periodStart sentinel", async () => {
    state.self = { tier: "max", timezone: "UTC" };
    const r = await checkAndIncrement("u1", "replan");
    expect(r).toEqual({ ok: true, periodStart: "" });
    expect(state.updateCalls).toHaveLength(0);
  });

  it("throws NoLiveUserError when the session no longer maps to a live user", async () => {
    state.self = null;
    await expect(checkAndIncrement("gone", "plan")).rejects.toBeInstanceOf(
      NoLiveUserError,
    );
  });

  it("emits a single atomic increment: SET col+1 WHERE period_start=$p AND col<limit", async () => {
    await checkAndIncrement("u1", "plan");
    expect(state.updateCalls).toHaveLength(1);
    const { set, where } = state.updateCalls[0]!;
    expect(compile(set.plan_generations_used).sql).toMatch(/\+ 1/);
    const w = compile(where);
    expect(w.sql).toMatch(/"period_start"\s*=/);
    expect(w.sql).toMatch(/"plan_generations_used"\s*</);
    expect(w.params).toEqual([expect.any(String), 3]); // [periodStart, limit]
  });
});

// ---------------------------------------------------------------------------
// refundUsage — unconditional mode.
// ---------------------------------------------------------------------------

describe("refundUsage — unconditional", () => {
  it("decrements the captured period and never touches the shared pool", async () => {
    seed("2026-07-01", { plan_generations_used: 2, validation_refunds_used: 1 });
    const r = await refundUsage("u1", "plan", "2026-07-01", "unconditional");
    expect(r).toEqual({ refunded: true });
    const row = state.rows.get("2026-07-01")!;
    expect(row.plan_generations_used).toBe(1);
    expect(row.validation_refunds_used).toBe(1); // pool untouched
  });

  it("floors at 0: a double refund is a no-op, never negative", async () => {
    seed("2026-07-01", { plan_generations_used: 1 });
    expect(await refundUsage("u1", "plan", "2026-07-01", "unconditional")).toEqual(
      { refunded: true },
    );
    expect(await refundUsage("u1", "plan", "2026-07-01", "unconditional")).toEqual(
      { refunded: false, reason: "floor" },
    );
    expect(state.rows.get("2026-07-01")!.plan_generations_used).toBe(0);
  });

  it("midnight straddle: refunds the CAPTURED period, leaving the new month's row alone", async () => {
    seed("2026-06-01", { plan_generations_used: 1 });
    seed("2026-07-01", { plan_generations_used: 0 });
    await refundUsage("u1", "plan", "2026-06-01", "unconditional");
    expect(state.rows.get("2026-06-01")!.plan_generations_used).toBe(0);
    expect(state.rows.get("2026-07-01")!.plan_generations_used).toBe(0);
  });

  it("Pro/Max short-circuit: an empty periodStart is not_metered with ZERO DB access", async () => {
    const r = await refundUsage("u1", "plan", "", "unconditional");
    expect(r).toEqual({ refunded: false, reason: "not_metered" });
    expect(state.scopedDbCalls).toBe(0); // never even constructed the scoped db
  });

  it("soft-deleted user (scoped filter yields 0 rows) → floor no-op, never throws", async () => {
    // No seeded row for this period ⇒ the scoped UPDATE matches 0 rows.
    const r = await refundUsage("deleted", "plan", "2026-07-01", "unconditional");
    expect(r).toEqual({ refunded: false, reason: "floor" });
  });

  it("never throws: a DB error is swallowed into reason:'error'", async () => {
    seed("2026-07-01", { plan_generations_used: 1 });
    state.updateThrows = new Error("connection reset");
    const r = await refundUsage("u1", "plan", "2026-07-01", "unconditional");
    expect(r).toEqual({ refunded: false, reason: "error" });
  });
});

// ---------------------------------------------------------------------------
// refundUsage — validation_limited mode (D2: the shared per-period pool).
// ---------------------------------------------------------------------------

describe("refundUsage — validation_limited (Zod-failure pool)", () => {
  it("grants refunds 1..3, denies the 4th, and the increment stays consumed", async () => {
    seed("2026-07-01", { plan_generations_used: 5, validation_refunds_used: 0 });
    const outcomes = [];
    for (let i = 0; i < 4; i++) {
      outcomes.push(
        await refundUsage("u1", "plan", "2026-07-01", "validation_limited"),
      );
    }
    expect(outcomes).toEqual([
      { refunded: true },
      { refunded: true },
      { refunded: true },
      { refunded: false, reason: "rate_limited" },
    ]);
    const row = state.rows.get("2026-07-01")!;
    expect(row.plan_generations_used).toBe(2); // 5 - 3 grants; the 4th consumed
    expect(row.validation_refunds_used).toBe(3); // capped at the limit
  });

  it("the pool is SHARED across kinds: a plan refund consumes the grant a replan refund then can't get", async () => {
    // One grant left in the pool.
    seed("2026-07-01", {
      plan_generations_used: 1,
      replans_used: 1,
      validation_refunds_used: VALIDATION_REFUND_LIMIT - 1,
    });
    expect(
      await refundUsage("u1", "plan", "2026-07-01", "validation_limited"),
    ).toEqual({ refunded: true });
    expect(
      await refundUsage("u1", "replan", "2026-07-01", "validation_limited"),
    ).toEqual({ refunded: false, reason: "rate_limited" });
    const row = state.rows.get("2026-07-01")!;
    expect(row.plan_generations_used).toBe(0);
    expect(row.replans_used).toBe(1); // the denied replan refund stayed consumed
    expect(row.validation_refunds_used).toBe(VALIDATION_REFUND_LIMIT);
  });

  it("a new period resets the pool (row default) — a fresh month refunds again", async () => {
    seed("2026-06-01", {
      plan_generations_used: 1,
      validation_refunds_used: VALIDATION_REFUND_LIMIT, // June exhausted
    });
    seed("2026-07-01", { plan_generations_used: 1, validation_refunds_used: 0 });
    // June is exhausted…
    expect(
      await refundUsage("u1", "plan", "2026-06-01", "validation_limited"),
    ).toEqual({ refunded: false, reason: "rate_limited" });
    // …but July's pool is fresh.
    expect(
      await refundUsage("u1", "plan", "2026-07-01", "validation_limited"),
    ).toEqual({ refunded: true });
    expect(state.rows.get("2026-07-01")!.validation_refunds_used).toBe(1);
  });

  it("floor interplay: col already 0 → 0 rows → rate_limited, and the pool is NOT consumed", async () => {
    seed("2026-07-01", { plan_generations_used: 0, validation_refunds_used: 0 });
    const r = await refundUsage("u1", "plan", "2026-07-01", "validation_limited");
    expect(r).toEqual({ refunded: false, reason: "rate_limited" });
    // The atomic statement matched 0 rows, so validation_refunds_used stayed 0.
    expect(state.rows.get("2026-07-01")!.validation_refunds_used).toBe(0);
  });

  it("atomicity pin: ONE UPDATE sets BOTH counters and guards on all three predicates", async () => {
    seed("2026-07-01", { replans_used: 1, validation_refunds_used: 0 });
    await refundUsage("u1", "replan", "2026-07-01", "validation_limited");
    expect(state.updateCalls).toHaveLength(1); // one statement, not two
    const { set, where } = state.updateCalls[0]!;
    // SET decrements the kind's counter AND increments the shared pool.
    expect(compile(set.replans_used).sql).toMatch(/- 1/);
    expect(compile(set.validation_refunds_used).sql).toMatch(/\+ 1/);
    // WHERE guards on period, the counter floor, AND the pool ceiling.
    const w = compile(where);
    expect(w.sql).toMatch(/"period_start"\s*=/);
    expect(w.sql).toMatch(/"replans_used"\s*>\s*0/);
    expect(w.sql).toMatch(/"validation_refunds_used"\s*</);
    expect(w.params).toEqual(["2026-07-01", VALIDATION_REFUND_LIMIT]);
  });
});
