"use client";

/**
 * AnalyticsConsentCardHarness — drives the REAL <AnalyticsConsentCardView />
 * without touching the consent store or PostHog (neither should run on the
 * auth-exempt playground). The container's store wiring is unit-tested
 * (consent.test.ts); this surface exists to give the AUTH-GATED /settings card
 * live axe/screenshot coverage — reviewers can't reach the settings surface, so
 * the harness renders the same view in both switch states here.
 *
 * States (?state=):
 *   - off — analytics off (the resting default), switch unchecked (default).
 *   - on  — analytics on, switch checked.
 *
 * The switch stays interactive via local state so it is exercisable in a real
 * browser; the handler deliberately does NOT call setAnalyticsConsent (no
 * store, no PostHog), exactly as the consent-banner harness does.
 */
import { useState } from "react";

import { AnalyticsConsentCardView } from "@/app/(settings)/settings/analytics-consent-card";

export function AnalyticsConsentCardHarness({
  initialState,
}: {
  initialState: "on" | "off";
}) {
  const [granted, setGranted] = useState(initialState === "on");

  return <AnalyticsConsentCardView granted={granted} onToggle={setGranted} />;
}
