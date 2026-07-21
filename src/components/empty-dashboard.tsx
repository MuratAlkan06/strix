/**
 * EmptyDashboard — the empty-state dashboard surface (DESIGN.md §8 "Empty (no
 * goals)", §4.4 example tiles; phase-1-golden-path "Empty-state dashboard").
 *
 * Rendered when the signed-in user has zero active goals. Composition:
 *   - a large pre-dawn Scene as the upper brand moment (state="pre-dawn" =
 *     "nothing started"), with the owl Emblem + a single h1 on a token scrim;
 *   - one primary CTA, "Create your first goal", on a card;
 *   - the five pre-dawn example tiles (the existing Scene variants — DATA in
 *     goal-seeds.ts), each a link to /goals/new?seed=… (Slice 3 builds that
 *     route + the server-side seed whitelist).
 *
 * Brand discipline: REUSES Scene/Card/Button/Emblem and globals.css tokens — no
 * re-minted colour/spacing/type, no Scene rebuild. Copy is declarative and plain
 * (Patagonia register, no exclamation). Interactive targets clear ≥44×44px
 * (DESIGN.md §11): the CTA is min-h-11 and each tile is a full-card link with a
 * min-h-11 label region — the playground's dense 16/28px sizing is NOT copied.
 *
 * Server component: the tiles are links, so there is no client state.
 */
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Emblem } from "@/components/emblem";
import { Scene } from "@/components/scene";
import { cn } from "@/lib/utils";
import { EXAMPLE_TILES } from "@/lib/goal-seeds";

export function EmptyDashboard() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 sm:gap-8 sm:p-6">
      {/* Upper brand moment — full-bleed pre-dawn scene, emblem + the page's one
          h1 + the invitational line on a bottom-anchored token scrim. */}
      <section
        className="relative isolate w-full overflow-hidden rounded-xl"
        style={{ height: "clamp(200px, 38vh, 320px)" }}
      >
        <div className="absolute inset-0 -z-10">
          <Scene state="pre-dawn" variant="header" />
        </div>
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{
            background:
              "linear-gradient(to top, color-mix(in oklch, var(--card) 82%, transparent) 0%, color-mix(in oklch, var(--card) 38%, transparent) 44%, transparent 70%)",
          }}
        />

        <div className="absolute left-4 top-4 flex items-center gap-2">
          {/* Decorative: the adjacent "Strix" wordmark names the brand, so the
              mark is aria-hidden (no SR "Strix, Strix"). */}
          <Emblem
            treatment="2-tone"
            className="size-7 text-foreground"
            decorative
          />
          <span className="font-heading text-sm font-medium tracking-tight text-foreground/90">
            Strix
          </span>
        </div>

        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1.5 p-4 sm:p-6">
          <h1 className="max-w-md font-heading text-[28px] font-medium leading-tight tracking-tight text-foreground sm:text-[36px]">
            Start with something big.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            One goal, a clear plan, and the patience to work it. Pick a starting
            point below, or describe your own.
          </p>
        </div>
      </section>

      {/* Primary CTA. */}
      <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="font-heading text-base font-medium text-foreground">
            Ready to begin
          </span>
          <span className="text-sm text-muted-foreground">
            Tell us what you want to work toward.
          </span>
        </div>
        <Link
          href="/goals/new"
          className={cn(
            buttonVariants({ size: "lg" }),
            "h-11 min-h-11 w-full px-5 sm:w-auto",
          )}
        >
          Create your first goal
        </Link>
      </Card>

      {/* The five pre-dawn example tiles (DESIGN.md §4.4). Tiles ARE the Scene
          variants; the sky stays pre-dawn until a goal exists. Each whole card
          is the link; the label region clears the ≥44×44px floor. */}
      <section className="flex flex-col gap-3">
        <h2 className="font-heading text-base font-medium text-foreground">
          Or start from an example
        </h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EXAMPLE_TILES.map((tile) => (
            <li key={tile.seed}>
              <Link
                href={`/goals/new?seed=${tile.seed}`}
                className="group/tile block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <Card className="gap-0 p-0 transition-colors group-hover/tile:ring-foreground/25">
                  <div className="h-28 w-full overflow-hidden rounded-t-xl">
                    <Scene state="pre-dawn" variant={tile.variant} />
                  </div>
                  <div className="flex min-h-11 items-center px-4 py-3">
                    <span className="text-sm font-medium text-foreground">
                      {tile.label}
                    </span>
                  </div>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
