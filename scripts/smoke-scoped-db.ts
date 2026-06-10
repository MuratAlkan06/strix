/**
 * smoke-scoped-db.ts — exercises scopedDb against the live Neon branch.
 *
 * The 17 Vitest unit tests cover the synchronous JS validation paths.
 * They CANNOT verify that the EXISTS subqueries and soft-delete filter
 * actually scope correctly when executed by Postgres. This script does
 * exactly that — it's the test that PLAN.md §4's RLS-replacement bet
 * lives or dies on.
 *
 * Re-runnable: cleans up before AND after itself using fixed test IDs.
 * Read-only against any real user data (uses 'smoke-test-' prefix).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { scopedDb, ScopedDbError } from "../src/db/scoped";
import { goals, milestones } from "../src/db/schema";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (check .env.local)");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// Deterministic test IDs so cleanup is exhaustive even after a partial run.
const USER_A = "smoke-test-user-A";
const USER_B = "smoke-test-user-B";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}
const results: Check[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

async function cleanup() {
  // Order matters: delete children before parents to satisfy RESTRICT FKs.
  // Use the user_id columns for goals/users to reach all transitive rows.
  await sql`
    DELETE FROM task_completions
    WHERE user_id IN (${USER_A}, ${USER_B})
  `;
  await sql`
    DELETE FROM recurring_tasks
    WHERE goal_id IN (
      SELECT id FROM goals WHERE user_id IN (${USER_A}, ${USER_B})
    )
  `;
  await sql`
    DELETE FROM milestones
    WHERE goal_id IN (
      SELECT id FROM goals WHERE user_id IN (${USER_A}, ${USER_B})
    )
  `;
  await sql`
    DELETE FROM goals
    WHERE user_id IN (${USER_A}, ${USER_B})
  `;
  await sql`
    DELETE FROM users
    WHERE id IN (${USER_A}, ${USER_B})
  `;
}

async function seed(): Promise<{
  goalA: string;
  goalA2: string;
  goalB: string;
  taskA: string;
  milestoneA: string;
}> {
  // Two live users.
  await sql`
    INSERT INTO users (id, email, tier, timezone)
    VALUES
      (${USER_A}, 'a@smoke-test.invalid', 'free', 'UTC'),
      (${USER_B}, 'b@smoke-test.invalid', 'free', 'UTC')
  `;

  // Two goals for A (the second exists to test same-user goal_id mismatch),
  // one for B.
  const goalRows = (await sql`
    INSERT INTO goals (user_id, title, color_index)
    VALUES
      (${USER_A}, 'Smoke test goal A', 0),
      (${USER_A}, 'Smoke test goal A2', 2),
      (${USER_B}, 'Smoke test goal B', 1)
    RETURNING id, user_id, title
  `) as Array<{ id: string; user_id: string; title: string }>;
  const goalA = goalRows.find((r) => r.title === "Smoke test goal A")!.id;
  const goalA2 = goalRows.find((r) => r.title === "Smoke test goal A2")!.id;
  const goalB = goalRows.find((r) => r.user_id === USER_B)!.id;

  // A recurring task and a milestone under goal A — for the forged-insert tests.
  const taskRow = (await sql`
    INSERT INTO recurring_tasks (goal_id, title, cadence)
    VALUES (${goalA}, 'Smoke test task', 'daily')
    RETURNING id
  `) as Array<{ id: string }>;
  const milestoneRow = (await sql`
    INSERT INTO milestones (goal_id, title, position)
    VALUES (${goalA}, 'Smoke test milestone', 0)
    RETURNING id
  `) as Array<{ id: string }>;

  return {
    goalA,
    goalA2,
    goalB,
    taskA: taskRow[0]!.id,
    milestoneA: milestoneRow[0]!.id,
  };
}

async function setUserDeletedAt(userId: string, deleted: boolean) {
  if (deleted) {
    await sql`UPDATE users SET deleted_at = now() WHERE id = ${userId}`;
  } else {
    await sql`UPDATE users SET deleted_at = NULL WHERE id = ${userId}`;
  }
}

async function main() {
  console.log("\n— scopedDb live-DB smoke test —\n");
  console.log(`DB: ${new URL(process.env.DATABASE_URL!).host}\n`);

  // Always start clean.
  await cleanup();
  const { goalA, goalA2, goalB, taskA } = await seed();

  try {
    const sdbA = scopedDb(USER_A);
    const sdbB = scopedDb(USER_B);

    // ---------------- Read isolation (direct ownership) ----------------
    {
      const aGoals = await sdbA.selectFrom(goals);
      const ids = aGoals.map((g) => g.id).sort();
      const onlyA =
        aGoals.length === 2 &&
        ids.join(",") === [goalA, goalA2].sort().join(",") &&
        aGoals.every((g) => g.user_id === USER_A);
      record(
        "selectFrom(goals) as user A returns only A's goals",
        onlyA,
        onlyA
          ? "2 rows, ids match"
          : `got ${aGoals.length} rows: ${JSON.stringify(
              aGoals.map((g) => ({ id: g.id, user_id: g.user_id })),
            )}`,
      );
    }
    {
      const bGoals = await sdbB.selectFrom(goals);
      const onlyB =
        bGoals.length === 1 &&
        bGoals[0]!.id === goalB &&
        bGoals[0]!.user_id === USER_B;
      record(
        "selectFrom(goals) as user B returns only B's goal",
        onlyB,
        onlyB ? "1 row, id matches" : `got ${bGoals.length} rows`,
      );
    }
    {
      const countA = await sdbA.count(goals);
      record(
        "count(goals) as user A returns 2 (A's own), not 3",
        countA === 2,
        `count = ${countA}`,
      );
    }

    // ---------------- Read isolation (transitive ownership) ----------------
    {
      const aMilestones = await sdbA.selectFrom(milestones);
      const onlyA =
        aMilestones.length === 1 && aMilestones[0]!.goal_id === goalA;
      record(
        "selectFrom(milestones) as user A returns only A's milestones",
        onlyA,
        onlyA ? "1 row" : `got ${aMilestones.length}`,
      );
    }
    {
      const bMilestones = await sdbB.selectFrom(milestones);
      record(
        "selectFrom(milestones) as user B returns 0 (B owns no milestones)",
        bMilestones.length === 0,
        `got ${bMilestones.length}`,
      );
    }

    // ---------------- Soft-delete filter ----------------
    await setUserDeletedAt(USER_A, true);
    try {
      const aGoalsAfterDelete = await sdbA.selectFrom(goals);
      record(
        "soft-deleted user's selectFrom(goals) returns empty",
        aGoalsAfterDelete.length === 0,
        `got ${aGoalsAfterDelete.length}`,
      );
      const aMilestonesAfterDelete = await sdbA.selectFrom(milestones);
      record(
        "soft-deleted user's selectFrom(milestones) returns empty (transitive filter)",
        aMilestonesAfterDelete.length === 0,
        `got ${aMilestonesAfterDelete.length}`,
      );
    } finally {
      // Restore so subsequent checks work.
      await setUserDeletedAt(USER_A, false);
    }

    // ---------------- Forged transitive insert ----------------
    {
      let threw: Error | null = null;
      try {
        // User A attempts to insert a milestone into User B's goal.
        await sdbA.insert(milestones, {
          goal_id: goalB,
          title: "forged milestone — should be rejected",
          position: 0,
        });
      } catch (e) {
        threw = e as Error;
      }
      const ok = threw instanceof ScopedDbError;
      record(
        "user A insert milestone into B's goal throws ScopedDbError",
        ok,
        ok
          ? `threw: ${threw!.message.slice(0, 80)}...`
          : threw
            ? `wrong error class: ${threw.constructor.name}`
            : "DID NOT THROW (critical)",
      );
    }

    // ---------------- Forged task_completion ----------------
    {
      let threw: Error | null = null;
      try {
        const { task_completions } = await import("../src/db/schema");
        // User B attempts task_completion with User A's recurring_task_id
        // — even if B passes their own goal_id, the task_id is A's, and
        // the consolidated cross-check should reject the pair.
        await sdbB.insert(task_completions, {
          recurring_task_id: taskA,
          user_id: USER_B,
          goal_id: goalB,
          for_date: "2026-01-01",
        } as never);
      } catch (e) {
        threw = e as Error;
      }
      const ok = threw instanceof ScopedDbError;
      record(
        "user B insert task_completion with A's recurring_task_id throws",
        ok,
        ok
          ? `threw: ${threw!.message.slice(0, 80)}...`
          : threw
            ? `wrong error class: ${threw.constructor.name}: ${threw.message.slice(0, 80)}`
            : "DID NOT THROW (critical)",
      );
    }

    // ---------------- Forged update (forbidden keys) ----------------
    {
      let threw: Error | null = null;
      try {
        // User A attempts to transfer their goal to user B by mutating user_id.
        await sdbA.update(goals, {
          set: { user_id: USER_B } as never,
        });
      } catch (e) {
        threw = e as Error;
      }
      const ok = threw instanceof ScopedDbError && /forbidden/i.test(threw.message);
      record(
        "update(goals, set: { user_id: victim }) throws (H1 fix)",
        ok,
        ok ? "rejected by forbidden-keys check" : `got: ${threw?.message ?? "no throw"}`,
      );
    }

    // ---------------- task_completions: derived goal_id ----------------
    {
      const { task_completions } = await import("../src/db/schema");
      // Omitting goal_id: derived from the recurring task's parent goal
      // inside the atomic INSERT…SELECT.
      const rows = await sdbA.insert(task_completions, {
        recurring_task_id: taskA,
        user_id: USER_A,
        for_date: "2026-01-02",
      } as never);
      const derived =
        rows.length === 1 &&
        (rows[0] as { goal_id?: string }).goal_id === goalA;
      record(
        "task_completion insert without goal_id derives rt.goal_id",
        derived,
        derived
          ? `stored goal_id === parent goal`
          : `got ${JSON.stringify(rows.map((r) => (r as { goal_id?: string }).goal_id))}, expected ${goalA}`,
      );
    }
    {
      const { task_completions } = await import("../src/db/schema");
      // Same-user mismatch: A's own task + A's OTHER goal must be rejected —
      // the stored goal_id may never disagree with the task's parent.
      let threw: Error | null = null;
      try {
        await sdbA.insert(task_completions, {
          recurring_task_id: taskA,
          user_id: USER_A,
          goal_id: goalA2,
          for_date: "2026-01-03",
        } as never);
      } catch (e) {
        threw = e as Error;
      }
      const ok = threw instanceof ScopedDbError;
      record(
        "task_completion with own task + own OTHER goal_id throws (mismatch)",
        ok,
        ok
          ? `threw: ${threw!.message.slice(0, 80)}...`
          : threw
            ? `wrong error class: ${threw.constructor.name}`
            : "DID NOT THROW (critical)",
      );
    }

    // ---------------- Soft-deleted user cannot INSERT ----------------
    await setUserDeletedAt(USER_A, true);
    try {
      let threw: Error | null = null;
      try {
        await sdbA.insert(goals, {
          user_id: USER_A,
          title: "insert while soft-deleted — should be rejected",
          color_index: 3,
        } as never);
      } catch (e) {
        threw = e as Error;
      }
      const ok = threw instanceof ScopedDbError;
      record(
        "soft-deleted user's direct insert throws (live-user guard)",
        ok,
        ok
          ? `threw: ${threw!.message.slice(0, 80)}...`
          : threw
            ? `wrong error class: ${threw.constructor.name}`
            : "DID NOT THROW (critical)",
      );
      const self = await sdbA.getSelf();
      record(
        "getSelf() returns null for a soft-deleted user",
        self === null,
        self === null ? "null as expected" : "returned a row",
      );
    } finally {
      await setUserDeletedAt(USER_A, false);
    }

    // ---------------- Self accessor ----------------
    {
      const updated = await sdbA.updateSelf({ timezone: "Europe/Istanbul" });
      const self = await sdbA.getSelf();
      const ok =
        updated.length === 1 &&
        self !== null &&
        self.timezone === "Europe/Istanbul" &&
        self.id === USER_A;
      record(
        "updateSelf(timezone) writes own row; getSelf() reflects it",
        ok,
        ok ? "timezone updated and read back" : `got ${JSON.stringify(self)}`,
      );
      const bSelf = await sdbB.getSelf();
      record(
        "getSelf() as user B returns B's row (scoping)",
        bSelf !== null && bSelf.id === USER_B,
        bSelf ? `id = ${bSelf.id}` : "null",
      );
    }

    // ---------------- Existence of victim's row is unchanged ----------------
    {
      const bGoalsStillThere = await sdbB.selectFrom(goals);
      record(
        "victim's data unaffected by all attempts",
        bGoalsStillThere.length === 1 && bGoalsStillThere[0]!.id === goalB,
        `B still has ${bGoalsStillThere.length} goals`,
      );
    }
  } finally {
    await cleanup();
  }

  // Report.
  console.log("Results:");
  const nameWidth = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`  ${r.name.padEnd(nameWidth)}  ${status}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(
      `All ${results.length} live-DB scopedDb assertions passed. ` +
        `The RLS-replacement bet from PLAN.md §4 is verified end-to-end.`,
    );
    process.exit(0);
  } else {
    console.log(
      `${failed.length} of ${results.length} live-DB assertions FAILED. ` +
        `This is a critical Phase 0 regression — fix before commit.`,
    );
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error(err);
  try {
    await cleanup();
  } catch {
    // best-effort cleanup
  }
  process.exit(1);
});
