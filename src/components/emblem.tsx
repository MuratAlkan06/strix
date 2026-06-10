/**
 * Emblem — the Strix owl mark (DESIGN.md §10).
 *
 * Strix is Latin for owl. The mark is a MINIMAL GEOMETRIC owl emblem: an
 * abstract perched silhouette built in the same flat-fill geometric language as
 * the terrain scenes — no face, no eyes, no beak, no limbs, no cartoon styling.
 *
 * Seed-grammar requirement (load-bearing): this geometry is the SEED of a future
 * owl-FORM construction system (one language from mark → figure). It is built
 * from the same anchors/proportions/fill discipline as a scene silhouette so a
 * later coach-figure can be derived from these rules, not bolted on as a
 * separate art style. Construction notes:
 *   - two ear-tufts (asymmetric weight, never a symmetric cartoon "horned" pair)
 *   - a rounded hunched body that reads as a perched owl in negative space
 *   - the breast notch is the ONE 2-tone facet (token + accent), extensible to
 *     a chest/wing facet on a full figure
 *
 * Treatments: `mono` (single token) and `2-tone` (token body + accent facet).
 */
import { cn } from "@/lib/utils";

interface EmblemProps {
  treatment?: "mono" | "2-tone";
  className?: string;
  title?: string;
}

// Owl body silhouette — one continuous flat path in a 32×32 box.
// Asymmetric ear-tufts (left tuft taller), rounded shoulders, tapered tail.
const BODY_D =
  "M16 3 " +
  "C 13.6 5 12.4 6.8 12.2 8.6 " + // left ear-tuft down to brow
  "C 9 9 6.6 11.4 6.2 15 " + // left shoulder
  "C 5.6 19.6 7 24 10 26.6 " + // left flank
  "C 12 28.4 14 29.2 16 29.4 " + // base left → centre
  "C 18 29.2 20 28.4 22 26.6 " + // base right
  "C 25 24 26.4 19.6 25.8 15 " + // right flank
  "C 25.4 11.4 23 9 19.8 8.6 " + // right shoulder
  "C 19.6 6.6 18.2 4.8 16 3 " + // right ear-tuft (shorter) → close
  "Z";

// The single 2-tone facet — a breast notch (chevron) in the accent token.
const FACET_D = "M16 14 C 14.4 16.4 13.6 19 13.8 21.6 L 16 19.6 L 18.2 21.6 C 18.4 19 17.6 16.4 16 14 Z";

export function Emblem({
  treatment = "2-tone",
  className,
  title = "Strix",
}: EmblemProps) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("block", className)}
      role="img"
      aria-label={title}
    >
      <path d={BODY_D} style={{ fill: "var(--emblem-body, currentColor)" }} />
      {treatment === "2-tone" && (
        <path
          d={FACET_D}
          style={{ fill: "var(--emblem-accent, var(--primary))" }}
        />
      )}
    </svg>
  );
}
