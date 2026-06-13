/**
 * install-platform.ts — pure platform decisions for the install affordance
 * (phase 2.5, S8). No DOM access here; the component passes in the signals it
 * read so this logic is unit-testable in node.
 *
 * Three reachable banner states (planning-doc "Install affordance" + "Platform
 * branch"):
 *   - "none"   — already installed (standalone) OR not yet eligible. Nothing.
 *   - "ios"    — iOS Safari, not standalone, no beforeinstallprompt available:
 *                show the calm "Add to Home Screen" instructions.
 *   - "chrome" — a beforeinstallprompt event was captured: show the native
 *                Install button that calls prompt().
 *
 * "standalone" detection is two-pronged because the two platforms disagree:
 * iOS exposes the legacy `navigator.standalone` boolean; everyone else honors
 * the `display-mode: standalone` media query. Either true → already installed.
 */

export type InstallVariant = "none" | "ios" | "chrome";

export type InstallSignals = {
  /** A `beforeinstallprompt` event has been captured and stashed (Chrome/
   *  Android). When true, the native install flow is available. */
  hasInstallPrompt: boolean;
  /** Running as an installed app already (either standalone signal true). */
  isStandalone: boolean;
  /** iOS Safari heuristic: the platform that needs manual "Add to Home
   *  Screen" instructions because it fires no beforeinstallprompt. */
  isIos: boolean;
};

/**
 * Resolve which banner variant the platform signals call for — assuming the
 * eligibility gates (active goal + session count + not dismissed) have already
 * passed. Eligibility is handled by the caller; this is purely the platform
 * branch.
 */
export function resolveInstallVariant(signals: InstallSignals): InstallVariant {
  // Already installed: never offer to install again, on any platform.
  if (signals.isStandalone) return "none";
  // A captured prompt means the native flow is the right one (Chrome/Android).
  if (signals.hasInstallPrompt) return "chrome";
  // iOS Safari fires no prompt — manual instructions are the only path.
  if (signals.isIos) return "ios";
  // Desktop browsers with no prompt and no iOS: nothing actionable to show.
  return "none";
}

/** True if BOTH eligibility gates pass: ≥1 active goal AND ≥3 sessions. */
export function isInstallEligible(
  hasActiveGoal: boolean,
  sessionCount: number | null,
): boolean {
  return hasActiveGoal && sessionCount !== null && sessionCount >= 3;
}

/** iOS Safari heuristic from a user-agent string. iPad on iPadOS 13+ reports a
 *  Mac UA, so the touch-capable Mac case is included by the caller (it passes
 *  maxTouchPoints); here we match the explicit iOS device tokens. */
export function isIosUserAgent(ua: string): boolean {
  return /iphone|ipad|ipod/i.test(ua);
}
