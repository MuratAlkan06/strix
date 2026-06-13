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

export default serwist({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  // S4 ships EXPLICIT runtime caching only (the planning doc's strategy
  // table); the full static precache manifest stays OFF so the precache layer
  // cannot shadow the versioned strix-* runtime caches. The injection point
  // stays wired in sw.ts — S6 (offline fallback) re-enables targeted precache
  // entries through this config without touching the runtime rules.
  disablePrecacheManifest: true,
  esbuildOptions: {
    define: {
      "process.env.STRIX_BUILD_ID": JSON.stringify(resolveBuildId()),
    },
  },
});
