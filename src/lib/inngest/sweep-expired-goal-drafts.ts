/**
 * sweepExpiredGoalDrafts — daily cron job that hard-deletes expired
 * `goal_drafts` rows.
 *
 * Drafts stage intake transcripts + plan_draft before "Save goal" commits
 * the materialized rows. `expires_at` is set at draft creation (a later
 * slice); this job only *enforces* the 30-day TTL — it never sets it.
 *
 * Cross-user by definition (it sweeps every user's stale drafts), so it uses
 * `unscopedDb`. This file lives under src/lib/inngest/**, which the access-
 * isolation check (scripts/check-unscoped-db.mjs, Layer 1) allows to import
 * the escape hatch.
 *
 * The expiry cutoff is `now()` evaluated *in the database*, not a JS
 * timestamp — there's no worker/DB clock skew to reason about, and the
 * comparison runs against the same `expires_at` index the draft path writes.
 */
import { lt, sql } from "drizzle-orm";
import { inngest } from "./client";
import { unscopedDb } from "@/db/unscoped";
import { goal_drafts } from "@/db/schema";

/** Delete every goal_drafts row whose `expires_at` is in the past. Returns
 *  the number of rows swept. Extracted from the Inngest handler so it is
 *  unit-testable against a mock client and reusable from a backfill if ever
 *  needed. */
export async function deleteExpiredGoalDrafts(
  db: typeof unscopedDb = unscopedDb,
): Promise<number> {
  const deleted = await db
    .delete(goal_drafts)
    .where(lt(goal_drafts.expires_at, sql`now()`))
    .returning({ id: goal_drafts.id });
  return deleted.length;
}

export const sweepExpiredGoalDrafts = inngest.createFunction(
  { id: "sweep-expired-goal-drafts" },
  // Daily at 06:00 UTC — off the midnight herd, before peak usage.
  { cron: "0 6 * * *" },
  async ({ step }) => {
    const deletedCount = await step.run("delete-expired-goal-drafts", () =>
      deleteExpiredGoalDrafts(),
    );
    return { deletedCount };
  },
);
