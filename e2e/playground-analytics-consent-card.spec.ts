/**
 * playground-analytics-consent-card.spec.ts — `verify:ui` coverage for the #11
 * settings Analytics card (the playground-check-in scheme verbatim).
 *
 * Target: /playground/analytics-consent-card — the auth-exempt, deterministic
 * harness rendering the REAL <AnalyticsConsentCardView /> in both switch states
 * behind local no-op state (no consent store write, no PostHog). It closes the
 * review-access gap: /settings is Clerk-gated, so the card has no live axe gate
 * there. Two kinds of assertion:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions, on
 *      every harness state (off, on). Runs on every platform.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — the default `off` state at 375×812.
 *      Platform-suffixed baselines (…-chromium-darwin.png / …-chromium-linux.png)
 *      coexist in e2e/playground-analytics-consent-card.spec.ts-snapshots/; a
 *      screenshot spec skips itself when no baseline exists for the CURRENT
 *      platform, so CI stays green before its Linux baselines are committed.
 *      Generate with `pnpm verify:ui:update` (Linux: the matching Playwright
 *      Docker image — DESIGN.md §11).
 *
 * Paths are RELATIVE — Playwright prepends the config `baseURL`. No hardcoded
 * http://localhost:3000 (a hardcoded URL caused a CI-only failure in S6).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/analytics-consent-card";

const AXE_STATES = ["off", "on"] as const;

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-analytics-consent-card.spec.ts-snapshots", file),
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

test.describe("/playground/analytics-consent-card — settings analytics card", () => {
  for (const state of AXE_STATES) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expectNoAxeViolations(page);
    });
  }

  test("matches the analytics-consent-card mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `analytics-consent-card-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ROUTE}?state=off`, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});
