/**
 * offline.spec.ts — phase 2.5 S6: the planning doc's automated check
 * ("Playwright headless run of the dashboard offline (mocked offline) renders
 * the shell without errors") plus the /~offline fallback contract, against
 * the verify:ui production server (the real sw.js).
 *
 * Two harness realities shape these tests:
 *   - /dashboard is auth-protected and the harness is unauthenticated, so a
 *     REAL signed-in dashboard cache cannot exist here (security review L1
 *     guarantees the signed-out path caches nothing — that absence IS the
 *     empty-cache edge case, pinned below). The offline COMPONENTS (useOnline
 *     indicator, disabled check-off, tooltip) are exercised on the auth-exempt
 *     /playground/active-dashboard, which renders the REAL <ActiveDashboard />.
 *   - The cached-dashboard offline render is reproduced by seeding the
 *     strix-dashboard-* SWR cache with the harness page's own HTML under the
 *     /dashboard key — byte-identical markup to a page whose static chunks the
 *     shell cache already holds, so the offline navigation renders AND
 *     hydrates exactly like a previously-visited dashboard.
 *
 * Error discipline: offline runs assert ZERO uncaught page errors
 * (`pageerror`). Console resource-load failures (net::ERR_INTERNET_
 * DISCONNECTED noise from intentionally-offline fetches) are expected and not
 * asserted on.
 *
 * Screenshot baselines follow the platform-suffix scheme (DESIGN.md §11):
 * axe + functional checks always run; screenshot specs skip themselves where
 * no baseline exists for the current platform.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const HARNESS_ROUTE = "/playground/active-dashboard";
const OFFLINE_ROUTE = "/~offline";
// Rendered copy uses the typographic apostrophe (&rsquo;).
const OFFLINE_HEADING = "You’re offline";
const TOOLTIP_COPY = "Reconnects when you’re online.";
const CHECKBOX_NAME = "Mark done: Stair intervals";

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(join(__dirname, "offline.spec.ts-snapshots", file));
}

/** The playground-dashboard skip scheme verbatim (see that spec's header). */
function skipUnlessBaseline(name: string, testInfo: TestInfo): void {
  const updating =
    testInfo.config.updateSnapshots === "all" ||
    testInfo.config.updateSnapshots === "changed";
  test.skip(
    !updating && !hasBaseline(name),
    `no ${process.platform} baseline yet — run \`pnpm verify:ui:update\` (axe still gates this surface)`,
  );
}

async function expectNoAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target),
  }));
  expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
}

/** Collect uncaught page exceptions — the "renders without errors" pin. */
function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  return errors;
}

/** Navigate and wait until the service worker is activated AND controlling
 *  (service-worker.spec.ts's helper, retargeted at the active harness). */
async function gotoControlled(page: Page): Promise<void> {
  await page.goto(HARNESS_ROUTE);
  await page.waitForFunction(async () => {
    if (!("serviceWorker" in navigator)) return false;
    await navigator.serviceWorker.ready;
    return navigator.serviceWorker.controller !== null;
  });
}

/** Wait until some cache holds the precached /~offline fallback document. */
async function waitForOfflinePrecache(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    for (const name of await caches.keys()) {
      const keys = await (await caches.open(name)).keys();
      if (keys.some((req) => new URL(req.url).pathname === "/~offline")) {
        return true;
      }
    }
    return false;
  });
}

/** The visible (or sr-only-empty) connectivity live region. */
function offlineIndicator(page: Page) {
  return page.getByRole("status").filter({ hasText: "Offline" });
}

/**
 * The visible Base UI tooltip popup carrying the hint copy. Scoped to the
 * tooltip-content slot so it never collides with the always-present sr-only
 * aria-describedby nodes (which hold the same copy, one per task row).
 */
function visibleTooltip(page: Page) {
  return page
    .locator('[data-slot="tooltip-content"]')
    .filter({ hasText: TOOLTIP_COPY });
}

/**
 * Resolve a control's accessible description from its aria-describedby token
 * list — the concatenated text of every referenced element, computed in-page
 * the way an AT would. This is the real SR contract (announced regardless of
 * tooltip open-state), not "a tooltip popup is visible".
 */
