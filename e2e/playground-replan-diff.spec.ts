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
 *   3. INLINE EDITOR INTERACTION — opening the ✎ editor moves focus onto
 *      its first proposed field (issue #46 revision — useFocusOnMount;
 *      asserted before any test touches a field, and Escape is exercised
 *      IMMEDIATELY after open, the real keyboard path: focus stranded on
 *      <body> would make Escape a no-op). Escape cancels exactly like the
 *      Cancel button, and a failed save marks each invalid field
 *      (aria-invalid + aria-describedby → a message naming the rule); the
 *      failed-save state is axe-rescanned. Every dismiss (Cancel, Escape, a
 *      saved edit) restores keyboard focus to the ✎ trigger that opened the
 *      editor (issue #46 — useRestoreFocus). Runs on every platform.
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

  test("focus lands on the editor's first field on open; Escape — immediate or mid-edit — cancels and discards the draft", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", {
      name: "Edit: Long endurance hike",
    });
    // This change proposes weekday + duration, so the editor's first
    // proposed field — the focus-on-open landing — is the Weekday select.
    const weekday = page.getByLabel("Weekday");
    const duration = page.getByLabel("Duration (minutes)");

    // Open: focus moves INTO the editor — never strands on <body> while
    // the ✎ trigger is unmounted.
    await trigger.click();
    await expect(weekday).toBeFocused();

    // Escape IMMEDIATELY — the test focuses no field first, so this only
    // passes if focus-on-open made the editor's Escape handler reachable.
    await page.keyboard.press("Escape");
    await expect(weekday).toBeHidden();
    await expect(trigger).toBeFocused();

    // Reopen, draft a value, Escape mid-edit: exactly the Cancel button's
    // behavior…
    await trigger.click();
    await duration.fill("999");
    await page.keyboard.press("Escape");
    await expect(duration).toBeHidden();
    await expect(page.getByText("Your version")).toHaveCount(0);
    // …focus is back on the ✎ trigger the editor replaced (issue #46)…
    await expect(trigger).toBeFocused();
    // …and the draft was discarded: reopening shows the proposal's value.
    await trigger.click();
    await expect(page.getByLabel("Duration (minutes)")).toHaveValue("240");
  });

  test("Cancel and a saved edit both restore focus to the ✎ trigger (issue #46)", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    const trigger = page.getByRole("button", {
      name: "Edit: Long endurance hike",
    });
    // Cancel click — the editor unmounts, the trigger remounts focused.
    // (Open lands focus on the first proposed field, per focus-on-open.)
    await trigger.click();
    await expect(page.getByLabel("Weekday")).toBeFocused();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(trigger).toBeFocused();
    // The confirming dismiss (Save edit) restores it the same way.
    await trigger.click();
    await page.getByLabel("Duration (minutes)").fill("180");
    await page.getByRole("button", { name: "Save edit" }).click();
    await expect(page.getByText("Your version")).toBeVisible();
    await expect(trigger).toBeFocused();
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
