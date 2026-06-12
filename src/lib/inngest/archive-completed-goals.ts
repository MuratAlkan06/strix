/**
 * archiveCompletedGoals — nightly cron that flips overdue completed goals to
 * archived (phase-2-close-the-loop "Goal completion celebration +
 * auto-archive").
 *
 * completeGoal (goal-detail actions) stamps `auto_archive_at = completed_at +
 * 7d`; this job only *enforces* that timer — it never sets it. One guarded
 * UPDATE:
 *
 *   status = 'archived', archived_at = now
 *   WHERE status = 'completed'
 *     AND auto_archive_at <= now
 *     AND owner not soft-deleted (NOT EXISTS users.deleted_at — a deleted
 *         account's rows are frozen for the Phase 4 hard-delete path, not
 *         mutated by maintenance jobs)
 *
 * Idempotent by construction: an archived row no longer matches
 * status='completed', so a re-run touches nothing (and archived_at is written
 * exactly once). Active goals never match.
 *
 * Cross-user by definition, so `unscopedDb` — this file lives under
 * src/lib/inngest/**, the access-isolation allowlist for background jobs.
 *
 * The cutoff is `now()` evaluated *in the database* (the sweep-job
 * convention — no worker/DB clock skew). The optional `now` seam exists for
 * the phase-doc verification step ("run manually with now = auto_archive_at
 * + 1s") and tests; production passes nothing.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { inngest } from "./client";
import { unscopedDb } from "@/db/unscoped";
import { goals, users } from "@/db/schema";

/** Archive every due completed goal. Returns the number of rows archived.
 *  Extracted from the Inngest handler so it is unit-testable against a mock
 *  client and manually runnable for the phase-gate verification. */
export async function archiveDueGoals(
  db: typeof unscopedDb = unscopedDb,
  now?: Date,
): Promise<number> {
  const cutoff = now ?? sql`now()`;
  const archived = await db
    .update(goals)
    .set({ status: "archived", archived_at: now ?? sql`now()` })
    .where(
      and(
        eq(goals.status, "completed"),
        lte(goals.auto_archive_at, cutoff),
        sql`not exists (select 1 from ${users} where ${users.id} = ${goals.user_id} and ${users.deleted_at} is not null)`,
      ),
    )
    .returning({ id: goals.id });
  return archived.length;
}

export const archiveCompletedGoals = inngest.createFunction(
  { id: "archive-completed-goals" },
  // Daily at 03:00 UTC (the phase-2 doc's schedule).
  { cron: "0 3 * * *" },
  async ({ step }) => {
    const archivedCount = await step.run("archive-due-goals", () =>
      archiveDueGoals(),
    );
    return { archivedCount };
  },
);
