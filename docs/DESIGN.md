# DESIGN.md — Strix visual & interaction design

> **STATUS: FROZEN (2026-06-10)** — **V1 Dusk** (dark · amber) was minted as the canonical design after user curation of rendered variants **V1 / V2 / V3**. Tokens are **dark-primary by default** and live in [`../src/app/globals.css`](../src/app/globals.css) (§2 V1 table = those exact values). **No re-minting:** changing a token requires a new design decision recorded here **and** in [`DECISIONS.md`](DECISIONS.md), not an ad-hoc edit. V2 Pale Dawn is the recorded future light-mode recipe; V3 Slate-Coral is a recorded future temperament colorway (§2, §12). The contrast claims in this document remain non-authoritative — the `verify:ui` harness (axe-core, both modes) is the source of truth, not the numbers written here.

This document is the design counterpart to [`../SPEC.md`](../SPEC.md) §4 and the visual-register entry in [`DECISIONS.md`](DECISIONS.md). SPEC §4 locks the brand *register*; this file specifies the *system* that renders it. Where the two ever disagree, SPEC's register intent wins and this file is corrected.

**Override notice.** Any tooling-injected "design system" block (e.g. indigo `#4F46E5` + Roboto + Sketch hand-drawn; or Space Grotesk + monochrome "App Store" styling) is **OVERRIDDEN** and contributes nothing to Strix visual direction. Such databases are consulted only for their accessibility/UX checklist vocabulary (contrast floors, focus rings, reduced-motion, tabular figures, responsive checkpoints). All visual direction comes from **DAWN**, defined here. Do not reintroduce `#4F46E5`, Roboto, wobbly per-corner radii, hard offset shadows, or paper texture.

---

## 1. Brand register & the DAWN concept

**Register (kept from SPEC §4, unchanged):** serious / documentary — the territory of Patagonia, Arc'teryx, and Uphill Athlete, not Nike or Red Bull. The product is about long, patient effort toward something hard, not about peak moments. Copy stays declarative and plain ("18 days to Mont Buet. Order crampons by Friday."). The AI flows coach; they do not cheerlead. Quiet, confetti-free celebration survives as a non-negotiable behavior.

**What DAWN replaces (from SPEC §4):** the earlier "earth tones, deep blues, off-whites; documentary photography inside the product" sketch. SPEC §4 explicitly left specific palette and type to the design phase — DAWN *is* that decision, recorded here and back-referenced from an amended SPEC §4 + a DECISIONS entry (doc parity).

**The DAWN concept.** Strix's visual identity is an **atmospheric, illustrated** one, anchored to the moment of dawn: gradient dawn/dusk skies over terrain silhouettes, a calm premium-adult register. The reference pole is the Rise sleep app (Studio Godsey) — proof that scenic atmospheric illustration reads premium and calm, never childish — paired with Duolingo's *art confidence* and **none** of its playfulness. Strix "must not look like every other vibecoded app."

Two rules keep DAWN from being a generic dusk-gradient template:

1. **Illustration is concentrated at brand moments only.** The dashboard horizon header, per-goal scene tiles, empty state, onboarding, and the completion moment carry illustration. The working task UI is **crisp, quiet chrome** — text, goal chips, checkboxes — with no decorative illustration (see §6 task-row rule).
2. **Time-of-day is semantic, not decorative.** Pre-dawn = "nothing started" (empty dashboard). Dawn = goals in progress (default). Sunrise = goal completion (the payoff). The sky *means* something; it is not wallpaper (see §4).

**The single celebratory moment.** Goal completion is rendered as a **sunrise over the goal's scene** (~900ms) plus a "Well done." line — confetti-free, the one luminous moment against otherwise crisp chrome. This is what makes the product memorable; see §4 (sunrise spec) and §8 (state philosophy).

---

## 2. Design tokens — V1 Dusk MINTED (V2 / V3 recorded for the future)

**Outcome of curation (2026-06-10).** The three variants were rendered side-by-side on the dev-only `/playground/dashboard` route (three class wrappers `.v1` / `.v2` / `.v3` over the token block; DAWN atmosphere, owl emblem, layout skeleton, and seed content held constant; chrome polarity + accent temperature varied). The user picked **V1 — Dusk (dark · amber)** as canonical.

**Winner rationale (one line).** A sunrise needs a dark base to rise *from*; the product is used at the dark ends of the day (early-morning planning, evening check-ins); the owl/nocturnal brand logic wants a night ground; amber carries *first-light* semantics (the dawn the brand is named for); coral read too alert-/destructive-adjacent for a calm register (and would force an icon pairing on every destructive — §8). Dark-primary + amber it is.

