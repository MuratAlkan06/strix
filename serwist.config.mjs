// @ts-check
/**
 * serwist.config.mjs — configurator-mode build config for the service worker
 * (phase 2.5, S4). `serwist build serwist.config.mjs` (the @serwist/cli bin)
 * bundles src/app/sw.ts → public/sw.js.
 *
 * WHY CONFIGURATOR MODE: this repo is Next 16, which builds with Turbopack by
 * default — @serwist/next's classic webpack-plugin mode (withSerwistInit in
 * next.config.ts) does not run under Turbopack. Configurator mode builds the
 * worker in its own step instead: `next build && serwist build …` in prod
 * (package.json "build"), a one-shot NODE_ENV=development build before
 * `next dev` in dev (package.json "dev"), so the worker registers in BOTH.
 *
 * BUILD ORDER MATTERS: in prod the config reads .next/BUILD_ID (written by
 * `next build`) and injects it into the bundle — every runtime cache name
 * embeds it (strix-shell-<id>, strix-dashboard-<id>), which is how sw.ts
 * recognizes and evicts a previous deploy's caches on activate.
 */
import { readFileSync } from "node:fs";
import { serwist } from "@serwist/next/config";

const isDev = process.env.NODE_ENV === "development";

function resolveBuildId() {
  // Dev workers are rebuilt from scratch each `pnpm dev`; versioning is moot.
  if (isDev) return "dev";
  try {
    return readFileSync(new URL(".next/BUILD_ID", import.meta.url), "utf8").trim();
  } catch {
    throw new Error(
      "serwist.config.mjs: .next/BUILD_ID not found — run `next build` before " +
        "`serwist build` (the service worker cache names embed the build ID).",
    );
  }
}

const buildId = resolveBuildId();

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // TARGETED precache only (S6, amending S4's full disable): the glob-based
  // static manifest stays OFF — empty globPatterns plus precachePrerendered
  // false defeat @serwist/next's defaults — so the precache layer still
  // cannot shadow the versioned strix-* runtime caches. What ships instead is
  // exactly ONE entry, the /~offline fallback screen, revisioned by the build
  // ID so each deploy re-fetches it once. S4's `disablePrecacheManifest: true`
  // had to go: @serwist/build short-circuits the whole manifest — INCLUDING
  // additionalPrecacheEntries — when that flag is set. The @serwist/next
  // default (disable in dev only) now applies, so dev builds keep S4's
  // no-precache behavior; offline fallback is pinned against the prod build
  // by e2e/offline.spec.ts.
  globPatterns: [],
  precachePrerendered: false,
  additionalPrecacheEntries: [{ url: "/~offline", revision: buildId }],
  esbuildOptions: {
    define: {
      "process.env.STRIX_BUILD_ID": JSON.stringify(buildId),
    },
  },
});
