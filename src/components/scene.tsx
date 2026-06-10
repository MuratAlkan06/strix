/**
 * Scene — the single DAWN illustration primitive (DESIGN.md §4).
 *
 * One component renders the fixed back→front z-stack for every brand-moment
 * scene (header + the five goal tiles + completion). Moods are data, not
 * components: the silhouette paths live in scene-data.ts and the colours come
 * from `--scene-*` CSS custom props set by a `scene-{state}` class in
 * playground.css. One scene, many moods, zero re-draw.
 *
 * Layer grammar (back→front): sky · sun-glow · sun-disc · haze · silhouettes(2–3)
 * · accent. The sky gradient and the sun glow are painted as CSS gradients
 * (where token `var()`s resolve reliably — Chromium does NOT resolve var() in an
 * SVG <stop>, painting black instead); the sun disc, silhouettes and accents
 * are an inline-SVG overlay with token-bound `style` fills. No raster, no stroke
 * on silhouettes, no gradient INSIDE a silhouette (the gradient is the sky).
 */
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import {
  SCENES,
  LANGUAGE_ROOFS,
  type SceneState,
  type SceneVariant,
} from "@/components/scene-data";

interface SceneProps {
  state: SceneState;
  variant: SceneVariant;
  /** Override the variant's default sun presence. */
  sun?: boolean;
  /** Reserved height styling lives on the caller; class merges in. */
  className?: string;
  /** Decorative by default; pass a label to expose it to AT. */
  title?: string;
}

const DEPTH_FILL = {
  far: "var(--scene-far)",
  mid: "var(--scene-mid)",
  near: "var(--scene-near)",
} as const;

export function Scene({ state, variant, sun, className, title }: SceneProps) {
  const def = SCENES[variant];
  const isHeader = variant === "header";
  const vbW = isHeader ? 400 : 320;
  const vbH = isHeader ? 240 : 200;
  // pre-dawn never shows a full sun; otherwise the prop overrides the default.
  const showSun = (sun ?? def.sunDefault) && state !== "pre-dawn";

  // Sun glow position as % of the box (for the CSS radial-gradient layer).
  const glowX = def.sun ? (def.sun.cx / vbW) * 100 : 50;
  const glowY = def.sun ? (def.sun.cy / vbH) * 100 : 50;
  const glowR = def.sun ? (def.sun.r * 2.6) : 0;

  const skyStyle: CSSProperties = {
    background:
      "linear-gradient(to bottom, var(--scene-sky-top) 0%, var(--scene-sky-mid) 52%, var(--scene-sky-bottom) 100%)",
  };
  const glowStyle: CSSProperties = {
    background: `radial-gradient(${glowR}px ${glowR}px at ${glowX}% ${glowY}%, color-mix(in oklch, var(--scene-sun) 90%, transparent) 0%, color-mix(in oklch, var(--scene-sun) 30%, transparent) 45%, transparent 72%)`,
  };

  return (
    <div
      className={cn(
        "relative isolate block h-full w-full overflow-hidden",
        `scene-${state}`,
        className,
      )}
      role={title ? "img" : "presentation"}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {/* 1 · Sky — CSS gradient (token var() resolves reliably here) */}
      <div aria-hidden="true" className="absolute inset-0" style={skyStyle} />

      {/* 2 · Sun glow — CSS radial behind the terrain */}
      {showSun && def.sun && (
        <div aria-hidden="true" className="absolute inset-0" style={glowStyle} />
      )}

      {/* 3+ · Sun disc · haze · silhouettes · accents — inline SVG overlay.
          preserveAspectRatio matches the sky/glow layers so everything aligns. */}
      <svg
        viewBox={`0 0 ${vbW} ${vbH}`}
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 block h-full w-full"
        aria-hidden="true"
      >
        {/* Sun disc — sits behind the near silhouette so it can be partly hidden */}
        {showSun && def.sun && (
          <circle
            cx={def.sun.cx}
            cy={def.sun.cy}
            r={def.sun.r}
            style={{ fill: "var(--scene-sun)" }}
          />
        )}

        {/* Atmospheric haze — one wide low-opacity warm band above the horizon */}
        <rect
          x="0"
          y={isHeader ? 138 : 116}
          width={vbW}
          height={isHeader ? 26 : 20}
          opacity="0.08"
          style={{ fill: "var(--scene-sun)" }}
        />

        {/* Silhouettes (back→front), flat-filled, no stroke */}
        {def.layers.map((layer, i) => (
          <path key={i} d={layer.d} style={{ fill: DEPTH_FILL[layer.depth] }} />
        ))}

        {/* Settlement roofs for the language tile (mid-layer angular rects) */}
        {variant === "language" &&
          LANGUAGE_ROOFS.map((r, i) => (
            <rect
              key={`roof-${i}`}
              x={r.x}
              y={r.y}
              width={r.w}
              height={r.h}
              style={{ fill: "var(--scene-mid)" }}
            />
          ))}

        {/* Accent marks — the one optional thin feature per scene */}
        {def.accent?.kind === "route" && (
          // faint diagonal route up the near face toward the peak (x≈214)
          <path
            d="M 150 176 L 214 96"
            fill="none"
            strokeWidth="1"
            strokeDasharray="3 4"
            style={{ stroke: "var(--scene-accent)", strokeOpacity: 0.4 }}
          />
        )}
        {def.accent?.kind === "finish" && (
          // single thin finish-line tick far down the (implied) path
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
          // warm window glow — the only interior light in the set
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
          // faint evenly-spaced vertical string/staff lines, fading up
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
    </div>
  );
}
