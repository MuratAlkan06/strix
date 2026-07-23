"use client";

/**
 * ConsentBannerHarness — drives the REAL <ConsentBannerView /> without touching
 * the consent store or PostHog (neither should run on the auth-exempt
 * playground). The container's pending/decided + init logic is unit-tested
 * (consent.test.ts); this surface is for the VISUAL register + verify:ui
 * axe/screenshot coverage.
 *
 * States (?state=):
 *   - banner    — the pending banner with Decline / Accept (default).
 *   - dismissed — the post-choice reality: nothing renders (the harness shows a
 *                 placeholder line so the surface is never blank).
 */
import { useState } from "react";

import { ConsentBannerView } from "@/components/consent-banner";

export function ConsentBannerHarness({
  initialState,
}: {
  initialState: "banner" | "dismissed";
}) {
  // Local dismissal so the buttons are exercisable in a real browser; the
  // handlers deliberately do NOT call setAnalyticsConsent (no store/posthog).
  const [dismissed, setDismissed] = useState(initialState === "dismissed");

  if (dismissed) {
    return (
      <p
        data-testid="consent-banner-empty"
        className="text-sm text-muted-foreground"
      >
        No banner (choice already made).
      </p>
    );
  }

  return (
    <ConsentBannerView
      onAccept={() => setDismissed(true)}
      onDecline={() => setDismissed(true)}
    />
  );
}
