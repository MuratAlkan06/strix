"use client";

/**
 * MotionProvider — the app-wide Motion runtime (DESIGN.md §7).
 *
 * Strix is CSS-first for motion (tw-animate-css); the `motion` package is
 * reserved for the ONE signature moment — the sunrise completion (§4.3). This
 * provider sets that up once, at the root, so the rest of the app pays nothing:
 *
 *  - `LazyMotion features={domAnimation}` loads only the DOM-animation feature
 *    bundle (transform/opacity/etc.), not the full `motion` runtime. `strict`
 *    makes any plain `motion.*` component THROW — app code must import the tiny
 *    `m.*` components from `motion/react-m`, preserving the code-split. (This is
 *    why §7 mandates `motion/react-m`, never `motion/react` components.)
 *  - `<MotionConfig reducedMotion="user">` honours `prefers-reduced-motion`
 *    globally: when the user asks for reduced motion, Motion auto-disables
 *    TRANSFORM and layout animations while STILL playing opacity — which is
 *    exactly the sunrise's reduced-motion spec (§4.3: no sun rise, but the sky
 *    crossfade + the "Well done." opacity fade still run). One config line buys
 *    the whole motion map's reduced-motion behaviour for m-components.
 *
 * This is a client component (Motion needs the browser); it wraps the root
 * layout's children so the SERVER root layout stays a server component.
 */
import { LazyMotion, domAnimation, MotionConfig } from "motion/react";
import type { ReactNode } from "react";

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
