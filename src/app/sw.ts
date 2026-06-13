/**
 * sw.ts — service worker entry (phase 2.5, S4). NOT an App Router route:
 * `serwist build serwist.config.mjs` bundles this file to public/sw.js after
 * `next build` (configurator mode — the Turbopack-compatible @serwist/next
 * path). Registered from the root layout via <SerwistProvider swUrl="/sw.js">.
 *
 * All caching policy lives in src/lib/sw/runtime-caching.ts (pure + unit
 * tested). This file only wires it to the SW lifecycle:
 *   - precacheEntries carries S6's TARGETED manifest: exactly one entry, the
 *     /~offline screen (additionalPrecacheEntries in serwist.config.mjs,
 *     revision = the build ID). The full static manifest stays off, so the
 *     precache still cannot shadow the versioned strix-* runtime caches. In
 *     dev the manifest is disabled entirely (the @serwist/next default) —
 *     offline fallback is a prod-build behavior, pinned by e2e/offline.spec.ts.
 *   - `fallbacks` serves that precached /~offline whenever a document
 *     strategy errors (offline navigation, or /dashboard with an empty
 *     cache). S4 hoped fallbacks alone would suffice "without touching the
 *     runtime rules", but Serwist only attaches the fallback plugin to
 *     runtime-caching strategies — so S6 added the pages-offline-fallback
 *     NetworkOnly rule (stores nothing) at the END of the rule table.
 *   - the activate hook evicts strix-* caches from older builds; the embedded
 *     STRIX_BUILD_ID constant is defined at `serwist build` time from
 *     .next/BUILD_ID (see serwist.config.mjs).
 */
import { Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

import {
  deleteStaleStrixCaches,
  getFallbackEntries,
  getRuntimeCaching,
} from "../lib/sw/runtime-caching";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// Replaced at bundle time by esbuild `define` (serwist.config.mjs) — the Next
// build ID in prod builds, "dev" in development.
const BUILD_ID = process.env.STRIX_BUILD_ID ?? "unversioned";

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  precacheOptions: { cleanupOutdatedCaches: true },
  // New builds take over immediately — stale-cache eviction below depends on
  // the fresh worker activating without waiting for old tabs to close.
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  disableDevLogs: true,
  runtimeCaching: getRuntimeCaching(BUILD_ID),
  // Offline document fallback (S6): Serwist pushes a handlerDidError plugin
  // carrying these entries onto every runtime strategy above, so a failed
  // document fetch answers with the precached /~offline instead of the
  // browser's network-error page.
  fallbacks: { entries: getFallbackEntries() },
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteStaleStrixCaches(self.caches, BUILD_ID));
});

serwist.addEventListeners();
