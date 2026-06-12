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
 *                   enumerating caches.keys().
 *   4. app shell   CacheFirst — /_next/static (JS/CSS chunks + next/font
 *                   assets), /icons/*, the manifest, and script/style/font
 *                   destinations.
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
import { CacheFirst, NetworkOnly, StaleWhileRevalidate } from "serwist";
import type { RuntimeCaching } from "serwist";

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
  | "app-shell-cache-first";

/** RuntimeCaching plus a stable id so tests can pin rule identity + order. */
export type StrixRuntimeCaching = RuntimeCaching & { id: StrixRuleId };

/** Same-origin destinations that are app shell wherever they live. */
const SHELL_DESTINATIONS: readonly string[] = ["script", "style", "font"];

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
      handler: new StaleWhileRevalidate({ cacheName: names.dashboard }),
    },
    {
      id: "app-shell-cache-first",
      matcher: ({ url, request, sameOrigin }) =>
        sameOrigin &&
        (url.pathname.startsWith("/_next/static/") ||
          url.pathname.startsWith("/icons/") ||
          url.pathname === "/manifest.webmanifest" ||
          SHELL_DESTINATIONS.includes(request.destination)),
      handler: new CacheFirst({ cacheName: names.shell }),
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