Values are **OKLCH** "L C H" and map to **exact shadcn slot names**. Global rules:
- `--radius: 0.625rem` (constant).
- `--input` mirrors `--border`; `--popover` / `--popover-foreground` mirror `--card` / `--card-foreground`.
- The `@theme` bindings already in `globals.css` are **reused, not renamed**.
- The V1 table below **is what `globals.css` `:root` carries** (dark-primary by default — no class needed). V2 / V3 are **recorded recipes**, not live tokens.

### V1 — Dusk (dark-primary) — **MINTED CANONICAL**
*Feel: the alpine hut at last light — deep indigo dusk, warm amber as the single point of heat. Premium, nocturnal, focused.*

> This table matches `src/app/globals.css` `:root` **exactly** (and `.dark`, which is aligned to the same values so dark-class toggling is a no-op). Goal ramp = §5 dark column; scene props = §4.3 dusk-base.

| slot | OKLCH | note |
|---|---|---|
| background | 0.18 0.035 264 | deep dusk indigo-navy (not pure black) |
| foreground | 0.94 0.012 250 | cool off-white |
| card | 0.225 0.038 262 | one step up, same hue family |
| card-foreground | 0.94 0.012 250 | |
| primary | 0.78 0.13 70 | warm amber (dawn light / CTA) |
| primary-foreground | 0.22 0.05 70 | dark warm ink on amber |
| secondary | 0.30 0.035 262 | muted indigo surface |
| secondary-foreground | 0.90 0.012 250 | |
| muted | 0.27 0.03 262 | |
| muted-foreground | 0.70 0.02 258 | ≥3:1 on bg; always text-paired |
| accent | 0.34 0.05 250 | hover/active wash |
| accent-foreground | 0.95 0.01 250 | |
| border | 0.92 0.01 250 / 12% | hairline via alpha |
| ring | 0.78 0.13 70 | amber focus ring = brand-tied |
| destructive | 0.62 0.16 28 | muted ember-red |

**Horizon gradient (V1):** vertical top→bottom `oklch(0.20 0.045 270)` 0% → `oklch(0.30 0.07 300)` 48% → `oklch(0.55 0.12 50)` 100%, plus a sun-glow radial `oklch(0.82 0.12 75)` @18% alpha centered ~78%w / 88%h.

### V2 — Pale Dawn (light-primary) — **RECORDED future light-mode recipe (not minted)**
*Feel: 5am desk, cold clear morning — pale sky, ink-blue type, same amber sun as warm anchor. Calm, awake, premium-clean.*

> **Reserved for the future light-mode slice.** When light mode is built, mint this under a light-mode mechanism (a `.light` / data-attr or `prefers-color-scheme`), not by re-minting `:root`. **Two contrast corrections from curation review are now folded into the values above** (the playground first rendered the raw recipe; axe caught these against white, and the corrected values are what the `/playground/dashboard` `.v2` override + this table now carry — this is a recipe correction, not a `:root` mint, so the freeze holds):
> - **On-white warning amber reaches ≥4.5:1** (warning notes are body text — §8 "cap hit / overdue"; the same `primary` amber renders the Equipment "order by Fri" note). The earlier `0.62 L` only reached **3.76:1**; `primary` is now **`0.57 L`** (≈4.62:1 on white). The `0.78 L` dusk amber is text-legible only on the dark ground.
> - **On-white goal-dot amber ≥3:1** (the §5 dot floor is 3:1 on its card). The earlier light goal-0 `0.70 0.12 65` was **2.74:1**; it is now **`0.65 0.12 65`** (≈3.33:1 on white), paired with its text as always (color is never sole signal).

| slot | OKLCH | note |
|---|---|---|
| background | 0.985 0.006 240 | near-white, faint cool cast |
| foreground | 0.24 0.04 262 | deep ink-indigo (NOT neutral black) |
| card | 1 0 0 | pure white lifts off cool bg |
| card-foreground | 0.24 0.04 262 | |
| primary | 0.57 0.13 64 | amber, darkened to clear 4.5:1 as on-white warning **text** (verified by axe; 0.62 L only reached 3.76:1) |
| primary-foreground | 0.99 0.005 80 | |
| secondary | 0.95 0.012 250 | pale indigo wash |
| secondary-foreground | 0.30 0.04 262 | |
| muted | 0.955 0.01 245 | |
| muted-foreground | 0.50 0.03 258 | ≥4.5:1 on white |
| accent | 0.93 0.02 248 | |
| accent-foreground | 0.28 0.04 262 | |
| border | 0.90 0.012 248 | |
| ring | 0.57 0.13 64 | mirrors corrected `primary` |
| destructive | 0.55 0.17 28 | muted brick-red |

