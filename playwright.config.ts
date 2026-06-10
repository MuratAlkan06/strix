import { defineConfig, devices } from "@playwright/test";

/**
 * playwright.config.ts — the `verify:ui` harness config.
 *
 * Scope: the DAWN curation surface `/playground/dashboard` (the stable, seed-only
 * route). Two assertions per slice: an axe-core WCAG 2.1 AA scan (the source of
 * truth for contrast — DESIGN.md §0/§11 subordinate the prose numbers to this)
 * and `toHaveScreenshot` visual baselines.
 *
 * DETERMINISM CHOICES (why production server + reduced motion):
 *  - webServer runs the PRODUCTION build (`pnpm start`), never `next dev`: dev
 *    injects HMR/error overlays and unminified, layout-shifting chrome that make
 *    screenshots non-deterministic. Locally the command also builds first so
 *    `pnpm verify:ui` is one self-contained command; in CI the workflow builds in
 *    its own (cacheable) step and this webServer just starts the server.
 *  - reduced motion + animations:'disabled' freeze every DAWN transition (§7) so
 *    a screenshot is the same pixels every run.
 *  - traces/video/retries off: this is a deterministic gate, not a flaky e2e suite.
 *
 * CROSS-PLATFORM SCREENSHOTS (the classic trap): Linux CI and macOS render fonts
 * with different antialiasing, so one baseline cannot serve both. Handled by
 * Playwright's DEFAULT snapshot naming, which suffixes the platform
 * (`…-chromium-linux.png` vs `…-chromium-darwin.png`) — the two baselines coexist
 * and never collide. The axe scan is platform-independent and ALWAYS runs; the
 * screenshot specs `test.skip()` themselves when no baseline exists for the
 * current platform (see e2e/playground-dashboard.spec.ts header), so CI is green
 * before its Linux baselines are committed and never flaky. Bootstrap a platform's
 * baselines with `pnpm verify:ui:update`. Scheme also documented in DESIGN.md §11.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  // Deterministic screenshots: no animations, reduced motion, stable threshold.
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      // small tolerance absorbs sub-pixel AA noise without hiding real regressions
      maxDiffPixelRatio: 0.01,
    },
  },

  use: {
    baseURL: "http://localhost:3000",
    trace: "off",
    video: "off",
    screenshot: "off",
    // reducedMotion is a browser-context option in this Playwright version, so it
    // is set here (emulates prefers-reduced-motion: reduce → DAWN §7 motion map
    // off → deterministic screenshots).
    contextOptions: { reducedMotion: "reduce" },
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Local: build then start (self-contained `pnpm verify:ui`). CI: the workflow
    // runs `pnpm build` in its own step, so here we only start the prod server.
    command: process.env.CI ? "pnpm start" : "pnpm build && pnpm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
