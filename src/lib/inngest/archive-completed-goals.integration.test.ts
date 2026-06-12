/**
 * INTEGRATION TEST — archiveCompletedGoals live-DB proof (env-gated; real
 * Postgres). The Phase 2 gate evidence: "verify an Inngest job in dev"
 * (phase-2-close-the-loop verification step 7).
 *
 * The unit tests pin the UPDATE's clauses; this file proves the semantics
 * against the database in DATABASE_URL by executing the extracted job body
 * (`archiveDueGoals` — exactly what the Inngest handler's step runs) over a
 * seeded fixture matrix:
 *
 *   - completed + auto_archive_at in the past            → archived, archived_at set
 *   - completed + auto_archive_at in the future          → untouched
 *   - completed + auto_archive_at NULL (never completed
 *     through completeGoal)                              → untouched
 *   - ACTIVE + a (synthetic) past auto_archive_at        → untouched
 *   - completed + past auto_archive_at, owner SOFT-
 *     DELETED (users.deleted_at set)                     → untouched
 *   - re-run                                             → zero rows, archived_at unchanged
 *
 * Skips cleanly when DATABASE_URL is unset (vitest.setup.ts's placeholder
 * counts as unset), so the default `pnpm test:run` is unaffected — the
 * scoped.integration.test.ts gating posture. Run locally with .env.local:
 *
 *   set -a; source .env.local; set +a; \
 *     pnpm vitest run src/lib/inngest/archive-completed-goals.integration.test.ts
 *
 * Fixture lifecycle (scoped.integration.test.ts conventions): unique-suffixed
 * IDs, GUARANTEED cleanup in afterAll, and a residue assertion so a leaky run
 * fails loudly instead of littering the dev DB. unscopedDb is legitimate
 * throughout — this file exercises a cross-user background job and lives
 * under src/lib/inngest/** (the access-isolation allowlist).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { archiveDueGoals } from "./archive-completed-goals";
import { unscopedDb } from "@/db/unscoped";
import { goals, users } from "@/db/schema";

const url = process.env.DATABASE_URL ?? "";
const hasRealDb = url.length > 0 && !url.includes("placeholder");
const run = hasRealDb ? describe : describe.skip;

const SUFFIX = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const USER_LIVE = `vitest-arch-${SUFFIX}-live`;
const USER_DELETED = `vitest-arch-${SUFFIX}-deleted`;
const FIXTURE_USERS = [USER_LIVE, USER_DELETED];

const HOUR_MS = 60 * 60 * 1000;
const now = Date.now();
const PAST = new Date(now - HOUR_MS); // due an hour ago
const FUTURE = new Date(now + 6 * 24 * HOUR_MS); // ~6 days out

let dueGoal = ""; // completed, past auto_archive_at → MUST archive
let futureGoal = ""; // completed, future auto_archive_at → untouched
let nullGoal = ""; // completed, NULL auto_archive_at → untouched
let activeGoal = ""; // active, past auto_archive_at → untouched
let orphanGoal = ""; // completed+due but owner soft-deleted → untouched

async function cleanup() {
  await unscopedDb.delete(goals).where(inArray(goals.user_id, FIXTURE_USERS));
  await unscopedDb.delete(users).where(inArray(users.id, FIXTURE_USERS));
}

async function fetchGoal(id: string) {
  const rows = await unscopedDb
    .select({
      status: goals.status,
      archived_at: goals.archived_at,
      completed_at: goals.completed_at,
      auto_archive_at: goals.auto_archive_at,
    })
    .from(goals)
    .where(eq(goals.id, id));
  return rows[0]!;
}

run("archiveCompletedGoals (integration, live DB)", () => {
  beforeAll(async () => {
    await unscopedDb.insert(users).values([
      {
        id: USER_LIVE,
        email: `${USER_LIVE}@vitest-int.invalid`,
        timezone: "UTC",
      },
      {
        id: USER_DELETED,
        email: `${USER_DELETED}@vitest-int.invalid`,
        timezone: "UTC",
        deleted_at: PAST, // soft-deleted owner — the NOT EXISTS exclusion
      },
    ]);

    const rows = await unscopedDb
      .insert(goals)
      .values([
        {
          user_id: USER_LIVE,
          title: `vitest-arch ${SUFFIX} due`,
          color_index: 0,
          status: "completed",
          completed_at: new Date(now - 8 * 24 * HOUR_MS),
          auto_archive_at: PAST,
          archive_reason: "user_action",
        },
        {
          user_id: USER_LIVE,
          title: `vitest-arch ${SUFFIX} future`,
          color_index: 1,
          status: "completed",
          completed_at: PAST,
          auto_archive_at: FUTURE,
          archive_reason: "user_action",
        },
        {
          user_id: USER_LIVE,
          title: `vitest-arch ${SUFFIX} null`,
          color_index: 2,
          status: "completed",
          completed_at: PAST,
          auto_archive_at: null,
        },
        {
          user_id: USER_LIVE,
          title: `vitest-arch ${SUFFIX} active`,
          color_index: 3,
          status: "active",
          // Synthetic: an active goal can't get auto_archive_at through the
          // app; planted to prove the status guard alone protects it.
          auto_archive_at: PAST,
        },
        {
          user_id: USER_DELETED,
          title: `vitest-arch ${SUFFIX} orphan`,
          color_index: 4,
          status: "completed",
          completed_at: new Date(now - 8 * 24 * HOUR_MS),
          auto_archive_at: PAST,
          archive_reason: "user_action",
        },
      ])
      .returning({ id: goals.id, title: goals.title });

    const idFor = (tag: string) =>
      rows.find((r) => r.title.endsWith(tag))!.id;
    dueGoal = idFor("due");
    futureGoal = idFor("future");
    nullGoal = idFor("null");
    activeGoal = idFor("active");
    orphanGoal = idFor("orphan");
  }, 60_000);

  afterAll(async () => {
    await cleanup();
    // Residue proof: zero fixture rows survive this file, pass or fail.
    const residue = {
      goals: await unscopedDb
        .select({ id: goals.id })
        .from(goals)
        .where(inArray(goals.user_id, FIXTURE_USERS)),
      users: await unscopedDb
        .select({ id: users.id })
        .from(users)
        .where(inArray(users.id, FIXTURE_USERS)),
    };
    expect(residue).toEqual({ goals: [], users: [] });
  }, 60_000);

  it("archives exactly the due completed goal of a live owner", async () => {
    const archivedCount = await archiveDueGoals(unscopedDb);
    // ≥1 guards against a parallel run's fixtures also being due; OUR rows
    // are then asserted individually.
    expect(archivedCount).toBeGreaterThanOrEqual(1);

    const due = await fetchGoal(dueGoal);
    expect(due.status).toBe("archived");
    expect(due.archived_at).not.toBeNull();
    // completed_at / auto_archive_at survive the flip (only status +
    // archived_at are written).
    expect(due.completed_at).not.toBeNull();
    expect(due.auto_archive_at).not.toBeNull();
  }, 30_000);

  it("leaves the not-yet-due completed goal untouched", async () => {
    const future = await fetchGoal(futureGoal);
    expect(future.status).toBe("completed");
    expect(future.archived_at).toBeNull();
  }, 30_000);

  it("leaves a completed goal with NULL auto_archive_at untouched", async () => {
    const nul = await fetchGoal(nullGoal);
    expect(nul.status).toBe("completed");
    expect(nul.archived_at).toBeNull();
  }, 30_000);

  it("never touches an active goal, even with a past auto_archive_at", async () => {
    const active = await fetchGoal(activeGoal);
    expect(active.status).toBe("active");
    expect(active.archived_at).toBeNull();
  }, 30_000);

  it("excludes goals whose owner is soft-deleted", async () => {
    const orphan = await fetchGoal(orphanGoal);
    expect(orphan.status).toBe("completed");
    expect(orphan.archived_at).toBeNull();
  }, 30_000);

  it("is idempotent: a re-run archives nothing further and archived_at is unchanged", async () => {
    const firstArchivedAt = (await fetchGoal(dueGoal)).archived_at;
    expect(firstArchivedAt).not.toBeNull();

    const secondRun = await archiveDueGoals(unscopedDb);

    const after = await fetchGoal(dueGoal);
    expect(after.status).toBe("archived");
    expect(after.archived_at?.getTime()).toBe(firstArchivedAt?.getTime());
    // None of OUR fixtures can match again; tolerate other suffixes' rows.
    const ours = await unscopedDb
      .select({ id: goals.id, status: goals.status })
      .from(goals)
      .where(inArray(goals.user_id, FIXTURE_USERS));
    expect(ours.filter((g) => g.status === "archived").map((g) => g.id)).toEqual(
      [dueGoal],
    );
    expect(secondRun).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