**Horizon gradient (V2):** top→bottom `oklch(0.93 0.03 255)` 0% → `oklch(0.90 0.055 40)` 55% → `oklch(0.95 0.04 75)` 100%, sun-glow radial `oklch(0.95 0.06 80)` @35% at ~75% / 82%. Pale, never washed-out; verify ≥3:1 against overlaid emblem/text.

### V3 — Slate / Coral (dark-primary, coral) — **RECORDED future temperament colorway candidate (not minted)**
*Feel: colder, clinical-premium dusk — slate-teal chrome with a coral-rose sun. Same polarity as V1 so the only perceived change is temperature — isolated "amber vs. coral" + "is a cooler base more adult".*

> **Did not win** (amber's first-light semantics + coral's alert-adjacency, per the §2 rationale). Preserved as a **candidate future coach-temperament colorway** (§12) — expressible as a class axis over the existing `--scene-*` props + emblem treatment, not a re-mint. If it graduates, its near-coral `destructive` must always pair an icon (§8, §11).

| slot | OKLCH | note |
|---|---|---|
| background | 0.20 0.018 230 | slate, low chroma, teal-leaning |
| foreground | 0.94 0.008 220 | |
| card | 0.245 0.02 228 | |
| card-foreground | 0.94 0.008 220 | |
| primary | 0.72 0.14 25 | coral-rose sun / CTA |
| primary-foreground | 0.21 0.05 25 | |
| secondary | 0.30 0.018 228 | |
| secondary-foreground | 0.90 0.008 220 | |
| muted | 0.27 0.015 228 | |
| muted-foreground | 0.71 0.012 222 | |
| accent | 0.33 0.025 220 | |
| accent-foreground | 0.95 0.008 220 | |
| border | 0.92 0.008 220 / 12% | |
| ring | 0.72 0.14 25 | |
| destructive | 0.60 0.15 22 | near coral → destructive must always pair an icon (§8) |

**Horizon gradient (V3):** top→bottom `oklch(0.22 0.03 235)` 0% → `oklch(0.34 0.06 350)` 50% → `oklch(0.58 0.13 20)` 100%, sun-glow radial `oklch(0.80 0.12 25)` @18% at ~78% / 88%.

> The dashboard header + completion moment are brand-defining; this 3-variant pass **is** the header's multi-variant render. The completion moment gets its own 2-up comparison at mint time.

---

## 3. Typography

Type is held **constant** across all three variants so the curation pass reads color/polarity, not type. **Stance A is the default.**

**Stance A — "Documentary serious, modern" (DEFAULT):**
- **Display / headings — Fraunces** (Google; optical sizing on; weight 500–600): greeting, section headers, goal titles, "Well done.", empty-state headline. **Not** used in dense UI.
- **Body / UI — Hanken Grotesk.**
- **Numeric / tabular:** `font-variant-numeric: tabular-nums` for countdowns and data columns; the big goal-detail countdown may use Fraunces tabular.

**Stance B — "Warm literary" (HELD):** Fraunces + Mona Sans. Rendered only if Stance A reads too cool after the chrome lock.

**Scale (px):** 12 / 14 / 16 / 18 / 22 / 28 / 36. Body base **16px** (mobile — avoids iOS auto-zoom). Line-height 1.5 body, 1.15–1.2 display. Line length 60–75ch desktop / 35–60ch mobile.

**Minted font tokens** (replaced the old `globals.css` font lines): `--font-sans: var(--font-hanken)` · `--font-heading: var(--font-fraunces)` · `--font-mono: var(--font-geist-mono)` (debug only — Geist Sans is demoted; Geist Mono survives as debug mono). **No Inter / Geist / Roboto as brand face.**

**Wiring mechanism (as implemented).** Fraunces (variable weight + `opsz` axis) and Hanken Grotesk (400/500/600) load **app-wide in the root layout** (`src/app/layout.tsx`) via `next/font/google`, `display: swap`, exposed as `--font-fraunces` / `--font-hanken` on `<html>`. The three font tokens above live in the **`@theme inline`** block of `globals.css`. The `inline` keyword is load-bearing: Tailwind v4 *dereferences the `var()` expression at build*, so `.font-sans` / `.font-heading` emit `font-family: var(--font-hanken)` / `var(--font-fraunces)` — pointing at the runtime vars, resolved on `<html>`. (The bug this fixed: when these tokens read `var(--font-geist-sans)`, the utilities baked **Geist** in regardless of any wrapper override — the `/playground/dashboard` route had to carry a direct `.pg-root` font override to compensate. At the V1 mint the tokens were repointed and that bypass was deleted; the playground now renders Fraunces/Hanken through this global wiring, which is the proof the mint is correct.)

