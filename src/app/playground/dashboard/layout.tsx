/**
 * Playground segment layout — DAWN curation route only.
 *
 * Loads the brand faces (Fraunces display + Hanken Grotesk body) via
 * next/font/google INSIDE this segment — NOT app-wide. The root layout and
 * src/app/globals.css are untouched; brand-face rewiring of @theme happens at
 * mint time. Here we apply the fonts by:
 *   1. exposing them as CSS variables (--font-fraunces / --font-hanken), and
 *   2. re-pointing the Tailwind font tokens (--font-sans / --font-heading) at
 *      them on the wrapper, so `font-sans` / `font-heading` utilities — incl.
 *      the ones inside shadcn components — resolve to the DAWN faces within
 *      this subtree only.
 *
 * playground.css carries the .v1/.v2/.v3 token overrides + --scene-* recipes.
 */
import type { ReactNode } from "react";
import type { CSSProperties } from "react";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./playground.css";

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  // variable weight + opsz axis on (DESIGN.md §3): optical sizing tracks
  // font-size. `axes` requires weight to be "variable" (or omitted).
  weight: "variable",
  axes: ["opsz"],
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken",
  weight: ["400", "500", "600"],
});

// Re-point the Tailwind font tokens at the DAWN faces for this subtree only.
const fontVars = {
  "--font-sans": "var(--font-hanken)",
  "--font-heading": "var(--font-fraunces)",
} as CSSProperties;

export default function PlaygroundLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div
      className={`${fraunces.variable} ${hanken.variable} font-sans`}
      style={fontVars}
    >
      {children}
    </div>
  );
}
