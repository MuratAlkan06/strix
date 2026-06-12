/**
 * The single registry of Inngest functions served by /api/inngest.
 *
 * Lives here (not in the route file) so the registration itself is
 * unit-testable — Next.js route modules may only export route handlers, so
 * the route imports this array instead of exposing one of its own.
 *
 * Registered:
 *   - sweepExpiredGoalDrafts        (Phase 0/1 — cron 0 6 * * *)
 *   - archiveCompletedGoals         (Phase 2   — cron 0 3 * * *)
 *   - resetMonthlyUsageCounters     (Phase 2 shell — cron 0 * * * *;
 *                                    Phase 3 fills the body)
 *
 * Still to come (see the route header): trialReminderTomorrow,
 * applyPendingArchive, applyPaymentFailureArchive (Phase 3);
 * hardDeleteAccounts (Phase 4).
 */
import { archiveCompletedGoals } from "./archive-completed-goals";
import { resetMonthlyUsageCounters } from "./reset-monthly-usage-counters";
import { sweepExpiredGoalDrafts } from "./sweep-expired-goal-drafts";

export const inngestFunctions = [
  sweepExpiredGoalDrafts,
  archiveCompletedGoals,
  resetMonthlyUsageCounters,
];
