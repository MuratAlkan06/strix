/**
 * playground-dashboard.spec.ts — the `verify:ui` harness for the DAWN surface.
 *
 * Target: /playground/dashboard (the stable seed-only curation route — all three
 * variant sections V1 dusk / V2 pale / V3 slate). Two kinds of assertion:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions. This is
 *      the source of truth for contrast (DESIGN.md §0/§11 explicitly subordinate
 *      the prose contrast numbers to this harness). Runs on EVERY platform — axe
 *      computes contrast/ARIA from rendered sRGB identically on macOS and Linux.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — full page at 375×812 and 1440×900.
 *
 * ── CROSS-PLATFORM SCREENSHOT SCHEME (read before regenerating baselines) ──────
 * Linux CI and macOS antialias fonts differently, so one PNG baseline cannot
 * serve both platforms. We rely on Playwright's DEFAULT snapshot naming, which
 * suffixes the platform: `<name>-chromium-linux.png` vs `<name>-chromium-darwin.png`.
 * Both baselines live side-by-side in e2e/playground-dashboard.spec.ts-snapshots/
 * and never collide.
 *
 *   • Axe ALWAYS runs (platform-independent) — the real accessibility gate.
 *   • A screenshot spec SKIPS itself when no baseline exists for the CURRENT
 *     platform (the existsSync guard below). So CI stays green before its Linux
 *     baselines are committed, and is never flaky; once Linux baselines land it
 *     actively compares. Local macOS runs compare/produce their own -darwin
 *     baselines, so a pre-push `pnpm verify:ui` does exercise screenshots.
 *   • Bootstrap a platform's baselines:  pnpm verify:ui:update
 *     (Linux baselines for CI are generated in the official Playwright Docker
 *      image so they match the runner exactly — see DESIGN.md §11.)
 * ───────────────────────────────────────────────────────────────────────────────
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/dashboard";

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-dashboard.spec.ts-snapshots", file),
  );
}

/**
 * Skip a screenshot spec ONLY when no baseline exists for this platform AND we
 * are not explicitly (re)generating baselines. The update-mode carve-out is
 * what lets `pnpm verify:ui:update` create the FIRST baseline (otherwise the
 * guard would skip before the screenshot is ever taken). NOTE: a plain run
 * resolves `updateSnapshots` to Playwright's DEFAULT "missing" (write actual +
 * FAIL), so only the explicit update modes count as updating; bare
 * `--update-snapshots` (what `pnpm verify:ui:update` passes) presets "changed".
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

test.describe("/playground/dashboard — DAWN surface", () => {
  test("has zero WCAG 2.1 AA violations (full page, no exclusions)", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });

    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();

    // Surface a readable summary if this ever regresses (id + the failing nodes).
    const summary = results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.map((n) => n.target),
    }));
    expect(summary, JSON.stringify(summary, null, 2)).toEqual([]);
  });

  test("matches the mobile baseline (375×812)", async ({ page }, testInfo) => {
    const name = `dashboard-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the desktop baseline (1440×900)", async ({ page }, testInfo) => {
    const name = `dashboard-desktop`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});
