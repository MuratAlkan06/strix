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
import type { InstallVariant } from "@/lib/install-platform";

export function ActiveDashboardHarness({
  greeting,
  dateLabel,
  today,
  model,
  accomplished,
  showCheckInPrompt,
  installBannerPreview,
}: {
  greeting: string;
  dateLabel: string;
  today: string;
  model: DashboardModel;
  accomplished: readonly AccomplishedCardModel[];
  showCheckInPrompt: boolean;
  /** When set, the dashboard renders the eligible InstallBannerView IN CONTEXT
   *  (the ?state=install-* harness states) so the in-place placement between
   *  the check-in prompt and the hero countdown is reviewable on a live render.
   *  Bypasses the Clerk/localStorage gates for the harness only — the real
   *  eligibility logic is untouched and unit-tested elsewhere. */
  installBannerPreview?: InstallVariant;
}) {
  return (
    <ActiveDashboard
      greeting={greeting}
      dateLabel={dateLabel}
      today={today}
      model={model}
      accomplished={accomplished}
      showCheckInPrompt={showCheckInPrompt}
      // The auth-exempt playground has no Clerk user, so the gated InstallBanner
      // renders null regardless; false keeps the non-install baselines
      // byte-identical. installBannerPreview (when set) bypasses that for the
      // in-context preview states.
      hasActiveGoal={false}
      installBannerPreview={installBannerPreview}
      onComplete={async () => ({ ok: true as const, alreadyDone: false })}
    />
  );
}
