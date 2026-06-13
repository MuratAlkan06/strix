"use client";

/**
 * use-online.ts — SSR-safe connectivity state (phase 2.5 S6).
 *
 * `useSyncExternalStore` over navigator.onLine + the window online/offline
 * events: the server snapshot is `true` (the server rendered this page, so
 * the connection existed; an actually-offline client corrects itself right
 * after hydration — exactly the moment the offline UI can do anything
 * useful). No state, no effects, no hydration mismatch.
 *
 * Used by the dashboard offline UI (indicator + disabled check-off). The
 * spec keeps MVP offline handling presentational — no queued mutations —
 * so this hook is deliberately just a boolean, not a sync manager.
 *
 * navigator.onLine `false` is trustworthy (definitely offline); `true` is
 * the browser's best guess (LAN without internet still reports true). Good
 * enough for a calm indicator; real failures still surface through the
 * action error paths.
 */
import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("online", onStoreChange);
  window.addEventListener("offline", onStoreChange);
  return () => {
    window.removeEventListener("online", onStoreChange);
    window.removeEventListener("offline", onStoreChange);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
