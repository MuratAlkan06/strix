#!/usr/bin/env node
/**
 * generate-icons.mjs — Strix PWA icon pipeline (phase 2.5, slice S1).
 *
 * Generates the three brand icon CONCEPTS (SVG masters + PNG exports) and the
 * canonical wired set the manifest / layout reference. Run after changing
 * geometry, palette, or the wired variant:
 *
 *   node scripts/generate-icons.mjs
 *
 * Concepts (all derive from the SAME owl-mark geometry as
 * src/components/emblem.tsx — DESIGN.md §10 seed-grammar requirement; the
 * BODY/FACET path data below is copied verbatim from that component):
 *   v1 "Dusk Perch"  — 2-tone mark (off-white body + amber breast facet) on
 *                      the dusk ground. The emblem treatment, as an icon.
 *   v2 "First Light" — dark owl silhouette against the V1 horizon-gradient
 *                      sky + sun-glow (DESIGN.md §2 horizon recipe). Flat
 *                      fill inside the silhouette; the gradient lives in the
 *                      sky (§4 rules).
 *   v3 "Sun Disc"    — dusk-ink owl inside the amber sun disc on the dusk
 *                      ground. The single point of heat, literally.
 *
 * Colors are the V1 Dusk tokens from src/app/globals.css, converted
 * OKLCH → sRGB hex here (standard Ottosson OKLab matrices — the same math
 * browsers use to resolve oklch() into sRGB). Tokens are FROZEN; if
 * globals.css changes, re-derive here.
 *
 * Output layout (public/):
 *   icons/strix-v{1,2,3}.svg              — masters (standard mark scale)
 *   icons/strix-v{1,2,3}-maskable.svg     — maskable masters (mark shrunk to
 *                                           the ~80%-diameter safe circle)
 *   icons/strix-v{N}[-maskable]-{192,512}.png
 *   icons/icon-{192,512}.png              — WIRED set (canonical names; what
 *   icons/icon-maskable-{192,512}.png       manifest.webmanifest references)
 *   icons/apple-touch-icon-{152,167,180}.png
 *
 * Swapping the curated winner = change WIRED_VARIANT below and re-run; the
 * manifest and layout reference only the canonical names.
 *
 * Rasterizer: sharp (devDependency) — libvips/librsvg renders the SVGs,
 * including the v2 gradients, with no system ImageMagick dependency.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public", "icons");

/** Variant wired into manifest.webmanifest + apple-touch links. PROVISIONAL
 * until the /playground/icons curation pass picks the winner. */
const WIRED_VARIANT = "v1";

