/**
 * Client-side PostHog wrapper. Feature code MUST import from here, never
 * from `posthog-js` directly.
 *
 * Auto-capture is disabled — the spec §9 taxonomy is explicit, so we don't
 * want PostHog inventing events for us. Call capture() with named events
 * defined centrally in Phase 5.
 */
"use client";

import posthog from "posthog-js";

let initialized = false;

export function initPostHog(): void {
  if (initialized) return;
  if (typeof window === "undefined") return;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host:
      process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
    capture_pageview: false,
    autocapture: false,
    person_profiles: "identified_only",
  });
  initialized = true;
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
