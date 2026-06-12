/**
 * PWA manifest + wired-icon parity (phase 2.5, slice S1).
 *
 * The manifest and layout reference CANONICAL icon filenames emitted by
 * scripts/generate-icons.mjs; swapping the curated icon variant regenerates
 * files without touching references. That contract only holds if the files
 * actually exist with the declared dimensions — this test pins it, plus the
 * W3C-spec field shapes the install prompt depends on.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const PUBLIC = join(ROOT, "public");

const manifest = JSON.parse(
  readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8"),
);

/** PNG pixel size from the IHDR chunk (bytes 16–23). */
function pngSize(path: string): { width: number; height: number } {
  const buf = readFileSync(path);
  // PNG signature sanity check.
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("manifest.webmanifest", () => {
  it("carries the required install fields", () => {
    expect(manifest.name).toBe("Strix");
    expect(manifest.short_name).toBe("Strix");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.orientation).toBe("portrait");
  });

  it("uses V1 Dusk hex colors", () => {
    // --background oklch(0.18 0.035 264) → #0a1121 (scripts/generate-icons.mjs)
    expect(manifest.theme_color).toBe("#0a1121");
    expect(manifest.background_color).toBe("#0a1121");
  });

  it("declares 192/512 icons in both any and maskable purposes", () => {
    const byPurpose = (purpose: string) =>
      manifest.icons
        .filter((i: { purpose: string }) => i.purpose === purpose)
        .map((i: { sizes: string }) => i.sizes)
        .sort();
    expect(byPurpose("any")).toEqual(["192x192", "512x512"]);
    expect(byPurpose("maskable")).toEqual(["192x192", "512x512"]);
  });

  it("points every icon at an existing PNG of the declared size", () => {
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      const [w, h] = icon.sizes.split("x").map(Number);
      const size = pngSize(join(PUBLIC, icon.src));
      expect(size).toEqual({ width: w, height: h });
    }
  });
});

describe("root layout PWA wiring", () => {
  const layout = readFileSync(join(ROOT, "src/app/layout.tsx"), "utf8");

  it("links the manifest", () => {
    expect(layout).toContain('manifest: "/manifest.webmanifest"');
  });

  it("references apple-touch icons that exist at the declared size", () => {
    const refs = [...layout.matchAll(/\/icons\/apple-touch-icon-(\d+)\.png/g)];
    expect(refs.length).toBeGreaterThanOrEqual(1);
    for (const [url, declared] of refs) {
      const size = pngSize(join(PUBLIC, url));
      expect(size).toEqual({
        width: Number(declared),
        height: Number(declared),
      });
    }
  });
});
