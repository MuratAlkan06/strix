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
- $9.99 is the canonical "low-friction sub price" — people approve without thinking. Above $12/mo for personal-use apps is where balking starts.
- Max at $19.99 matches Rise/Fabulous-tier AI-coaching pricing. The mentor is the AI-coaching differentiator and warrants premium positioning.
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

**Waypoint** (App Store, March 2026 launch): direct concept overlap — AI-generated roadmaps from a goal, broken into milestones. Reviewed and judged "AI slop, not polished." Validates the space without threatening differentiation. Strix beats it on equipment-linked-to-milestones, weekly check-ins with structured replan, safety pushback, mentor in v2, and unified cross-goal dashboard.

**Ultiself** (326K+ users, $19 premium): adjacent not direct. Habit-first ("pick habits to improve mood") with a fixed library of 250+ pre-built habits. Strix is goal-first ("I want to climb Mont Blanc — generate the plan") with custom AI-generated plans. Positioning line: "Ultiself helps you choose habits. Strix helps you reach the goals those habits serve."

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

**Goal pause removed from MVP.** SPEC §5 originally listed `paused` as a fourth goal status alongside active/completed/archived; no MVP phase used it (no pause UI, no rule for what paused dashboard rows do). Removed from the enum entirely. If the product needs pause later (a "vacation mode" feature, say), reintroduce as a deliberate v2 addition with explicit semantics. Cleaner schema beats vestigial states.

## What is intentionally *not* in MVP

- Push notifications.
- Mentor / dynamic intensity tuning.
- Native mobile.
- Social features, sharing, community, partner matching.
- Streaks, gamification, leaderboards, user-facing analytics dashboards.
- Budgeting beyond a per-item cost field.
- Multi-user collaboration on a single goal.

If a planning agent or implementation session quietly slips any of these in, that's drift — push back.
