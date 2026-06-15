/**
 * /playground/landing-a — TEMP landing-variant A for live curation.
 *
 * THROWAWAY scaffolding (like the sibling /playground/* curation routes): public
 * via the /playground(.*) Clerk matcher (src/proxy.ts), noindexed by the segment
 * layout, torn down once the user picks a direction. Does NOT touch the real
 * marketing surface (src/app/page.tsx).
 *
 * Direction — "Quiet type, maximal space". Minimal, type-led, centered, lots of
 * negative space. No scene illustration — the brand carries on Fraunces + the
 * owl emblem + the dusk ground alone (the /~offline register, dialed up). The
 * calmest of the three.
 *
 * Brand discipline: reuses the DAWN tokens + Emblem + Button primitive + the
 * Fraunces/Hanken faces from globals.css — no re-minted colour/spacing/type.
 * Copy is declarative and plain (SPEC §4 register), derived from the product
 * value in SPEC §2 (describe a big goal → AI plans the daily/weekly/milestone
 * work → one view of what to do today). Inherits the global dusk chrome.
 */
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Emblem } from "@/components/emblem";
import { cn } from "@/lib/utils";

export default function LandingAPage() {
  return (
    <main className="flex min-h-dvh w-full flex-1 flex-col">
      {/* Wordmark, top-left — the one persistent brand mark. */}
      <div className="flex items-center gap-2 p-6">
        <Emblem treatment="2-tone" className="size-6 text-foreground" title="Strix" />
        <span className="font-heading text-sm font-medium tracking-tight text-foreground/90">
          Strix
        </span>
      </div>

      {/* Centered hero — type-led, generous negative space. */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 pb-16 text-center">
        <div className="flex max-w-xl flex-col items-center gap-6">
          <h1 className="font-heading text-[34px] font-medium leading-[1.1] tracking-tight text-foreground sm:text-[52px]">
            Turn a big goal into the work of today.
          </h1>
          <p className="max-w-md text-base leading-relaxed text-muted-foreground sm:text-lg">
            Describe what you want to reach. Strix interviews you, then builds the
            daily habits, weekly sessions, milestones, and gear that get you
            there — all in one view.
          </p>

          <div className="mt-2 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/sign-up"
              className={cn(
                buttonVariants({ size: "lg" }),
                "h-11 min-h-11 w-full px-6 text-base sm:w-auto",
              )}
            >
              Get started
            </Link>
            <Link
              href="/sign-in"
              className={cn(
                buttonVariants({ variant: "ghost", size: "lg" }),
                "h-11 min-h-11 w-full px-6 text-base sm:w-auto",
              )}
            >
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
