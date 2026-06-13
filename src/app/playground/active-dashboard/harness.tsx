"use client";

/**
 * ActiveDashboardHarness — client wrapper for the playground active-dashboard
 * surface. Provides the REAL <ActiveDashboard /> a deterministic local
 * complete handler (always ok, no server action, no DB) so the optimistic
 * check-off flow — including the struck-but-visible completed state — is
 * exercisable without auth.
 */
import { ActiveDashboard } from "../../(dashboard)/dashboard/active-dashboard";
import type {
  AccomplishedCardModel,
  DashboardModel,
} from "../../(dashboard)/dashboard/dashboard-model";

export function ActiveDashboardHarness({
  greeting,
  dateLabel,
  today,
  model,
  accomplished,
  showCheckInPrompt,
}: {
  greeting: string;
  dateLabel: string;
  today: string;
  model: DashboardModel;
  accomplished: readonly AccomplishedCardModel[];
  showCheckInPrompt: boolean;
}) {
  return (
    <ActiveDashboard
      greeting={greeting}
      dateLabel={dateLabel}
      today={today}
      model={model}
      accomplished={accomplished}
      showCheckInPrompt={showCheckInPrompt}
      // The auth-exempt playground has no Clerk user, so InstallBanner renders
      // null regardless; false keeps the baselines byte-identical. The banner's
      // own states are exercised on /playground/install-banner.
      hasActiveGoal={false}
      onComplete={async () => ({ ok: true as const, alreadyDone: false })}
    />
  );
}
