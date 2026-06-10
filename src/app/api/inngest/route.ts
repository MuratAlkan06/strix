/**
 * Inngest serve() endpoint. signingKey is required so the SDK rejects
 * unsigned requests — without it, anyone reaching this route could trigger
 * functions that mutate or delete data.
 *
 * Functions registered later by phase:
 *   - sweepExpiredGoalDrafts        (Phase 0/1)
 *   - archiveCompletedGoals         (Phase 2)
 *   - resetMonthlyUsageCounters     (Phase 2 stub, Phase 3 real)
 *   - trialReminderTomorrow         (Phase 3)
 *   - applyPendingArchive           (Phase 3)
 *   - applyPaymentFailureArchive    (Phase 3)
 *   - hardDeleteAccounts            (Phase 4)
 */
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [],
  signingKey: process.env.INNGEST_SIGNING_KEY,
});
