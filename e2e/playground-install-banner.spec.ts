/**
 * playground-install-banner.spec.ts — `verify:ui` coverage for the S8 install
 * affordance (planning/phase-2.5-pwa-polish.md "Install affordance"; the
 * playground-check-in scheme verbatim).
 *
 * Target: /playground/install-banner — the auth-exempt, deterministic harness
 * rendering the REAL <InstallBannerView /> in each reachable state behind local
 * no-op handlers (no Clerk user, no beforeinstallprompt, no DB). Two kinds of
 * assertion:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions, on
 *      every harness state (ios, chrome, dismissed). Runs on every platform.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — `ios` and `chrome` at 375×812.
 *      Platform-suffixed baselines (…-chromium-darwin.png /
 *      …-chromium-linux.png) coexist in
 *      e2e/playground-install-banner.spec.ts-snapshots/; a screenshot spec
 *      skips itself when no baseline exists for the CURRENT platform, so CI
 *      stays green before its Linux baselines are committed. Generate with
 *      `pnpm verify:ui:update` (Linux: the matching Playwright Docker image —
 *      DESIGN.md §11).
 *
 * Paths are RELATIVE — Playwright prepends the config `baseURL`. No hardcoded
 * http://localhost:3000 (a hardcoded URL caused a CI-only failure in S6).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/install-banner";

const AXE_STATES = ["ios", "chrome", "dismissed"] as const;

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-install-banner.spec.ts-snapshots", file),
  );
}

/** Skip a screenshot spec ONLY when no baseline exists for this platform AND we
 *  are not explicitly (re)generating baselines — the playground-check-in scheme
 *  verbatim. */
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

test.describe("/playground/install-banner — install affordance", () => {
  for (const state of AXE_STATES) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expectNoAxeViolations(page);
    });
  }

  test("matches the iOS-instructions mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `install-banner-ios-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ROUTE}?state=ios`, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the Chrome-install mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `install-banner-chrome-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ROUTE}?state=chrome`, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});
