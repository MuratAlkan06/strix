"use client";

/**
 * install-banner.tsx — the "Add to home screen" affordance (phase 2.5, S8;
 * planning/phase-2.5-pwa-polish.md "Install affordance").
 *
 * A small, dismissible, calm banner that appears on the dashboard once the
 * user (a) has at least one active goal AND (b) has been authenticated for 3+
 * sessions — and never if already installed, never again once dismissed.
 *
 * STRUCTURE — two pieces, on purpose:
 *   - InstallBannerView: a PURE presentational component (variant + handlers).
 *     It owns the DAWN register and is what the /playground/install-banner
 *     harness renders directly (the harness can't supply a real Clerk user or
 *     a real beforeinstallprompt event, so it drives the view, not the
 *     container).
 *   - InstallBanner: the container. Reads Clerk userId, the per-user session
 *     count + dismissed flag (src/lib/use-local-storage.ts), captures the
 *     beforeinstallprompt event, detects standalone/iOS, and decides whether —
 *     and as which variant — to render the view.
 *
 * PLATFORM BRANCH (planning-doc "Platform branch"):
 *   - already standalone → render nothing.
 *   - iOS Safari (no beforeinstallprompt) → calm manual instructions.
 *   - Chrome/Android → capture beforeinstallprompt (preventDefault + stash),
 *     show an Install button that calls prompt(); hide after the choice.
 *
 * DESIGN register (DESIGN.md §8/§11): one quiet card-toned row, NOT amber —
 * being un-installed is a state, not a warning. Dismiss is an explicit ≥44px
 * control with a visible focus ring; the install action is the shared button
 * primitive (token-tied, focus ring, ≥44px via h-11). Never naggy: dismissal
 * is permanent and the banner self-hides the moment it stops being actionable.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/nextjs";
import { Download, Plus, Share, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  dismissedKey,
  useBooleanFlag,
  useSessionCount,
} from "@/lib/use-local-storage";
import {
  isInstallEligible,
  isIosUserAgent,
  resolveInstallVariant,
  type InstallVariant,
} from "@/lib/install-platform";

/** The slice of the beforeinstallprompt event we use — typed locally because
 *  the DOM lib does not ship BeforeInstallPromptEvent. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const SHELL =
  "flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm";

/** The dismissal announcement (SR-polite). Constant so the test can assert it. */
export const DISMISS_ANNOUNCEMENT = "Install prompt dismissed";

/** The default id of the element to focus after dismiss — the hero countdown
 *  region the banner sits above (active-dashboard.tsx tags it). Exported so the
 *  dashboard and the e2e spec name the SAME anchor. */
export const INSTALL_DISMISS_FOCUS_ID = "install-dismiss-focus-target";

/**
 * On dismiss the banner <section> unmounts; without intervention focus drops to
 * <body> (a WCAG 2.4.3 focus-order failure for keyboard users — the S3 class of
 * bug) and screen readers announce nothing. This purpose-built helper closes
 * both gaps and runs from the SHARED dismiss button, so it covers the real
 * dashboard mount AND the playground harness identically:
 *
 *   1. ANNOUNCE — write the dismissal into a persistent, body-level polite live
 *      region. It must outlive the unmounting <section>, so it is appended to
 *      <body> (not rendered inside the banner) and reused across dismissals.
 *   2. FOCUS the documented neighbor by id (the hero countdown region, tagged
 *      tabIndex={-1}). The move is deferred a frame so it lands AFTER React's
 *      unmount commit; if the neighbor is somehow absent, focus is left for the
 *      browser rather than forced onto <body>.
 */
function announceDismiss(): void {
  if (typeof document === "undefined") return;
  const ID = "install-dismiss-announcer";
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
  region.textContent = DISMISS_ANNOUNCEMENT;
}

function focusDismissNeighbor(neighborId: string): void {
  if (typeof document === "undefined") return;
  // Defer past React's unmount commit so the section is gone and the neighbor
  // is the live next target (focusing during the same tick would race it).
  requestAnimationFrame(() => {
    const target = document.getElementById(neighborId);
    target?.focus();
  });
}

/** Platform signals (standalone / iOS) are static for the page's lifetime, so
 *  they need no subscription — this never calls back. */
function noopSubscribe(): () => void {
  return () => {};
}

/** Already running as an installed app: iOS exposes the legacy
 *  `navigator.standalone`; everyone else honors the display-mode media query.
 *  SSR snapshot is false → the banner is absent in server HTML / first paint. */
function getIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const displayMode = window.matchMedia?.("(display-mode: standalone)").matches;
  const iosStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
    true;
  return Boolean(displayMode) || iosStandalone;
}

/** iOS heuristic: explicit device tokens, OR a touch-capable Mac UA (iPadOS
 *  13+ masquerades as a Mac but still fires no beforeinstallprompt). */