---

## 4. Illustration grammar

Everything is **inline SVG + CSS gradients**, themeable by token, reproducible from rules. **No PNG/JPG/Lottie, no external illustration packs, no illustrator.**

### 4.1 Layer grammar (back → front)
A scene is a fixed z-stack in one `<svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid slice">` (header) or `0 0 320 200` (tile):
1. **Sky** — a `<rect>` filled by a `linearGradient` (recipes in §4.3). Always present.
2. **Sun / moon disc** (optional) — one `<circle>` + a soft halo circle behind via `radialGradient`. Present in dawn/day/sunrise; absent pre-dawn.
3. **Atmospheric haze** (optional) — one wide low-opacity (6–12%) horizontal band in the warm stop color, just above the far silhouette.
4. **Silhouette layers (2–3)** — far / mid / near, each ONE flat-filled `<path>`; darker + slightly higher chroma toward foreground. Parallax = opacity + value, never many layers.

**Token binding:** sky stops + silhouette fills are CSS custom props on the SVG (`fill: var(--scene-sky-top)`, etc.), set per state class. One SVG, many moods, zero re-draw.

### 4.2 Geometry rules
- Silhouettes are low-poly continuous paths, **~8–12 anchors max** — a confident single gesture.
- Curve character: straight ridgelines + gentle cubic béziers; **one hero feature per scene**; calm asymmetry — never a centered symmetric mountain.
- **Fill-only, no stroke.**
- **Banned:** outlined/cartoon styling; gradient fills inside silhouettes (flat only — the gradient lives in the sky); drop shadows on shapes; texture/noise; >3 silhouette layers; symmetric hero peaks; faces/figures inside scenes; birds/clouds/sparkles; emoji or icon-font inside a scene; sunburst rays.

### 4.3 Time-of-day gradient recipes (semantic states)
Bound to a **state class** on the SVG root. Values are the dusk-base reference; the pale-dawn base lightens each sky stop ~+0.4 L and drops chroma ~30%.

| State | Semantic use | Sky top → mid → bottom | Sun |
|---|---|---|---|
| **pre-dawn** | empty-state dashboard, "nothing started" | 0.16 0.03 270 → 0.22 0.04 285 → 0.30 0.05 320 | none (or faint sub-horizon disc, 30%) |
| **dawn** | default header, goals in progress | 0.22 0.045 270 → 0.34 0.07 320 → 0.62 0.12 55 | low warm disc, partly behind near silhouette |
| **day** | "all caught up today" calm | 0.55 0.07 250 → 0.72 0.05 230 → 0.88 0.04 90 | high, bright, small halo |
| **dusk** | evening / settings ambient | 0.20 0.04 285 → 0.30 0.06 340 → 0.48 0.10 30 | low, sinking, warm |
| **sunrise** | goal completion (the payoff) | animate FROM dawn TO 0.30 0.06 300 → 0.55 0.12 60 → 0.86 0.10 85 | disc rises + halo widens; gradient brightens |

> **Dawn-recipe reconciliation (§2 vs. §4.3):** where the dawn row above differs from the §2 V1 horizon recipe, the **§2 V1 horizon recipe is the IMPLEMENTED canonical** (globals.css `.scene-dawn` matches §2); the §4.3 dawn row is the pre-curation generic reference.

**Completion = sunrise (the locked, confetti-free moment).** The goal's scene animates dawn→sunrise over **900ms ease-out** (sun `cy` lifts ~14% of the viewBox via `transform: translateY` on the GPU; sky stops crossfade), then "Well done." fades in (200ms, +60ms after the brighten settles). **No** confetti / burst / sound. `prefers-reduced-motion`: skip the rise — **250ms sky crossfade** + the line.

### 4.4 The five example-goal scene tiles
All from the same grammar — they differ only in the near-silhouette `<path>` + one optional thin accent mark. Sky = pre-dawn on the empty dashboard; switches to dawn once that goal exists. Tile viewBox `0 0 320 200`, 3 silhouette layers.

| Tile | Near-silhouette gesture | Accent | Sun |
|---|---|---|---|
| **Climb a mountain** | one asymmetric ridge, clear peak right-of-center | faint diagonal "route" line up the face (1px, muted-foreground @40%) | dawn disc behind peak |
| **Learn a language** | low rolling hills + distant settlement (3–4 angular roof rects, mid layer) | none | low |
| **Run a race** | flat horizon + long gentle path curving to a vanishing point | single thin finish-line tick far down the path | low, wide halo |
| **Write a book** | horizon broken by one upright rectangle (lit window / 5am desk) | warm window-glow `<rect>` (the only interior light in the set) | none — pre-dawn interior |
| **Learn an instrument** | soft dune-like swells, very smooth béziers | faint evenly-spaced vertical "string/staff" lines rising + fading up (≤10%) | low |

