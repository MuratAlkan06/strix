/**
 * purge.ts — session-end client-storage purge (phase 2.5, S7).
 *
 * Shared-device safety per planning/phase-2.5-pwa-polish.md "Session-end
 * purge": when a session ends (sign-out, expiry, remote revocation), the next
 * user on the device must not see the previous user's dashboard offline.
 *
 * FULL clear of ALL Cache Storage entries — deliberately not scoped to
 * `strix-*`: the planning doc accepts evicting the user-agnostic app shell
 * for MVP (one static re-download) over per-user cache partitioning, and a
 * full clear is strictly stronger than a prefix-scoped one (it also catches
 * the Serwist-internal precache, which lives outside the strix- prefix).
 *
 * INVARIANT (S4 security review, PR #61): Cache Storage is the COMPLETE
 * client-side storage surface today. Strix keeps nothing in localStorage or
 * IndexedDB — the "last-loaded dashboard data" carve-out IS the named
 * `strix-dashboard-<build>` service-worker cache (see runtime-caching.ts),
 * not a separate JSON/IndexedDB store. Enumerating `caches.keys()` therefore
 * purges everything. If a future slice adds any IndexedDB-backed storage
 * (Serwist ExpirationPlugin, BackgroundSync queues, a client data store),
 * this purge MUST be extended to cover it.
 *
 * ORDERING CONTRACT for callers: the planning doc warns a navigation
 * mid-purge can cut it short. Await this function to completion BEFORE
 * initiating any sign-out redirect — see sign-out-button.tsx, where the only
 * navigation is the one `signOut()` itself performs after the purge settles.
 *
 * Errors propagate to the caller: session-end callers must still sign out on
 * purge failure (auth wins), so the catch-and-warn lives at the call site,
 * not here. Like deleteStaleStrixCaches, the CacheStorage is injectable so
 * the policy is unit-testable in a node environment.
 */

export type CacheStorageLike = Pick<CacheStorage, "keys" | "delete">;

/** The default surface: `globalThis.caches` where the Cache API exists.
 * Typed optional because the DOM lib declares `caches` unconditionally, but
 * insecure contexts and older browsers do not provide it at runtime. */
function defaultCacheStorage(): CacheStorageLike | undefined {
  return (globalThis as { caches?: CacheStorage }).caches;
}

/**
 * Delete every cache the browser holds for this origin. Resolves only after
 * all deletions settle; rejects if enumeration or any deletion fails. A
 * missing Cache API is a successful no-op — nothing was ever stored there.
 */
export async function purgeClientCaches(
  cacheStorage: CacheStorageLike | undefined = defaultCacheStorage(),
): Promise<void> {
  if (!cacheStorage) return;
  const keys = await cacheStorage.keys();
  await Promise.all(keys.map((key) => cacheStorage.delete(key)));
}
