/**
 * resetMonthlyUsageCounters — hourly cron that guarantees every active user
 * has a current-month usage_counters row (SPEC §3.5 / §10: usage periods reset
 * on the calendar 1st in the USER's timezone).
 *
 * Because the boundary is per-timezone, the job runs hourly UTC and each tick
 * touches ONLY the users whose local clock just crossed into a new month —
 * detected entirely in SQL: `now() AT TIME ZONE u.timezone` gives each user's
 * local wall-clock, and `date_trunc('hour', local) = date_trunc('month',
 * local)` is true only during 00:00–00:59 on the 1st. For those users it
 * creates the (user_id, period_start) row; the unique index makes the create
 * idempotent (a user who already triggered lazy creation by hitting an AI
 * endpoint is skipped via ON CONFLICT DO NOTHING).
 *
 * The cron is a BACKSTOP: checkAndIncrement lazily creates the row on first
 * metered use, but analytics queries want every active user to have a
 * current-month row even if they never hit an AI endpoint that month.
 *
 * Cross-user by definition, so `unscopedDb` — this file lives under
 * src/lib/inngest/**, the access-isolation allowlist for background jobs
 * (scripts/check-unscoped-db.mjs, Layer 1). The clock is the DATABASE's
 * (`now()` in SQL — no worker/DB skew); the optional `now` seam exists for
 * the env-gated integration test and manual verification, production passes
 * nothing.
 */
import { and, isNull, sql } from "drizzle-orm";
import { inngest } from "./client";
import { unscopedDb } from "@/db/unscoped";
import { usage_counters, users } from "@/db/schema";

export interface MonthlyResetResult {
  /** New current-month rows created this tick (conflicts are not counted). */
  resetCount: number;
}

/**
 * Create the current-month usage_counters row for every user whose local
 * month just began (within this UTC hour). Returns the number of rows created.
 * Extracted from the Inngest handler so it is unit-testable against a mock
 * client and manually runnable for verification.
 */
export async function resetDueMonthlyUsageCounters(
  db: typeof unscopedDb = unscopedDb,
  now?: Date,
): Promise<MonthlyResetResult> {
  // The reference instant — the DB's own clock in production; a bound value
  // for the seam. Reused across the projection + predicate so a user can't
  // land on two different local months mid-evaluation.
  const nowExpr = now ? sql`${now.toISOString()}::timestamptz` : sql`now()`;
  const localNow = sql`((${nowExpr}) AT TIME ZONE ${users.timezone})`;

  const due = await db
    .select({
      userId: users.id,
      periodStart: sql<string>`date_trunc('month', ${localNow})::date`,
      periodEnd: sql<string>`(date_trunc('month', ${localNow}) + interval '1 month' - interval '1 day')::date`,
    })
    .from(users)
    .where(
      and(
        isNull(users.deleted_at),
        // Local time is within the first hour of the 1st of the month.
        sql`date_trunc('hour', ${localNow}) = date_trunc('month', ${localNow})`,
      ),
    );

  let resetCount = 0;
  for (const row of due) {
    const inserted = await db
      .insert(usage_counters)
      .values({
        user_id: row.userId,
        period_start: row.periodStart,
        period_end: row.periodEnd,
      })
      .onConflictDoNothing({
        target: [usage_counters.user_id, usage_counters.period_start],
      })
      .returning({ id: usage_counters.id });
    resetCount += inserted.length;
  }

  return { resetCount };
}

export const resetMonthlyUsageCounters = inngest.createFunction(
  { id: "reset-monthly-usage-counters" },
  // Hourly UTC — catches every timezone's local-month boundary.
  { cron: "0 * * * *" },
  async ({ step }) => {
    const { resetCount } = await step.run("reset-due-monthly-counters", () =>
      resetDueMonthlyUsageCounters(),
    );
    return { resetCount };
  },
);
