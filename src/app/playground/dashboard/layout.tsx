/**
 * Playground segment layout — DAWN curation route only.
 *
 * Loads the brand faces (Fraunces display + Hanken Grotesk body) via
 * next/font/google INSIDE this segment — NOT app-wide. The root layout and
 * src/app/globals.css are untouched; brand-face rewiring of @theme happens at
 * mint time.
 *
 * We expose the faces as CSS variables (--font-fraunces / --font-hanken) and
 * tag the wrapper `.pg-root`. We do NOT re-point --font-sans / --font-heading:
 * globals.css declares those in an `@theme inline` block, which bakes the
 * utilities to `font-family: var(--font-geist-sans)` (the value, not a
 * reference to --font-sans), so a wrapper-level --font-sans override is dead.
 * Instead playground.css applies the faces DIRECTLY under .pg-root — see the
 * font block there. The permanent fix lands at token mint (Rev 6.3).
 *
 * playground.css carries the .v1/.v2/.v3 token overrides + --scene-* recipes.
 */
import type { ReactNode } from "react";
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

export default function PlaygroundLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className={`pg-root ${fraunces.variable} ${hanken.variable}`}>
      {children}
    </div>
  );
}
