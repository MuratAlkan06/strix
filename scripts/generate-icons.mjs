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
 * ROUND 1 concepts (all derive from the SAME owl-mark geometry as
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
 * ROUND 2 concepts (curation feedback: the emblem seed reads as a blob at
 * icon size — round 2 leads with the proven owl signifiers instead: two
 * large eyes, ear tufts, facial disc. Same palette, same flat-geometric
 * register; geometry authored directly in the 512 canvas):
 *   v4 "Watcher"     — reduced geometric owl face front-on: two large pale
 *                      eyes with dusk pupils, triangular ear tufts, amber
 *                      beak wedge, on the dusk ground.
 *   v5 "Disc"        — barn-owl facial disc: pale heart-shaped face (top
 *                      notch, pointed chin) with two dusk eyes and a narrow
 *                      amber beak, on the dusk ground.
 *   v6 "Night Watch" — tufted owl-head silhouette in dusk ink against the
 *                      v2 horizon-gradient sky, eyes as two solid amber
 *                      discs (the glow of an owl watching at dusk).
 *
 * ROUND 3 — V6 ground refinements (curation feedback: V6's owl wins but the
 * gradient ground is in question; same head/eye/beak geometry, different
 * grounds):
 *   v6a "Flat"       — flat dusk ground. The v6 dusk-ink head would vanish on
 *                      it (60px squint test: ΔL 0.02 is invisible), so the
 *                      head re-tones to an elevated dusk. The --card token
 *                      (L 0.225) ALSO fails the squint test against the
 *                      L 0.18 ground — verified empirically at true 60px —
 *                      so the head uses non-token oklch(0.26 0.04 264),
 *                      same hue family, two steps up.
 *   v6b "Pale"       — pale (foreground) head silhouette on flat dusk; eyes
 *                      as dusk sockets with amber irises (solid-amber eyes
 *                      wash out against the pale head at 60px — checked),
 *                      amber beak.
 *   v6c "Muted horizon" — the v6 gradient restrained: flat dusk sky over the
 *                      top ~3/4 (raised to L 0.245 so the dusk-ink head still
 *                      separates), the warm band compressed into the bottom
 *                      quarter at lower chroma, sun-glow at ~half strength.
 *                      Reads ~80% flat with a hint of horizon.
 *
 * Colors are the V1 Dusk tokens from src/app/globals.css, converted
 * OKLCH → sRGB hex here (standard Ottosson OKLab matrices — the same math
 * browsers use to resolve oklch() into sRGB). Tokens are FROZEN; if
 * globals.css changes, re-derive here.
 *
 * Output layout (public/):
 *   icons/strix-{id}.svg                  — masters (standard mark scale)
 *   icons/strix-{id}-maskable.svg         — maskable masters (mark shrunk to
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

/** Variant wired into manifest.webmanifest + apple-touch links. CANONICAL:
 * v6a "Night Watch — flat", user-curated 2026-06-12 (round 3 on
 * /playground/icons; recorded in docs/DECISIONS.md "Visual register" +
 * docs/DESIGN.md §10). */
const WIRED_VARIANT = "v6a";

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
  // Round-3 (non-token, dusk-family) — rationale in the v6a/v6c notes above.
  headDusk: oklchToHex(0.26, 0.04, 264), // v6a elevated head
  flatSky: oklchToHex(0.245, 0.05, 272), // v6c flat sky band
  duskMauve: oklchToHex(0.28, 0.055, 300), // v6c horizon transition
  emberWarm: oklchToHex(0.44, 0.08, 50), // v6c muted warm band
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

/** transform scaling 512-space art about the canvas centre (round-2 variants
 * author geometry directly in the 512 box; markScale 1 = as drawn). */
const artTransform = (scale) =>
  `translate(${256 * (1 - scale)} ${256 * (1 - scale)}) scale(${scale})`;

// V1 horizon recipe (DESIGN.md §2): vertical sky gradient + sun-glow radial
// at ~78%w / 88%h. Shared by v2 and v6; gradient lives in the SKY only (§4
// fill discipline — marks stay flat).
const HORIZON_DEFS =
  `<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${DUSK.skyTop}"/>` +
  `<stop offset="0.48" stop-color="${DUSK.skyMid}"/>` +
  `<stop offset="1" stop-color="${DUSK.skyBottom}"/>` +
  `</linearGradient>` +
  `<radialGradient id="glow" cx="0.78" cy="0.88" r="0.5">` +
  `<stop offset="0" stop-color="${DUSK.sun}" stop-opacity="0.5"/>` +
  `<stop offset="1" stop-color="${DUSK.sun}" stop-opacity="0"/>` +
  `</radialGradient>`;
const HORIZON_BG =
  `<rect width="${SIZE}" height="${SIZE}" fill="url(#sky)"/>` +
  `<rect width="${SIZE}" height="${SIZE}" fill="url(#glow)"/>`;

// Round-3 restrained horizon (v6c): flat dusk holds to 74%, the warm band
// lives in the bottom quarter at lower chroma, glow at ~half the v2 strength
// and pinned near the bottom edge.
const MUTED_HORIZON_DEFS =
  `<linearGradient id="mutedSky" x1="0" y1="0" x2="0" y2="1">` +
  `<stop offset="0" stop-color="${DUSK.flatSky}"/>` +
  `<stop offset="0.74" stop-color="${DUSK.flatSky}"/>` +
  `<stop offset="0.88" stop-color="${DUSK.duskMauve}"/>` +
  `<stop offset="1" stop-color="${DUSK.emberWarm}"/>` +
  `</linearGradient>` +
  `<radialGradient id="mutedGlow" cx="0.78" cy="0.97" r="0.38">` +
  `<stop offset="0" stop-color="${DUSK.sun}" stop-opacity="0.28"/>` +
  `<stop offset="1" stop-color="${DUSK.sun}" stop-opacity="0"/>` +
  `</radialGradient>`;
const MUTED_HORIZON_BG =
  `<rect width="${SIZE}" height="${SIZE}" fill="url(#mutedSky)"/>` +
  `<rect width="${SIZE}" height="${SIZE}" fill="url(#mutedGlow)"/>`;

// ---------------------------------------------------------------------------
// V6 head geometry — shared by v6 and its round-3 ground refinements
// (v6a/v6b/v6c). Tufted head silhouette, eye discs at r 46, beak kite.
// Widest extent from canvas centre: dx = 188 (Bézier x 444 − 256), so
// maskScale 0.85 → 160 ≤ 204.8 safe radius for every member of the family.
// ---------------------------------------------------------------------------
const V6_HEAD_D =
  "M 132 128 Q 256 250 380 128 C 428 182 444 262 408 330 C 372 402 312 430 256 430 C 200 430 140 402 104 330 C 68 262 84 182 132 128 Z";
const V6_EYES = [
  { cx: 188, cy: 268 },
  { cx: 324, cy: 268 },
];
const v6Head = (fill) => `<path d="${V6_HEAD_D}" fill="${fill}"/>`;
const v6Eyes = (r, fill) =>
  V6_EYES.map((e) => `<circle cx="${e.cx}" cy="${e.cy}" r="${r}" fill="${fill}"/>`).join("");
const V6_BEAK = `<polygon points="256,288 278,330 256,376 234,330" fill="${DUSK.primary}"/>`;

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
    defs: HORIZON_DEFS,
    background: HORIZON_BG,
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
  // -- Round 2 (owl-forward; 512-space geometry, artTransform scaling) ------
  v4: {
    label: "Watcher",
    // Max radial extent from canvas centre: eyes' outer edge dx = 192
    // (cx 360 + r 88 − 256). maskScale 0.84 → 161 ≤ 204.8 safe radius.
    markScale: 1,
    maskScale: 0.84,
    defs: "",
    background: `<rect width="${SIZE}" height="${SIZE}" fill="${DUSK.background}"/>`,
    mark: (s) =>
      `<g transform="${artTransform(s)}">` +
      // Ear tufts — short triangles rooted on the eye-top arcs, apexes
      // angled up-OUTWARD (owl tufts splay; cat ears point straight up).
      `<polygon points="82,246 162,213 96,150" fill="${DUSK.foreground}"/>` +
      `<polygon points="430,246 350,213 416,150" fill="${DUSK.foreground}"/>` +
      // Eyes — the load-bearing signifier: two large pale discs, dusk pupils.
      `<circle cx="152" cy="300" r="88" fill="${DUSK.foreground}"/>` +
      `<circle cx="360" cy="300" r="88" fill="${DUSK.foreground}"/>` +
      `<circle cx="152" cy="300" r="42" fill="${DUSK.background}"/>` +
      `<circle cx="360" cy="300" r="42" fill="${DUSK.background}"/>` +
      // Beak — amber kite between the eyes; the single point of heat.
      `<polygon points="256,308 284,352 256,408 228,352" fill="${DUSK.primary}"/>` +
      `</g>`,
  },
  v5: {
    label: "Disc",
    // Extent: chin point dy = 160 (y 416 − 256); ×1.1 → 176 standard,
    // ×0.95 → 152 maskable ≤ 204.8.
    markScale: 1.1,
    maskScale: 0.95,
    defs: "",
    background: `<rect width="${SIZE}" height="${SIZE}" fill="${DUSK.background}"/>`,
    mark: (s) =>
      `<g transform="${artTransform(s)}">` +
      // Facial disc — barn-owl heart: notched brow, lobed sides, pointed chin.
      `<path d="M 256 168 C 220 120 150 130 130 200 C 112 268 140 350 256 416 C 372 350 400 268 382 200 C 362 130 292 120 256 168 Z" fill="${DUSK.foreground}"/>` +
      // Eyes — dusk discs set wide in the pale disc.
      `<circle cx="196" cy="248" r="32" fill="${DUSK.background}"/>` +
      `<circle cx="316" cy="248" r="32" fill="${DUSK.background}"/>` +
      // Beak — narrow amber kite on the disc's centre line.
      `<polygon points="256,262 274,304 256,348 238,304" fill="${DUSK.primary}"/>` +
      `</g>`,
  },
  v6: {
    label: "Night Watch",
    markScale: 1,
    maskScale: 0.85,
    defs: HORIZON_DEFS,
    background: HORIZON_BG,
    mark: (s) =>
      `<g transform="${artTransform(s)}">` +
      // Tufted head silhouette in dusk ink; amber eye-glow; beak breaks any
      // cat-head misread.
      v6Head(DUSK.sceneNear) +
      v6Eyes(46, DUSK.primary) +
      V6_BEAK +
      `</g>`,
  },
  // -- Round 3 (V6 ground refinements; identical head geometry) -------------
  v6a: {
    label: "Flat",
    markScale: 1,
    maskScale: 0.85,
    defs: "",
    background: `<rect width="${SIZE}" height="${SIZE}" fill="${DUSK.background}"/>`,
    mark: (s) =>
      `<g transform="${artTransform(s)}">` +
      // Head re-toned to elevated dusk so it separates from the flat ground
      // (header notes: --card fails the 60px squint test; this tone passes).
      v6Head(DUSK.headDusk) +
      v6Eyes(46, DUSK.primary) +
      V6_BEAK +
      `</g>`,
  },
  v6b: {
    label: "Pale",
    markScale: 1,
    maskScale: 0.85,
    defs: "",
    background: `<rect width="${SIZE}" height="${SIZE}" fill="${DUSK.background}"/>`,
    mark: (s) =>
      `<g transform="${artTransform(s)}">` +
      // Pale head; eyes punch through to the dusk ground as sockets, amber
      // irises keep the glow signature (solid amber washes out on pale).
      v6Head(DUSK.foreground) +
      v6Eyes(46, DUSK.background) +
      v6Eyes(24, DUSK.primary) +
      V6_BEAK +
      `</g>`,
  },
  v6c: {
    label: "Muted horizon",
    markScale: 1,
    maskScale: 0.85,
    defs: MUTED_HORIZON_DEFS,
    background: MUTED_HORIZON_BG,
    mark: (s) =>
      `<g transform="${artTransform(s)}">` +
      // Original dusk-ink owl; the restraint lives in the ground.
      v6Head(DUSK.sceneNear) +
      v6Eyes(46, DUSK.primary) +
      V6_BEAK +
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
console.log(`wired set ← ${WIRED_VARIANT} (canonical, user-curated 2026-06-12)`);
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
