import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { SerwistProvider } from "@serwist/next/react";
import { MotionProvider } from "@/components/motion-provider";
import { SessionWatch } from "@/components/session-watch";
import { SPLASH_STARTUP_IMAGES } from "@/lib/ios-splash";
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
    // iOS launch screens (phase 2.5 S9). Real images built by
    // scripts/generate-splash.mjs from the V6a brand mark on the dusk ground —
    // a pragmatic iPhone 8/X/12/14/15-family set (not exhaustive). Each entry's
    // media query is portrait-only (the manifest pins orientation:"portrait")
    // and matches on device-width/height × -webkit-device-pixel-ratio so iOS
    // picks the file authored for that exact logical resolution; a mismatch
    // means iOS shows a blank/letterboxed launch. Filenames carry the PHYSICAL
    // pixel dimensions the splash script emits. See the script header for the
    // device→resolution table this list mirrors.
    startupImage: SPLASH_STARTUP_IMAGES,
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
      {/* Safe-area insets (phase 2.5 S9): pt/pb/pl/pr-safe reserve the notch /
          dynamic-island / home-indicator / landscape-cutout space app-wide, so
          no route slides content under a cutout in iOS standalone. env() is 0
          off-device (desktop, the verify:ui headless browser, Android without a
          cutout) → these add nothing there and shift no baselines; they only
          expand under a real inset. Full-bleed surfaces that must paint to the
          very edge (the HorizonHeader scene) handle their own inset internally
          rather than inheriting this padding. */}
      <body className="min-h-full flex flex-col pt-safe pr-safe pb-safe pl-safe">
        {/* SerwistProvider registers the service worker (public/sw.js, built by
            `serwist build` — see serwist.config.mjs) in dev AND prod, per the
            phase-2.5 planning doc. Client component; keeps this layout a
            server component, same as the providers below.
            reloadOnOnline={false} (S6, security review L5): the provider's
            default calls location.reload() the moment connectivity returns,
            which would discard in-memory state — mid-conversation AI-intake
            chat on /goals/new, unsaved check-in text. Freshness comes from
            the dashboard's StaleWhileRevalidate cache + the useOnline-driven
            offline UI instead; nothing needs a forced reload. */}
        <SerwistProvider swUrl="/sw.js" reloadOnOnline={false}>
          {/* MotionProvider sets up LazyMotion(domAnimation, strict) + MotionConfig
              reducedMotion="user" once at the root (DESIGN.md §7); it is a client
              component so the root layout stays a server component. */}
          <ClerkProvider>
            {/* SessionWatch (S7, mounted app-wide per ADR-0002 CS-4): renders
                nothing; needs useAuth() so it lives inside ClerkProvider. Fires
                the shared-device cache purge on a session-end auth flip from any
                surface, not just /settings. */}
            <SessionWatch />
            <MotionProvider>{children}</MotionProvider>
          </ClerkProvider>
        </SerwistProvider>
      </body>
    </html>
  );
}