**Engineer rule:** build ONE `<Scene state variant sun? />`; the five tiles are **DATA** (path-d strings + accent flag), not five components.

### 4.5 Where illustration MAY and MAY NOT appear
- **MAY:** dashboard horizon header (full-bleed, height `clamp(120px, 22vh, 200px)`); per-goal scene tile (goals-list cards + goal-detail header); empty-state dashboard (large pre-dawn scene + 5 tiles); onboarding tiles; the completion moment (enlarged scene); an optional ambient strip on settings.
- **MAY NOT:** task rows (text + goal chip + checkbox only); inside buttons / inputs / selects / dialogs / toasts / tooltips; behind dense lists; equipment rows; check-in fields; as loading-skeleton fill. **Task UI is crisp chrome; illustration is concentrated at brand moments only.**
- **Contrast over scenes:** text/emblem on a scene sits on a ≥40% token-colored scrim or a solid card; never raw text on a gradient unless it clears 4.5:1 against **every** stop it overlaps.
- **Performance:** static SVG (no per-frame JS). The only animation is the completion transition + ≤0.02 parallax drift on the header sun on scroll (transform only; reduced-motion disables it). Reserve scene height → no CLS.

---

## 5. Goal-attribution color ramp

Five hues in the dawn palette — muted, distinguishable. **Never the sole meaning carrier:** every chip pairs a dot + the goal-name text; milestone icons pair a label/tooltip. Both modes (OKLCH); dark variants lift L, trim C.

| idx | name | light (on pale-dawn) | dark (on dusk) |
|---|---|---|---|
| 0 | dawn amber | 0.65 0.12 65 | 0.78 0.12 70 |
| 1 | alpine blue | 0.55 0.09 245 | 0.70 0.09 240 |
| 2 | lichen green | 0.58 0.07 150 | 0.72 0.07 150 |
| 3 | clay rose | 0.60 0.10 30 | 0.72 0.10 28 |
| 4 | dusk plum | 0.52 0.08 320 | 0.68 0.08 320 |

**Build-time checks:** adjacent pairs differ by ≥~18° hue OR clearly in L; the dot clears 3:1 against its card in both modes. Always text-paired → passes color-not-only. Dot ≥8px with a 1px inner ring at 10% foreground.

**Minted (dark-primary):** `--goal-color-0…4` in `:root` = the **dark (on dusk)** column above — the app's default ground is dusk, so the dark ramp is canonical. The existing `@theme --color-goal-0…4 → var(--goal-color-N)` mapping is unchanged. When light mode lands (V2), the **light (on pale-dawn)** column moves into that mode's override — with the on-white dot ≥3:1 check from the §2 V2 note.

---

## 6. Component manifest

**Installed (base-nova / shadcn at `src/components/ui/`):** button, card, input, label, select, switch, tooltip, sonner, dialog, sheet.

**Playground usage:** card (section containers + scene tiles), button (row affordances + an "Adjust" stub; one primary CTA per surface), tooltip (truncation disclosure), sonner (calm "task checked" undo, 3–5s).

**DAWN deltas (the complete new-surface list — nothing one-off outside it):**
- **Scene** — `state: pre-dawn | dawn | day | dusk | sunrise`; `variant: mountain | language | race | book | instrument | header`; `sun?`. One component; tiles are data.
- **HorizonHeader** — full-bleed dashboard header (scene + emblem + greeting + date on scrim).
- **GoalChip** — dot + goal-name text (the attribution primitive).
- **CountdownStat** — tabular number + label.
- **Emblem** — the owl mark, mono + 2-tone, with clear-space rules (see §10).
- **shadcn `checkbox`** — the check-off control; **not currently installed** → add as a delta.

**Task-row clean-chrome rule.** A task row is text + a `GoalChip` + a `checkbox`. **No illustration, no decorative color fields, no scene.** This is what keeps the working surface quiet against the brand moments that carry illustration.

---

## 7. Motion personality

