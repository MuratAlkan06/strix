/**
 * INTEGRATION TEST — checkAndIncrement concurrency proofs (env-gated; real
 * Postgres). Phase-3 slice S1 (issue #96), §Verification 1 "atomic concurrent".
 *
 * The unit tests (usage.test.ts) prove the STATEMENT shapes and the pool
 * arithmetic against an in-memory fake; only a real Postgres can prove the
 * `WHERE … AND col < limit` conditional UPDATE actually SERIALIZES concurrent
 * callers on the row lock so no two requests both pass the check. These do,
 * against DATABASE_URL, with N genuinely-parallel Neon-HTTP requests:
 *
 *   - N=10 concurrent increments from used=0, limit=3 → EXACTLY 3 succeed
 *     (also exercises the get-or-create race: 10 concurrent
 *     ensureCurrentMonthCounter inserts, one wins, nine catch 23505).
 *   - N=4 concurrent from used=2, limit=3 → EXACTLY 1 succeeds (the last slot).
 *
 * Skips cleanly when DATABASE_URL is unset (vitest.setup.ts fills a placeholder
 * URL, which counts as "no DB"), so the default `pnpm test:run` is unaffected —
 * same gating posture as scoped.integration.test.ts. Run locally with
 * .env.local loaded:
 *
 *   set -a; source .env.local; set +a; \
 *     pnpm vitest run src/lib/billing/usage.integration.test.ts
 *
 * unscopedDb is used for fixture lifecycle ONLY (users cannot be created
 * through scopedDb by design) and for neutral row-count/seed verification; the
 * quota logic under test always runs through the real checkAndIncrement →
 * scopedDb path. This file is on the check-unscoped-db.mjs Layer 1 allowlist
 * for exactly that reason. GUARANTEED cleanup in afterAll asserts zero residue.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

import { unscopedDb } from "@/db/unscoped";
import { usage_counters, users } from "@/db/schema";
import { checkAndIncrement } from "./usage";
import { monthStartFor, monthEndFor } from "./period";

const url = process.env.DATABASE_URL ?? "";
const hasRealDb = url.length > 0 && !url.includes("placeholder");
const run = hasRealDb ? describe : describe.skip;

const SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const USER = `vitest-int-${SUFFIX}-usage`;
const TZ = "UTC";
const PERIOD_START = monthStartFor(TZ);
const PERIOD_END = monthEndFor(TZ);

/** Delete the fixture's counter rows so a test starts from a known state. */
async function clearCounters() {
  await unscopedDb
    .delete(usage_counters)
    .where(eq(usage_counters.user_id, USER));
}

/** Seed the current period's counter row at a specific plan count. */
async function seedPlanUsed(planUsed: number) {
  await clearCounters();
  await unscopedDb.insert(usage_counters).values({
    user_id: USER,
    period_start: PERIOD_START,
    period_end: PERIOD_END,
    plan_generations_used: planUsed,
  });
}

/** The stored plan counter for the current period (0 if the row is absent). */
async function storedPlanUsed(): Promise<number | null> {
  const rows = await unscopedDb
    .select({ used: usage_counters.plan_generations_used })
    .from(usage_counters)
    .where(
      and(
        eq(usage_counters.user_id, USER),
        eq(usage_counters.period_start, PERIOD_START),
      ),
    );
  return rows[0]?.used ?? null;
}

run("checkAndIncrement (integration, live DB) — atomic concurrency", () => {
  beforeAll(async () => {
    // tier defaults to 'free' — exactly the metered path we want to prove.
    const inserted = await unscopedDb
      .insert(users)
      .values({ id: USER, email: `${USER}@vitest-int.invalid`, timezone: TZ })
      .returning({ id: users.id, tier: users.tier });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]!.tier).toBe("free");
  }, 60_000);

  afterAll(async () => {
    await clearCounters();
    await unscopedDb.delete(users).where(inArray(users.id, [USER]));
    // Residue proof: zero fixture rows survive, pass or fail.
    const counters = await unscopedDb
      .select({ id: usage_counters.id })
      .from(usage_counters)
      .where(eq(usage_counters.user_id, USER));
    const userRows = await unscopedDb
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, USER));
    expect({ counters, userRows }).toEqual({ counters: [], userRows: [] });
  }, 60_000);

  it("N=10 concurrent from used=0 (limit 3) → EXACTLY 3 succeed", async () => {
    await clearCounters(); // no row: the concurrent creates race too

    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkAndIncrement(USER, "plan")),
    );

    const ok = results.filter((r) => r.ok);
    const capped = results.filter((r) => !r.ok);
    expect(ok).toHaveLength(3);
    expect(capped).toHaveLength(7);
    // Every rejection reports the real cap; none drove the counter past it.
    expect(capped.every((r) => !r.ok && r.cap === 3)).toBe(true);
    // The DB landed exactly 3 increments — no lost-update, no over-count.
    expect(await storedPlanUsed()).toBe(3);
  }, 60_000);

  it("N=4 concurrent from used=2 (limit 3) → EXACTLY 1 succeeds (the last slot)", async () => {
    await seedPlanUsed(2);

    const results = await Promise.all(
      Array.from({ length: 4 }, () => checkAndIncrement(USER, "plan")),
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toHaveLength(3);
    expect(await storedPlanUsed()).toBe(3);
  }, 60_000);
});
