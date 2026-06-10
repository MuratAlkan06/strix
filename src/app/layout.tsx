import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
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
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider>{children}</ClerkProvider>
      </body>
    </html>
  );
}
