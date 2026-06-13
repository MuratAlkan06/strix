/**
 * Inngest serve() endpoint. signingKey is required so the SDK rejects
 * unsigned requests — without it, anyone reaching this route could trigger
 * functions that mutate or delete data.
 *
 * The function list lives in src/lib/inngest/functions.ts (unit-testable
 * registry — route modules may only export handlers). Registered so far:
 *   - sweepExpiredGoalDrafts        (Phase 0/1)
 *   - archiveCompletedGoals         (Phase 2)
 *   - resetMonthlyUsageCounters     (Phase 2 stub, Phase 3 real)
 * Functions registered later by phase:
 *   - trialReminderTomorrow         (Phase 3)
 *   - applyPendingArchive           (Phase 3)
 *   - applyPaymentFailureArchive    (Phase 3)
 *   - hardDeleteAccounts            (Phase 4)
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { inngestFunctions } from "@/lib/inngest/functions";

// Background jobs (archival sweeps, monthly resets) can run well past the
// default serverless wall clock. Allow up to 300s (ADR-0002 CS-3). Valid on
// Vercel fluid compute, which the AI routes' 120/90/90 maxDuration already
// rely on.
export const maxDuration = 300;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: inngestFunctions,
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
