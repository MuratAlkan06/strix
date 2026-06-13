/**
 * ios-safe-area.spec.ts — live proof of the S9 iOS-standalone CSS contract
 * against the production server the verify:ui harness boots.
 *
 * VERIFICATION LIMIT (state honestly): env(safe-area-inset-*) resolves to 0 in
 * every non-notched context — including this headless Chromium — so this suite
 * CANNOT prove the notch/home-indicator behaviour itself. That is only
 * verifiable on a real device (the S11 device matrix, user-owned). What it CAN
 * prove, and does, is that the safe-area layer is APPLIED and computes to its
 * correct off-device baseline (a no-op that shifts no layout), and that the
 * other standalone polish (overscroll-containment, the splash <link> set, the
 * startup-image assets) is wired and unbroken. So a regression that drops the
 * classes, mis-targets the cutout vars, or breaks the splash wiring fails here.
 *
 * Target: /playground/dashboard — the auth-exempt curation route that renders
 * the HorizonHeader deterministically (same reasoning as the screenshot/SW
 * specs). The root layout's body wrapper + the header are present on it.
 *
 * Paths are RELATIVE (baseURL) — never hardcoded http://localhost:3000.
 */
import { test, expect } from "@playwright/test";

const ROUTE = "/playground/dashboard";

test.describe("iOS standalone polish (S9) — CSS applied + wired", () => {
  test("body carries the safe-area + overscroll-containment layer", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const body = await page.evaluate(() => {
      const cs = getComputedStyle(document.body);
      return {
        className: document.body.className,
        paddingTop: cs.paddingTop,
        paddingBottom: cs.paddingBottom,
        paddingLeft: cs.paddingLeft,
        paddingRight: cs.paddingRight,
        overscrollX: cs.overscrollBehaviorX,
        overscrollY: cs.overscrollBehaviorY,
      };
    });
    // The four inset utilities are present in the class list…
    for (const cls of ["pt-safe", "pr-safe", "pb-safe", "pl-safe"]) {
      expect(body.className).toContain(cls);
    }
    // …and resolve to 0 off-device (the no-op that shifts no baseline; the
    // notch reserve only materialises under a real inset on-device).
    expect(body.paddingTop).toBe("0px");
    expect(body.paddingBottom).toBe("0px");
    expect(body.paddingLeft).toBe("0px");
    expect(body.paddingRight).toBe("0px");
    // No-bounce overscroll is in effect on both axes.
    expect(body.overscrollX).toBe("contain");
    expect(body.overscrollY).toBe("contain");
  });

  test("the HorizonHeader emblem clears the status bar via max(1rem, inset)", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const emblem = await page.evaluate(() => {
      const header = document.querySelector("header");
      if (!header) return null;
      const el = [...header.querySelectorAll<HTMLElement>("div[style]")].find(
        (d) => (d.getAttribute("style") ?? "").includes("max(1rem"),
      );
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { top: cs.top, left: cs.left, position: cs.position };
    });
    expect(emblem).not.toBeNull();
    // Off-device max(1rem, env(0)) = 1rem = the prior top-4/left-4 → no shift.
    expect(emblem!.position).toBe("absolute");
    expect(emblem!.top).toBe("16px");
    expect(emblem!.left).toBe("16px");
  });

  test("emits one apple-touch-startup-image link per device, each portrait-only", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const links = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel="apple-touch-startup-image"]',
        ),
      ].map((l) => ({ href: l.getAttribute("href"), media: l.media })),
    );
    expect(links.length).toBeGreaterThanOrEqual(8);
    for (const l of links) {
      expect(l.href).toMatch(/^\/splash\/apple-splash-\d+x\d+\.png$/);
      expect(l.media).toContain("orientation: portrait");
      expect(l.media).toContain("-webkit-device-pixel-ratio");
    }
    // Every link points at a distinct image (no two devices share a file).
    const hrefs = links.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test("every splash asset the layout links is actually served (200 image/png)", async ({
    page,
  }) => {
    await page.goto(ROUTE);
    const hrefs = await page.evaluate(() =>
      [
        ...document.querySelectorAll<HTMLLinkElement>(
          'link[rel="apple-touch-startup-image"]',
        ),
      ].map((l) => l.getAttribute("href")!),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      const res = await page.request.get(href);
      expect(res.status(), `missing splash asset ${href}`).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
  });

  test("layout is unbroken: no horizontal overflow at 375 / 768 / 1440", async ({
    page,
  }) => {
    for (const width of [375, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(ROUTE);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      // A safe-area layer that leaked into horizontal scroll would surface as
      // a positive overflow here (the classic env() landscape-inset mistake).
      expect(overflow, `horizontal overflow at ${width}px`).toBeLessThanOrEqual(
        1,
      );
    }
  });
});
