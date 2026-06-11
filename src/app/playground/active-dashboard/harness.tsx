"use client";

/**
 * ActiveDashboardHarness — client wrapper for the playground active-dashboard
 * surface. Provides the REAL <ActiveDashboard /> a deterministic local
 * complete handler (always ok, no server action, no DB) so the optimistic
 * check-off flow — including the struck-but-visible completed state — is
 * exercisable without auth.
 */
import { ActiveDashboard } from "../../(dashboard)/dashboard/active-dashboard";
import type { DashboardModel } from "../../(dashboard)/dashboard/dashboard-model";

export function ActiveDashboardHarness({
  greeting,
  dateLabel,
  today,
  model,
}: {
  greeting: string;
  dateLabel: string;
  today: string;
  model: DashboardModel;
}) {
  return (
    <ActiveDashboard
      greeting={greeting}
      dateLabel={dateLabel}
      today={today}
      model={model}
      onComplete={async () => ({ ok: true as const, alreadyDone: false })}
    />
  );
}
