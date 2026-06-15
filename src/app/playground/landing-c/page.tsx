/**
 * /playground/landing-c — TEMP landing-variant C for live curation.
 *
 * THROWAWAY scaffolding (sibling of the other /playground/* curation routes):
 * public via /playground(.*) (src/proxy.ts), noindexed by the segment layout,
 * torn down once the user picks. Does NOT touch src/app/page.tsx.
 *
 * Direction — "First light". The boldest of the three: an amber sun-glow hero
 * (the brand's first-light/dawn semantic, DESIGN.md §2) sits behind a centered
 * headline, and the value is shown CONCRETELY as a product-chrome "plan card"
 * — the crisp task UI the brand promises (DESIGN.md §6 clean-chrome), rendered
 * with real goal-attribution chips. Amber-forward where A/B stay cool.
 *
 * Brand discipline: the glow uses the SAME sun-glow recipe as Scene (a radial of
 * the scene-sun token) and the goal chips use the minted --goal-color-* ramp +
 * the Card primitive — no re-minted colour/spacing/type, no new art. The glow is
 * a low-alpha wash behind a solid foreground, so all type clears AA contrast
 * against the dusk ground, never the gradient (DESIGN.md §4.5/§11). Copy is plain
 * (SPEC §4), derived from SPEC §2–§3.
 */
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Emblem } from "@/components/emblem";
import { cn } from "@/lib/utils";

// A concrete glimpse of the unified view — three plan rows across two goals,
// each with its goal-attribution dot (the --goal-color-* ramp, always
// text-paired). Static preview chrome, not interactive.
const PLAN_ROWS = [
  { goal: "Climb Mont Blanc", color: 0, task: "Stair intervals · 30 min" },
  { goal: "Learn Spanish", color: 1, task: "Vocabulary review · 15 min" },
  { goal: "Climb Mont Blanc", color: 0, task: "Order crampons by Friday" },
];

export default function LandingCPage() {
  return (
    <main className="relative isolate flex min-h-dvh w-full flex-1 flex-col overflow-hidden">
      {/* Amber first-light glow — same radial recipe as Scene's sun-glow, low
          alpha, anchored bottom-right behind everything. Decorative wash; all
          type below sits on the solid dusk ground, not on the glow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(60rem 60rem at 78% 92%, color-mix(in oklch, var(--primary) 26%, transparent) 0%, color-mix(in oklch, var(--primary) 9%, transparent) 38%, transparent 66%)",
        }}
      />

      {/* Wordmark, top-left. */}
      <div className="flex items-center gap-2 p-6">
        <Emblem treatment="2-tone" className="size-6 text-foreground" title="Strix" />
        <span className="font-heading text-sm font-medium tracking-tight text-foreground/90">
          Strix
        </span>
      </div>

      {/* Centered bold hero + concrete plan card. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-10 px-6 pb-16">
        <div className="flex max-w-2xl flex-col items-center gap-5 text-center">
          <span className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">
            The dawn the brand is named for
          </span>
          <h1 className="font-heading text-[36px] font-semibold leading-[1.05] tracking-tight text-foreground sm:text-[58px]">
            Every big goal,
            <br />
            one clear morning at a time.
          </h1>
          <p className="max-w-lg text-base leading-relaxed text-muted-foreground sm:text-lg">
            Strix interviews you about the goal, builds the plan, and rolls every
            goal into a single view of what to do today.
          </p>

          <div className="mt-1 flex w-full flex-col items-center gap-3 sm:w-auto sm:flex-row">
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
          </div>
        </div>

        {/* Concrete proof — the crisp clean-chrome plan UI the brand promises. */}
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
      </div>
    </main>
  );
}