// ---------------------------------------------------------------------------
// OKLCH → sRGB hex (Björn Ottosson's reference OKLab matrices).
// ---------------------------------------------------------------------------
function oklchToHex(L, C, Hdeg) {
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
  const gamma = (c) => {
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

// V1 Dusk tokens (src/app/globals.css :root, OKLCH verbatim) → hex.
const DUSK = {
  background: oklchToHex(0.18, 0.035, 264), // --background  #0a1121
  foreground: oklchToHex(0.94, 0.012, 250), // --foreground  #e5ecf3
  primary: oklchToHex(0.78, 0.13, 70), // --primary (amber) #eca851
  sceneNear: oklchToHex(0.16, 0.05, 272), // --scene-near (silhouette ink)
  skyTop: oklchToHex(0.2, 0.045, 270), // horizon gradient stop 0%
  skyMid: oklchToHex(0.3, 0.07, 300), // horizon gradient stop 48%
  skyBottom: oklchToHex(0.55, 0.12, 50), // horizon gradient stop 100%
  sun: oklchToHex(0.82, 0.12, 75), // sun-glow
};

// ---------------------------------------------------------------------------
// Owl-mark geometry — copied VERBATIM from src/components/emblem.tsx (32×32
// box). Body bbox ≈ x 6.2–25.8, y 3–29.4; visual centre (16, 16.2).
// ---------------------------------------------------------------------------
const BODY_D =
  "M16 3 " +
  "C 13.6 5 12.4 6.8 12.2 8.6 " +
  "C 9 9 6.6 11.4 6.2 15 " +
  "C 5.6 19.6 7 24 10 26.6 " +
  "C 12 28.4 14 29.2 16 29.4 " +
  "C 18 29.2 20 28.4 22 26.6 " +
  "C 25 24 26.4 19.6 25.8 15 " +
  "C 25.4 11.4 23 9 19.8 8.6 " +
  "C 19.6 6.6 18.2 4.8 16 3 " +
  "Z";
const FACET_D =
  "M16 14 C 14.4 16.4 13.6 19 13.8 21.6 L 16 19.6 L 18.2 21.6 C 18.4 19 17.6 16.4 16 14 Z";

const SIZE = 512; // master canvas
const MARK_CX = 16;
const MARK_CY = 16.2;

/** transform placing the 32-box mark centred on the 512 canvas at `scale`. */
const markTransform = (scale) =>
  `translate(${256 - MARK_CX * scale} ${256 - MARK_CY * scale}) scale(${scale})`;

/**
 * Per-variant art. `mark(scale)` returns the inner SVG; `markScale` /
 * `maskScale` size the mark for standard vs maskable exports. Maskable safe
 * zone: launchers may crop to a centred circle of 80% diameter (r = 204.8 on
 * 512); the mark's max radial extent is ≈13.3 × scale, so maskScale 12 keeps
 * it at ≈160 px — comfortably inside.
 */
const VARIANTS = {
  v1: {
    label: "Dusk Perch",
    markScale: 12.8,
    maskScale: 12,
    defs: "",
    background: `<rect width="${SIZE}" height="${SIZE}" fill="${DUSK.background}"/>`,
    mark: (s) =>
      `<g transform="${markTransform(s)}">` +
      `<path d="${BODY_D}" fill="${DUSK.foreground}"/>` +
      `<path d="${FACET_D}" fill="${DUSK.primary}"/>` +
      `</g>`,
  },
  v2: {
    label: "First Light",
    markScale: 12.8,
    maskScale: 12,
    // V1 horizon recipe (DESIGN.md §2): vertical sky gradient + sun-glow
    // radial at ~78%w / 88%h @18% alpha. Gradient lives in the SKY; the owl
    // stays a flat silhouette (§4 fill discipline).
    defs:
      `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${DUSK.skyTop}"/>` +
      `<stop offset="0.48" stop-color="${DUSK.skyMid}"/>` +
      `<stop offset="1" stop-color="${DUSK.skyBottom}"/>` +
      `</linearGradient>` +
      `<radialGradient id="glow" cx="0.78" cy="0.88" r="0.5">` +
      `<stop offset="0" stop-color="${DUSK.sun}" stop-opacity="0.5"/>` +
      `<stop offset="1" stop-color="${DUSK.sun}" stop-opacity="0"/>` +
      `</radialGradient>`,
    background:
      `<rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>` +
      `<rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>`,
    mark: (s) =>
      `<g transform="${markTransform(s)}">` +
      `<path d="${BODY_D}" fill="${DUSK.sceneNear}"/>` +
      `</g>`,
  },
  v3: {
    label: "Sun Disc",
    markScale: 10.5,
    maskScale: 9.5,
    defs: "",
    // Disc r tracks the mark: max mark extent ≈13.3 × scale, disc keeps a
    // ~16% breathing ring around it and itself stays inside the safe zone
    // at maskScale (9.5 → disc r ≈ 147 ≤ 204.8).
    background: `<rect width="${SIZE}" height="${SIZE}" fill="${DUSK.background}"/>`,
    mark: (s) =>
      `<circle cx="256" cy="256" r="${Math.round(13.3 * s * 1.16)}" fill="${DUSK.primary}"/>` +
      `<g transform="${markTransform(s)}">` +
      `<path d="${BODY_D}" fill="${DUSK.background}"/>` +
      `</g>`,
  },
};

function svgFor(variant, scale) {
  const v = VARIANTS[variant];
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}">` +
    (v.defs ? `<defs>${v.defs}</defs>` : "") +
    v.background +
    v.mark(scale) +
    `</svg>`
  );
}

async function png(svg, sizePx, file) {
  await sharp(Buffer.from(svg), { density: 300 })
    .resize(sizePx, sizePx)
    .png()
    .toFile(join(OUT, file));
  console.log(`  ${file}`);
}

mkdirSync(OUT, { recursive: true });

for (const id of Object.keys(VARIANTS)) {
  const v = VARIANTS[id];
  console.log(`${id} — ${v.label}`);
  const standard = svgFor(id, v.markScale);
  const maskable = svgFor(id, v.maskScale);
  writeFileSync(join(OUT, `strix-${id}.svg`), standard);
  writeFileSync(join(OUT, `strix-${id}-maskable.svg`), maskable);
  console.log(`  strix-${id}.svg / strix-${id}-maskable.svg`);
  for (const s of [192, 512]) {
    await png(standard, s, `strix-${id}-${s}.png`);
    await png(maskable, s, `strix-${id}-maskable-${s}.png`);
  }
}

// Wired canonical set (manifest + apple-touch links reference ONLY these
// names — swapping the winner never touches the manifest or layout).
console.log(`wired set ← ${WIRED_VARIANT} (provisional until curation)`);
const wired = VARIANTS[WIRED_VARIANT];
const standard = svgFor(WIRED_VARIANT, wired.markScale);
const maskable = svgFor(WIRED_VARIANT, wired.maskScale);
for (const s of [192, 512]) {
  await png(standard, s, `icon-${s}.png`);
  await png(maskable, s, `icon-maskable-${s}.png`);
}
// iOS home-screen icons (opaque full-bleed; iOS applies its own corner mask).
for (const s of [152, 167, 180]) {
  await png(standard, s, `apple-touch-icon-${s}.png`);
}

console.log("palette:", DUSK);
console.log("done.");
