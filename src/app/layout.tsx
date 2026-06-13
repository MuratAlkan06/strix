import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { SerwistProvider } from "@serwist/next/react";
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
  // PWA surface (phase 2.5 S1): manifest + iOS install tags. The icon files
  // are the canonical wired names emitted by scripts/generate-icons.mjs —
  // swapping the curated icon variant regenerates the files and never touches
  // this metadata (see the script header).
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Strix",
    statusBarStyle: "black-translucent",
  },
  icons: {
    apple: [
      {
        url: "/icons/apple-touch-icon-152.png",
        sizes: "152x152",
        type: "image/png",
      },
      {
        url: "/icons/apple-touch-icon-167.png",
        sizes: "167x167",
        type: "image/png",
      },
      {
        url: "/icons/apple-touch-icon-180.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export const viewport: Viewport = {
  // V1 Dusk --background oklch(0.18 0.035 264) as sRGB hex (browser chrome /
  // status bar tint must match the dark ground; manifest colors mirror this).
  themeColor: "#0a1121",
  // Edge-to-edge on notched iPhones; safe-area insets are handled per-surface.
  viewportFit: "cover",
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
        {/* SerwistProvider registers the service worker (public/sw.js, built by
            `serwist build` — see serwist.config.mjs) in dev AND prod, per the
            phase-2.5 planning doc. Client component; keeps this layout a
            server component, same as the providers below. */}
        <SerwistProvider swUrl="/sw.js">
          {/* MotionProvider sets up LazyMotion(domAnimation, strict) + MotionConfig
              reducedMotion="user" once at the root (DESIGN.md §7); it is a client
              component so the root layout stays a server component. */}
          <ClerkProvider>
            <MotionProvider>{children}</MotionProvider>
          </ClerkProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
