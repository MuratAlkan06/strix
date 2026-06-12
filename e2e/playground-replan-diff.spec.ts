/**
 * playground-replan-diff.spec.ts — `verify:ui` extension for the Phase 2
 * replan diff UI (phase-2-close-the-loop "Replan diff UI"; the
 * playground-check-in scheme verbatim).
 *
 * Target: /playground/replan-diff — the deterministic fixture route (pinned
 * dates, no DB, no live AI) rendering the REAL <ReplanDiffView /> over the
 * REAL buildReplanPageModel. Two kinds of assertion:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions,
 *      on every harness state (proposal, empty-pending, decided, error).
 *      Runs on every platform.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — `proposal` and `decided` states at
 *      375×812 and 1440×900. Platform-suffixed baselines
 *      (…-chromium-darwin.png / …-chromium-linux.png) coexist in
 *      e2e/playground-replan-diff.spec.ts-snapshots/; a screenshot spec
 *      skips itself when no baseline exists for the CURRENT platform, so CI
 *      stays green before its Linux baselines are committed (the PR #26
 *      bootstrap). Generate with `pnpm verify:ui:update` (Linux: the
 *      matching Playwright Docker image — see DESIGN.md §11).
 *
 *   3. INLINE EDITOR INTERACTION — Escape cancels exactly like the Cancel
 *      button, and a failed save marks each invalid field (aria-invalid +
 *      aria-describedby → a message naming the rule); the failed-save state
 *      is axe-rescanned. Runs on every platform.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/replan-diff";

const AXE_STATES = ["proposal", "empty-pending", "decided", "error"] as const;

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-replan-diff.spec.ts-snapshots", file),
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

test.describe("/playground/replan-diff — replan diff UI", () => {
  for (const state of AXE_STATES) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expectNoAxeViolations(page);
    });
  }

  test("matches the proposal mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `replan-diff-proposal-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the proposal desktop baseline (1440×900)", async ({
    page,
  }, testInfo) => {
    const name = `replan-diff-proposal-desktop`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the decided mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = `replan-diff-decided-mobile`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ROUTE}?state=decided`, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("matches the decided desktop baseline (1440×900)", async ({
    page,
  }, testInfo) => {
    const name = `replan-diff-decided-desktop`;
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${ROUTE}?state=decided`, { waitUntil: "networkidle" });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });

  test("Escape inside the inline editor cancels it and discards the draft", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Edit: Long endurance hike" })
      .click();
    const duration = page.getByLabel("Duration (minutes)");
    await duration.fill("999");
    await duration.press("Escape");
    // The editor is gone — exactly the Cancel button's behavior…
    await expect(duration).toBeHidden();
    await expect(page.getByText("Your version")).toHaveCount(0);
    // …and the draft was discarded: reopening shows the proposal's value.
    await page
      .getByRole("button", { name: "Edit: Long endurance hike" })
      .click();
    await expect(page.getByLabel("Duration (minutes)")).toHaveValue("240");
  });

  test("a failed save marks the invalid field and names the rule (axe-clean)", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: "Edit: Long endurance hike" })
      .click();
    const duration = page.getByLabel("Duration (minutes)");
    await duration.fill("0");
    await page.getByRole("button", { name: "Save edit" }).click();

    // Field-level association: aria-invalid + aria-describedby resolving to
    // a visible message that names the violated rule.
    await expect(duration).toHaveAttribute("aria-invalid", "true");
    const describedBy = await duration.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
      "Duration must be at least 1 minute.",
    );
    await expectNoAxeViolations(page);

    // Fixing the field retires its error, and the save goes through.
    await duration.fill("60");
    await expect(duration).not.toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Save edit" }).click();
    await expect(duration).toBeHidden();
    await expect(page.getByText("Your version")).toBeVisible();
  });
});
