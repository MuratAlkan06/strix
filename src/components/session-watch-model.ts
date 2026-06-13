/**
 * session-watch-model.ts — pure transition logic for the best-effort session
 * expiry / remote-revocation purge (phase 2.5, S7).
 *
 * The planning doc's "Session-end purge" bullet asks for the purge "on
 * session expiry / remote revocation when detected" — best-effort. The
 * detectable signal on the client is Clerk's `useAuth().isSignedIn` flipping
 * true → false while a watcher is mounted (Clerk polls/refreshes the session
 * in the background, so an expired or remotely revoked session surfaces as
 * exactly that flip). This module is the pure state machine; session-watch.tsx
 * feeds it the hook snapshots.
 *
 * Deliberate choices, pinned by session-watch-model.test.ts:
 *  - No purge before Clerk loads: `isSignedIn` is undefined while loading —
 *    treating that as "signed out" would purge on every cold start.
 *  - No purge when the user was never signed in while watched: a visitor who
 *    lands signed-out has no session-scoped caches that this watcher is
 *    responsible for.
 *  - Purge fires once per true → false transition (re-arms on the next
 *    sign-in), so a single expiry does not loop.
 */

export type SessionWatchSnapshot = {
  /** Clerk has resolved the auth state (useAuth().isLoaded). */
  isLoaded: boolean;
  /** undefined until loaded, then a definite boolean. */
  isSignedIn: boolean | undefined;
};

export type SessionWatchState = {
  /** A signed-in session has been observed while this watcher was mounted. */
  sawSignedIn: boolean;
};

export const INITIAL_WATCH_STATE: SessionWatchState = { sawSignedIn: false };

export function watchSession(
  state: SessionWatchState,
  snapshot: SessionWatchSnapshot,
): { state: SessionWatchState; shouldPurge: boolean } {
  if (!snapshot.isLoaded) {
    return { state, shouldPurge: false };
  }
  if (snapshot.isSignedIn === true) {
    return { state: { sawSignedIn: true }, shouldPurge: false };
  }
  // Loaded and not signed in: purge only on the true → false transition.
  if (state.sawSignedIn) {
    return { state: { sawSignedIn: false }, shouldPurge: true };
  }
  return { state, shouldPurge: false };
}
