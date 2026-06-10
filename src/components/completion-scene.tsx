"use client";

/**
 * CompletionScene — the ONE signature animated moment (DESIGN.md §4.3, §7).
 *
 * Goal completion is a sunrise over the goal's scene: the sky brightens
 * dawn→sunrise, the sun disc RISES ~14% of the viewBox from behind the near
 * ridge, then "Well done." fades in — confetti-free, ~900ms, the single
 * luminous beat against otherwise crisp chrome.
 *
 * LAYERING (back→front):
 *   1. <Scene state="dawn"> — the complete, static DAWN frame (sky · dawn sun ·
 *      terrain · accent). This is the "before": it matches the dawn tiles the
 *      rest of the app renders, so the moment starts from a familiar frame.
 *   2. sunrise SKY — an m.div (scene-sunrise gradient) that fades 0→1 on top of
 *      the dawn sky: the brighten.
 *   3. rising SUN — an m.div (scene-sunrise sun) that fades 0→1 AND rises via
 *      translateY ~14%: the payoff. Sits above the base terrain…
 *   4. terrain COPY — an m.div (same silhouettes) that fades 0→1 ON TOP of the
 *      rising sun, so the sun rises FROM BEHIND the near ridge (occlusion) and
 *      the terrain reads as sunrise-lit during the moment.
 *   5. "Well done." — Fraunces, fades in after the sky settles.
 *
 * WHY NOT ANIMATE <Scene>: <Scene> is a deliberately STATIC primitive ("no
 * per-frame JS") and is what the dashboard screenshots capture — animating it
 * risks shifting those baselines. So the animated layers are added AROUND a
 * static <Scene>, reusing the SAME geometry DATA (SCENES) for the terrain copy —
 * no path duplication, <Scene> untouched.
 *
 * SKY-CROSSFADE MECHANISM (deliberate): CSS custom props (--scene-sky-*) do NOT
 * interpolate across a transition unless @property-registered. Rather than
 * register them, we stack two sky gradient layers and crossfade OPACITY — GPU
 * cheap, no @property. The .scene-dawn / .scene-sunrise wrappers feed each layer
 * its own --scene-* set, so the gradient strings match <Scene>'s exactly. (Sun
 * glow is a CSS radial-gradient, never an SVG <stop>: Chromium paints var() in a
 * <stop> black — the constraint <Scene> documents.)
 *
 * REDUCED MOTION (§4.3) is honoured two ways: the root <MotionConfig
 * reducedMotion="user"> auto-suppresses TRANSFORM animations (the rise) while
 * preserving OPACITY (the crossfades + "Well done." still play), and we also
 * shorten the crossfade to 250ms and zero the rise distance, so the reduced path
 * is provably "no rise · 250ms sky crossfade · the line still appears."
 * Everything is transform/opacity only.
 */
import { useSyncExternalStore, type CSSProperties } from "react";
import * as m from "motion/react-m";
import { cn } from "@/lib/utils";
import { Scene } from "@/components/scene";
import {
  SCENES,
  LANGUAGE_ROOFS,
  type SceneVariant,
} from "@/components/scene-data";

type CompletionVariant = Exclude<SceneVariant, "header">;

interface CompletionSceneProps {
  variant: CompletionVariant;
  /** Drives the sunrise. Flip false→true to play; back to false resets to dawn. */
  complete: boolean;
  /** Reserved-height styling lives on the caller; class merges in. */
  className?: string;
  /** Exposed to AT — this is a meaningful image, not decoration. */
  title?: string;
}

const DEPTH_FILL = {
  far: "var(--scene-far)",
  mid: "var(--scene-mid)",
  near: "var(--scene-near)",
} as const;

/** The completion moment uses the 320×200 tile scenes. */
const VB_W = 320;
const VB_H = 200;
/** Sun rise = ~14% of the viewBox height (DESIGN.md §4.3). */
const RISE_PERCENT = 14;

/** Mirror prefers-reduced-motion so we can pick the 250ms reduced path (§4.3).
 *  useSyncExternalStore subscribes to the media query directly (the purpose-
 *  built primitive for external stores) — no setState-in-effect. SSR snapshot
 *  is `false` (no preference), corrected on hydration. */
const RM_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(RM_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(RM_QUERY).matches,
    () => false,
  );
}

/** Flat-filled terrain silhouettes for a variant (drawn twice: once via the
 *  base <Scene>, once here as the occluding copy over the rising sun). */
function Terrain({ variant }: { variant: CompletionVariant }) {
  const def = SCENES[variant];
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 block h-full w-full"
      aria-hidden="true"
    >
      <rect
        x="0"
        y={116}
        width={VB_W}
        height={20}
        opacity="0.08"
        style={{ fill: "var(--scene-sun)" }}
      />
      {def.layers.map((layer, i) => (
        <path key={i} d={layer.d} style={{ fill: DEPTH_FILL[layer.depth] }} />
      ))}
      {variant === "language" &&
        LANGUAGE_ROOFS.map((roof, i) => (
          <rect
            key={`roof-${i}`}
            x={roof.x}
            y={roof.y}
            width={roof.w}
            height={roof.h}
            style={{ fill: "var(--scene-mid)" }}
          />
        ))}
      {def.accent?.kind === "route" && (
        <path
          d="M 150 176 L 214 96"
          fill="none"
          strokeWidth="1"
          strokeDasharray="3 4"
          style={{ stroke: "var(--scene-accent)", strokeOpacity: 0.4 }}
        />
      )}
      {def.accent?.kind === "finish" && (
        <line
          x1="186"
          y1="170"
          x2="186"
          y2="180"
          strokeWidth="1"
          style={{ stroke: "var(--scene-accent)", strokeOpacity: 0.5 }}
        />
      )}
      {def.accent?.kind === "window" && (
        <rect
          x="208"
          y="132"
          width="28"
          height="34"
          opacity="0.85"
          style={{ fill: "var(--scene-sun)" }}
        />
      )}
      {def.accent?.kind === "strings" && (
        <g
          strokeWidth="1"
          style={{ stroke: "var(--scene-accent)", strokeOpacity: 0.1 }}
        >
          <line x1="120" y1="176" x2="120" y2="120" />
          <line x1="152" y1="178" x2="152" y2="122" />
          <line x1="184" y1="180" x2="184" y2="124" />
          <line x1="216" y1="178" x2="216" y2="122" />
          <line x1="248" y1="176" x2="248" y2="120" />
        </g>
      )}
    </svg>
  );
}