async function accessibleDescription(
  control: ReturnType<Page["getByRole"]>,
): Promise<string> {
  const describedBy = await control.getAttribute("aria-describedby");
  expect(describedBy, "control must carry aria-describedby").toBeTruthy();
  return control.evaluate((el) => {
    const ids = (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    return ids
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ");
  });
}

test.describe("/~offline — the fallback screen", () => {
  test("renders the branded offline screen with zero WCAG 2.1 AA violations", async ({
    page,
  }) => {
    await page.goto(OFFLINE_ROUTE, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: OFFLINE_HEADING }),
    ).toBeVisible();
    // No nav dead-end: one calm path back toward the (possibly cached)
    // dashboard.
    await expect(
      page.getByRole("link", { name: "Go to dashboard" }),
    ).toHaveAttribute("href", "/dashboard");
    await expectNoAxeViolations(page);
  });

  test("matches the offline-screen mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = "offline-screen-mobile";
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(OFFLINE_ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});

test.describe("dashboard offline state — indicator + disabled check-off", () => {
  test("offline: indicator appears, check-off is disabled with the tooltip; both recover online", async ({
    page,
  }) => {
    const errors = collectPageErrors(page);
    await page.goto(HARNESS_ROUTE, { waitUntil: "networkidle" });

    // Online: no indicator text, checkbox live (the additive proof that the
    // S6 changes leave the online surface — and its baselines — untouched).
    await expect(offlineIndicator(page)).toHaveCount(0);
    const checkbox = page.getByRole("checkbox", { name: CHECKBOX_NAME });
    await expect(checkbox).toBeEnabled();

    await page.context().setOffline(true);

    await expect(offlineIndicator(page)).toBeVisible();
    // aria-disabled — visibly dimmed, inert, but still hoverable/focusable so
    // the tooltip can explain itself.
    await expect(checkbox).toBeDisabled();
    // The hint is a REAL accessible description: aria-describedby resolves to
    // an element carrying the copy, announced regardless of tooltip open-state
    // — not merely a visually-painted popup.
    expect(await accessibleDescription(checkbox)).toContain(TOOLTIP_COPY);
    await checkbox.hover();
    await expect(visibleTooltip(page)).toBeVisible();
    // A forced click must be a no-op: no optimistic strike offline.
    await checkbox.click({ force: true });
    await expect(checkbox).not.toBeChecked();

    // The offline state is still a WCAG 2.1 AA surface.
    await expectNoAxeViolations(page);

    await page.context().setOffline(false);
    await expect(offlineIndicator(page)).toHaveCount(0);
    await expect(checkbox).toBeEnabled();

    expect(errors).toEqual([]);
  });

  test("matches the offline dashboard mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = "offline-dashboard-mobile";
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(HARNESS_ROUTE, { waitUntil: "networkidle" });
    await page.context().setOffline(true);
    await expect(offlineIndicator(page)).toBeVisible();
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});

test.describe("service worker offline fallback (prod sw.js)", () => {
  test("offline navigation to an uncached route serves the precached /~offline", async ({
    page,
  }) => {
    await gotoControlled(page);
    await waitForOfflinePrecache(page);
    await page.context().setOffline(true);

    const errors = collectPageErrors(page);
    await page.goto("/goals");
    await expect(
      page.getByRole("heading", { name: OFFLINE_HEADING }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("offline /dashboard with an EMPTY cache lands on the offline screen, never a crash (the S4 L1 edge)", async ({
    page,
  }) => {
    await gotoControlled(page);
    await waitForOfflinePrecache(page);
    // The unauthenticated harness IS the empty-cache device: security review
    // L1 keeps signed-out /dashboard responses out of the SWR cache, so no
    // strix-dashboard-* entry can exist here.
    const dashboardEntries = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith("strix-dashboard-")) continue;
        for (const req of await (await caches.open(name)).keys()) {
          urls.push(req.url);
        }
      }
      return urls;
    });
    expect(dashboardEntries).toEqual([]);

    await page.context().setOffline(true);
    const errors = collectPageErrors(page);
    await page.goto("/dashboard");
    await expect(
      page.getByRole("heading", { name: OFFLINE_HEADING }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  });

  test("offline /dashboard with a cached shell renders the dashboard from the SWR cache, hydrated, without errors", async ({
    page,
  }) => {
    await gotoControlled(page);
    // Re-flow this page's static assets through the now-controlling worker so
    // the shell cache holds every chunk the cached HTML will need offline.
    await page.reload();
    await page.waitForFunction(async () => {
      const used = performance
        .getEntriesByType("resource")
        .map((entry) => new URL(entry.name, location.href))
        .filter(
          (url) =>
            url.origin === location.origin &&
            url.pathname.startsWith("/_next/static/"),
        )
        .map((url) => url.href);
      const shellName = (await caches.keys()).find((name) =>
        name.startsWith("strix-shell-"),
      );
      if (!shellName || used.length === 0) return false;
      const cached = new Set(
        (await (await caches.open(shellName)).keys()).map((req) => req.url),
      );
      return used.every((href) => cached.has(href));
    });

    // Seed the SWR dashboard cache: this page's own HTML under the /dashboard
    // key — markup whose every chunk is now shell-cached (see file header).
    await page.evaluate(async () => {
      const shellName = (await caches.keys()).find((name) =>
        name.startsWith("strix-shell-"),
      );
      if (!shellName) throw new Error("strix-shell-* cache missing");
      const buildId = shellName.slice("strix-shell-".length);
      const response = await fetch(location.pathname);
      if (!response.ok) throw new Error(`seed fetch failed: ${response.status}`);
      const cache = await caches.open(`strix-dashboard-${buildId}`);
      await cache.put(new Request(new URL("/dashboard", location.origin)), response);
    });

    await page.context().setOffline(true);
    const errors = collectPageErrors(page);
    await page.goto("/dashboard");

    // The dashboard shell, served from cache and hydrated offline: the
    // harness greeting + sections render, the indicator is live (proof of
    // hydration — it is not in the cached HTML, which was rendered online),
    // and check-off is disabled with the spec'd tooltip.
    await expect(page.getByRole("heading", { name: "Good morning." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
    await expect(offlineIndicator(page)).toBeVisible();
    const checkbox = page.getByRole("checkbox", { name: CHECKBOX_NAME });
    await expect(checkbox).toBeDisabled();
    expect(await accessibleDescription(checkbox)).toContain(TOOLTIP_COPY);
    await checkbox.hover();
    await expect(visibleTooltip(page)).toBeVisible();

    expect(errors).toEqual([]);
  });
});
