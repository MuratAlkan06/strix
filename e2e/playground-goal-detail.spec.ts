/**
 * playground-goal-detail.spec.ts — `verify:ui` extension for the Phase 2
 * read-only goal detail (phase-2-close-the-loop "Accomplished section":
 * tap a card → read-only detail; the playground-goal-complete scheme
 * verbatim).
 *
 * Target: /playground/goal-detail — the deterministic fixture route (pinned
 * dates, no DB, no auth) rendering the REAL <GoalDetail /> over the REAL
 * buildGoalDetailModel. Two kinds of assertion:
 *
 *   1. AXE (WCAG 2.1 AA) — full-page scan, ZERO violations, NO exclusions,
 *      on the default (active, editable) state AND ?state=completed-readonly.
 *      Runs on every platform.
 *
 *   2. SCREENSHOTS (toHaveScreenshot) — the completed-readonly state at
 *      375×812 and 1440×900 (the default active surface is already pinned by
 *      the goal-complete pre-state baselines — no duplicate baseline here).
 *      Platform-suffixed baselines coexist in
 *      e2e/playground-goal-detail.spec.ts-snapshots/; a screenshot spec skips
 *      itself when no baseline exists for the CURRENT platform, so CI stays
 *      green before Linux baselines land. Bootstrap with
 *      `pnpm verify:ui:update`.
 *
 * Functional pins (acceptance criterion 2): the read-only state exposes ZERO
 * edit affordances — no Edit/Add buttons, no milestone reorder, no intensity
 * radios, no Mark complete, no Adjust plan — while the default active state
 * keeps every one of them (the gate must not touch active goals).
 *
 * Slice 4 (structural-edit replan banner) extends this spec with the three
 * banner postures (?state=banner-visible | banner-generating | banner-error):
 * AXE on each, functional pins (idle offer + action; quiet disabled
 * Generating; the calm error + Try again whose retry NEVER navigates — the
 * harness stub always fails), and screenshots for the genuinely new visual
 * surface: the banner card itself (idle, mobile+desktop) and its error
 * posture (mobile). Phase 1 never pinned the banner — every prior baseline
 * ran flag-off — and generating is a label swap, so it gets no baseline.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/goal-detail";

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-goal-detail.spec.ts-snapshots", file),
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

test.describe("/playground/goal-detail — read-only completed/archived detail", () => {
  for (const [label, query] of [
    ["default (active, editable)", ""],
    ["completed-readonly", "?state=completed-readonly"],
  ] as const) {
    test(`${label} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}${query}`, { waitUntil: "networkidle" });
      await expectNoAxeViolations(page);
    });
  }

  test("completed-readonly exposes ZERO edit affordances", async ({ page }) => {
    await page.goto(`${ROUTE}?state=completed-readonly`, {
      waitUntil: "networkidle",
    });
    // The quiet status treatment is there…
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    // …and every editor affordance is gone.
    await expect(page.getByRole("button", { name: /^Edit / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Add / })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Move / })).toHaveCount(0);
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Mark complete" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Adjust plan" }),
    ).toHaveCount(0);
    // The sections still read in full — content is shown, not stripped.
    await expect(
      page.getByRole("heading", { name: "Milestones" }),
    ).toBeVisible();
    await expect(page.getByText("Core and mobility work")).toBeVisible();
  });

  test("the default ACTIVE state keeps every edit affordance (gate touches nothing active)", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("button", { name: "Mark complete" }),
    ).toBeVisible();
    await expect(page.getByRole("radio")).toHaveCount(3);
    await expect(
      page.getByRole("button", { name: "Add a milestone" }),
    ).toBeVisible();
    expect(
      await page.getByRole("button", { name: /^Edit / }).count(),
    ).toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "Adjust plan" }),
    ).toBeVisible();
  });

  for (const [viewport, label] of [
    [{ width: 375, height: 812 }, "mobile"],
    [{ width: 1440, height: 900 }, "desktop"],
  ] as const) {
    test(`matches the completed-readonly ${label} baseline (${viewport.width}×${viewport.height})`, async ({
      page,
    }, testInfo) => {
      const name = `goal-detail-completed-readonly-${label}`;
      skipUnlessBaseline(name, testInfo);
      await page.setViewportSize(viewport);
      await page.goto(`${ROUTE}?state=completed-readonly`, {
        waitUntil: "networkidle",
      });
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  }
});

test.describe("/playground/goal-detail — structural-edit replan banner (slice 4)", () => {
  const BANNER_COPY = "Want me to update the rest of your plan?";

  for (const state of [
    "banner-visible",
    "banner-generating",
    "banner-error",
  ] as const) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expect(page.getByText(BANNER_COPY)).toBeVisible();
      await expectNoAxeViolations(page);
    });
  }

  test("the default (flag-off) state never shows the banner", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(page.getByText(BANNER_COPY)).toHaveCount(0);
  });

  test("banner-visible: the offer reads with its action armed", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=banner-visible`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByText(BANNER_COPY)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Yes, update it" }),
    ).toBeEnabled();
  });

  test("banner-generating: the quiet in-flight state disables the action", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=banner-generating`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("button", { name: "Generating" }),
    ).toBeDisabled();
  });

  test("banner-error: calm inline retry, and retrying NEVER navigates", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=banner-error`, {
      waitUntil: "networkidle",
    });
    await expect(page.getByText("Replan generation failed.")).toBeVisible();
    // The harness generation stub always fails — clicking Try again must
    // settle back into the same calm error on the SAME page (no navigation
    // on failure is the slice's acceptance criterion 2).
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(page.getByText("Replan generation failed.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Try again" }),
    ).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe(ROUTE);
  });

  for (const [viewport, label] of [
    [{ width: 375, height: 812 }, "mobile"],
    [{ width: 1440, height: 900 }, "desktop"],
  ] as const) {
    test(`matches the banner-visible ${label} baseline (${viewport.width}×${viewport.height})`, async ({
      page,
    }, testInfo) => {
      const name = `goal-detail-banner-visible-${label}`;
      skipUnlessBaseline(name, testInfo);
      await page.setViewportSize(viewport);
      await page.goto(`${ROUTE}?state=banner-visible`, {
        waitUntil: "networkidle",
      });
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  }

  test("matches the banner-error mobile baseline (375×812)", async ({
    page,
  }, testInfo) => {
    const name = "goal-detail-banner-error-mobile";
    skipUnlessBaseline(name, testInfo);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${ROUTE}?state=banner-error`, {
      waitUntil: "networkidle",
    });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
});
