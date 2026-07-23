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
 * setAnalyticsConsent is the single entry point the banner + settings call to
 * change the choice at runtime. On withdrawal it opts out AND scrubs storage:
 * PostHog's opt_out_capturing() stops capture and disables persistence, but it
 * does NOT delete the already-stored distinct_id/device_id and exposes no API
 * that does (verified against posthog-js 1.x — reset() can't help once
 * persistence is disabled). So we remove PostHog's own browser storage directly,
 * making the #11 AC "PostHog cookies/localStorage removed on withdrawal" hold.
 * `cross_subdomain_cookie: false` keeps the cookie host-only so that removal is
 * deterministic in production (a `path=/` delete, no domain guessing).
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
 * stops capture and disables persistence but leaves the already-written
 * distinct_id/device_id behind, and posthog offers no delete API — so we clear
 * its prefixed keys directly. Safe by construction: PostHog owns every `ph_` /
 * `__ph_` key, and our device-global consent lives under `strix.*`, so it is
 * never touched. Persistence is disabled at this point, so nothing is re-written.
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
 * Runtime consent transition — the ONE entry point the consent banner and the
 * settings Analytics card call. "granted": persist, init (no-op if already
 * inited), and opt back in (covers re-granting after a prior withdrawal, where
 * the SDK is already initialised). "denied": persist, and if the SDK was ever
 * initialised, opt_out_capturing() (stops capture) followed by clearPostHogStorage()
 * (removes the cookie/localStorage it set). Persistence is device-global
 * (survives sign-out).
 */
export function setAnalyticsConsent(choice: ConsentChoice): void {
  persistAnalyticsConsent(choice);
  if (choice === "granted") {
    initPostHog();
    if (initialized) posthog.opt_in_capturing({ captureEventName: false });
  } else if (initialized) {
    posthog.opt_out_capturing();
    clearPostHogStorage();
  }
}

export function capture(
  event: string,
  properties: Record<string, unknown> = {},
): void {
  if (!initialized) return;
  posthog.capture(event, properties);
}

export function identify(
  distinctId: string,
  properties: Record<string, unknown> = {},
): void {
  if (!initialized) return;
  posthog.identify(distinctId, properties);
}

export { posthog };
