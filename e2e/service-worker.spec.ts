/**
 * service-worker.spec.ts — live proof of the S4 service-worker contract
 * against the production server the verify:ui harness boots (webServer in
 * playwright.config.ts builds + serves the real sw.js).
 *
 * Target page: /playground/dashboard — the auth-exempt curation route (same
 * reasoning as the screenshot specs: it renders deterministically with zero
 * Clerk secrets, in CI and locally). The root layout registers the worker on
 * every route, so the playground is a fully representative registration
 * surface.
 *
 * What this pins beyond the unit table (runtime-caching.test.ts classifies
 * matchers in isolation):
 *   1. /sw.js is actually served (200, JS content type).
 *   2. The registration in the root layout reaches "activated + controlling"
 *      (skipWaiting + clientsClaim) — registration is not silently disabled.
 *   3. Real shell traffic lands in the NAMED, build-versioned strix-shell-*
 *      cache that slice S7's purge will enumerate.
 *   4. After API traffic — including /api/ai/* — NO cache anywhere contains
 *      any /api/ entry. (A /manifest.webmanifest fetch is used as a write
 *      sentinel: once IT is cached, earlier cache writes have flushed, so the
 *      negative assertions are meaningful.)
 *   5. Signed-out /dashboard traffic caches NOTHING (security review L1).
 *      /dashboard is auth-protected, so every response the unauthenticated
 *      harness can produce is an auth redirect (status 0 opaqueredirect under
 *      `redirect: "manual"`). Before the CacheableResponsePlugin fix, Serwist's
 *      default plugin DID admit those status-0 redirects into
 *      strix-dashboard-* — the cache-poisoning vector the review flagged. Now
 *      only status-200 responses are admitted, so no strix-dashboard-* entry
 *      may exist here at all (the cache is not even materialized — Serwist
 *      opens it on first successful write). The positive SWR path (cache name,
 *      strategy, 200-only admission) is pinned by the unit table; the offline
 *      render itself is slice S6's surface.
 */
import { test, expect, type Page } from "@playwright/test";

const ROUTE = "/playground/dashboard";

/** Navigate and wait until the service worker is activated AND controlling. */
async function gotoControlled(page: Page): Promise<void> {
  await page.goto(ROUTE);
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

test("serves /sw.js and the registration takes control of the page", async ({
  page,
}) => {
  const response = await page.request.get("/sw.js");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("javascript");

  await gotoControlled(page);
  const controllerUrl = await page.evaluate(
    () => navigator.serviceWorker.controller?.scriptURL ?? null,
  );
  expect(controllerUrl).toContain("/sw.js");
});

test("app-shell traffic lands in the versioned strix-shell cache", async ({
  page,
}) => {
  await gotoControlled(page);
  // Reload so the page's static assets re-flow through the (now controlling)
  // worker; cache writes are async, so poll.
  await page.reload();
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    const shell = names.find((name) => name.startsWith("strix-shell-"));
    if (!shell) return false;
    const keys = await (await caches.open(shell)).keys();
    return keys.some((request) =>
      new URL(request.url).pathname.startsWith("/_next/static/"),
    );
  });
});

test("signed-out dashboard traffic and /api/ traffic are never cached", async ({
  page,
}) => {
  await gotoControlled(page);
  await page.evaluate(async () => {
    // A signed-out dashboard visit (unauthenticated → auth redirect; `manual`
    // avoids chasing the Clerk sign-in host, which is unreachable in CI, and
    // yields the status-0 opaqueredirect the L1 plugin must reject).
    await fetch("/dashboard", { redirect: "manual" }).catch(() => null);
    // API traffic, including the AI endpoints (POST is how they are really
    // called; a GET probes the matcher path too). All NetworkOnly.
    await fetch("/api/me/goals").catch(() => null);
    await fetch("/api/ai/plan", { method: "POST" }).catch(() => null);
    await fetch("/api/ai/plan").catch(() => null);
    // Write sentinel: a known shell-cacheable asset, fetched LAST.
    await fetch("/manifest.webmanifest").catch(() => null);
  });

  // Wait until the sentinel has been written — i.e. the cache layer
  // demonstrably accepted writes in this window, so the negative assertions
  // below cannot pass merely because writes were still in flight.
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    const shell = names.find((name) => name.startsWith("strix-shell-"));
    if (!shell) return false;
    const keys = await (await caches.open(shell)).keys();
    return keys.some(
      (request) => new URL(request.url).pathname === "/manifest.webmanifest",
    );
  });

  // Security review L1: the signed-out redirect must NOT have been cached —
  // no strix-dashboard-* cache holds any entry (status 0 or otherwise).
  const dashboardEntries = await page.evaluate(async () => {
    const entries: Array<{ url: string; status: number | null }> = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("strix-dashboard-")) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        entries.push({ url: request.url, status: response?.status ?? null });
      }
    }
    return entries;
  });
  expect(dashboardEntries).toEqual([]);

  // The negative guarantee: no cache, of any name, holds any /api/ entry.
  const apiEntries = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) {
        urls.push(request.url);
      }
    }
    return urls.filter((url) => new URL(url).pathname.startsWith("/api/"));
  });
  expect(apiEntries).toEqual([]);
});
