/**
 * sw.ts — service worker entry (phase 2.5, S4). NOT an App Router route:
 * `serwist build serwist.config.mjs` bundles this file to public/sw.js after
 * `next build` (configurator mode — the Turbopack-compatible @serwist/next
 * path). Registered from the root layout via <SerwistProvider swUrl="/sw.js">.
 *
 * All caching policy lives in src/lib/sw/runtime-caching.ts (pure + unit
 * tested). This file only wires it to the SW lifecycle:
 *   - precacheEntries stays plumbed but EMPTY in S4 (the static manifest is
 *     disabled in serwist.config.mjs so precache cannot shadow the versioned
 *     strix-* runtime caches). S6 adds its offline-fallback entries — and a
 *     `fallbacks` option on the Serwist instance below — without touching the
 *     runtime rules.
 *   - the activate hook evicts strix-* caches from older builds; the embedded
 *     STRIX_BUILD_ID constant is defined at `serwist build` time from
 *     .next/BUILD_ID (see serwist.config.mjs).
 */
import { Serwist } from "serwist";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";

import {
  deleteStaleStrixCaches,
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
});

self.addEventListener("activate", (event) => {
  event.waitUntil(deleteStaleStrixCaches(self.caches, BUILD_ID));
});

serwist.addEventListeners();
