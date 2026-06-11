/**
 * playground-active-dashboard.spec.ts — `verify:ui` extension for the Slice 10
 * ACTIVE dashboard (phase-1-golden-path: "when the product dashboard ships,
 * extend or re-target the harness" — this EXTENDS; /playground/dashboard and
 * its baselines are untouched).
 *
 * Target: /playground/active-dashboard — the deterministic fixture route
 * (pinned today = 2026-06-10, no DB, no auth) rendering the REAL
 * <ActiveDashboard /> over the REAL buildDashboardModel. Two kinds of
 * assertion, same scheme as playground-dashboard.spec.ts:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions,
 *      on BOTH harness states (populated + ?state=empty-sections). Runs on
 *      every platform.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — populated state at 375×812 and
 *      1440×900, empty-sections at 375×812. Platform-suffixed baselines
 *      (…-chromium-darwin.png / …-chromium-linux.png) coexist in
 *      e2e/playground-active-dashboard.spec.ts-snapshots/; a screenshot spec
 *      skips itself when no baseline exists for the CURRENT platform, so CI
 *      stays green before its Linux baselines are committed. Bootstrap with
 *      `pnpm verify:ui:update` (Linux: the matching Playwright Docker image —
 *      see DESIGN.md §11).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/active-dashboard";

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-active-dashboard.spec.ts-snapshots", file),
  );
}

/**
 * Skip a screenshot spec ONLY when no baseline exists for this platform AND we
 * are not currently (re)generating baselines (`updateSnapshots: "none"` means
 * a plain run with no writing) — the playground-dashboard scheme verbatim.
 */
function skipUnlessBaseline(name: string, testInfo: TestInfo): void {
  const updating = testInfo.config.updateSnapshots !== "none";
  test.skip(
    !updating && !hasBaseline(name),
    `no ${process.platform} baseline yet — run \`pnpm verify:ui:update\` (axe still gates this surface)`,
  );
}

async function expectNoAxeViolations(page: import("@playwright/test").Page) {
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

test.describe("/playground/active-dashboard — active DAWN dashboard", () => {
  test("populated state has zero WCAG 2.1 AA violations (full page, no exclusions)", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expectNoAxeViolations(page);
  });

  test("empty-sections state has zero WCAG 2.1 AA violations", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=empty-sections`, {
      waitUntil: "networkidle",
    });
    await expectNoAxeViolations(page);
  });

  test("matches the mobile baseline (375×812)", async ({ page }, testInfo) => {
    const name = `active-dashboard-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the desktop baseline (1440×900)", async ({ page }, testInfo) => {
    const name = `active-dashboard-desktop`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the empty-sections mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `active-dashboard-empty-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ROUTE}?state=empty-sections`, {
      waitUntil: "networkidle",
    });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});
