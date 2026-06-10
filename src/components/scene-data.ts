/**
 * scene-data.ts — DAWN illustration grammar as DATA.
 *
 * The five example-goal tiles + the header differ ONLY in their silhouette
 * <path> strings and one optional thin accent mark (DESIGN.md §4.4). There is
 * exactly ONE <Scene> component; these definitions drive it. Do not author a
 * component per scene.
 *
 * Geometry rules (DESIGN.md §4.2), enforced by hand here:
 *  - low-poly continuous paths, ~8–12 anchors, a single confident gesture
 *  - straight ridgelines + gentle cubic béziers; ONE hero feature per scene
 *  - calm asymmetry — never a centered symmetric peak
 *  - fill-only (no stroke); the gradient lives in the SKY, never inside a path
 *
 * Coordinate systems:
 *  - header  viewBox 0 0 400 240
 *  - tile    viewBox 0 0 320 200
 * Paths are authored in tile space (320×200); the header reuses the same
 * grammar at its own scale via a dedicated `header` variant below.
 */

export type SceneState = "pre-dawn" | "dawn" | "day" | "dusk" | "sunrise";
export type SceneVariant =
  | "mountain"
  | "language"
  | "race"
  | "book"
  | "instrument"
  | "header";

/** A single flat-filled silhouette layer. `depth` selects the fill token. */
export interface SilhouetteLayer {
  d: string;
  depth: "far" | "mid" | "near";
}

/** A thin accent mark (the one optional decorative line per scene). */
export interface SceneAccent {
  /** "line" → <line>/<path> stroke (1px); "rect" → filled <rect> (window glow). */
  kind: "route" | "finish" | "window" | "strings";
}

export interface SceneDef {
  /** back→front silhouette layers (2–3) */
  layers: SilhouetteLayer[];
  accent?: SceneAccent;
  /** default sun presence for this variant (overridable by the `sun` prop) */
  sunDefault: boolean;
  /** sun centre in the scene's own viewBox units */
  sun?: { cx: number; cy: number; r: number };
}

/* -------------------------------------------------------------------------- */
/* Tile scenes (320×200). Ground baseline ~ y=150; near layer fills to y=200.  */
/* -------------------------------------------------------------------------- */

/**
 * Climb a mountain — one asymmetric ridge, clear peak right-of-center.
 * Hero feature: the right-of-centre summit. Accent: faint diagonal route line.
 */
const mountain: SceneDef = {
  sunDefault: true,
  sun: { cx: 214, cy: 120, r: 30 },
  layers: [
    // far range — soft low shoulders, left-weighted
    {
      depth: "far",
      d: "M0 150 L0 118 C 40 110 70 96 104 104 C 150 116 168 92 214 100 C 264 108 300 122 320 116 L320 150 Z",
    },
    // mid range — a secondary ridge stepping up to the right
    {
      depth: "mid",
      d: "M0 174 L0 142 C 52 150 96 130 140 138 C 176 144 196 122 232 118 L 268 150 L 320 138 L320 174 Z",
    },
    // near hero — the asymmetric summit, peak at x≈214 (right of centre 160)
    {
      depth: "near",
      d: "M0 200 L0 178 L 92 168 L 150 176 L 214 96 L 248 150 L 320 170 L320 200 Z",
    },
  ],
  accent: { kind: "route" }, // diagonal route up the near face, toward the peak
};

/**
 * Learn a language — low rolling hills + a distant settlement (angular roofs).
 */
const language: SceneDef = {
  sunDefault: true,
  sun: { cx: 96, cy: 132, r: 22 },
  layers: [
    {
      depth: "far",
      d: "M0 150 L0 128 C 60 120 120 132 180 124 C 240 116 290 128 320 122 L320 150 Z",
    },
    // mid — rolling band that carries the settlement roofs (drawn separately)
    {
      depth: "mid",
      d: "M0 172 L0 150 C 64 142 128 154 196 146 C 252 140 296 150 320 146 L320 172 Z",
    },
    // near — broad gentle swell, settlement sits on the mid band
    {
      depth: "near",
      d: "M0 200 L0 180 C 72 170 150 184 220 176 C 270 170 300 178 320 174 L320 200 Z",
    },
  ],
  // roofs are emitted by the Scene from this flag; kept here as DATA intent
};

