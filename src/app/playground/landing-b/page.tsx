/**
 * /playground/landing-b — TEMP landing-variant B for live curation.
 *
 * THROWAWAY scaffolding (sibling of the other /playground/* curation routes):
 * public via /playground(.*) (src/proxy.ts), noindexed by the segment layout,
 * torn down once the user picks. Does NOT touch src/app/page.tsx.
 *
 * Direction — "Editorial dawn". Warmer and more written than A: a full-bleed
 * dawn Scene header carries the brand moment (the same HorizonHeader grammar the
 * product dashboard uses), the value line rides a token scrim, and below it an
 * editorial left-aligned lede sits beside the four plan pillars from SPEC §3
 * (daily habits, weekly sessions, milestones, equipment). Asymmetric, documentary.
 *
 * Brand discipline: reuses Scene + Emblem + Button + the Fraunces/Hanken faces +
 * the DAWN tokens — no re-minted colour/spacing/type, no new scene art. The
 * scrim mirrors HorizonHeader's so type clears contrast over every sky stop
 * (DESIGN.md §4.5: never raw text on a gradient). Copy is plain/declarative
 * (SPEC §4), derived from SPEC §2–§3.
 */
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Emblem } from "@/components/emblem";
import { Scene } from "@/components/scene";
import { cn } from "@/lib/utils";

const PILLARS = [
  {
    title: "Daily habits",
    body: "The small, recurring work that compounds.",
  },
  {
    title: "Weekly sessions",
    body: "The focused efforts, scheduled to real days.",
  },
  {
    title: "Milestones",
    body: "Dated waypoints that prove you're on track.",
  },
  {
    title: "Equipment",
    body: "What to buy, and when — ordered by urgency.",
  },
];

export default function LandingBPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-1 flex-col gap-10 p-4 sm:p-6">
      {/* Brand moment — full-bleed dawn scene, emblem top-left, value line on a
          bottom-anchored scrim (mirrors HorizonHeader). */}
      <section
        className="relative isolate w-full overflow-hidden rounded-xl"
        style={{ height: "clamp(260px, 46vh, 420px)" }}
      >
        <div className="absolute inset-0 -z-10">
          <Scene state="dawn" variant="header" />
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(to top, color-mix(in oklch, var(--card) 84%, transparent) 0%, color-mix(in oklch, var(--card) 36%, transparent) 46%, transparent 72%)",
          }}
        />

        <div className="absolute left-5 top-5 flex items-center gap-2">
          <Emblem treatment="2-tone" className="size-7 text-foreground" title="Strix" />
          <span className="font-heading text-sm font-medium tracking-tight text-foreground/90">
            Strix
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5 sm:p-7">
          <h1 className="max-w-xl font-heading text-[30px] font-medium leading-[1.1] tracking-tight text-foreground sm:text-[42px]">
            Long, patient effort — finally has a plan.
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            18 days to the summit. Order crampons by Friday. Strix turns the goal
            you keep putting off into the work in front of you.
          </p>
        </div>
      </section>

      {/* Editorial body — lede beside the four plan pillars, then the CTAs. */}
      <section className="flex flex-col gap-8 px-1 sm:px-2">
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-5">
          <p className="font-heading text-lg leading-relaxed text-foreground sm:col-span-2 sm:text-xl">
            Describe a big goal in plain language. An AI coach interviews you to
            understand where you&rsquo;re starting from, then builds the whole
            plan.
          </p>
          <ul className="grid grid-cols-1 gap-x-8 gap-y-5 sm:col-span-3 sm:grid-cols-2">
            {PILLARS.map((pillar) => (
              <li key={pillar.title} className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-foreground">
                  {pillar.title}
                </span>
                <span className="text-sm leading-relaxed text-muted-foreground">
                  {pillar.body}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-7 sm:flex-row sm:items-center">
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
              buttonVariants({ variant: "outline", size: "lg" }),
              "h-11 min-h-11 w-full px-6 text-base sm:w-auto",
            )}
          >
            Sign in
          </Link>
        </div>
      </section>
    </main>
  );
}
