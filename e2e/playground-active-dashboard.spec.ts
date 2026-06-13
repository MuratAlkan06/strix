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
 *
 * Phase 2 slice 6+7 ADDS the accomplished / friday-prompt /
 * accomplished-no-active states (axe + both viewports each) plus functional
 * pins: the default state still renders NEITHER new surface (the additive
 * proof that keeps the original baselines byte-identical), the Friday banner
 * links /check-in, and accomplished cards deep-link to goal detail.
 *
 * Phase 2.5 slice S8 ADDS the install-chrome / install-ios IN-CONTEXT states
 * (axe + mobile baseline each): the eligible install banner rendered in place
 * between the check-in prompt and the hero countdown, which the gated
 * <InstallBanner> can't surface in the auth-exempt playground. Plus the focus
 * pin: keyboard-dismissing the banner moves focus to the documented neighbor
 * (the hero countdown), NEVER to <body>, and a polite live region carries the
 * dismissal text — the S3 focus-order regression class, asserted here.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test, expect, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ROUTE = "/playground/active-dashboard";

// Mirror of install-banner.tsx's exported constants. The component is a
// "use client" module (Clerk + React imports) and importing it into this Node
// test context would drag those deps in, so the two STABLE strings are mirrored
// here instead; install-banner.test.ts could pin parity, but they are constants
// by contract (the announcement copy and the dismiss-focus anchor id).
const INSTALL_DISMISS_FOCUS_ID = "install-dismiss-focus-target";
const DISMISS_ANNOUNCEMENT = "Install prompt dismissed";

/** True if a baseline PNG for `name` exists for the current project+platform. */
function hasBaseline(name: string): boolean {
  const file = `${name}-chromium-${process.platform}.png`;
  return existsSync(
    join(__dirname, "playground-active-dashboard.spec.ts-snapshots", file),
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

test.describe("/playground/active-dashboard — accomplished + Friday prompt (phase 2)", () => {
  for (const state of [
    "accomplished",
    "friday-prompt",
    "accomplished-no-active",
  ] as const) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expectNoAxeViolations(page);
    });
  }

  test("default state still renders neither new surface (the additive proof)", async ({
    page,
  }) => {
    await page.goto(ROUTE, { waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Accomplished" }),
    ).toHaveCount(0);
    await expect(page.getByRole("link", { name: /check in/i })).toHaveCount(0);
  });

  test("the Friday banner links /check-in; gone from the Wednesday states", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=friday-prompt`, {
      waitUntil: "networkidle",
    });
    const banner = page.getByRole("link", {
      name: /How did this week feel\?/,
    });
    await expect(banner).toBeVisible();
    await expect(banner).toHaveAttribute("href", "/check-in");

    await page.goto(`${ROUTE}?state=accomplished`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("link", { name: /How did this week feel\?/ }),
    ).toHaveCount(0);
  });

  test("accomplished cards carry the honest date line and deep-link to goal detail", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=accomplished`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByRole("heading", { name: "Accomplished" }),
    ).toBeVisible();
    // Completed goal → "Completed …"; archived keeps its surviving
    // completed_at; NULL completed_at falls back to "Archived …".
    const finished = page.getByRole("link", { name: /Finished goal/ });
    await expect(finished).toContainText("Completed Jun 5, 2026");
    await expect(finished).toHaveAttribute("href", "/goals/g-done");
    await expect(
      page.getByRole("link", { name: /Couch to 5k/ }),
    ).toContainText("Completed Apr 18, 2026");
    await expect(
      page.getByRole("link", { name: /Thirty days of sketching/ }),
    ).toContainText("Archived Mar 2, 2026");
  });

  test("zero active + accomplished renders coherent empty sections, never the pre-dawn empty state", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=accomplished-no-active`, {
      waitUntil: "networkidle",
    });
    await expect(
      page.getByText("Nothing scheduled today. Rest is part of the plan."),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Accomplished" }),
    ).toBeVisible();
  });

  for (const [state, viewport, label] of [
    ["accomplished", { width: 375, height: 812 }, "mobile"],
    ["accomplished", { width: 1440, height: 900 }, "desktop"],
    ["friday-prompt", { width: 375, height: 812 }, "mobile"],
    ["friday-prompt", { width: 1440, height: 900 }, "desktop"],
    ["accomplished-no-active", { width: 375, height: 812 }, "mobile"],
    ["accomplished-no-active", { width: 1440, height: 900 }, "desktop"],
  ] as const) {
    test(`matches the ${state} ${label} baseline (${viewport.width}×${viewport.height})`, async ({
      page,
    }, testInfo) => {
      const name = `active-dashboard-${state}-${label}`;
      skipUnlessBaseline(name, testInfo);
      await page.setViewportSize(viewport);
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  }
});

test.describe("/playground/active-dashboard — install banner in context (S8)", () => {
  for (const state of ["install-chrome", "install-ios"] as const) {
    test(`${state} state has zero WCAG 2.1 AA violations (full page, no exclusions)`, async ({
      page,
    }) => {
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expectNoAxeViolations(page);
    });
  }

  test("the banner renders in place — between the check-in prompt and the hero countdown", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=install-chrome`, {
      waitUntil: "networkidle",
    });
    // The eligible Chrome banner the gated container can't surface here.
    await expect(
      page.getByRole("region", { name: "Install Strix" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Install" }),
    ).toBeVisible();
  });

  test("keyboard-dismiss moves focus to the hero countdown (not <body>) and announces politely — the S3 focus-order pin", async ({
    page,
  }) => {
    await page.goto(`${ROUTE}?state=install-chrome`, {
      waitUntil: "networkidle",
    });
    const dismiss = page.getByRole("button", { name: "Dismiss" });
    await dismiss.focus();
    await expect(dismiss).toBeFocused();

    // Enter on the X dismisses; the <section> unmounts.
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("region", { name: "Install Strix" }),
    ).toHaveCount(0);

    // Focus landed on the documented neighbor (the hero countdown), NOT <body>.
    // The move is deferred a frame past the unmount commit, so this auto-retries.
    await expect(page.locator(`#${INSTALL_DISMISS_FOCUS_ID}`)).toBeFocused();
    expect(
      await page.evaluate(() => document.activeElement === document.body),
    ).toBe(false);

    // …and the polite live region carries the dismissal text for SR users.
    await expect(
      page.locator("#install-dismiss-announcer"),
    ).toHaveText(DISMISS_ANNOUNCEMENT);
  });

  for (const state of ["install-chrome", "install-ios"] as const) {
    test(`matches the ${state} in-context mobile baseline (375×812)`, async ({
      page,
    }, testInfo) => {
      const name = `active-dashboard-${state}-mobile`;
      skipUnlessBaseline(name, testInfo);
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`${ROUTE}?state=${state}`, { waitUntil: "networkidle" });
      await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
    });
  }
});
