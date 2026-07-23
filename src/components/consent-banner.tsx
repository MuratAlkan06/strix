"use client";

/**
 * consent-banner.tsx — the analytics cookie-consent affordance (issue #11).
 *
 * GDPR/ePrivacy requires explicit opt-in before non-essential (analytics)
 * cookies load. Strix defers the whole PostHog browser SDK behind this choice
 * (src/lib/analytics/client.ts) — nothing loads, no request, no cookie until
 * the user accepts.
 *
 * STRUCTURE — cloned from install-banner.tsx (two pieces, on purpose):
 *   - ConsentBannerView: a PURE presentational component (copy + two handlers).
 *     It owns the DAWN register and is what the /playground/consent-banner
 *     harness renders directly.
 *   - ConsentBanner: the container mounted once app-wide in src/app/layout.tsx.
 *     Reads the device-global consent (src/lib/analytics/consent.ts), shows the
 *     view ONLY while the choice is pending, and — when the choice is already
 *     "granted" — starts analytics on load so a returning user is tracked
 *     without ever seeing the banner again.
 *
 * NO DARK PATTERNS (DESIGN.md §1 register + #11 AC): decline is exactly as easy
 * as accept — two equal-weight buttons, both persist a choice and dismiss the
 * banner permanently. No pre-ticked box, no "maybe later", no buried decline.
 *
 * WHERE IT DOES NOT RENDER: the container returns null (and skips init) on
 * /playground/* and on /~offline. Both are auth-exempt surfaces with committed
 * verify:ui screenshot baselines; an app-wide overlay there would change those
 * pixels. The banner belongs on the real product surfaces, not the harnesses.
 */
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { Button } from "@/components/ui/button";
import { initPostHog, setAnalyticsConsent } from "@/lib/analytics/client";
import { useAnalyticsConsent } from "@/lib/analytics/consent";

const SHELL =
  "flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm shadow-lg sm:flex-row sm:items-center";

/** Post-choice announcements (SR-polite). Constants so the test can assert them. */
export const ACCEPT_ANNOUNCEMENT = "Analytics on.";
export const DECLINE_ANNOUNCEMENT = "Analytics off.";

/**
 * On a choice the banner unmounts; a screen-reader user needs to know what
 * happened. Write the result into a persistent body-level polite live region
 * (it must outlive the unmounting <section>, so it is appended to <body> and
 * reused, exactly as install-banner.tsx's announceDismiss does).
 */
function announceChoice(granted: boolean): void {
  if (typeof document === "undefined") return;
  const ID = "consent-announcer";
  let region = document.getElementById(ID);
  if (region === null) {
    region = document.createElement("div");
    region.id = ID;
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    document.body.appendChild(region);
  }
  // Clear-then-set so a repeat message still fires the live-region update.
  region.textContent = "";
  region.textContent = granted ? ACCEPT_ANNOUNCEMENT : DECLINE_ANNOUNCEMENT;
}

/**
 * Presentational consent banner. Two equal-weight actions; either announces the
 * result (SR-polite) before handing off to the container, so the announcement
 * survives the unmount. Shared by the real mount and the playground harness.
 */
export function ConsentBannerView({
  onAccept,
  onDecline,
}: {
  onAccept: () => void;
  onDecline: () => void;
}) {
  const handleAccept = () => {
    announceChoice(true);
    onAccept();
  };
  const handleDecline = () => {
    announceChoice(false);
    onDecline();
  };

  return (
    <section aria-label="Analytics cookies" className={SHELL}>
      <p className="min-w-0 flex-1 text-foreground">
        Strix uses PostHog to measure how the product is used. These analytics
        cookies load only if you accept.
      </p>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleDecline}
          className="h-11 flex-1 px-4 sm:flex-none"
        >
          Decline
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={handleAccept}
          className="h-11 flex-1 px-4 sm:flex-none"
        >
          Accept
        </Button>
      </div>
    </section>
  );
}

/** True on the auth-exempt harness surfaces whose screenshot baselines an
 *  app-wide overlay must not disturb (see the file header). */
function isExcludedSurface(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/~offline" || pathname.startsWith("/playground");
}

/** A store that never changes — the useSyncExternalStore "am I hydrated?" idiom
 *  (install-banner.tsx uses the same shape for its static platform signals). */
function noopSubscribe(): () => void {
  return () => {};
}

/**
 * Container. Mounted once in the root layout. Renders the banner only while the
 * choice is pending; on an already-"granted" load it starts analytics without
 * showing anything.
 */
export function ConsentBanner() {
  const pathname = usePathname();
  const consent = useAnalyticsConsent();
  const excluded = isExcludedSurface(pathname);

  // Avoid FLASHING a pending banner for an already-decided user: useAnalytics
  // Consent returns null on the server AND for a genuinely-pending client, so
  // we only reveal the banner once hydrated, by which point `consent` holds the
  // real value. `hydrated` is false on the server + first client render (no
  // hydration mismatch) and true thereafter — the setState-free useSyncExternal
  // Store idiom install-banner uses for its static signals.
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);

  // Returning user who already accepted: start analytics on load, no banner
  // (#11 AC A3 "init on load without banner"). Skipped on excluded surfaces so
  // the verify:ui harnesses stay network-free and deterministic. initPostHog is
  // itself consent-gated + idempotent, so this is safe to call unconditionally
  // once granted.
  useEffect(() => {
    if (excluded) return;
    if (consent === "granted") initPostHog();
  }, [excluded, consent]);

  if (excluded) return null;
  if (!hydrated) return null; // pre-hydration: nothing (avoids the flash/mismatch)
  if (consent !== null) return null; // decided → banner never shows again

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center px-4 pt-4 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]">
      <div className="w-full max-w-2xl">
        <ConsentBannerView
          onAccept={() => setAnalyticsConsent("granted")}
          onDecline={() => setAnalyticsConsent("denied")}
        />
      </div>
    </div>
  );
}
