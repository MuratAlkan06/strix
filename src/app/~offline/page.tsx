/**
 * /~offline — the offline fallback screen (phase 2.5 S6, planning doc
 * "Offline dashboard shell": "All other routes … show a polite offline
 * screen — no crash, no half-broken UI").
 *
 * How it is served: the service worker precaches this route at install time
 * (serwist.config.mjs `additionalPrecacheEntries`, revision = build ID) and
 * the fallback plugin answers any failed same-origin DOCUMENT request with
 * it — so offline navigation to /goals, /settings, or an empty-cache
 * /dashboard lands here instead of the browser's network-error page. The
 * route is Clerk-public (src/proxy.ts): the precache fetch must never hit an
 * auth redirect.
 *
 * Constraints that shape this file:
 *   - SERVER component, zero client interactivity: when served offline, its
 *     JS chunks may not be in any cache, so the SSR HTML must stand alone.
 *     The shared root CSS is in the strix-shell cache from any prior visit.
 *   - The dashboard link is a plain <a>, not next/link: without hydration a
 *     Link cannot client-navigate anyway, and a full document navigation is
 *     exactly what the SW can answer — cached dashboard if one exists, this
 *     screen again if not. No dead end either way.
 *   - V1 Dusk register (DESIGN.md §1/§8): calm, declarative, no alarm. The
 *     emblem + wordmark block mirrors EmptyDashboard's brand treatment.
 */
import type { Metadata } from "next";

import { buttonVariants } from "@/components/ui/button";
import { Emblem } from "@/components/emblem";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Offline — Strix",
};

export default function OfflinePage() {
  return (
    <main className="flex w-full flex-1 flex-col items-center justify-center gap-8 p-6">
      <div className="flex items-center gap-2">
        <Emblem
          treatment="2-tone"
          className="size-7 text-foreground"
          title="Strix"
        />
        <span className="font-heading text-sm font-medium tracking-tight text-foreground/90">
          Strix
        </span>
      </div>

      <div className="flex max-w-sm flex-col items-center gap-2 text-center">
        <h1 className="font-heading text-[28px] font-medium leading-tight tracking-tight text-foreground">
          You&rsquo;re offline
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This page needs a connection. Your dashboard may still be available
          from your last visit, and everything else will be here when
          you&rsquo;re back online.
        </p>
      </div>

      {/* Plain <a>, full document navigation on purpose — see the file
          header: this page may render without hydration, and a document
          request is what the SW can answer. */}
      <a
        href="/dashboard"
        className={cn(
          buttonVariants({ variant: "outline", size: "lg" }),
          "min-h-11 cursor-pointer px-5",
        )}
      >
        Go to dashboard
      </a>
    </main>
  );
}
