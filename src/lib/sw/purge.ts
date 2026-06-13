/**
 * purge.ts — session-end client-storage purge (phase 2.5, S7; extended S8).
 *
 * Shared-device safety per planning/phase-2.5-pwa-polish.md "Session-end
 * purge": when a session ends (sign-out, expiry, remote revocation), the next
 * user on the device must not see the previous user's data offline.
 *
 * TWO storage surfaces are cleared:
 *   1. ALL Cache Storage entries — deliberately not scoped to `strix-*`: the
 *      planning doc accepts evicting the user-agnostic app shell for MVP (one
 *      static re-download) over per-user cache partitioning, and a full clear
 *      is strictly stronger than a prefix-scoped one (it also catches the
 *      Serwist-internal precache, which lives outside the strix- prefix).
 *   2. The install-banner localStorage keys (S8): every `strix.install.*` key.
 *      Like the Cache-Storage clear, this is a prefix-wide sweep, not a single
 *      user's keys — on a shared device the clean slate must cover ANY prior
 *      user's per-user install state, and it's strictly stronger than scoping
 *      to one userId (which the sign-out caller may not even have to hand).
 *
 * INVARIANT (updated S8): Cache Storage is NO LONGER the only client storage —
 * the install affordance (S8) keeps a per-user session count + dismissed flag
 * in localStorage under the `strix.install.` prefix
 * (src/lib/use-local-storage.ts). Those keys ARE user-scoped (Clerk user id
 * suffix) AND are cleared here on session end, so the shared-device guarantee
 * holds. No IndexedDB is used. If a future slice adds IndexedDB-backed storage
 * (Serwist ExpirationPlugin, BackgroundSync queues, a client data store), this
 * purge MUST be extended to cover it too.
 *
 * ORDERING CONTRACT for callers: the planning doc warns a navigation mid-purge
 * can cut it short. Await this function to completion BEFORE initiating any
 * sign-out redirect — see sign-out-button.tsx, where the only navigation is the
 * one `signOut()` itself performs after the purge settles.
 *
 * Errors propagate to the caller: session-end callers must still sign out on
 * purge failure (auth wins), so the catch-and-warn lives at the call site,
 * not here. Like deleteStaleStrixCaches, the storage surfaces are injectable so
 * the policy is unit-testable in a node environment.
 */

export type CacheStorageLike = Pick<CacheStorage, "keys" | "delete">;

/** The localStorage surface the purge needs: enumerate keys + remove. Both the
 *  real `globalThis.localStorage` and a node test fake satisfy this. */
export type LocalStorageLike = Pick<Storage, "length" | "key" | "removeItem">;

/** The localStorage prefix the install affordance owns (S8). Re-declared here
 *  rather than imported so the purge has no dependency on a "use client"
 *  module; the prefix is a stable contract, asserted by purge.test.ts. */
const INSTALL_STORAGE_PREFIX = "strix.install.";

/** The default surface: `globalThis.caches` where the Cache API exists.
 * Typed optional because the DOM lib declares `caches` unconditionally, but
 * insecure contexts and older browsers do not provide it at runtime. */
function defaultCacheStorage(): CacheStorageLike | undefined {
  return (globalThis as { caches?: CacheStorage }).caches;
}

/** The default localStorage surface, guarded: access can throw in sandboxed
 *  iframes / disabled-storage modes, so a failure resolves to undefined. */
function defaultLocalStorage(): LocalStorageLike | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage;
  } catch {
    return undefined;
  }
}

/** Remove every `strix.install.*` key from the given localStorage. A missing
 *  store is a no-op. Collect-then-remove so removal doesn't shift indices
 *  mid-enumeration. */
function purgeInstallStorage(store: LocalStorageLike | undefined): void {
  if (!store) return;
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key !== null && key.startsWith(INSTALL_STORAGE_PREFIX)) keys.push(key);
  }
  for (const key of keys) store.removeItem(key);
}

/**
 * Delete every cache the browser holds for this origin AND every install-banner
 * localStorage key. Resolves only after all cache deletions settle; rejects if
 * cache enumeration or any deletion fails. A missing Cache API is a successful
 * no-op — nothing was ever stored there. The localStorage sweep runs first and
 * synchronously (cheap, best-effort) so a later cache rejection still leaves
 * the client store cleared.
 */
export async function purgeClientCaches(
  cacheStorage: CacheStorageLike | undefined = defaultCacheStorage(),
  localStorage: LocalStorageLike | undefined = defaultLocalStorage(),
): Promise<void> {
  purgeInstallStorage(localStorage);
  if (!cacheStorage) return;
  const keys = await cacheStorage.keys();
  await Promise.all(keys.map((key) => cacheStorage.delete(key)));
}