/**
 * Run a race — flat horizon + a long gentle path curving to a vanishing point.
 */
const race: SceneDef = {
  sunDefault: true,
  sun: { cx: 232, cy: 116, r: 26 },
  layers: [
    {
      depth: "far",
      d: "M0 150 L0 138 C 80 134 160 140 240 136 L 320 140 L320 150 Z",
    },
    {
      depth: "mid",
      d: "M0 168 L0 156 C 90 152 180 160 320 156 L320 168 Z",
    },
    // near — flat plain; the path (accent) runs across it to a vanishing point
    {
      depth: "near",
      d: "M0 200 L0 176 C 120 172 220 180 320 176 L320 200 Z",
    },
  ],
  accent: { kind: "finish" }, // thin finish-line tick far down the path
};

/**
 * Write a book — horizon broken by ONE upright rectangle (lit 5am window).
 * No sun — pre-dawn interior. The window glow is the only interior light.
 */
const book: SceneDef = {
  sunDefault: false,
  layers: [
    {
      depth: "far",
      d: "M0 150 L0 134 C 90 130 180 136 320 132 L320 150 Z",
    },
    {
      depth: "mid",
      d: "M0 172 L0 156 C 100 152 200 160 320 154 L320 172 Z",
    },
    // near — flat ground broken by the upright structure on the right third
    {
      depth: "near",
      d: "M0 200 L0 178 L 196 178 L 196 120 L 244 120 L 244 178 L 320 178 L320 200 Z",
    },
  ],
  accent: { kind: "window" }, // warm window-glow rect inside the upright
};

/**
 * Learn an instrument — soft dune-like swells, very smooth béziers.
 */
const instrument: SceneDef = {
  sunDefault: true,
  sun: { cx: 88, cy: 138, r: 20 },
  layers: [
    {
      depth: "far",
      d: "M0 150 L0 132 C 80 118 160 146 240 130 C 286 121 308 134 320 130 L320 150 Z",
    },
    {
      depth: "mid",
      d: "M0 174 L0 152 C 96 138 176 166 264 150 C 296 144 312 152 320 150 L320 174 Z",
    },
    {
      depth: "near",
      d: "M0 200 L0 176 C 104 160 184 188 280 172 C 304 168 314 174 320 172 L320 200 Z",
    },
  ],
  accent: { kind: "strings" }, // faint vertical staff/string lines fading up
};

/* -------------------------------------------------------------------------- */
/* Header scene (400×240). Same grammar, its own hero gesture (a calm range).   */
/* -------------------------------------------------------------------------- */

const header: SceneDef = {
  sunDefault: true,
  sun: { cx: 312, cy: 196, r: 40 }, // low, right of centre, partly behind near
  layers: [
    // far — distant soft shoulders
    {
      depth: "far",
      d: "M0 240 L0 150 C 60 140 120 158 188 148 C 252 139 320 160 400 150 L400 240 Z",
    },
    // mid — a stepped ridge rising right
    {
      depth: "mid",
      d: "M0 240 L0 182 C 70 188 132 166 196 172 C 248 177 286 152 332 150 L 372 182 L 400 172 L400 240 Z",
    },
    // near — the hero ridge, asymmetric summit left-of-the-sun
    {
      depth: "near",
      d: "M0 240 L0 204 L 96 196 L 168 206 L 244 150 L 288 196 L 400 186 L400 240 Z",
    },
  ],
};

export const SCENES: Record<SceneVariant, SceneDef> = {
  mountain,
  language,
  race,
  book,
  instrument,
  header,
};

/** Settlement roofs for the language tile (mid-layer angular rects). */
export const LANGUAGE_ROOFS: ReadonlyArray<{
  x: number;
  y: number;
  w: number;
  h: number;
}> = [
  { x: 196, y: 132, w: 14, h: 14 },
  { x: 214, y: 128, w: 18, h: 18 },
  { x: 236, y: 134, w: 12, h: 12 },
  { x: 252, y: 130, w: 16, h: 16 },
];
