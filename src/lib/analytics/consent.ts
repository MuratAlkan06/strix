"use client";

/**
 * consent.ts — the analytics-consent client store (issue #11, cookie consent
 * for PostHog).
 *
 * ONE value: the user's analytics choice, "granted" | "denied", with UNSET
 * meaning "pending" (never decided). It gates whether the PostHog browser SDK
 * is initialised at all (src/lib/analytics/client.ts reads this before
 * posthog.init) — a defer-init consent model: nothing loads, no request is
 * made, no cookie is set until the choice is "granted".
 *
 * DEVICE-GLOBAL scoping (deliberate, and the OPPOSITE of use-local-storage.ts's
 * per-user install keys): the consent key carries NO Clerk user id. A privacy
 * choice is a property of the browser/device, not of whoever is signed in, so
 * it must survive sign-out. It is intentionally OUTSIDE the `strix.install.`
 * namespace the session-end purge sweeps (src/lib/sw/purge.ts), so signing out
 * on a shared device clears cached data but NOT the analytics decision. Do NOT
 * add this key to any purge list.
 *
 * SSR safety: reads go through useSyncExternalStore (the same posture as
 * use-local-storage.ts / use-online.ts) — the server + first-paint snapshot is
 * null ("not yet known"), so server and first client render agree and the real
 * value lands right after hydration with no setState-in-effect and no mismatch.
 * Callers that must not FLASH a pending banner for an already-decided user gate
 * additionally on a mounted flag (see consent-banner.tsx).
 */
import { useCallback, useSyncExternalStore } from "react";

/** Device-global (NOT user-scoped) analytics-consent key. Kept out of the
 *  `strix.install.` prefix the purge sweeps so the choice survives sign-out. */
export const ANALYTICS_CONSENT_KEY = "strix.consent.analytics";

/** A decided choice. Absence of a stored value = pending (represented as null
 *  by the reads below). */
export type ConsentChoice = "granted" | "denied";

/** Minimal Storage surface — real localStorage and a node test fake satisfy it. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Pure decision: coerce a raw stored value to a valid choice, else null. Any
 * value that is not exactly "granted" or "denied" (missing, corrupt, legacy) is
 * treated as pending — the safe default is "analytics off, ask again". Unit
 * tested in node.
 */
export function parseConsent(raw: string | null): ConsentChoice | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

/** localStorage if the browser exposes it (private-mode / sandboxed iframes can
 *  make access throw), else undefined — a graceful no-op store. */
function safeStorage(): StorageLike | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Read the persisted choice from a storage (defaults to localStorage). Returns
 * null when pending, unreadable, or absent — the "analytics stays off" default.
 */
export function readAnalyticsConsent(
  store: StorageLike | undefined = safeStorage(),
): ConsentChoice | null {
  if (!store) return null;
  try {
    return parseConsent(store.getItem(ANALYTICS_CONSENT_KEY));
  } catch {
    return null;
  }
}

/**
 * A tiny same-tab subscription so useSyncExternalStore re-renders after a write
 * (the native `storage` event only fires in OTHER tabs). setAnalyticsConsent
 * (client.ts) notifies through persistAnalyticsConsent below.
 */
const subscribers = new Set<() => void>();
function notify(): void {
  for (const fn of subscribers) fn();
}
function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  if (typeof window !== "undefined") {
    window.addEventListener("storage", onChange);
  }
  return () => {
    subscribers.delete(onChange);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", onChange);
    }
  };
}

/**
 * Persist the choice and notify same-tab subscribers so the banner + settings
 * switch reflect it immediately. A storage that throws (quota/disabled) still
 * notifies, so the in-tab read re-runs — worst case the choice is not durable
 * and the banner reappears next load, never a crash. The posthog side-effects
 * (init / opt-in / opt-out) live in client.ts's setAnalyticsConsent, which
 * calls this; this module holds NO posthog dependency.
 */
export function persistAnalyticsConsent(choice: ConsentChoice): void {
  const store = safeStorage();
  try {
    store?.setItem(ANALYTICS_CONSENT_KEY, choice);
  } catch {
    // non-durable write (quota/disabled) — fall through to notify anyway.
  }
  notify();
}

/**
 * SSR-safe subscription to the current choice. Returns null on the server and
 * first paint (getServerSnapshot), then the real value after hydration; null
 * also means pending/unreadable. Re-renders on any same-tab or cross-tab write.
 */
export function useAnalyticsConsent(): ConsentChoice | null {
  const getSnapshot = useCallback((): ConsentChoice | null => {
    return readAnalyticsConsent();
  }, []);
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
