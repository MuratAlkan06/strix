/**
 * playground-goal-complete.spec.ts — `verify:ui` extension for the Phase 2
 * goal-completion moment (phase-2-close-the-loop "Goal completion celebration
 * + auto-archive"; the playground-check-in scheme verbatim).
 *
 * Target: /playground/goal-complete — the deterministic fixture route (pinned
 * dates, no DB, no auth) rendering the REAL <GoalDetail /> over the REAL
 * buildGoalDetailModel. Two kinds of assertion:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions,
 *      on every harness state (pre, celebrating, completed). Runs on every
 *      platform.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — all three states at 375×812 and
 *      1440×900. Platform-suffixed baselines coexist in
 *      e2e/playground-goal-complete.spec.ts-snapshots/; a screenshot spec
 *      skips itself when no baseline exists for the CURRENT platform (the
 *      PR #26 bootstrap), so CI stays green before Linux baselines land.
 *
 * ANIMATION PINNING (no mid-animation pixels): the Playwright context runs
 * with `reducedMotion: "reduce"` globally (playwright.config.ts), so the
 * celebration takes the §4.3 reduced path — no sun rise, 250ms opacity
 * crossfades only — and every capture here therefore ALSO verifies the
 * prefers-reduced-motion behaviour. Before screenshotting the celebrating
 * state the spec waits for the LAST element in the choreography ("Well
 * done.", delay+fade ≈ 0.51s) to reach opacity 1 — the settled final frame,
 * deterministic every run. The full 900ms rise is reviewed manually on the
 * playground without the emulation.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/goal-complete";

const AXE_STATES = ["pre", "celebrating", "completed"] as const;

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-goal-complete.spec.ts-snapshots", file),
  );
}

/**
 * Skip a screenshot spec ONLY when no baseline exists for this platform AND
 * we are not explicitly (re)generating baselines — the playground-dashboard
 * scheme verbatim.
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

/** Wait for the celebration's settled final frame: "Well done." is the last
 *  element to fade in, so its opacity landing at 1 means every layer of the
 *  sunrise (sky, sun, terrain, scrim) has finished. */
async function waitForSettledCelebration(page: Page) {
  const line = page.getByText("Well done.");
  await expect(line).toBeVisible();
  await expect(line).toHaveCSS("opacity", "1");
}

test.describe("/playground/goal-complete — goal completion moment", () => {
  for (const state of AXE_STATES) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      if (state === "celebrating") await waitForSettledCelebration(page);
      await expectNoAxeViolations(page);
    });
  }

  test("pre state shows Mark complete; completed state does not", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=pre`, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("button", { name: "Mark complete" }),
    ).toBeVisible();

    await page.goto(`${ROUTE}?state=completed`, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("button", { name: "Mark complete" }),
    ).toHaveCount(0);
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  });

  for (const [state, viewport, label] of [
    ["pre", { width: 375, height: 812 }, "mobile"],
    ["pre", { width: 1440, height: 900 }, "desktop"],
    ["celebrating", { width: 375, height: 812 }, "mobile"],
    ["celebrating", { width: 1440, height: 900 }, "desktop"],
    ["completed", { width: 375, height: 812 }, "mobile"],
    ["completed", { width: 1440, height: 900 }, "desktop"],
  ] as const) {
    test(`matches the ${state} ${label} baseline (${viewport.width}×${viewport.height})`, async ({
      page,
    }, testInfo) => {
      const name = `goal-complete-${state}-${label}`;
      skipUnlessBaseline(name, testInfo);
      await page.setViewportSize(viewport);
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      // Pin the settled frame — never a mid-animation capture.
      if (state === "celebrating") await waitForSettledCelebration(page);
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  }
});
