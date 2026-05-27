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

## What is intentionally *not* in MVP

- Push notifications.
- Mentor / dynamic intensity tuning.
- Native mobile.
- Social features, sharing, community, partner matching.
- Streaks, gamification, leaderboards, user-facing analytics dashboards.
- Budgeting beyond a per-item cost field.
- Multi-user collaboration on a single goal.

If a planning agent or implementation session quietly slips any of these in, that's drift — push back.
