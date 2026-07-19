/**
 * Emblem — the Strix owl mark (DESIGN.md §10).
 *
 * Strix is Latin for owl. As of the 2026-07-19 v0.5.0 device demo the project
 * lead aligned the in-app mark to the curated **V6a "Night Watch"** owl — the
 * same mark as the PWA/home-screen icon (superseding the round-1 perched-owl
 * seed emblem, which read as a blob at small size; see DECISIONS.md "Visual
 * register" + DESIGN.md §10). The geometry is the tufted owl-head silhouette
 * with two eyes and a beak kite, authored in a 512 box (copied VERBATIM from
 * the v6a variant in scripts/generate-icons.mjs so the mark and icon stay one
 * geometry).
 *
 * Tonal lockup — why this differs from the icon's fills. The icon is a large,
 * opaque tile with its OWN flat dusk ground, so it can use the v6a treatment
 * (dark elevated-dusk head + solid amber eyes) legibly at ≥60px. The in-app
 * mark is a small (~24–40px) BARE silhouette painted over live dawn/dusk scenes
 * (sky-top L 0.16–0.20) and the offline `--background` — where a dark head
 * vanishes and solid amber eyes wash out. So the in-app mark uses the DARK-
 * SURFACE lockup of the same owl (DESIGN.md §10, DECISIONS.md): a light head
 * silhouette in the body token + dusk eye-sockets with amber irises + an amber
 * beak — the amber stays the single point of heat and clears the ≥3:1 glyph
 * floor (§11). This is exactly the tonal adaptation the icon's round-3 explored
 * as "v6b"; it is the same owl, not a second mark.
 *
 * Treatments: `mono` (single body token; eyes/beak read as dark sockets) and
 * `2-tone` (body token + amber accent on eyes/beak). The default is `2-tone`.
 */
import { cn } from "@/lib/utils";

interface EmblemProps {
  treatment?: "mono" | "2-tone";
  className?: string;
  title?: string;
}

// V6a "Night Watch" geometry — copied VERBATIM from the v6a variant in
// scripts/generate-icons.mjs (512 box). Tufted owl-head silhouette; eye discs
// at r 46; beak kite. Keeping the 512 viewBox means the paths match the icon
// pipeline byte-for-byte (one geometry, mark ↔ icon).
const HEAD_D =
  "M 132 128 Q 256 250 380 128 C 428 182 444 262 408 330 " +
  "C 372 402 312 430 256 430 C 200 430 140 402 104 330 " +
  "C 68 262 84 182 132 128 Z";
const EYES = [
  { cx: 188, cy: 268 },
  { cx: 324, cy: 268 },
];
const EYE_R = 46; // socket radius (v6a)
const IRIS_R = 24; // amber iris radius (v6b lockup: reads on the light head)
const BEAK_POINTS = "256,288 278,330 256,376 234,330";

export function Emblem({
  treatment = "2-tone",
  className,
  title = "Strix",
}: EmblemProps) {
  const body = "var(--emblem-body, currentColor)";
  // Dusk socket so the eyes read on a LIGHT head (solid amber would wash out);
  // falls back to the canonical dark ground token when unset.
  const socket = "var(--emblem-socket, var(--background))";
  const accent = "var(--emblem-accent, var(--primary))";
  const twoTone = treatment === "2-tone";

  return (
    <svg
      viewBox="0 0 512 512"
      className={cn("block", className)}
      role="img"
      aria-label={title}
    >
      {/* Head silhouette — the body token (currentColor on dark scenes). */}
      <path d={HEAD_D} style={{ fill: body }} />

      {/* Eye sockets — dark discs knocked into the head so the amber (2-tone)
          or the socket itself (mono) reads as two watching eyes. */}
      {EYES.map((e) => (
        <circle key={`s${e.cx}`} cx={e.cx} cy={e.cy} r={EYE_R} style={{ fill: socket }} />
      ))}

      {twoTone ? (
        <>
          {/* Amber irises — the glow of an owl watching at dusk. */}
          {EYES.map((e) => (
            <circle
              key={`i${e.cx}`}
              cx={e.cx}
              cy={e.cy}
              r={IRIS_R}
              style={{ fill: accent }}
            />
          ))}
          {/* Beak kite — the single point of heat with the eyes. */}
          <polygon points={BEAK_POINTS} style={{ fill: accent }} />
        </>
      ) : (
        // Mono: beak reads as a dark notch in the single-token head.
        <polygon points={BEAK_POINTS} style={{ fill: socket }} />
      )}
    </svg>
  );
}
