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
 *   3. Real traffic lands in the NAMED, build-versioned caches
 *      (strix-shell-*, strix-dashboard-*) that slice S7's purge will
 *      enumerate.
 *   4. After API traffic — including /api/ai/* — NO cache anywhere contains
 *      any /api/ entry. (A /manifest.webmanifest fetch is used as a write
 *      sentinel: once IT is cached, earlier cache writes have flushed, so the
 *      negative assertion is meaningful.)
 *
 * NOTE on /dashboard: it is auth-protected, so the unauthenticated harness
 * never sees its HTML — the spec only asserts the SWR rule CLAIMED the
 * request (the named cache appears; redirects are not cached). The offline
 * render itself is slice S6's surface.
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

test("dashboard visit creates its named cache; /api/ never appears in any cache", async ({
  page,
}) => {
  await gotoControlled(page);
  await page.evaluate(async () => {
    // A dashboard visit (unauthenticated → redirect; `manual` avoids chasing
    // the Clerk sign-in host, which is unreachable in CI). The SWR rule still
    // claims the request and opens its named cache.
    await fetch("/dashboard", { redirect: "manual" }).catch(() => null);
    // API traffic, including the AI endpoints (POST is how they are really
    // called; a GET probes the matcher path too). All NetworkOnly.
    await fetch("/api/me/goals").catch(() => null);
    await fetch("/api/ai/plan", { method: "POST" }).catch(() => null);
    await fetch("/api/ai/plan").catch(() => null);
    // Write sentinel: a known shell-cacheable asset, fetched LAST.
    await fetch("/manifest.webmanifest").catch(() => null);
  });

  // The named dashboard cache exists (S7 purge target), and the sentinel has
  // been written — i.e. the cache layer demonstrably accepted writes in this
  // window.
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    if (!names.some((name) => name.startsWith("strix-dashboard-"))) {
      return false;
    }
    const shell = names.find((name) => name.startsWith("strix-shell-"));
    if (!shell) return false;
    const keys = await (await caches.open(shell)).keys();
    return keys.some(
      (request) => new URL(request.url).pathname === "/manifest.webmanifest",
    );
  });

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
