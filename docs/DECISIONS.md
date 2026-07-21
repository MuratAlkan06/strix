# Strix — Decisions Log

The "why" behind decisions that aren't captured in SPEC.md or PLAN.md. Read this when you come back to the project and wonder why something is the way it is.

---

## Naming

**Strix was chosen** after a long search through habit/goal app naming space. Sound matters more than literal meaning — the brand register (Patagonia/Arc'teryx documentary tone) carries the meaning; the name carries the feel.

**Rejected names and why:**
- **Cairn** — already a well-known hiking safety app; outdoor-coded category overlap.
- **Throughline** — meaning was exact but too long, and "feels passive" per gut check.
- **Ascent / Ascend** — multiple existing habit trackers in this space; "Ascend Habit Tracker," "Ascend: Self-Improvement," etc. Too crowded.
- **Pitch** — connotation problem ("baseball" or "sales pitch"), wrong feeling.
- **Sisu** — meaning was exact (Finnish word for grit/perseverance) but "S" is too soft a consonant for the brand intensity wanted.
- **Kova** — already an App Store quit/habit tracker.
- **Forge / Grit / Commit** — the most crowded part of the entire habit-tracker namespace; every "discipline-coded" word is taken.
- **Pursue / Passage** — Pursue exists; Passage felt too passive.
- **Lodestar / Threshold / Tend / Anvil** — not gut-resonant during the search.

**Strix tradeoffs to be aware of:**
- Trademark in software class (042) is registered by a customs SaaS company — different category so unlikely consumer confusion, but registering "Strix" as a bare wordmark may not be possible. Standard playbook: compound modification later (e.g., "Strix Goals") if a defensible mark becomes needed.
- ASUS Strix is a gaming hardware brand — dominates Google SERPs for "Strix." SEO life is harder. App Store search is cleaner because category-segregated.
- Owl meaning (Latin "strix") is quietly available if a visual mark is ever needed.

---

## Platform and stack

**Mobile-first responsive web (PWA) for MVP, native via Expo in v2.**

- Iteration speed matters more than platform fit pre-launch. Skipping App Store review = ship 5 changes a day instead of 5 a week.
- Notifications are the one feature that genuinely requires native — and they're v2.
- Next.js + Supabase/Neon + Tailwind is the stack Claude Code is strongest at. Faster feedback loop than React Native at this stage.
- Transition to native is cheap if built with portable patterns (NativeWind for Tailwind, etc.). Data model, API, and prompts all move over unchanged.

**Stack chosen by the planning agent** (Next.js 15, Neon, Drizzle, Clerk, Stripe, PostHog, Inngest, Resend, Vercel) — see PLAN.md §1 and §4.

---

## Business model

**Tiers: Free (3 goals), Pro $9.99/mo or $89.99/yr (5 goals), Max $19.99/mo or $179.99/yr (5 goals + mentor).**

**Why these numbers:**
- Pricing rationale: see internal notes.
- 25% annual discount (higher than typical 15-20%) matches what AI-coaching apps do — Rise is only annual. Bigger discount funnels users into lower-churn tier.

**Why Free is 3 goals not 2:**
- Original instinct was 2 (cleaner conversion trigger).
- Reconsidered: Mont Blanc alone is one goal; most users want a primary big goal + a smaller secondary one. 2 hits the wall the moment they want to try a second life area.
- 3 lets users genuinely use the product; conversion wall at the 4th goal is the natural "I'm getting serious" moment.

**Trial: Max-only, card required, 1 week, expires to Free if not converted.**
- Pro has no trial (lower-intent funnel doesn't need it).
- Card-required trials convert ~3-4x better than no-card trials. For Max specifically, the AI-coaching value justifies the friction.
- Trial-end auto-triggers downgrade-and-archive flow if user has 4-5 goals.

**Why "Sonnet 4.6 across all tiers" is non-negotiable:**
- Free users tasting good output is what drives conversion.
- Degrading free quality (e.g., Haiku) breaks the funnel — bad output → no upgrade → no business.
- This is the most likely "well-meaning agent optimization" that would silently destroy the product. Locked in SPEC.md §10 and PLAN.md.

---

## Key product decisions

**AI proposes, user approves.** Every AI-generated change — initial plan, replan, equipment adjustments — is reviewed before it lands. No silent rewrites. This is the spine of user trust in the product.

**Equipment is milestone-linked, not a flat shopping list.** "Order crampons by June 12 because you need them for the Mont Buet climb on June 19" is the product; "buy crampons" alone is not. Application invariant: exactly one of milestone_id or standalone_deadline is set per equipment item.

**Unified cross-goal dashboard is the default landing surface.** New users land here, not on a single goal. The product's distinct value vs. competitors (Ultiself, Waypoint, etc.) is seeing everything at once.

**No experience-level segmentation in the UI.** The AI calibrates plan difficulty from intake (current fitness, prior experience, time available, target date). No "beginner mode" or "expert mode" surface. Experience-level handling is the AI's job, not the product's segmentation.

**Per-goal intensity ships in MVP as a *quiet* feature.**
- Originally deferred to v2. Reversed during planning review.
- Reason: v3 partner matching needs per-goal intensity data from day one. Matching a "brutal-on-Mont-Blanc" user with another "brutal-on-Mont-Blanc" user is meaningful; matching by global intensity is noise.
- Design constraint: goal-detail intensity defaults to "Follows your account preference" with user's global intensity shown in muted text. Users who don't override never see a divergence. Casual users get the simple mental model; power users get the override.

**Safety pushback on unrealistic/dangerous goals.** AI flags concerns conversationally with reasoning and a safer alternative. User can override; the AI's concern is on record. No hard refusals.

---

## Downgrade and cancellation

**The downgrade-and-archive screen is the only barrier between user and cancel button.**

- Mechanic: user with more goals than target tier allows must choose which to archive before cancellation completes. Archived goals are fully restorable on re-upgrade.
- Framing: not an error screen, no red styling, no "are you sure?" interstitials. Routine step in a legitimate flow.
- Compliance: click-to-cancel regulations (FTC in US, EU consumer protection) require cancellation be as easy as signup. Putting an error-coded barrier in the way creates regulatory and reputational risk.
- Stripe Customer Portal is *not* used for cancellation because it adds its own confirmation UI, which would violate the "only barrier" requirement. Portal is used only for payment-method updates and invoice history.

**Account deletion is distinct from cancellation.** 30-day soft-delete grace period (recover by logging in), then background job hard-deletes. Also handles Stripe customer cleanup so no orphaned records or accidental email contact with deleted users.

---

## Competitive landscape

**Waypoint** (App Store, March 2026 launch): direct concept overlap — AI-generated roadmaps from a goal, broken into milestones. Reviewed internally (assessment in internal notes). Validates the space without threatening differentiation. Strix beats it on equipment-linked-to-milestones, weekly check-ins with structured replan, safety pushback, mentor in v2, and unified cross-goal dashboard.

**Ultiself** (326K+ users, $19 premium): adjacent not direct. Habit-first ("pick habits to improve mood") with a fixed library of 250+ pre-built habits. Strix is goal-first ("I want to climb Mont Blanc — generate the plan") with custom AI-generated plans. Positioning line: see internal notes.

**Habit-tracker namespace generally:** extremely crowded. Every short evocative discipline-coded word is taken (Forge, Grit, Commit, Ascend, etc.). This is why Strix exists — non-habit-tracker vocabulary, less saturated.

---

## V2 / V3 roadmap intent (not committed)

**V2 priorities (in rough order):**
1. Notifications (web push initially, native push after Expo port). Smart timing alerts ("order crampons now — shipping takes 7-10 days").
2. AI mentor — persistent persona, adjusts tone and intensity based on user history. Max-tier exclusive.
3. Native mobile (Expo). Triggered by notifications becoming the priority.

**V3+:**
- Partner matching — opt-in feature connecting users pursuing similar goals in similar places. Hiking partner for the weekend, long-run partner for marathon block, writing accountability buddy. Uses the structured location and activity_type fields captured in MVP intake (SPEC.md §7A) — this is why those fields exist now even though they're not user-facing yet.

---

## Planning revision (2026-05)

**Intensity suggestion at intake.** The flat `challenging` default planned for Phase 0 was miscalibrated for long-timeline goals (a 3-year marathon shouldn't default to challenging). Suggestion-with-explicit-confirmation preserves user ownership of the intensity lever (original SPEC §8 intent) while fixing the bad-default problem. Spec-compliant because the AI suggests, the user actively chooses, and it's never silent or auto-applied. The intake flow now elicits a starting intensity and the user picks `comfortable/challenging/brutal` before plan generation. `challenging` remains as a final fallback only if intake completes without a pick.

**Trial-cancel archival timing.** The user makes the archive decision at cancel-click via the downgrade-and-archive screen, but execution is deferred to trial-end so Max access is preserved through the trial week (SPEC §10). The pending selection is reversible — resuming Max before trial-end discards it. At trial-end the deferred selection executes automatically with no new prompt. Recorded here so it isn't "simplified" back into either archive-at-click (violates §10:149) or decide-at-expiry (ambushes the user). The pending state lives in `subscriptions.pending_archive_goal_ids` (jsonb array) + `subscriptions.pending_archive_decided_at`.

**Trial-end is two paths, not three.** SPEC §10 says plainly: "if the user hasn't canceled, the card is charged and they continue on Max." Silent trial expiry is a CONVERSION, not a downgrade — there is no "trial_expired_no_action archive heuristic" for users who simply did nothing. They wanted Max, they got Max. Path 1 (no cancel): `customer.subscription.updated` to `active` → `trial_converted`, all goals stay active, no archive. Path 2 (canceled during trial): `customer.subscription.deleted` after period end → `applyPendingArchive` with `archive_reason='downgrade_selection'`. An earlier revision conflated the silent-expiry case with archive-fallback logic, contradicting the spec; corrected here.

**Payment-failure path (distinct from silent expiry).** A separate, rare third case: if the trial-end charge fails (card declined / expired / insufficient funds), Stripe enters Smart Retries dunning over several days while we surface a non-threatening "update your card" banner. Stripe sends card-update emails directly; we don't duplicate. If the customer updates their card and a retry succeeds, the path collapses to a normal `trial_converted`. Only if dunning exhausts (Stripe gives up) does `customer.subscription.deleted` fire with `cancellation_details.reason='payment_failed'` — and only then does `applyPaymentFailureArchive` run, picking the 3 goals to **keep** by `last_completion_at DESC NULLS LAST, created_at DESC` (the activity heuristic; `created_at` is the fallback when no goal has completions). The rest archive with `archive_reason='trial_expired_no_action'`. PostHog `subscription_canceled { reason: "payment_failed" }`. Recorded so the rare-but-real payment-failure case isn't mistaken for the silent-expiry case during future spec passes.

**Activity heuristic uses a 30-day window.** `applyPaymentFailureArchive` ranks goals by `last_completion_at` within the last 30 days only, not all-time. An old goal with stale completions shouldn't outrank a freshly active one. Goals with no completions in the 30-day window collapse to `created_at DESC`, same as goals that have never had a completion. Keeps the heuristic responsive to recent intent without being thrown off by historical noise.

**Archived-goal reactivation rebases via replan.** Restoring an archived goal does not flip it back to `active` with stale past target dates — that would invalidate the entire plan. Restore opens the existing replan flow with `trigger='structural_edit'` and a reactivation payload; the AI proposes shifted milestone/equipment dates relative to `now()`; the user reviews and approves. Consistent with SPEC §8 "AI proposes, user approves." Counts against the monthly replan cap for Free users.

**Medical disclaimer on plan review for physical/fitness goals.** When the intake's `activity_type ∈ {climbing, mountaineering, running, cycling, swimming, strength}`, the plan review screen surfaces a single-line disclaimer in the Patagonia register: "This plan is generated guidance, not medical advice. Check with a physician before starting a demanding physical program." Quietly placed under the plan header, not a modal interstitial, no acknowledgment required. Reduces liability without theatrical hedging. Recorded so a future "Phase 5 copy pass" doesn't quietly remove it.

**Goal pause removed from MVP.** SPEC §5 originally listed `paused` as a fourth goal status alongside active/completed/archived; no MVP phase used it (no pause UI, no rule for what paused dashboard rows do). Removed from the enum entirely (`scripts/verify-schema.ts` asserts its absence; adding the value back is a one-line `ALTER TYPE … ADD VALUE` whenever it's actually needed, so pre-adding buys nothing). If the product needs pause later (a "vacation mode" feature, say), reintroduce as a deliberate v2 addition with explicit semantics — **and unpause must re-run the tier-cap check**: only active goals count against the cap (SPEC §5), so pause-3 / create-3 / unpause-3 would otherwise put a Free user at 6 active goals. Pause is a cap-evasion vector unless reactivation is gated exactly like goal creation. Cleaner schema beats vestigial states. (Note: `subscription_status` does contain `'paused'` — that's Stripe's own status vocabulary mirrored locally, unrelated to goal pause.)

## Planning revision (2026-06) — post-Phase-0 external review

A 23-edit external plan review, critiqued and then adversarially verified by a second-opinion agent fleet, produced this pass. The decisions that came out of it:

**Check-in skip is recorded as `'skipped'`, never as `'right'`.** Skips are not sentiment data — writing `'right'` on skip would pollute the feeling signal the replan AI and analytics read. `'skipped'` is a fourth `weekly_feeling` enum value, written only by the skip path and excluded from every feeling-signal query; `first_weekly_check_in_completed` fires on the first *non-skipped* row. A skip writes a real `weekly_check_ins` row (not a PostHog-only event) because the Friday prompt needs dismissal state for the week and a later real submission upserts over it cleanly.

**Deleted-event routing is reason-keyed, with a superseded marker.** `customer.subscription.deleted` fires for *every* immediate cancellation, so the local `cancel_at_period_end` flag cannot identify payment failure (every immediate cancel has it false). Routing order: superseded rows (tier transitions — `subscriptions.superseded_at`) sync status only; payment failure keys exclusively on Stripe's `cancellation_details.reason='payment_failed'`; user-cancel keys on local `cancel_at_period_end=true` and not superseded; everything else (refund downgrade, account deletion) is plain sync with no archive job. Without the superseded marker, a Max→Pro transition's deleted event would race the Pro created event and could archive a paying customer's goals down the payment-failure path.

**`subscription_canceled` fires once, at the cancel-click decision moment — scoped to user-initiated cancellation.** The trial-end execution of a deferred cancel does not re-fire it (that was a double-count); the `payment_failed` variant still fires at dunning exhaustion, which involves no click. `billing_period` rides on the click-time fire. Cancel-then-resume users fire `subscription_resumed`; churn analysis nets the two.

**Account deletion refund handling, per billing state.** Annual subscribers within the 30-day refund window (and actually charged — trials excluded) get an automatic prorated refund at soft-delete click with the subscription canceled immediately; recovery restores them at Free. Past the window, remaining time is forfeited and the deletion copy says so plainly. Monthly is unchanged (`cancel_at_period_end`; the period resolves within the grace window). Rationale: the old blanket "canceled at end of billing period" copy was impossible to honor — the day-30 hard delete's `stripe.customers.del` force-cancels everything — and deletion must not silently punish annual subscribers relative to cancellation, where the refund button exists. Stripe-first hard-delete rationale is preserved: by day 30 nothing carrying paid time is left to orphan.

**Recovery is reconciliation, not a flag flip.** During the 30-day grace, Stripe webhooks for soft-deleted users **sync billing state but suppress side-effects** (no archive jobs, banners, emails, or analytics — a blanket no-op was rejected: events are idempotency-logged before processing and thus unreplayable, so suppressing state sync would leave a day-25 recoverer with a phantom paid tier forever). Recovery clears `deleted_at`, re-syncs `subscriptions.status`/`users.tier` from Stripe, discloses any pending `cancel_at_period_end` (never silently resumes it), and routes an over-cap recoverer through the downgrade-and-archive selection screen.

**Recorded deviation from SPEC §10:150** ("present the same selection screen at the moment of expiry, not after"): the shipped model is decide-at-click + execute-at-expiry (flag #5), with `applyPendingArchive` defensively re-validating the active count at expiry and heuristic-archiving down to cap (reason `downgrade_selection`, tagged `heuristic: true`) for goals created after the click — the user is absent at expiry, and re-prompting was rejected as decide-at-expiry ambush. The selection *screen* does appear wherever the user is actually present: at cancel-click, in the refund flow, and at account recovery. This trades the spec's literal wording for its intent (no cap violation, no ambush, user choice wherever a user exists).

**Quota increments are refunded on AI failure — with a floor.** `checkAndIncrement` runs before the Anthropic call (concurrency-safe by construction); a failed call decrements the same period row so a 502 doesn't burn Free quota. The decrement is guarded `> 0` (no DB CHECK exists; a negative counter would grant quota silently), and repeated validation-class failures are rate-limited rather than refunded unconditionally — model output is prompt-influenced, and unconditional refunds convert the cap into unlimited failed Anthropic spend.

## Lighthouse PWA gate superseded → installability criteria (2026-06-13)

Phase 2.5 formal gate 4 "Lighthouse PWA score ≥ 90" became unmeasurable: Google removed the Lighthouse PWA category in v12 (May 2024), confirmed absent in the installed Lighthouse 13.4.0 (no `pwa` category; the former PWA audits return "not in this version"). Replaced by an explicit installability-criteria gate — manifest `errors:[]` + required fields + maskable icons; SW with a fetch handler; HTTPS; no DevTools → Application → Manifest installability warnings; successful real-device install. Faithful to the original intent, no coverage lost; user-perceived speed remains covered by the cold-launch < 2.0s device gate. Canonical definition: planning/phase-2.5-pwa-polish.md gate 4; PLAN.md and phase-5 reference it. Local pre-check 2026-06-13: manifest `errors:[]`, all fields + maskable icons present, `/sw.js` served — PASS pending HTTPS + device confirmation.

## Visual register (2026-06)

**DAWN replaces the earth-tone documentary palette sketched in SPEC §4.** SPEC §4 locked the brand *register* (Patagonia/Arc'teryx documentary, serious about long patient effort) and explicitly left specific palette and type to the design phase. That decision is now made: **DAWN** — an atmospheric, illustrated identity. Gradient dawn/dusk skies over terrain silhouettes, rendered as a pure inline-SVG/CSS illustration system (no raster, no Lottie, no stock packs); Fraunces (display) + Hanken Grotesk (body); a minimal geometric owl emblem. SPEC §4 and this log are amended in the same slice (doc parity); the full system lives in `docs/DESIGN.md`.

**Why.** The earlier sketch (earth tones / deep blues / off-whites + documentary *photography inside the product*) risked the template "vibecoded app" look. DAWN buys distinctiveness through an illustration-led brand and a **semantic** time-of-day system (pre-dawn = empty/"nothing started"; dawn = in progress; sunrise = completion), so the atmosphere *means* something rather than being decoration. The register *behaviors* from SPEC §4 all survive: copy stays declarative and plain, the AI coaches rather than cheerleads, there is **no gamification**, and the single celebratory moment stays **quiet and confetti-free** — now rendered as a sunrise over the goal's scene + a "Well done." line (the goal-completion celebration in SPEC §6 / PLAN phase-2). Photography guidance in SPEC §4 is retained but **re-scoped to marketing only** — the product UI itself carries no photography.

**Mechanics.** Chrome polarity (light vs. dark primary) and accent temperature (amber vs. coral) are resolved by **user curation of three real rendered variants** (V1 Dusk / V2 Pale Dawn / V3 Slate-Coral) on a throwaway playground route, then minted **once** into `globals.css` and frozen. The goal-attribution palette (SPEC §8 visual attribution) becomes **5 dawn-derived hues**, always paired with goal-name text so color is never the sole signal. Recorded so a future pass doesn't "restore" the earth-tone wording or treat the curation tokens as already-frozen.

**Curation completed (2026-06-10) → V1 Dusk minted.** The user picked **V1 — Dusk (dark · amber)** as canonical; tokens are now **dark-primary by default** in `src/app/globals.css` and **DESIGN.md is FROZEN** (re-minting requires a new design decision + DESIGN.md + this log). Rationale: a sunrise needs a dark base to rise from, usage clusters at the dark ends of the day, the owl/nocturnal brand logic wants a night ground, and amber carries first-light semantics; coral read too alert-adjacent for the calm register. **V2 Pale Dawn is reserved for the future light-mode slice** (with two on-white contrast corrections recorded in DESIGN.md §2: warning amber ≥4.5:1, goal-dot amber ≥3:1). **V3 Slate-Coral is reserved as a candidate coach-temperament colorway** (§12), expressible over the existing `--scene-*` props — the losing variant is a future option, not waste. Same slice also fixed the brand-face wiring app-wide (Fraunces/Hanken via corrected `@theme inline` font tokens) and removed the now-obsolete playground font bypass.

**App icon curated (2026-06-12) → V6a "Night Watch — flat" minted.** Three rounds of rendered candidates on the throwaway `/playground/icons` surface (round 1 emblem-derived V1–V3, round 2 owl-forward V4–V6 after the emblem seed read as a blob at icon size, round 3 V6 ground refinements V6a–V6c judged at true 60px on a mock home screen). The user picked **V6a**: tufted owl-head silhouette, solid amber eyes, flat `#0a1121` dusk ground. Engineer-flagged design-system delta (recorded in DESIGN.md §10): the head uses **non-token elevated dusk `oklch(0.26 0.04 264)` → `#1a2438`** because `--card` (`0.225 L`) lacks separation against `--background` at icon scale — it fails the 60px squint test, verified at true size. Icon-only value, not a new token. The wired set is emitted by `scripts/generate-icons.mjs` (`WIRED_VARIANT = "v6a"`); the manifest and layout reference only canonical filenames, so the swap touched no references.

**In-app mark aligned to v6a (2026-07-19) → icon↔emblem divergence superseded.** At the v0.5.0 device demo the project lead flagged that the app still rendered the round-1 perched-owl seed emblem (the old `Emblem`), and decided the in-app brand mark must be the same owl as the icon — **V6a "Night Watch"**. `src/components/emblem.tsx` now renders the v6a head/eye/beak geometry (verbatim from `generate-icons.mjs`), replacing the 2026-06-12 "emblem stays the in-app mark" divergence recorded above. The **fills** are re-locked for context, not re-minted: the icon (large, opaque, own flat ground) keeps v6a's dark head + solid amber eyes; the in-app mark is a small (~24–40px) *bare* silhouette over live scenes + the offline `--background`, where a dark head vanishes and solid amber eyes wash out — so in-app it uses the **dark-surface lockup of the same owl** (light head in the body token, dusk eye-sockets, amber irises, amber beak; the treatment round-3 explored as "v6b"), keeping amber the single point of heat and ≥3:1 legible (§11). No new tokens; PWA icons/manifest/`generate-icons.mjs` output untouched (Gate-4 evidence stays valid). Full rationale + the seed-grammar (§12) note in DESIGN.md §10 "In-app mark aligned to v6a".

**Deferred (owner's call, 2026-06-10).** A **coach-temperament roster** with a **visible choosing ritual** (assessment → "meet your coaches" → user picks a visually distinct, grammar-native geometric owl coach — never a cartoon mascot) is parked to a **post-base phase, naturally the v2 AI mentor lane (Max-tier)**. Rationale: Rise built its "AI Expert" tier (~$29.99, late 2025; multi-coach, voice-differentiated, with a real visual choosing phase) *on top of* an already-finished product — it is a premium layer, not base. Strix builds the base first. The decision needs a **product-architect pass** before it ships; per-goal intensity stays a quiet feature regardless (any temperament system must be account-level). What is preserved at zero cost now: the owl emblem is specced as the **seed** of that future owl-form construction grammar, and temperament colorways must remain expressible over the existing scene tokens — both verified at design review.

## Production deploy + v0.5.0 reframing (2026-06-13)

**The deploy decisions are frozen in [ADR-0002](adr/0002-production-deploy.md); this is the pointer + the one reframe the rest of the docs depend on.** Read the ADR for the full contract (env surface, code slices, provisioning runbook, rollback).

**v0.5.0 certifies native-feel on a PREVIEW, not production.** The device matrix and the gate-4 installability check (gate 4's HTTPS/DevTools half) run on a `*.vercel.app` **preview** backed by a Clerk **dev** instance — Clerk prohibits production keys on `*.vercel.app`, and dev-on-preview is Clerk's documented recommendation. The **production standup** — custom domain + Clerk **prod** instance + prod Neon + prod PostHog + Stripe — is **Phase 3** (the prod cutover, tracked in issue #70 and gated by the Phase-3 commerce exit gate in LAUNCH_CHECKLIST.md). So nothing here calls v0.5.0 a "production deploy" or stands up a custom domain now.

**Deploy target = Vercel; DB = Neon serverless Postgres (US West, `us-west-2`).** Runtime `DATABASE_URL` is the Neon **pooled** host; schema migrations run **manually by the owner** against a dedicated `DIRECT_DATABASE_URL` (the **direct**, non-pooled host) via `pnpm db:migrate` — **never** in the Vercel build (a build must not mutate the schema). Functions pinned to region **`pdx1`**, co-located with the reused Neon `us-west-2` DB and the operator's US-West location (PostHog US ingestion is region-agnostic). The preview uses **ONE shared preview Neon DB** (a separate project from the future prod DB), **not** branch-per-preview (it must be migrated against the direct host + seeded before the matrix). Inngest via the official **Vercel integration**; PostHog **US** (a separate preview project to keep matrix events out of prod funnels).

**Auth: embedded Clerk components replace the hosted Account Portal.** `app/sign-in/[[...sign-in]]` and `app/sign-up/[[...sign-up]]` render `<SignIn/>` / `<SignUp/>`, with `NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and `NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, so `redirectToSignIn()` and the middleware route in-app and email/password auth stays on-origin (no PWA standalone pop-out). Cosmetic appearance/localization is deferred to Phase 5.

**Two security/footgun invariants worth surfacing here:** `INNGEST_DEV` **must be ABSENT in every Vercel scope** — if truthy, `/api/inngest` skips signature verification and the cron triggers become world-callable (verify with an unsigned POST → 401). And `STRIX_BUILD_ID` is **build-injected** by `serwist build` from `.next/BUILD_ID`, **not** a Vercel env var (an env var would never reach the service-worker bundle). Do **not** enable Vercel **Deployment Protection** — it gates the whole origin and breaks the clean-install gates.

## What is intentionally *not* in MVP

- Push notifications.
- Mentor / dynamic intensity tuning.
- Native mobile.
- Social features, sharing, community, partner matching.
- Streaks, gamification, leaderboards, user-facing analytics dashboards.
- Budgeting beyond a per-item cost field.
- Multi-user collaboration on a single goal.

If a planning agent or implementation session quietly slips any of these in, that's drift — push back.
