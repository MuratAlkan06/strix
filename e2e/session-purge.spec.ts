/**
 * session-purge.spec.ts — live proof of the S7 session-end purge against the
 * production server the verify:ui harness boots (planning doc "Session-end
 * purge": `await caches.keys() → caches.delete(...)`, full clear).
 *
 * Target page: /playground/session-purge — the auth-exempt harness that wires
 * the REAL purgeClientCaches to a button (same auth-exempt reasoning as
 * service-worker.spec.ts; zero Clerk secrets needed in CI).
 *
 * Sequencing against the live service worker (same write-sentinel discipline
 * as service-worker.spec.ts): the SW caches this page's own shell traffic
 * asynchronously, so the spec first waits until a known asset (the manifest)
 * is observably cached — proof in-flight writes have flushed and the page is
 * idle. Only then does it seed, purge, and assert; nothing re-populates the
 * caches afterwards because nothing else fetches.
 *
 * What this pins:
 *   1. Seeded user-named caches AND the SW's own strix-* caches all exist
 *      pre-purge (the purge has real work to do).
 *   2. One button press → the in-page snapshot taken right after the purge
 *      resolved reports ZERO caches — the full-clear contract, including the
 *      user-agnostic shell (accepted MVP trade-off) and the seeds.
 *   3. An out-of-band caches.keys() agrees: nothing survived.
 */
import { test, expect, type Page } from "@playwright/test";

const ROUTE = "/playground/session-purge";
const SEEDS = ["e2e-purge-seed-a", "e2e-purge-seed-b"] as const;

/** Navigate and wait until the service worker is activated AND controlling. */
async function gotoControlled(page: Page): Promise<void> {
  await page.goto(ROUTE);
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

test("purge button empties Cache Storage completely", async ({ page }) => {
  await gotoControlled(page);

  // Write sentinel: fetch a known shell-cacheable asset, then wait until it
  // is observably cached — earlier async cache writes have flushed, so the
  // pre-purge inventory below is stable and the post-purge emptiness cannot
  // be racing a straggler write.
  await page.evaluate(async () => {
    await fetch("/manifest.webmanifest").catch(() => null);
  });
  await page.waitForFunction(async () => {
    const names = await caches.keys();
    const shell = names.find((name) => name.startsWith("strix-shell-"));
    if (!shell) return false;
    const keys = await (await caches.open(shell)).keys();
    return keys.some(
      (request) => new URL(request.url).pathname === "/manifest.webmanifest",
    );
  });

  // Seed caches the way a previous user's session data would sit there —
  // names deliberately OUTSIDE the strix- prefix to pin the FULL clear (not
  // a prefix-scoped one).
  await page.evaluate(async (seeds) => {
    for (const name of seeds) {
      const cache = await caches.open(name);
      await cache.put(
        new Request(`/__e2e__/${name}`),
        new Response(`payload for ${name}`),
      );
    }
  }, SEEDS as unknown as string[]);

  // Pre-purge inventory: seeds + the SW's own strix-shell-* cache all exist.
  const before = await page.evaluate(() => caches.keys());
  for (const seed of SEEDS) expect(before).toContain(seed);
  expect(before.some((name) => name.startsWith("strix-shell-"))).toBe(true);

  // One press of the real affordance.
  await page.getByRole("button", { name: "Purge all caches" }).click();

  // The harness snapshots caches.keys() in-page immediately after the purge
  // promise resolved — the authoritative post-purge observation.
  await expect(page.getByTestId("purge-result")).toHaveText(
    "purged: 0 caches remain",
  );

  // Out-of-band confirmation: nothing survived, nothing repopulated.
  const after = await page.evaluate(() => caches.keys());
  expect(after).toEqual([]);
});
