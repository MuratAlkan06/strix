/**
 * playground-check-in.spec.ts — `verify:ui` extension for the Phase 2 weekly
 * check-in (phase-2-close-the-loop "Weekly check-in UI"; the
 * playground-active-dashboard scheme verbatim).
 *
 * Target: /playground/check-in — the deterministic fixture route (pinned
 * fixture week, no DB, no auth) rendering the REAL <CheckInForm /> over the
 * REAL buildCheckInModel. Two kinds of assertion:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions,
 *      on every harness state (default, pro, resubmit, skipped, empty).
 *      Runs on every platform.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — `default` and `resubmit` states at
 *      375×812 and 1440×900. Platform-suffixed baselines
 *      (…-chromium-darwin.png / …-chromium-linux.png) coexist in
 *      e2e/playground-check-in.spec.ts-snapshots/; a screenshot spec skips
 *      itself when no baseline exists for the CURRENT platform, so CI stays
 *      green before its Linux baselines are committed (the PR #26
 *      bootstrap). Generate with `pnpm verify:ui:update` (Linux: the
 *      matching Playwright Docker image — see DESIGN.md §11).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/check-in";

const AXE_STATES = ["default", "pro", "resubmit", "skipped", "empty"] as const;

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-check-in.spec.ts-snapshots", file),
  );
}

/**
 * Skip a screenshot spec ONLY when no baseline exists for this platform AND we
 * are not explicitly (re)generating baselines — the playground-dashboard
 * scheme verbatim. NOTE: a plain run resolves `updateSnapshots` to Playwright's
 * DEFAULT "missing" (write actual + FAIL), so only the explicit update modes
 * count as updating; bare `--update-snapshots` (what `pnpm verify:ui:update`
 * passes) presets "changed".
 */
function skipUnlessBaseline(name: string, testInfo: TestInfo): void {
  const updating =
    testInfo.config.updateSnapshots === "all" ||
    testInfo.config.updateSnapshots === "changed";
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

test.describe("/playground/check-in — weekly check-in", () => {
  for (const state of AXE_STATES) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expectNoAxeViolations(page);
    });
  }

  test("matches the default mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `check-in-default-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the default desktop baseline (1440×900)", async ({
    page,
  }, testInfo) => {
    const name = `check-in-default-desktop`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the resubmit mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `check-in-resubmit-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ROUTE}?state=resubmit`, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the resubmit desktop baseline (1440×900)", async ({
    page,
  }, testInfo) => {
    const name = `check-in-resubmit-desktop`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ROUTE}?state=resubmit`, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});
