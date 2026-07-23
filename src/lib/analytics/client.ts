/**
 * Client-side PostHog wrapper. Feature code MUST import from here, never
 * from `posthog-js` directly.
 *
 * Auto-capture is disabled — the spec §9 taxonomy is explicit, so we don't
 * want PostHog inventing events for us. Call capture() with named events
 * defined centrally in Phase 5.
 *
 * CONSENT GATE (issue #11): initPostHog is a NO-OP unless the stored analytics
 * consent is "granted" (src/lib/analytics/consent.ts). Deferring init is the
 * control — before consent NOTHING loads, no request is made, no cookie is set.
 * (We deliberately do NOT use posthog's `cookieless_mode: 'on_reject'`: it still
 * sends anonymous events pre-consent, which the #11 acceptance criteria forbid.)
 * When we do init, `opt_out_capturing_by_default` + an explicit opt-in are a
 * defence-in-depth belt-and-braces; the opt-in passes `captureEventName: false`
 * so the implicit `$opt_in` event never fires (taxonomy stays explicit).
 * setAnalyticsConsent is the entry point for THIS tab's own choice (persist +
 * applyConsent). applyConsent is the shared reconcile-the-live-SDK-to-a-value
 * core the banner container ALSO calls to mirror a sibling tab's choice arriving
 * cross-tab via the `storage` event (issue #11 review M1) — so a withdrawal in
 * one tab tears analytics down in every tab, not only the one that clicked.
 * On withdrawal it opts out AND scrubs storage: PostHog's opt_out_capturing()
 * stops capture, disables persistence, and (posthog-js 1.406.2) clears its own
 * persisted store — set_disabled(true) calls remove(), deleting the stored
 * distinct_id/device_id. We still scrub the `ph_` / `__ph_` keys directly as
 * belt-and-braces: it deterministically removes the host-only
 * `ph_<token>_posthog` cookie and the residual opt-out flag, so the #11 AC
 * "PostHog cookies/localStorage removed on withdrawal" holds without relying on
 * SDK-internal cleanup order. `cross_subdomain_cookie: false` keeps that cookie
 * host-only so removal is deterministic in production (a `path=/` delete, no
 * domain guessing).
 */
"use client";

import posthog from "posthog-js";

import {
  persistAnalyticsConsent,
  readAnalyticsConsent,
  type ConsentChoice,
} from "./consent";

let initialized = false;

export function initPostHog(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  // Consent gate: no init (and therefore no network/cookies) until granted.
  if (readAnalyticsConsent() !== "granted") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: false,
    autocapture: false,
    person_profiles: "identified_only",
    // Defence-in-depth: even in the same-tick window before the opt-in below,
    // capturing stays off until we explicitly opt in.
    opt_out_capturing_by_default: true,
    // Host-only cookie so a withdrawal can delete it with a plain `path=/`
    // clear, without knowing the registrable domain (see clearPostHogStorage).
    cross_subdomain_cookie: false,
  });
  // Consent is "granted" here, so opt in immediately — but suppress the implicit
  // `$opt_in` event (captureEventName: false) to keep the event taxonomy explicit.
  posthog.opt_in_capturing({ captureEventName: false });
  initialized = true;
}

/**
 * Remove PostHog's OWN browser storage for this device. opt_out_capturing()
 * already disables persistence and clears its persisted store (posthog-js
 * 1.406.2: set_disabled(true) → remove()), but we still scrub every `ph_` /
 * `__ph_` key directly as belt-and-braces — guaranteeing the host-only cookie
 * and the residual opt-out flag are gone regardless of SDK-internal cleanup.
 * Safe by construction: PostHog owns every `ph_` / `__ph_` key, and our
 * device-global consent lives under `strix.*`, so it is never touched.
 * Persistence is disabled at this point, so nothing is re-written.
 */
function clearPostHogStorage(): void {
  if (typeof window === "undefined") return;
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith("ph_") || key.startsWith("__ph_")) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // storage disabled / private mode — nothing durable was written either.
  }
  const token = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (token) {
    // Mirrors posthog's default cookie name; host-only (cross_subdomain_cookie:
    // false at init), so a plain path=/ expiry deletes it.
    document.cookie = `ph_${token}_posthog=; Max-Age=0; path=/`;
  }
}

/**
 * Reconcile the live PostHog SDK to a consent VALUE — the shared core that both
 * this tab's own choice (setAnalyticsConsent) and the banner container's
 * cross-tab effect route through, so withdrawal is symmetric across tabs (issue
 * #11 review M1). Directions:
 *   - "granted": init (no-op if already inited) and opt in — covers a returning
 *     user AND re-granting after a prior withdrawal (SDK already initialised).
 *   - "denied": if the SDK was ever initialised, opt_out_capturing() (stops
 *     capture, disables persistence) then clearPostHogStorage() (removes the
 *     cookie/localStorage). If it was never initialised there is nothing to tear
 *     down — no-op.
 *   - null (pending): no-op — no choice has been made.
 * Loop-safe: the container effect only re-runs on a genuine consent-VALUE change
 * (useSyncExternalStore bails on an identical snapshot), and the "denied" scrub
 * is idempotent — once the `ph_`/`__ph_` keys are gone a repeat call removes
 * nothing and fires no further `storage` events, so there is no cross-tab loop.
 */
export function applyConsent(consent: ConsentChoice | null): void {
  if (typeof window === "undefined") return;
  if (consent === "granted") {
    initPostHog();
    if (initialized) posthog.opt_in_capturing({ captureEventName: false });
  } else if (consent === "denied" && initialized) {
    posthog.opt_out_capturing();
    clearPostHogStorage();
  }
}

/**
 * Runtime consent transition — the entry point the consent banner and the
 * settings Analytics card call for THIS tab's own choice. Persist the choice
 * (device-global; survives sign-out; notifies same-tab subscribers AND, via the
 * native `storage` event, sibling tabs) and reconcile this tab's live SDK to it.
 */
export function setAnalyticsConsent(choice: ConsentChoice): void {
  persistAnalyticsConsent(choice);
  applyConsent(choice);
}

// Defence-in-depth for capture()/identify(): gate on BOTH the module `initialized`
// flag AND the LIVE consent value, so an event can never slip through after a
// withdrawal (in this OR a sibling tab) even if some future path leaves
// `initialized` true. This robustness ALSO relies on `opt_out_capturing_by_default:
// true` staying set at init (see initPostHog) — the SDK-level backstop this gate
// pairs with; do NOT drop it as "redundant".
export function capture(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (!initialized) return;
  if (readAnalyticsConsent() !== "granted") return;
  posthog.capture(event, properties);
}

export function identify(
  distinctId: string,
  properties: Record<string, unknown> = {},
): void {
  if (!initialized) return;
  if (readAnalyticsConsent() !== "granted") return;
  posthog.identify(distinctId, properties);
}
