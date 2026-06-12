/**
 * resetMonthlyUsageCounters — hourly cron, registered in Phase 2 as a
 * deliberate NO-OP shell (phase-2-close-the-loop "Goal completion celebration
 * + auto-archive" job list).
 *
 * Phase 3 fills the body with the local-midnight-window logic: usage periods
 * reset on the 1st of the month in each USER'S timezone (SPEC §3.5), so the
 * job runs hourly UTC and, each tick, resets only the users whose local
 * clock just crossed into a new month. Registering the shell now means the
 * cron schedule, function id, and serve() registration are already live and
 * verified before any billing logic depends on them.
 *
 * Until then the body returns immediately — no DB client is even accepted,
 * so a Phase 2 run provably cannot write.
 */
import { inngest } from "./client";

export interface MonthlyResetResult {
  /** Always 0 in Phase 2 — nothing is examined, nothing is reset. */
  resetCount: number;
  /** Honest marker for the Inngest run log. */
  note: "phase-2 no-op — Phase 3 adds the local-midnight-window reset";
}

/** The extracted body (sweep-job pattern). Phase 3 replaces this with the
 *  real local-midnight-window reset; Phase 2 returns immediately. */
export async function resetDueMonthlyUsageCounters(): Promise<MonthlyResetResult> {
  return {
    resetCount: 0,
    note: "phase-2 no-op — Phase 3 adds the local-midnight-window reset",
  };
}

export const resetMonthlyUsageCounters = inngest.createFunction(
  { id: "reset-monthly-usage-counters" },
  // Hourly UTC — catches every timezone's local-month boundary (Phase 3).
  { cron: "0 * * * *" },
  async () => resetDueMonthlyUsageCounters(),
);
