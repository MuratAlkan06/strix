"use client";

/**
 * SessionWatch — best-effort session expiry / remote-revocation purge
 * (phase 2.5, S7). Renders nothing; feeds Clerk auth snapshots through the
 * pure watchSession machine and fires purgeClientCaches when a signed-in
 * session ends while mounted.
 *
 * COVERAGE LIMIT (honest): mounted on /settings only, so it observes a
 * session end only while the user is on the settings surface. App-wide
 * coverage needs this component in the root layout — a one-line follow-up
 * deferred because src/app/layout.tsx is owned by the parallel S6 slice
 * (offline fallback). The sign-out button is the primary, fully-covered
 * purge path; this watcher is the best-effort layer the planning doc asks
 * for ("on session expiry / remote revocation when detected").
 *
 * When the user signs out via the button on this page, the button's own
 * purge runs first and this watcher fires a second purge on the auth flip —
 * harmless: purging an already-empty Cache Storage is idempotent.
 */
import { useEffect, useRef } from "react";
import { useAuth } from "@clerk/nextjs";

import { purgeClientCaches } from "@/lib/sw/purge";
import { INITIAL_WATCH_STATE, watchSession } from "./session-watch-model";

export function SessionWatch() {
  const { isLoaded, isSignedIn } = useAuth();
  const stateRef = useRef(INITIAL_WATCH_STATE);

  useEffect(() => {
    const result = watchSession(stateRef.current, { isLoaded, isSignedIn });
    stateRef.current = result.state;
    if (result.shouldPurge) {
      // Best-effort: a failed purge must not break the page; the failure is
      // surfaced for diagnosis but auth state is already gone either way.
      purgeClientCaches().catch((error: unknown) => {
        console.warn("[strix] session-end cache purge failed", error);
      });
    }
  }, [isLoaded, isSignedIn]);

  return null;
}
