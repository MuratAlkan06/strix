// Playground = design-curation + verify:ui harness surface. Public (Clerk-excluded
// in proxy.ts) but noindex — security review M1, 2026-06-10. Torn down with the
// playground.
import type { Metadata } from "next";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function PlaygroundLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
