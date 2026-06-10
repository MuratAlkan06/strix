import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { MotionProvider } from "@/components/motion-provider";
import "./globals.css";

// DAWN brand faces, loaded app-wide (DESIGN.md §3). Fraunces = display/headings,
// Hanken Grotesk = body/UI. Exposed as CSS variables that the @theme-inline font
// tokens in globals.css dereference, so `font-sans` / `font-heading` utilities
// emit var(--font-hanken) / var(--font-fraunces) everywhere. Geist is demoted:
// Geist Mono stays for --font-mono (debug only); Geist Sans is no longer loaded.
const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-fraunces",
  // Variable weight + optical sizing on (DESIGN.md §3): opsz tracks font-size.
  // `axes` requires weight "variable".
  weight: "variable",
  axes: ["opsz"],
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-hanken",
  weight: ["400", "500", "600"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Strix",
  description: "A goal-tracking app for ambitious, sustained efforts.",
};

// The whole app is behind Clerk-aware rendering; no point prerendering pages
// statically against placeholder keys. Phase 5 may carve out specific marketing
// surfaces that opt back into static generation.
export const dynamic = "force-dynamic";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // ClerkProvider must be INSIDE <body> for Next.js 16 cache components
  // support (Clerk Core 3 upgrade guide). Wrapping <html> breaks RSC
  // streaming with the cache-components flow.
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${hanken.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* MotionProvider sets up LazyMotion(domAnimation, strict) + MotionConfig
            reducedMotion="user" once at the root (DESIGN.md §7); it is a client
            component so the root layout stays a server component. */}
        <ClerkProvider>
          <MotionProvider>{children}</MotionProvider>
        </ClerkProvider>
      </body>
    </html>
  );
}
