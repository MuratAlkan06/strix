"use client";

/**
 * InstallBannerHarness — drives the REAL <InstallBannerView /> through its
 * reachable states without a Clerk user or a real beforeinstallprompt event
 * (neither exists on the auth-exempt playground). The container's eligibility
 * + platform logic is unit-tested in node (install-platform.test.ts,
 * use-local-storage.test.ts); this surface is for the VISUAL register +
 * verify:ui axe/screenshot coverage.
 *
 * States (?state=):
 *   - ios     — calm "Add to Home Screen" instructions (no Install button).
 *   - chrome  — native Install button + dismiss.
 *   - dismissed — the post-dismiss reality: nothing renders (the harness shows
 *                 a placeholder line so the surface is never blank).
 */
import { useState } from "react";

import { InstallBannerView } from "@/components/install-banner";
import type { InstallVariant } from "@/lib/install-platform";

export function InstallBannerHarness({ variant }: { variant: InstallVariant }) {
  // Local dismissal so the dismiss button is exercisable in a real browser.
  const [dismissed, setDismissed] = useState(false);

  if (variant === "none" || dismissed) {
    return (
      <p data-testid="install-banner-empty" className="text-sm text-muted-foreground">
        No banner (dismissed or not eligible).
      </p>
    );
  }

  return (
    <InstallBannerView
      variant={variant}
      onInstall={() => {
        /* playground: the native prompt() is unavailable; no-op */
      }}
      onDismiss={() => setDismissed(true)}
    />
  );
}
