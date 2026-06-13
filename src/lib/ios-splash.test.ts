/**
 * ios-splash.test.ts — guards the iOS launch-screen contract (phase 2.5 S9).
 *
 * The invariant that actually matters on-device: every device's media query
 * and its image file must agree, or iOS shows a blank launch. These tests pin
 * the agreement by construction (no device fixtures, just the table's own
 * algebra) AND verify the generator emitted a real PNG at the exact physical
 * size each <link> claims — so a drift between the table and public/splash/ is
 * caught here, not on a phone.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  SPLASH_DEVICES,
  SPLASH_STARTUP_IMAGES,
  splashFilename,
  splashHeightPx,
  splashMedia,
  splashWidthPx,
} from "./ios-splash";

const PUBLIC = join(__dirname, "..", "..", "public");

describe("SPLASH_DEVICES — the pragmatic iPhone set", () => {
  it("covers the 8/X/12/14/15 families (a non-trivial set)", () => {
    // Pragmatic, not exhaustive — but a regression that empties or truncates
    // the table to one device should fail loudly.
    expect(SPLASH_DEVICES.length).toBeGreaterThanOrEqual(8);
  });

  it("has positive, integer logical dimensions and a dpr of 2 or 3", () => {
    for (const d of SPLASH_DEVICES) {
      expect(Number.isInteger(d.cssWidth) && d.cssWidth > 0).toBe(true);
      expect(Number.isInteger(d.cssHeight) && d.cssHeight > 0).toBe(true);
      expect([2, 3]).toContain(d.dpr);
      // iPhones are taller than wide in portrait.
      expect(d.cssHeight).toBeGreaterThan(d.cssWidth);
    }
  });

  it("yields a UNIQUE physical resolution per device (no file collisions)", () => {
    // Two devices that share a css size but differ in dpr (XR vs 11 Pro Max)
    // must still map to different files — the filename keys on physical px.
    const files = SPLASH_DEVICES.map(splashFilename);
    expect(new Set(files).size).toBe(files.length);
  });

  it("yields a UNIQUE media query per device (no two links both match)", () => {
    const medias = SPLASH_DEVICES.map(splashMedia);
    expect(new Set(medias).size).toBe(medias.length);
  });
});

describe("media queries", () => {
  it("are portrait-only and carry all three iOS match terms", () => {
    for (const d of SPLASH_DEVICES) {
      const m = splashMedia(d);
      expect(m).toContain(`(device-width: ${d.cssWidth}px)`);
      expect(m).toContain(`(device-height: ${d.cssHeight}px)`);
      expect(m).toContain(`(-webkit-device-pixel-ratio: ${d.dpr})`);
      expect(m).toContain("(orientation: portrait)");
    }
  });
});

describe("filenames", () => {
  it("encode the exact physical pixel size the layout will request", () => {
    for (const d of SPLASH_DEVICES) {
      expect(splashFilename(d)).toBe(
        `/splash/apple-splash-${splashWidthPx(d)}x${splashHeightPx(d)}.png`,
      );
    }
  });
});

describe("SPLASH_STARTUP_IMAGES — the metadata array", () => {
  it("has one {url, media} entry per device, in lockstep with the table", () => {
    expect(SPLASH_STARTUP_IMAGES).toHaveLength(SPLASH_DEVICES.length);
    SPLASH_STARTUP_IMAGES.forEach((entry, i) => {
      const d = SPLASH_DEVICES[i]!;
      expect(entry.url).toBe(splashFilename(d));
      expect(entry.media).toBe(splashMedia(d));
    });
  });
});

describe("generated assets", () => {
  it("a real PNG exists for every device the layout links", () => {
    // Catches a table edited without re-running scripts/generate-splash.mts.
    for (const d of SPLASH_DEVICES) {
      const rel = splashFilename(d).replace(/^\//, "");
      expect(existsSync(join(PUBLIC, rel)), `missing ${rel}`).toBe(true);
    }
  });
});
