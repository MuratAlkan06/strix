#!/usr/bin/env tsx
/**
 * generate-splash.mts — Strix iOS launch-screen pipeline (phase 2.5, slice S9).
 *
 * Renders one PNG launch image per iPhone in the pragmatic device set, for the
 * `apple-touch-startup-image` <link> tags the root layout emits. Run after
 * changing the brand mark, the dusk ground, or the device table:
 *
 *   pnpm tsx scripts/generate-splash.mts
 *
 * EACH image is the V6a brand mark (the wired icon variant — see
 * scripts/generate-icons.mjs) centred on the flat DUSK ground (the manifest
 * background_color), at the device's PHYSICAL pixel resolution. The geometry
 * (head / amber eye-glow / beak) and palette are copied VERBATIM from the V6a
 * variant in generate-icons.mjs so an icon and its launch screen are the same
 * mark — if generate-icons.mjs's V6a geometry or DUSK palette changes,
 * re-derive here. (Kept as a deliberate copy rather than a shared import: the
 * icon script is a standalone .mjs run with `node` and this is a .mts run with
 * `tsx`; the device table IS shared from src/lib/ios-splash.ts below, which is
 * the part that must never drift from the layout's <link> media queries.)
 *
 * The DEVICE TABLE is imported from src/lib/ios-splash.ts — the SAME module the
 * layout's startupImage reads — so the rendered file names and pixel sizes can
 * never disagree with the media queries that select them.
 *
 * Output: public/splash/apple-splash-<physicalW>x<physicalH>.png
 *
 * Rasterizer: sharp (devDependency), as in generate-icons.mjs.
 */
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  SPLASH_DEVICES,
  splashWidthPx,
  splashHeightPx,
  type SplashDevice,
} from "../src/lib/ios-splash";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "splash");

// ---------------------------------------------------------------------------
// OKLCH → sRGB hex (Björn Ottosson's reference OKLab matrices) — VERBATIM from
// scripts/generate-icons.mjs so both pipelines resolve the frozen V1 Dusk
// tokens to the exact same hex.
// ---------------------------------------------------------------------------
function oklchToHex(L: number, C: number, Hdeg: number): string {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const gamma = (c: number) => {
    c = Math.min(1, Math.max(0, c));
    return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  };
  return `#${lin
    .map((c) =>
      Math.round(gamma(c) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

// V1 Dusk tokens (src/app/globals.css :root) → hex. Only the subset the V6a
// mark + ground need.
const DUSK = {
  background: oklchToHex(0.18, 0.035, 264), // --background #0a1121 (the ground)
  primary: oklchToHex(0.78, 0.13, 70), // --primary amber (eye glow + beak)
  headDusk: oklchToHex(0.26, 0.04, 264), // v6a elevated head (separates on flat)
};

// ---------------------------------------------------------------------------
// V6a mark geometry — copied VERBATIM from scripts/generate-icons.mjs (512-box
// art space). Tufted head silhouette, amber eye discs, amber beak kite.
// ---------------------------------------------------------------------------
const ART = 512;
const V6_HEAD_D =
  "M 132 128 Q 256 250 380 128 C 428 182 444 262 408 330 C 372 402 312 430 256 430 C 200 430 140 402 104 330 C 68 262 84 182 132 128 Z";
const V6_EYES = [
  { cx: 188, cy: 268 },
  { cx: 324, cy: 268 },
];
const V6_BEAK = `<polygon points="256,288 278,330 256,376 234,330" fill="${DUSK.primary}"/>`;
const v6Mark =
  `<path d="${V6_HEAD_D}" fill="${DUSK.headDusk}"/>` +
  V6_EYES.map(
    (e) => `<circle cx="${e.cx}" cy="${e.cy}" r="46" fill="${DUSK.primary}"/>`,
  ).join("") +
  V6_BEAK;

/**
 * One launch screen: the V6a mark centred on a dusk-filled portrait canvas.
 * The mark is sized to ~22% of the shorter (width) edge — an app-launch scale,
 * smaller than an icon, so it reads as a calm brand moment, not a giant logo.
 */
function splashSvg(widthPx: number, heightPx: number): string {
  const markPx = Math.round(widthPx * 0.22);
  const x = (widthPx - markPx) / 2;
  const y = (heightPx - markPx) / 2;
  const scale = markPx / ART;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">` +
    `<rect width="${widthPx}" height="${heightPx}" fill="${DUSK.background}"/>` +
    `<g transform="translate(${x} ${y}) scale(${scale})">${v6Mark}</g>` +
    `</svg>`
  );
}

async function renderSplash(device: SplashDevice): Promise<void> {
  const w = splashWidthPx(device);
  const h = splashHeightPx(device);
  const file = `apple-splash-${w}x${h}.png`;
  const svg = splashSvg(w, h);
  // The SVG declares its exact w×h in px, so render at native size (no
  // `density` multiplier) and pin the output to the physical resolution iOS
  // expects for this device.
  await sharp(Buffer.from(svg))
    .resize(w, h)
    .png()
    .toFile(join(OUT, file));
  console.log(`  ${file}  (${device.covers})`);
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  console.log(`iOS launch screens ← V6a mark on dusk (${DUSK.background})`);
  for (const device of SPLASH_DEVICES) {
    await renderSplash(device);
  }
  console.log(`done — ${SPLASH_DEVICES.length} images in public/splash/.`);
}

await main();
