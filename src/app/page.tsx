import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Emblem } from "@/components/emblem";
import { Scene } from "@/components/scene";
import { cn } from "@/lib/utils";

// The public landing (CS-8). Signed-in users are sent to their dashboard — this
// is how authenticated users "reach the dashboard via redirect from the root
// page" (phase-1-golden-path routing note), since `/` is the public landing and
// the dashboard lives at `/dashboard`. Signed-out users see the branded landing
// below.
//
// Composition (curation pick: B+C blend, graduated from the now-removed
// /playground/landing-* variants):
//   · Hero  — variant B's full-bleed dawn Scene header (the same HorizonHeader
//     grammar the dashboard uses): emblem top-left, SPEC-derived headline +
//     value line riding a bottom-anchored token scrim so type clears contrast
//     over every sky stop (DESIGN.md §4.5 — never raw text on a gradient).
//   · Proof — variant C's "Today" card: multiple goals' tasks in one unified
//     daily view with goal-attribution dots (the --goal-color-* ramp, always
//     text-paired, §11). The clean-chrome task UI the brand promises (§6), the
//     concrete anchor for the hero's claim.
//   · CTAs  — primary Get started → /sign-up, secondary Sign in → /sign-in.
//
// Brand discipline: reuses Scene + Emblem + Button + Card + the Fraunces/Hanken
// faces + the app-wide DAWN tokens — no re-minted colour/spacing/type, no new
// scene art. Copy is plain/declarative (SPEC §4), derived from SPEC §2–§3. As a
// real product surface it follows the §11 product-graduation requirements
// (cursor-pointer comes from the button primitive; CTA targets ≥44px).

// A concrete glimpse of the unified view — three plan rows across two goals,
// each with its goal-attribution dot (the --goal-color-* ramp, always
// text-paired). Static preview chrome, not interactive.
const PLAN_ROWS = [
  { goal: "Climb Mont Blanc", color: 0, task: "Stair intervals · 30 min" },
  { goal: "Learn Spanish", color: 1, task: "Vocabulary review · 15 min" },
  { goal: "Climb Mont Blanc", color: 0, task: "Order crampons by Friday" },
];

export default async function Home() {
  const { userId } = await auth();
  if (userId) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-4xl flex-1 flex-col gap-10 p-4 sm:p-6">
      {/* Hero (variant B) — full-bleed dawn scene, emblem top-left, headline +
          value line on a bottom-anchored token scrim (mirrors HorizonHeader). */}
      <section
        className="relative isolate w-full overflow-hidden rounded-xl"
        style={{ height: "clamp(280px, 48vh, 440px)" }}
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
            Turn a big goal into the work of today.
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-muted-foreground sm:text-base">
            Describe what you want to reach. Strix interviews you about where
            you&rsquo;re starting from, then builds the daily habits, weekly
            sessions, milestones, and gear that get you there.
          </p>
        </div>
      </section>

      {/* Proof (variant C) — a short lede bridges the hero to the concrete
          "Today" card: every goal's work rolled into one daily view. */}
      <section className="flex flex-col items-center gap-6 px-1 sm:px-2">
        <p className="max-w-xl text-center font-heading text-lg leading-relaxed text-foreground sm:text-xl">
          Every goal&rsquo;s daily, weekly, and milestone work rolls into a
          single view of what to do today.
        </p>

        {/* The crisp clean-chrome plan UI the brand promises (§6). */}
        <Card className="w-full max-w-md gap-0 p-0">
          <div className="border-b border-border px-5 py-3">
            <span className="font-heading text-sm font-medium text-foreground">
              Today
            </span>
          </div>
          <ul className="flex flex-col">
            {PLAN_ROWS.map((row, i) => (
              <li
                key={i}
                className={cn(
                  "flex items-center gap-3 px-5 py-3.5",
                  i < PLAN_ROWS.length - 1 && "border-b border-border",
                )}
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-foreground/10"
                  style={{ backgroundColor: `var(--goal-color-${row.color})` }}
                />
                <span className="flex flex-1 flex-col">
                  <span className="text-sm text-foreground">{row.task}</span>
                  <span className="text-xs text-muted-foreground">{row.goal}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </section>

      {/* CTAs — primary Get started, secondary Sign in. Product-graduation:
          targets ≥44px (h-12 = 48px); cursor-pointer comes from the primitive. */}
      <section className="flex flex-col gap-3 border-t border-border px-1 pt-7 sm:flex-row sm:items-center sm:px-2">
        <Link
          href="/sign-up"
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-12 min-h-12 w-full px-7 text-base sm:w-auto",
          )}
        >
          Get started
        </Link>
        <Link
          href="/sign-in"
          className={cn(
            buttonVariants({ variant: "outline", size: "lg" }),
            "h-12 min-h-12 w-full px-7 text-base sm:w-auto",
          )}
        >
          Sign in
        </Link>
      </section>
    </main>
  );
}
