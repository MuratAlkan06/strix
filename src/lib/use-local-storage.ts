"use client";

/**
 * use-local-storage.ts — the install-affordance client store (phase 2.5, S8).
 *
 * The install banner is the first feature to keep PER-USER state in
 * localStorage (the #11 analytics-consent store, src/lib/analytics/consent.ts,
 * later added a separate DEVICE-GLOBAL key). Two values here, both gating a
 * single dismissible banner:
 *   - a per-user authenticated SESSION COUNT (banner needs ≥3 sessions), and
 *   - a per-user DISMISSED flag (banner never shows again once dismissed).
 *
 * USER SCOPING (binding, planning-doc "Install affordance" + the purge
 * invariant): every key is prefixed with the Clerk user id, so a different
 * user on a shared device does NOT inherit the previous user's session count
 * or dismissal. The key namespace (`strix.install.*.<userId>`) is enumerated
 * by `installBannerStorageKeys` so the session-end purge (src/lib/sw/purge.ts)
 * can clear exactly these keys — keeping the clean-slate-on-sign-out model
 * intact now that localStorage is no longer empty.
 *
 * SESSION counting (planning-doc "authenticated for 3+ sessions"): the count
 * increments AT MOST ONCE per browser session. A sessionStorage flag — which
 * the browser clears when the tab/session ends — records "already counted this
 * session"; the durable count lives in localStorage. So opening five tabs in
 * one session counts once; returning tomorrow counts again. The pure
 * `recordSession` decision is unit-tested in node against fake storages.
 *
 * SSR safety: the reads go through `useSyncExternalStore` (the same posture as
 * use-online.ts) — the server snapshot is the "not yet known" value, so the
 * server and the first client paint agree (banner hidden) and the real value
 * lands right after hydration with no setState-in-effect and no mismatch.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

const NS = "strix.install";

/** Durable per-user authenticated session count. */
export function sessionCountKey(userId: string): string {
  return `${NS}.sessions.${userId}`;
}

/** Durable per-user "banner dismissed — never show again" flag. */
export function dismissedKey(userId: string): string {
  return `${NS}.dismissed.${userId}`;
}

/** Per-user "already counted THIS session" flag — sessionStorage, so the
 *  browser clears it at session end and the next session counts once more. */
export function sessionCountedFlagKey(userId: string): string {
  return `${NS}.counted.${userId}`;
}

/**
 * Every localStorage key this slice owns for a given user. The session-end
 * purge enumerates this so the clean-slate-on-sign-out guarantee covers the
 * install-banner store too. (The sessionStorage "counted" flag is NOT durable
 * — the browser drops it at session end — so it is intentionally omitted.)
 */
export function installBannerStorageKeys(userId: string): string[] {
  return [sessionCountKey(userId), dismissedKey(userId)];
}

/** Minimal Storage surface — both localStorage and sessionStorage satisfy it,
 *  and a fake satisfies it in node tests. */
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Pure session-count decision (the testable core of the once-per-session
 * counter). Given the durable + session storages and a user id: if this
 * session has not been counted yet, increment the durable count and set the
 * session flag; otherwise leave both untouched. Returns the count to use now.
 *
 * Resilient to corrupt values: a non-numeric durable count is treated as 0.
 */
export function recordSession(
  durable: StorageLike,
  session: StorageLike,
  userId: string,
): number {
  const flagKey = sessionCountedFlagKey(userId);
  const countKey = sessionCountKey(userId);
  const parsed = Number.parseInt(durable.getItem(countKey) ?? "", 10);
  const current = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;

  if (session.getItem(flagKey) === "1") {
    return current;
  }
  const next = current + 1;
  durable.setItem(countKey, String(next));
  session.setItem(flagKey, "1");
  return next;
}

/** localStorage / sessionStorage if the browser exposes it (private-mode /
 *  sandboxed iframes can make access throw), else undefined — a graceful
 *  no-op store. */
function safeStorage(
  kind: "localStorage" | "sessionStorage",
): StorageLike | undefined {
  try {
    return globalThis[kind];
  } catch {
    return undefined;
  }
}

/**
 * A tiny same-tab subscription so `useSyncExternalStore` re-renders after this
 * module writes localStorage (the native `storage` event only fires in OTHER
 * tabs). Both the session increment and the dismissal write notify it.
 */
const subscribers = new Set<() => void>();
function notify(): void {
  for (const fn of subscribers) fn();
}
function subscribe(onChange: () => void): () => void {
  subscribers.add(onChange);
  if (typeof window !== "undefined") {
    // Cross-tab dismissals/counts should reflect here too.
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
 * The per-user authenticated session count, counted at most once per browser
 * session. Returns null until the count has been recorded (SSR + first paint),
 * so the eligibility gate stays closed until the real durable value is known.
 */
export function useSessionCount(userId: string | null | undefined): number | null {
  // The increment is a write to an external system — the correct place for it
  // is an effect, and it does NOT setState (it notifies the external store,
  // which useSyncExternalStore reads below). Runs once per userId.
  useEffect(() => {
    if (!userId) return;
    const durable = safeStorage("localStorage");
    const session = safeStorage("sessionStorage");
    if (!durable || !session) return;
    try {
      recordSession(durable, session, userId);
      notify();
    } catch {
      // A storage that throws mid-write (quota, disabled) leaves the banner
      // gated shut — acceptable: the affordance is a nicety, never a blocker.
    }
  }, [userId]);

  const getSnapshot = useCallback((): number | null => {
    if (!userId) return null;
    const durable = safeStorage("localStorage");
    if (!durable) return null;
    try {
      const raw = durable.getItem(sessionCountKey(userId));
      if (raw === null) return null;
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }, [userId]);

  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}

/**
 * A boolean localStorage flag, user-scoped, SSR-safe via useSyncExternalStore.
 * `[value, setTrue]`: value is null until the store is readable client-side,
 * then the stored boolean; setTrue persists `true` and notifies. Used for the
 * dismissed flag.
 */
export function useBooleanFlag(
  key: string | null,
): [boolean | null, () => void] {
  const getSnapshot = useCallback((): boolean | null => {
    if (!key) return null;
    const durable = safeStorage("localStorage");
    if (!durable) return null;
    try {
      return durable.getItem(key) === "1";
    } catch {
      return false;
    }
  }, [key]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => null);

  const setTrue = useCallback(() => {
    if (!key) return;
    const durable = safeStorage("localStorage");
    if (!durable) {
      notify();
      return;
    }
    try {
      durable.setItem(key, "1");
    } catch {
      // Persisting the dismissal failed (quota/disabled): worst case it
      // reappears next session. Notify so the in-tab read re-runs regardless.
    }
    notify();
  }, [key]);

  return [value, setTrue];
}
