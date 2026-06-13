/**
 * runtime-caching.ts — the service worker's caching rules (phase 2.5, S4).
 *
 * EXPLICIT strategy table per planning/phase-2.5-pwa-polish.md "Service
 * worker" — deliberately NOT Serwist's defaultCache (its NetworkFirst page
 * strategy contradicts the spec's StaleWhileRevalidate dashboard). Rules are
 * evaluated IN ORDER; the first matcher to return true wins, so precedence is
 * part of the contract and pinned by runtime-caching.test.ts:
 *
 *   1. /api/ai/*   NetworkOnly — AI responses must NEVER be cached or
 *                   replayed. Its own rule ABOVE the general API rule so the
 *                   guarantee is visible here and testable in isolation.
 *   2. /api/*      NetworkOnly — no offline mutations in MVP; nothing stored.
 *   3. /dashboard  StaleWhileRevalidate — the route HTML and its RSC payloads
 *                   (same pathname, `?_rsc=` + RSC header) land in the NAMED
 *                   dashboard cache: yesterday's dashboard renders instantly
 *                   offline, fresh data lands when online. This named cache IS
 *                   the "last-loaded dashboard data" carve-out — no separate
 *                   JSON/IndexedDB store; S7's sign-out purge targets it by
 *                   enumerating caches.keys(). ONLY status-200 responses are
 *                   admitted (security review L1): without the explicit
 *                   CacheableResponsePlugin, Serwist's default plugin also
 *                   admits status 0 (opaqueredirect), so a signed-out
 *                   navigation's auth redirect would poison the cache and be
 *                   served stale to the next signed-in user on the device.
 *   4. app shell   CacheFirst — /_next/static (JS/CSS chunks + next/font
 *                   assets, which next/font serves under /_next/static/media),
 *                   /icons/*, and the manifest. Explicit path prefixes ONLY —
 *                   no script/style/font destination catch-all (security
 *                   review L2: a destination catch-all would CacheFirst-pin
 *                   same-origin assets at ANY path indefinitely).
 *   5. pages       NetworkOnly + offline fallback (phase 2.5, S6) — every
 *                   OTHER same-origin document request. Stores NOTHING (the
 *                   spec's "no offline mutations / no other route caching"
 *                   stands); the rule exists because Serwist's `fallbacks`
 *                   option only attaches its handlerDidError plugin to
 *                   runtime-caching strategies — a request no rule matches
 *                   never enters a strategy, so it could never fall back to
 *                   the precached /~offline screen. Online this rule is a
 *                   pure passthrough; offline the failed fetch triggers the
 *                   fallback (getFallbackEntries below). LAST on purpose:
 *                   /dashboard documents keep their SWR rule (3), so a
 *                   cached dashboard still renders offline, and an
 *                   empty-cache /dashboard falls back to /~offline too.
 *
 * Cross-origin requests match nothing → network passthrough, never stored.
 *
 * VERSIONING: every cache name embeds the Next build ID (injected at
 * `serwist build` time — see serwist.config.mjs), and deleteStaleStrixCaches
 * runs on activate so old builds' caches are evicted on deploy.
 *
 * This module is pure (no SW globals at module scope) so vitest can classify
 * requests through the real rule table in a node environment.
 */
import {
  CacheFirst,
  CacheableResponsePlugin,
  NetworkOnly,
  StaleWhileRevalidate,
} from "serwist";
// PrecacheFallbackEntry is the exported name of the `fallbacks.entries`
// element type (Serwist's own FallbackEntry alias is not exported).
import type { PrecacheFallbackEntry, RuntimeCaching } from "serwist";

/**
 * The offline fallback document (phase 2.5, S6). Precached by
 * serwist.config.mjs (`additionalPrecacheEntries`, revision = the build ID)
 * and served by the fallback plugin whenever a document strategy errors —
 * i.e. the device is offline and the runtime caches cannot answer. The route
 * is Clerk-public (src/proxy.ts): the precache install fetch must receive
 * the page itself, never an auth redirect.
 */
export const OFFLINE_FALLBACK_URL = "/~offline";