- **Easing:** enter = strong **ease-out**; move/reposition = **ease-in-out**; **never ease-in** (nothing should accelerate away from the user).
- **Durations:** buttons 100–160ms; dropdowns/popovers 150–250ms; general UI ≤300ms. **Completion is the one exception at 900ms** (the sunrise).
- **`:active`** = `scale(0.97)`.
- **List stagger:** 30–80ms between rows on first paint; **no list layout animations** on reorder.
- **Transitions over keyframes** wherever possible (transform/opacity only — GPU-friendly).
- **Reduced-motion map:** all motion is gated by `prefers-reduced-motion`. The sunrise rise → 250ms sky crossfade; shimmer → static muted block; parallax drift → off; row strike-through stays (it is a state change, not decoration, and is brief).

This is implemented CSS-first (`tw-animate-css`); the `motion` package is reserved **only** for the sunrise completion (`LazyMotion` + `domAnimation` via `motion/react-m`, `<MotionConfig reducedMotion="user">` at the root).

**Implemented (motion slice).**
- **Provider:** [`../src/components/motion-provider.tsx`](../src/components/motion-provider.tsx) wraps the root layout's children with `LazyMotion features={domAnimation} strict` + `<MotionConfig reducedMotion="user">`. The root layout stays a server component (the provider is the client boundary). `strict` makes app code import `m.*` from `motion/react-m`; a plain `motion.*` component throws — preserving the code-split so non-completion surfaces ship no Motion runtime.
- **Sunrise mechanism:** [`../src/components/completion-scene.tsx`](../src/components/completion-scene.tsx) (a dedicated client component — the static `<Scene>` primitive is left untouched so the dashboard screenshots don't move). The sky brighten is an **opacity crossfade of two stacked gradient layers** (a static dawn `<Scene>` underneath + a `.scene-sunrise` `m.div` fading 0→1), **not** `@property` registration of the `--scene-*` custom props (they don't interpolate in a transition otherwise). The sun **rises via `translateY` ~14%** of the viewBox (transform/opacity only) and is occluded by a terrain copy that fades in on top, so it lifts from behind the near ridge; "Well done." (Fraunces) fades in 200ms, +60ms after the sky settles. **Reduced motion:** the rise distance is zeroed and the crossfade shortens to 250ms (and `MotionConfig` independently drops transforms while keeping opacity), so the line still appears — matching §4.3.
- **Demo route:** [`../src/app/playground/completion/page.tsx`](../src/app/playground/completion/page.tsx) — a throwaway, auth-exempt (`/playground(.*)`) surface that plays the moment on a mountain scene (Mark complete / Reset). Deliberately a **separate** route from `/playground/dashboard` so that surface's `verify:ui` baselines stay byte-identical.
- **Micro-motion (§7):** the shared `button` / `checkbox` primitives already carry `transition-*` (≤300ms, ease) and an `:active` affordance from base-nova, so they conform without edits; the shared primitives were not modified (a global active-scale change is out of this slice's scope and would risk the dashboard baselines).

---

## 8. State philosophy (dashboard surface, DAWN register)

- **Loading:** section-card skeletons (muted fill, subtle `tw-animate-css` pulse) — **no illustration in skeletons.** The horizon header renders its static scene immediately (no data needed) so the brand frame is present while rows load. Rows reserve exact height (no CLS). Shimmer → static muted block under reduced-motion.
- **Empty (no goals):** pre-dawn full scene in the upper area; one primary CTA "Create your first goal" on a scrim/card; below it, the 5 pre-dawn example tiles. Copy is invitational and plain ("Start with something big.").
- **Empty (has goals, nothing due):** day/calm dawn header + "Nothing scheduled today. Rest is part of the plan."
- **Error (load failed):** **NOT** a red screen. A calm card, a plain line ("Couldn't load your day. Tap to retry."), and a retry button. Destructive red is reserved for destructive confirmations.
- **Success (task checked):** the row strikes through 150–200ms ease-out; an optional calm sonner undo (3–5s). **No burst / sound.**
- **Success (goal completed):** the **sunrise** transition (§4.3) — the single celebratory moment in the app, and it is quiet.
- **Warning (cap hit / equipment overdue):** an amber/primary-toned inline note with icon + text, **never red**. "Order crampons by Friday" is a plain statement, not an alarm.

---

## 9. Anti-slop banlist

The brand dies in the defaults. All fourteen are enforced at design review:

1. Stock / undraw-style vector packs.
2. **Cartoon mascot / owl coach — the HARD BAN narrows precisely to Duolingo-adjacent CARTOON styling** (round-cute mascot, expressive eyes/limbs, a nagging persistent presence). **Grammar-native geometric owl FIGURES at ritual moments are a SANCTIONED future surface** (see §10, §12) — built in the same flat-fill silhouette language as the terrain, never with cute faces or per-character art styles.
3. Confetti / particle bursts / sparkles on any success.
4. Default-shadcn graypanel (neutral-gray on neutral-gray stock palette).
5. Inter / Geist / Roboto as the brand face.
6. Generic indigo/purple SaaS gradient (`#4F46E5`-family) as a brand color or hero gradient.
7. Emoji as UI. (Persona/owl indicators are SVG geometric only — no emoji owl.)
8. Glassmorphism clichés (blur is allowed only to mask a transition).
9. Gamification furniture — XP / streak flames / badges / levels / leaderboards / celebratory progress rings.
10. Guilt mechanics — red overdue counts, "you broke your streak," shame copy; missed tasks are neutral.
11. Hand-drawn / wobbly / paper-texture, per-corner random radii, hard offset neobrutalist shadows, jiggle-on-error.
12. Symmetric centered mountain logo scenes, sunburst rays, gradient-filled or stroked silhouettes.
13. Single-mountain-on-a-circle App-Store cliché; neon / sport-script.
14. Horizontal-scroll "journey" track as primary nav; task UI is vertical, predictable, native.

---

## 10. The owl emblem

Strix is Latin for *owl* (see DECISIONS — "Naming"). The mark is a **minimal geometric owl emblem ONLY**.

- **Construction:** flat-fill geometric SVG in the DAWN silhouette language (the same grammar as terrain scenes) — abstract, no expressive face/eyes/limbs.
- **Treatments:** mono (single token) + 2-tone (token + accent). Defined for light and dark grounds.
- **Clear-space:** a minimum margin equal to the emblem's cap-height on all sides; minimum legible size defined so it never degrades into mush.
- **Usage:** top-left of the horizon header (small), and brand surfaces — **not** persistent decoration inside the working task UI.

**Seed-grammar requirement (load-bearing).** The emblem geometry must be the **SEED of the future owl-form construction system** — one language from mark → figure. A later coach-figure system (see §12) must be derivable from this emblem's construction rules (silhouette anchors, proportion, fill discipline), not a separate art style bolted on. This is checked at design review; it costs nothing now and preserves the option later.

**App icon (minted 2026-06-12).** The PWA/home-screen icon is **V6a "Night Watch — flat"**: a tufted owl-head silhouette with two solid amber eye discs (`primary`) and an amber beak kite, on the flat `--background` dusk ground (`#0a1121`) — user-curated over three rounds on `/playground/icons` (round 1 emblem-derived, round 2 owl-forward, round 3 V6 ground refinements; the route is kept as the curation record). The icon stays grammar-native (flat fills, no strokes, amber as the single point of heat) but leads with the owl signifiers (eyes, tufts) rather than the emblem seed geometry, which reads as a blob at 60px — a deliberate, recorded divergence; the emblem remains the in-app mark and the seed for §12. **Design-system delta (icon-only, not a minted token):** the head fill is elevated dusk `oklch(0.26 0.04 264)` → `#1a2438` because `--card` (`0.225 L`) lacks separation against `--background` at icon scale (fails the 60px squint test, verified at true size). Generated by `scripts/generate-icons.mjs` (`WIRED_VARIANT = "v6a"`); the manifest and layout reference only the canonical `icon-*` / `apple-touch-icon-*` filenames. Decision recorded in [`DECISIONS.md`](DECISIONS.md) "Visual register".

---

## 11. Accessibility baseline

The injected design-system DB contributes **only** this checklist (its visual values are overridden — §0):

- **Contrast:** body text ≥ **4.5:1**; large text and non-text UI glyphs ≥ **3:1**. Verified at **both ends** of any gradient a text/emblem overlaps, in **both modes**, by the `verify:ui` axe-core harness — the prose numbers in this doc are DRAFT and not trusted.
- **Focus:** visible focus rings, **2–4px**, brand-tied (the `ring` token = the accent).
- **Pointer:** `cursor-pointer` on all clickables; hover transitions 150–300ms.
- **Touch targets:** ≥ **44×44px**. **Product-graduation requirement (from curation review):** the `/playground/dashboard` components were sized for dense side-by-side curation — the **checkbox renders ~16px and the "Adjust" button ~28px** there. When these graduate to real product surfaces, their **interactive targets must be brought to ≥44×44px** (expand the hit area — padding / an enlarged label-wrap — without necessarily enlarging the visual glyph). Recorded so the playground sizes are not copied verbatim into product. **Product-graduation requirement:** shared button primitive lacks `cursor-pointer` (base-nova default); add it when primitives graduate to product surfaces (§11 "cursor-pointer on all clickables").
- **Icons:** lucide SVG, **never emoji**.
- **Motion:** `prefers-reduced-motion` respected everywhere (§7 map).
- **No CLS:** reserved heights for scenes and rows.
- **Color is never the sole signal:** goal attribution is always text-paired; destructive always pairs an icon (critical on V3, where destructive sits near the coral accent).
- **Numerics:** tabular figures for timers/data.
- **Checkpoints:** 375 / 768 / 1024 / 1440.

**The `verify:ui` harness (this is the contrast source of truth).** Playwright + `@axe-core/playwright` scan `/playground/dashboard` (all three variant sections) + `/playground/active-dashboard` — full-page **WCAG 2.1 AA** checks (`wcag2a/2aa/21a/21aa`) that must report **zero violations, with no exclusions or suppressions**. It runs against the **production** server with reduced-motion + animations disabled so results are deterministic. Config: [`../playwright.config.ts`](../playwright.config.ts); specs: [`../e2e/playground-dashboard.spec.ts`](../e2e/playground-dashboard.spec.ts) + [`../e2e/playground-active-dashboard.spec.ts`](../e2e/playground-active-dashboard.spec.ts); commands `pnpm verify:ui` / `pnpm verify:ui:update`. It is a **separate** gate from `verify:phase-0` (kept fast) and runs as its own CI job. This is what the "prose numbers are DRAFT" caveat defers to — e.g. it is what caught and corrected the V2 on-white amber (§2 V2 note: warning text `primary` → `0.57 L`; goal-0 dot → `0.65 L`).

**Cross-platform screenshot scheme (the classic trap, handled).** `toHaveScreenshot` baselines render differently on macOS vs Linux (font antialiasing), so a single PNG can't serve both. The harness uses Playwright's **default platform-suffixed snapshot names** (`…-chromium-linux.png` for CI, `…-chromium-darwin.png` for local macOS) — the two baselines coexist in each spec's `e2e/*.spec.ts-snapshots/` directory and never collide. The **axe scan always runs** (platform-independent); a screenshot spec **skips itself when no baseline exists for the current platform**, so CI is green before its Linux baselines land and is never flaky. Linux baselines are generated in the matching **`mcr.microsoft.com/playwright:v<version>-noble` Docker image** so they byte-match the `ubuntu-latest` runner; bootstrap/refresh with `pnpm verify:ui:update` (local) or that image (Linux).

---

## 12. Future explorations (PARKED — do not design now)

**Coach temperament system (atmosphere + voice).** A later, post-base addition — **deferred by the user on 2026-06-10** to the **v2 AI mentor lane (Max-tier exclusive)**. No persona design or research happens in this slice. What is recorded here are only the *requirements that keep the option open at zero cost now*:

- **A visible choosing ritual.** At the end of intake, a "meet your coaches" roster → the user picks a visually distinct coach. This is a future **brand-defining screen** that earns its own multi-variant pass when built.
- **A roster of geometric owl coaches in the ONE DAWN grammar.** Temperament differentiates via (a) silhouette shape / posture, (b) colorway, (c) sky state, (d) copy voice register — **never** via cute faces/expressive eyes or per-coach art styles. One production grammar, not a style per coach (Strix is small; Rise's big team can afford per-coach styles, Strix can't and shouldn't).
- **Precedent:** Rise launched **"AI Expert"** (late 2025) — an LLM coaching tier at **$29.99** *above* the standard membership, matching users with different AI coaches each with a distinct voice. It is paywalled/app-only (which is why an earlier public-copy research sweep missed it; owner firsthand knowledge corrected the record). Owner also confirms Rise's AI Expert has a real **visual choosing phase**. This validates a multi-temperament roster in a calm-premium register and suggests pricing headroom for Strix's mentor lane.
- **Constraints carried forward:** per-goal intensity stays a **quiet** feature (DECISIONS) — any temperament system must honor that and be **account-level**; appearance is **rituals-only** (choosing, weekly check-in header, plan-review) — **never** persistent on the daily dashboard (premium = low frequency); the spine is **AI proposes, user approves** (suggest-and-confirm, not assign); a **product-architect pass** is required before any of it ships.

**Standing token-architecture requirement (verified at design review, applies now):** coach-temperament colorways must be expressible later as a **class axis over the existing `--scene-*` custom props + emblem treatment** — true by construction today, recorded so a future refactor doesn't quietly close the door. The variant that *loses* the V1/V2/V3 curation is a candidate future temperament colorway, not waste.

---

*Sources behind the DAWN direction: Studio Godsey (Rise) for atmospheric scenic illustration reading premium; Apple Developer + Pixso (Gentler Streak, 2024 Apple Design Award) for the no-guilt kind-coaching register. Both are pressure-test poles, not visual templates to copy.*
