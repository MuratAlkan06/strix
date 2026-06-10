/**
 * Playground segment layout — DAWN curation route only.
 *
 * The brand faces (Fraunces display + Hanken Grotesk body) are now loaded
 * APP-WIDE in the root layout and exposed as --font-fraunces / --font-hanken on
 * <html>; globals.css points the @theme-inline font tokens at those vars. So
 * this segment loads nothing font-related and carries no font override — the
 * `.font-sans` / `.font-heading` utilities render Hanken / Fraunces here through
 * the same global wiring as the rest of the app. The `.pg-root` wrapper is kept
 * as a stable hook should playground-only scoping be needed again.
 *
 * playground.css carries the .v1/.v2/.v3 token overrides + --scene-* recipes.
 */
import type { ReactNode } from "react";
import "./playground.css";

export default function PlaygroundLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <div className="pg-root">{children}</div>;
}
