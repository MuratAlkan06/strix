"use client";

/**
 * SessionWatch — best-effort session expiry / remote-revocation purge
 * (phase 2.5, S7). Renders nothing; feeds Clerk auth snapshots through the
 * pure watchSession machine and fires purgeClientCaches when a signed-in
 * session ends while mounted.
 *
 * Mounted app-wide in the root layout (ADR-0002 CS-4), inside <ClerkProvider>
 * so useAuth() is available — so it observes a session end on any surface, not
 * just /settings. The sign-out button remains the primary, fully-covered purge
 * path; this watcher is the best-effort layer the planning doc asks for ("on
 * session expiry / remote revocation when detected").
 *
 * When the user signs out via the button, the button's own purge runs first
 * and this watcher fires a second purge on the auth flip — harmless: purging
 * an already-empty Cache Storage is idempotent.
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
