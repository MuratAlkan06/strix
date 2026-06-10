/**
 * /playground/dashboard — the DAWN variant curation playground.
 *
 * Renders all THREE variants stacked vertically (V1 Dusk / V2 Pale Dawn /
 * V3 Slate-Coral), each a full dashboard composition inside its own token
 * wrapper, so the user can pick the final polarity + accent from real rendered
 * UI rather than prose. Held constant across all three: the DAWN atmosphere
 * system, the owl emblem, the layout skeleton, and the seed content. Varied:
 * chrome polarity + accent temperature.
 *
 * Token wrappers (.v1/.v2/.v3 + --scene-* recipes) live in playground.css; the
 * brand fonts are applied by the segment layout. V1/V3 also carry `.dark` so the
 * shadcn components' dark styles engage; V2 stays light. globals.css and the
 * root layout are untouched — tokens are minted ONCE post-curation, elsewhere.
 */
import { DashboardVariant } from "./dashboard-variant";

const VARIANTS = [
  { id: "v1", dark: true, label: "V1 — Dusk", sub: "dark · amber" },
  { id: "v2", dark: false, label: "V2 — Pale Dawn", sub: "light · amber" },
  { id: "v3", dark: true, label: "V3 — Slate-Coral", sub: "dark · coral" },
] as const;

export default function PlaygroundDashboardPage() {
  return (
    <main className="flex flex-col">
      {VARIANTS.map((v) => (
        <section
          key={v.id}
          className={`${v.id}${v.dark ? " dark" : ""} bg-background text-foreground`}
          aria-label={v.label}
        >
          {/* variant label band — uses the variant's own card tokens */}
          <div className="border-b border-border bg-card/60 px-4 py-2 sm:px-5">
            <div className="mx-auto flex max-w-7xl items-baseline gap-2">
              <span className="font-heading text-sm font-medium text-foreground">
                {v.label}
              </span>
              <span className="text-xs text-muted-foreground">{v.sub}</span>
            </div>
          </div>
          <DashboardVariant />
        </section>
      ))}
    </main>
  );
}
