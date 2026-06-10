/**
 * HorizonHeader — the full-bleed dashboard header (DESIGN.md §4.5, §10).
 *
 * The brand frame: a full-bleed DAWN scene with the owl emblem top-left, the
 * greeting and date riding on a scrim. The scene renders immediately (no data
 * needed) so the brand frame is present while rows load.
 *
 * A11y: text sits on a ≥40% token-coloured scrim (a bottom-anchored gradient
 * here) so it clears contrast against every sky stop it overlaps — never raw
 * text on the gradient. Height is reserved via clamp → no CLS.
 */
import { Emblem } from "@/components/emblem";
import { Scene } from "@/components/scene";
import type { SceneState } from "@/components/scene-data";

interface HorizonHeaderProps {
  greeting: string;
  date: string;
  /** Header scene state; the dashboard default is "dawn". */
  state?: SceneState;
}

export function HorizonHeader({
  greeting,
  date,
  state = "dawn",
}: HorizonHeaderProps) {
  return (
    <header
      className="relative isolate w-full overflow-hidden rounded-xl"
      style={{ height: "clamp(120px, 22vh, 200px)" }}
    >
      {/* full-bleed scene */}
      <div className="absolute inset-0 -z-10">
        <Scene state={state} variant="header" />
      </div>

      {/* scrim — bottom-anchored, token-coloured, so the type clears contrast
          against every sky stop it overlaps (never raw text on a gradient) */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklch, var(--card) 78%, transparent) 0%, color-mix(in oklch, var(--card) 30%, transparent) 38%, transparent 64%)",
        }}
      />

      {/* emblem, top-left, small, with clear-space */}
      <div className="absolute left-4 top-4 flex items-center gap-2">
        <Emblem
          treatment="2-tone"
          className="size-7 text-foreground"
          title="Strix"
        />
        <span className="font-heading text-sm font-medium tracking-tight text-foreground/90">
          Strix
        </span>
      </div>

      {/* greeting + date on the scrim, bottom-left */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col gap-0.5 p-4 sm:p-5">
        <h1 className="font-heading text-[22px] font-medium leading-tight tracking-tight text-foreground sm:text-[28px]">
          {greeting}
        </h1>
        <p className="text-sm text-muted-foreground">{date}</p>
      </div>
    </header>
  );
}