/**
 * Common prefix of every runtime cache this app owns. S7's session-end purge
 * and the activate-time eviction below both key off it; the precache cache
 * (Serwist-internal naming) is intentionally outside the prefix.
 */
export const STRIX_CACHE_PREFIX = "strix-";

/** Versioned cache names — deterministic, so S7 can also target them by name. */
export function strixCacheNames(buildId: string) {
  return {
    shell: `${STRIX_CACHE_PREFIX}shell-${buildId}`,
    dashboard: `${STRIX_CACHE_PREFIX}dashboard-${buildId}`,
  } as const;
}

export type StrixRuleId =
  | "ai-never-cached"
  | "api-network-only"
  | "dashboard-swr"
  | "app-shell-cache-first"
  | "pages-offline-fallback";

/** RuntimeCaching plus a stable id so tests can pin rule identity + order. */
export type StrixRuntimeCaching = RuntimeCaching & { id: StrixRuleId };

export function getRuntimeCaching(buildId: string): StrixRuntimeCaching[] {
  const names = strixCacheNames(buildId);
  return [
    {
      id: "ai-never-cached",
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/api/ai/"),
      handler: new NetworkOnly(),
    },
    {
      id: "api-network-only",
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/api/"),
      handler: new NetworkOnly(),
    },
    {
      id: "dashboard-swr",
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname === "/dashboard",
      handler: new StaleWhileRevalidate({
        cacheName: names.dashboard,
        // Only real dashboards enter the cache. Supplying a cacheWillUpdate
        // plugin also displaces Serwist's default cacheOkAndOpaquePlugin,
        // which would otherwise admit status-0 opaqueredirect responses
        // (signed-out auth redirects) — security review L1.
        plugins: [new CacheableResponsePlugin({ statuses: [200] })],
      }),
    },
    {
      id: "app-shell-cache-first",
      matcher: ({ url, sameOrigin }) =>
        sameOrigin &&
        (url.pathname.startsWith("/_next/static/") ||
          url.pathname.startsWith("/icons/") ||
          url.pathname === "/manifest.webmanifest"),
      handler: new CacheFirst({ cacheName: names.shell }),
    },
    {
      id: "pages-offline-fallback",
      // Documents only (full navigations). RSC payload fetches report
      // destination "" and stay unmatched — offline client-side navigation
      // failures degrade to Next's own hard-navigation retry, which IS a
      // document request and lands here.
      matcher: ({ request, sameOrigin }) =>
        sameOrigin && request.destination === "document",
      // Stores nothing. The strategy exists to FAIL offline so the fallback
      // plugin (attached by the Serwist constructor from getFallbackEntries)
      // can answer with the precached /~offline.
      handler: new NetworkOnly(),
    },
  ];
}

/**
 * `fallbacks.entries` for the Serwist instance (sw.ts): when any runtime
 * strategy above errors on a DOCUMENT request — offline navigation to an
 * uncached route, or to /dashboard with an empty cache (the signed-out /
 * post-purge device) — serve the precached offline screen instead. Non-
 * document failures (API fetches, assets) propagate untouched: an AI or API
 * call must surface its real error, never a ghost HTML response.
 */
export function getFallbackEntries(): PrecacheFallbackEntry[] {
  return [
    {
      url: OFFLINE_FALLBACK_URL,
      matcher: ({ request }) => request.destination === "document",
    },
  ];
}

/**
 * Delete every strix-* cache that does not belong to `buildId`. Called from
 * sw.ts on activate, after a new build's worker takes over — the runtime
 * analogue of `cleanupOutdatedCaches` (which only covers the precache).
 * CacheStorage is injected so the eviction policy is unit-testable.
 */
export async function deleteStaleStrixCaches(
  cacheStorage: Pick<CacheStorage, "keys" | "delete">,
  buildId: string,
): Promise<void> {
  const current = new Set<string>(Object.values(strixCacheNames(buildId)));
  const keys = await cacheStorage.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(STRIX_CACHE_PREFIX) && !current.has(key))
      .map((key) => cacheStorage.delete(key)),
  );
}
