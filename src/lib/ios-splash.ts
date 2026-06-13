/**
 * ios-splash.ts — the single source of truth for the iOS launch-screen set
 * (phase 2.5 S9, planning doc "iOS standalone polish" → splash screens).
 *
 * iOS only shows a custom launch image when an `apple-touch-startup-image`
 * <link> matches the device EXACTLY on device-width × device-height ×
 * -webkit-device-pixel-ratio (and, since the manifest pins
 * orientation:"portrait", on portrait). A mismatch shows a blank/letterboxed
 * launch instead — so the media query and the image's physical pixel size
 * must agree. This table is the agreement, consumed by BOTH:
 *   - src/app/layout.tsx (appleWebApp.startupImage → the <link> tags), and
 *   - scripts/generate-splash.mjs (renders one PNG per row at width×height).
 * Change the device set in ONE place and both stay in lockstep.
 *
 * PRAGMATIC, NOT EXHAUSTIVE (planning doc): the iPhone 8 / X / 12 / 14 / 15
 * families. Each logical (cssWidth×cssHeight, dpr) tuple covers several
 * marketed models that share a screen — listed in `covers` for traceability.
 * Newer/unknown devices simply fall back to the manifest background_color
 * (#0a1121 dusk) launch — acceptable: a flat dusk launch, never broken chrome.
 */

export interface SplashDevice {
  /** logical CSS width (px) — the device-width media term. */
  readonly cssWidth: number;
  /** logical CSS height (px) — the device-height media term. */
  readonly cssHeight: number;
  /** device pixel ratio — the -webkit-device-pixel-ratio media term. */
  readonly dpr: number;
  /** Marketed models sharing this screen (documentation only). */
  readonly covers: string;
}

/**
 * iPhone families, portrait. physical px = css × dpr; the generator emits a
 * PNG at exactly that physical size and the layout's media query matches the
 * css/dpr tuple. Ordered smallest → largest screen.
 */
export const SPLASH_DEVICES: readonly SplashDevice[] = [
  { cssWidth: 375, cssHeight: 667, dpr: 2, covers: "iPhone 8 · SE (2nd/3rd gen)" },
  { cssWidth: 414, cssHeight: 736, dpr: 3, covers: "iPhone 8 Plus" },
  { cssWidth: 375, cssHeight: 812, dpr: 3, covers: "iPhone X · XS · 11 Pro · 12/13 mini" },
  { cssWidth: 414, cssHeight: 896, dpr: 2, covers: "iPhone XR · 11" },
  { cssWidth: 414, cssHeight: 896, dpr: 3, covers: "iPhone XS Max · 11 Pro Max" },
  { cssWidth: 390, cssHeight: 844, dpr: 3, covers: "iPhone 12 · 12 Pro · 13 · 13 Pro · 14" },
  { cssWidth: 428, cssHeight: 926, dpr: 3, covers: "iPhone 12/13 Pro Max · 14 Plus" },
  { cssWidth: 393, cssHeight: 852, dpr: 3, covers: "iPhone 14 Pro · 15 · 15 Pro" },
  { cssWidth: 430, cssHeight: 932, dpr: 3, covers: "iPhone 14 Pro Max · 15 Plus · 15 Pro Max" },
] as const;

/** Physical pixel width of a device's launch image. */
export function splashWidthPx(d: SplashDevice): number {
  return d.cssWidth * d.dpr;
}

/** Physical pixel height of a device's launch image. */
export function splashHeightPx(d: SplashDevice): number {
  return d.cssHeight * d.dpr;
}

/** Public path of a device's launch image — keyed by PHYSICAL pixel size so
 * two devices that differ only in dpr (same css size, e.g. XR vs Max) never
 * collide. This is the name the generator writes and the layout references. */
export function splashFilename(d: SplashDevice): string {
  return `/splash/apple-splash-${splashWidthPx(d)}x${splashHeightPx(d)}.png`;
}

/** The portrait-only media query iOS matches against to pick this image. */
export function splashMedia(d: SplashDevice): string {
  return (
    `(device-width: ${d.cssWidth}px) and (device-height: ${d.cssHeight}px) ` +
    `and (-webkit-device-pixel-ratio: ${d.dpr}) and (orientation: portrait)`
  );
}

/**
 * The startupImage array for Next's `appleWebApp` metadata: one
 * `{ url, media }` per device, which Next renders as
 * `<link rel="apple-touch-startup-image" href=… media=…>`. A mutable array —
 * Next's `AppleImage[]` metadata type is not `readonly`.
 */
export const SPLASH_STARTUP_IMAGES: Array<{ url: string; media: string }> =
  SPLASH_DEVICES.map((d) => ({
    url: splashFilename(d),
    media: splashMedia(d),
  }));