export function CompletionScene({
  variant,
  complete,
  className,
  title,
}: CompletionSceneProps) {
  const sun = SCENES[variant].sun;
  const reduced = useReducedMotion();

  // Sky/terrain crossfade: 900ms full sunrise; 250ms under reduced motion (§4.3).
  const fade = reduced ? 0.25 : 0.9;
  // The rise lifts the sun by ~14% of the box (negative y = up). Zeroed under
  // reduced motion (belt-and-suspenders: MotionConfig also drops transforms).
  const riseY = complete && !reduced ? `${-RISE_PERCENT}%` : 0;

  const sunriseSky: CSSProperties = {
    background:
      "linear-gradient(to bottom, var(--scene-sky-top) 0%, var(--scene-sky-mid) 52%, var(--scene-sky-bottom) 100%)",
  };
  const sunGlow: CSSProperties | undefined = sun
    ? {
        background: `radial-gradient(${sun.r * 2.6}px ${sun.r * 2.6}px at ${(sun.cx / VB_W) * 100}% ${(sun.cy / VB_H) * 100}%, color-mix(in oklch, var(--scene-sun) 90%, transparent) 0%, color-mix(in oklch, var(--scene-sun) 30%, transparent) 45%, transparent 72%)`,
      }
    : undefined;

  return (
    <div
      className={cn(
        "relative isolate block h-full w-full overflow-hidden",
        className,
      )}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* 1 · DAWN frame — the complete static "before" (sky · sun · terrain). */}
      <Scene state="dawn" variant={variant} className="absolute inset-0" />

      {/* 2 · SUNRISE sky — brighten, crossfading in over the dawn sky. */}
      <m.div
        aria-hidden="true"
        className="scene-sunrise absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: complete ? 1 : 0 }}
        transition={{ duration: fade, ease: "easeOut" }}
        style={sunriseSky}
      />

      {/* 3 · Rising SUN (glow + disc) — fades in AND rises ~14%. Above the base
            terrain; the layer-4 copy then occludes its base. */}
      {sun && (
        <m.div
          aria-hidden="true"
          className="scene-sunrise absolute inset-0"
          initial={{ opacity: 0, y: 0 }}
          animate={{ opacity: complete ? 1 : 0, y: riseY }}
          transition={{ duration: fade, ease: "easeOut" }}
        >
          {/* glow — CSS radial (var() resolves here, unlike an SVG <stop>) */}
          <div className="absolute inset-0" style={sunGlow} />
          {/* disc — solid fill on a <circle> (var() resolves on fill) */}
          <svg
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            preserveAspectRatio="xMidYMid slice"
            className="absolute inset-0 block h-full w-full"
          >
            <circle
              cx={sun.cx}
              cy={sun.cy}
              r={sun.r}
              style={{ fill: "var(--scene-sun)" }}
            />
          </svg>
        </m.div>
      )}

      {/* 4 · Terrain COPY — sunrise-lit silhouettes over the rising sun, so the
            sun tucks behind the near ridge. Fades in with the sky. */}
      <m.div
        aria-hidden="true"
        className="scene-sunrise absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: complete ? 1 : 0 }}
        transition={{ duration: fade, ease: "easeOut" }}
      >
        <Terrain variant={variant} />
      </m.div>

      {/* Scrim under the line — bottom-anchored, token-coloured, so the near-
          white "Well done." clears contrast even where the near ridge dips and
          exposes the bright sunrise sky behind the text (DESIGN.md §4.5: never
          raw text on a gradient). Fades in with the line. */}
      <m.div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-1/2"
        initial={{ opacity: 0 }}
        animate={{ opacity: complete ? 1 : 0 }}
        transition={{
          duration: 0.2,
          delay: complete ? fade + 0.06 : 0,
          ease: "easeOut",
        }}
        style={{
          background:
            "linear-gradient(to top, color-mix(in oklch, var(--background) 72%, transparent) 0%, color-mix(in oklch, var(--background) 24%, transparent) 55%, transparent 100%)",
        }}
      />

      {/* 5 · "Well done." — Fraunces, 200ms fade, +60ms after the sky settles.
            Opacity-only → still appears under reduced motion (§4.3). */}
      <div className="pointer-events-none absolute inset-0 flex items-end justify-center p-5">
        <m.p
          className="font-heading text-2xl font-medium tracking-tight text-foreground"
          initial={{ opacity: 0 }}
          animate={{ opacity: complete ? 1 : 0 }}
          transition={{
            duration: 0.2,
            delay: complete ? fade + 0.06 : 0,
            ease: "easeOut",
          }}
        >
          Well done.
        </m.p>
      </div>
    </div>
  );
}