function getIsIos(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const ipadOsAsMac =
    /macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1;
  return isIosUserAgent(ua) || ipadOsAsMac;
}

/**
 * Presentational banner. `variant` is "ios" or "chrome" (a "none" variant
 * renders nothing — the container short-circuits, but the view stays total).
 */
export function InstallBannerView({
  variant,
  onInstall,
  onDismiss,
  dismissFocusId = INSTALL_DISMISS_FOCUS_ID,
}: {
  variant: InstallVariant;
  /** Chrome only — runs the native prompt(). */
  onInstall?: () => void;
  onDismiss: () => void;
  /** Id of the neighbor to focus after dismiss (defaults to the hero countdown
   *  region the dashboard tags); keeps focus off <body> when the section
   *  unmounts. The harness overrides it with its own in-context anchor. */
  dismissFocusId?: string;
}) {
  if (variant === "none") return null;

  // Shared dismiss path (real mount + harness): announce, hand off, then move
  // focus to the documented neighbor so it lands after React unmounts us.
  const handleDismiss = () => {
    announceDismiss();
    onDismiss();
    focusDismissNeighbor(dismissFocusId);
  };

  const dismiss = (
    <button
      type="button"
      onClick={handleDismiss}
      aria-label="Dismiss"
      className="-m-2 inline-flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <X aria-hidden="true" className="size-4" />
    </button>
  );

  if (variant === "ios") {
    return (
      <section aria-label="Add Strix to your home screen" className={SHELL}>
        {/* lucide `Share` is the iOS-style square-with-up-arrow — it mirrors
            the real Safari Share control the instruction refers to (the bare
            up-arrow `ArrowUpFromLine` was an approximation). */}
        <Share
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
        <p className="min-w-0 flex-1 text-foreground">
          Add Strix to your home screen: tap{" "}
          <span className="font-medium">Share</span>, then{" "}
          <span className="inline-flex items-center gap-0.5 font-medium">
            <Plus aria-hidden="true" className="inline size-3.5" />
            Add to Home Screen
          </span>
          .
        </p>
        {dismiss}
      </section>
    );
  }

  // chrome
  return (
    <section aria-label="Install Strix" className={SHELL}>
      <Download
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
      <p className="min-w-0 flex-1 text-foreground">
        Install Strix for a faster, full-screen home-screen app.
      </p>
      <Button type="button" onClick={onInstall} className="h-11 shrink-0 px-4">
        Install
      </Button>
      {dismiss}
    </section>
  );
}

/**
 * Container. Renders the banner only when eligible, not standalone, not
 * dismissed, and a platform variant applies. `hasActiveGoal` is the
 * server-known eligibility input (passed down from the dashboard page); the
 * session count and dismissal are read per-user from localStorage here.
 */
export function InstallBanner({ hasActiveGoal }: { hasActiveGoal: boolean }) {
  const { userId } = useAuth();
  const sessionCount = useSessionCount(userId);
  const [dismissed, dismiss] = useBooleanFlag(userId ? dismissedKey(userId) : null);

  // Captured beforeinstallprompt event (Chrome/Android) — null until fired.
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  // Static platform signals via useSyncExternalStore (no setState-in-effect;
  // SSR-safe: both false on the server / first paint, so nothing flashes
  // before hydration — the same posture as use-online.ts).
  const isStandalone = useSyncExternalStore(
    noopSubscribe,
    getIsStandalone,
    () => false,
  );
  const isIos = useSyncExternalStore(noopSubscribe, getIsIos, () => false);

  useEffect(() => {
    const onBeforeInstall = (e: Event) => {
      // Suppress Chrome's mini-infobar; surface our own affordance instead.
      e.preventDefault();
      setPromptEvent(e as InstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const handleInstall = useCallback(() => {
    const event = promptEvent;
    if (!event) return;
    // Hide immediately on choice — the prompt is one-shot and must not nag.
    setPromptEvent(null);
    void event.prompt().catch(() => {
      /* a failed prompt is non-fatal; the banner is already hidden */
    });
  }, [promptEvent]);

  // Gate 1: eligibility (active goal + 3+ sessions). dismissed === null means
  // the flag hasn't been read yet — stay hidden until it has.
  if (!isInstallEligible(hasActiveGoal, sessionCount)) return null;
  if (dismissed !== false) return null;

  // Gate 2: platform branch.
  const variant = resolveInstallVariant({
    hasInstallPrompt: promptEvent !== null,
    isStandalone,
    isIos,
  });
  if (variant === "none") return null;

  return (
    <InstallBannerView
      variant={variant}
      onInstall={variant === "chrome" ? handleInstall : undefined}
      onDismiss={dismiss}
    />
  );
}
