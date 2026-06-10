# Strix — Product Spec

A product spec, not a technical spec. The planning agents downstream decide framework, database, file structure, schema, and build sequence. This document defines what the product is and how it should behave — anything below that line is intentionally open.

---

## 1. Problem

People set big goals (climb Mont Blanc, learn Spanish, run a half marathon) and abandon them because they can't translate the goal into a credible plan of daily, weekly, and milestone-level work. Existing to-do apps don't generate the plan. Existing coaching apps don't show multiple goals in one view.

## 2. Solution

A goal-tracking app where the user describes a big goal in plain language, an AI agent interviews them to understand their starting point and constraints, and the system generates a structured plan covering daily habits, weekly sessions, milestones, and required equipment. All active goals roll up into a single Canvas-style "what do I do today" view.

## 3. MVP scope

- A tier-based limit on **active goals** per user (3 on Free, 5 on Pro and Max — see §10).
- Each goal has **daily tasks** (recurring), **weekly tasks** (recurring, scheduled to a specific weekday), **milestone tasks** (one-off, dated), and **equipment items** (one-off, dated, optionally with cost).
- A **unified dashboard** showing today + this week + upcoming, across all goals, with clear visual attribution back to the parent goal.
- A **per-goal page** for planning, reviewing, and adjusting one goal in isolation.
- An **aggregated equipment page** showing every gear/shopping item across goals, ordered by urgency.
- A **weekly check-in** that captures how the past week felt and lets the AI propose plan adjustments.

## 4. Target audience and brand positioning

### Primary audience

People pursuing ambitious goals that require sustained effort over months — most visibly physical and athletic goals (climbing Mont Blanc, running a half marathon, landing a snowboard backflip), but the product equally serves any major effortful goal (writing a novel, learning a language, building a business, learning an instrument).

**The product does not segment by experience level.** First-time marathoners and seasoned athletes use the same product. The AI calibrates plan difficulty from the intake interview (current fitness, prior experience, available time, target date) and the intensity preference. There is no "beginner mode" or "expert mode" in the UI — experience-level handling is the AI's job, not the product's segmentation.

### Marketing emphasis vs. product breadth

Marketing visuals and copy lean into the physical/athletic framing because it gives the product a distinctive visual identity and clear emotional center of gravity. Marketing examples and onboarding tiles can show summits, races, hikes, ski lines. But the product itself is universal — a user pursuing a non-physical goal should feel welcomed and well-served by the actual experience, not tolerated. Welcome them quietly; lead the marketing with the loudest examples.

### Brand register

Serious / documentary — the territory of Patagonia, Arc'teryx, and Uphill Athlete, not Nike or Red Bull. The product is about long patient effort toward something hard, not about peak moments. The brand voice respects that.

Concrete implications the planning agent and any future design work should honor:

- **Photography and visual language:** real effort in real conditions. Alpine ridges, runners in winter rain, climbers at dusk, novelists at a 5am desk. Not finish lines, not flexes, not stock motivation. (This guidance governs **marketing** photography; the product UI itself is illustration-led — see below.)
- **Copy voice:** declarative, plain, low on exclamation. "18 days to Mont Buet. Order crampons by Friday." Not "Crush it!"
- **Color and typography:** a dawn-atmospheric palette — deep indigo/dusk grounds and pale dawn neutrals with warm sun accents (amber/coral family); a soft-modern serif display paired with a humanist grotesk body (Fraunces + Hanken Grotesk), with weight and restraint. Not neons, not sport-script. Specific tokens live in docs/DESIGN.md.
- **Product visual identity is illustration-led:** the in-product surface is built from bespoke atmospheric SVG scenes (gradient dawn/dusk skies, terrain silhouettes) plus a minimal geometric owl emblem. No mascots; no photography inside the product (the photography guidance above is marketing-territory direction).
- **Tone in the AI flows:** the intake and replan flows speak in this register too. Coaching, not cheerleading.

*Amended 2026-06-10: the palette/typography direction is superseded by the DAWN visual system — see docs/DESIGN.md and docs/DECISIONS.md. The brand register, voice, marketing-photography guidance, and audience framing above are unchanged.*

## 5. Conceptual model

This describes the entities that exist in the product. Schema design (types, indexes, normalization, soft-delete patterns) is left to the planning agent.

- A **user** has many **goals**. Max active goals is tier-dependent (3 Free, 5 Pro/Max).
- A **goal** has a **status** (active, completed, archived). Only active goals count against the tier cap.
- A goal has many **recurring tasks** (each with a cadence: daily or weekly), many **milestones** (dated waypoints), and many **equipment items**.
- An **equipment item** may be linked to a specific milestone. When it is, its deadline is derived from that milestone. When it isn't, the AI sets a standalone deadline.
- **Task completions** are tracked over time so the system knows what was done and when. This drives progress, replanning, and (later) streaks.
- A **weekly check-in** belongs to a user and captures their subjective experience of the past week ("too easy / right / too hard") plus free-text notes. It's the input to the replan flow.

## 6. Core screens

Routes and component organization are left to the agent. These are the user-facing surfaces and what they do.

- **Dashboard.** Default landing surface. Today's tasks + this week's tasks + upcoming milestones/equipment, all goals mixed together. Every task row shows which goal it belongs to via a colored indicator. Tap a task to expand detail; tap a goal to deep-dive. Once the user has any completed goals, an "Accomplished" section appears showing their wins — a retention surface.
- **Empty-state dashboard.** For users who haven't created any goals yet, the dashboard shows one primary CTA ("Create your first goal") with 4–5 example goal tiles below (climb a mountain, learn a language, run a race, write a book, learn an instrument). Clicking a tile pre-seeds the intake chat but still runs the full interview. No multi-step tour — the intake chat *is* the onboarding.
- **Goals list.** Grid of active goals with progress, target date, and next milestone. Completed goals shown in a "Completed" section below. Archived goals collapsed below that. "Add new goal" tile present when the user is below their tier cap.
- **Goal detail.** One goal in full. Sections for daily habits, weekly sessions, milestones, and equipment, each fully editable (add, remove, reschedule). An "Adjust plan" action that triggers a replan. Manual structural changes (adding a milestone, shifting the target date, removing a recurring task) prompt a small "want me to update the rest of your plan?" replan offer — user-initiated, never automatic.
- **Goal completion.** When a user marks a goal complete, a brief celebration moment is shown. The goal moves to the "Completed" section automatically and auto-archives after 7 days. Completed and archived goals never count against the active-goal cap.
- **Equipment.** Single list across all goals, grouped by urgency (this week / this month / later). Each row shows the parent goal, the deadline, optional cost, and a purchased checkbox.
- **New goal.** Conversational intake (see §7). Produces a draft plan the user reviews before committing.
- **Settings.** Display name, timezone, intensity preference. Account management (subscription, data export, account deletion) lives here — see §10.

## 7. AI flows

Three flows. The agent decides API structure, streaming vs. one-shot, model choice, and where prompts live. What follows is the **behavior**, not the implementation.

### A. Goal intake

A conversational chat that interviews the user to gather what's needed to plan well. The shape of the questions varies by goal type — climbing needs different questions than language learning — so the AI leads, asking 1–2 questions at a time.

It must establish: a clear one-sentence version of the goal, the user's honest starting point and prior experience level (this is what drives intensity calibration), their constraints (days per week, time per session, budget, location), the target date, and any safety-critical knowledge gaps the goal might involve.

**Structured fields, not just prose.** The intake summary must capture **location** (city/region) and **activity type** (climbing, running, language learning, writing, instrument, business, other) as structured fields, even though the conversation feels free-form. These aren't user-facing in the MVP, but they're required for v3+ features like partner matching (§12). Designing the schema to support this from day one avoids a future migration.

**Safety and realism pushback.** During or after intake, the AI assesses whether the stated goal-and-timeline combination is safe and realistic. If it identifies meaningful risk — rapid weight loss, untrained physical extremes, dangerous mountaineering without prerequisites, anything where the stated plan could plausibly cause harm — it pushes back conversationally, explaining the concern and proposing a safer alternative ("20 lbs in 2 weeks isn't safe — here's why, and here's a 2-month version that gets you to the same place"). The user can override and continue; the AI's concern is on the record. No hard refusals. The user is the decider.

The output is a structured summary attached to the goal. The user confirms before moving on.

### B. Plan generation

Takes the intake summary and produces a complete draft plan: daily habits, weekly sessions, milestones, and equipment with deadlines. Equipment items should be linked to the milestones they're required for, so deadlines are derived sensibly. The plan is calibrated to the user's intensity preference and starting point — realistic, not aspirational.

The user reviews and edits the draft in the UI before it's committed. Nothing saves silently.

### C. Replan

Triggered two ways: (1) the weekly check-in, and (2) user-initiated structural edits in the goal detail view. Input: the goal, recent completion history, and either the check-in feedback ("too easy / right / too hard" + notes) or the structural change the user just made. Output: proposed deltas to recurring tasks and milestones, presented as a diff. The user accepts, edits, or rejects.

**The AI proposes; the user approves.** Never silently rewrite the plan. This is a core product decision.

## 8. Key product decisions

These are intentional, not defaults. The planning agent shouldn't quietly drop them.

- **AI proposes, user approves.** Every AI-generated change — initial plan, replan, equipment adjustments — is reviewed before it lands. No silent rewrites.
- **Equipment is milestone-linked.** Gear isn't a flat shopping list; it has a deadline derived from when it's needed.
- **Unified view is the default.** New users land on the cross-goal dashboard, not on a single goal. The product's distinct value is in seeing everything at once.
- **Visual attribution is consistent.** Each goal has one color, assigned at creation, used everywhere it appears (dots, progress bars, milestone icons). Up to 5 active goals → 5 distinct colors from a fixed palette.
- **Intensity is user-set.** A preference ("comfortable / challenging / brutal") that the AI honors when generating and replanning. During intake, the AI may suggest a starting intensity based on the goal and timeline, but the user must explicitly confirm or change it — never inferred silently, never auto-applied. Don't auto-tune intensity from behavior in MVP.
- **Active-goal cap is tier-based, not user preference.** 3 on Free, 5 on Pro/Max. Hard limit; the user can't have 6 active goals.
- **No experience-level segmentation in the UI.** The AI handles calibration via intake. There is no beginner/expert split in the product surface.
- **The AI flags unsafe and unrealistic goals.** Soft pushback during intake with reasoning and an alternative. User can override. The AI never refuses outright.
- **Sonnet 4.6 quality across all tiers.** Free users get the same AI quality as paid — the difference is volume of AI-heavy operations (§10), not capability.

## 9. Quality bar and instrumentation

If a real user can do all of the following without friction, the MVP is done.

1. Sign up and create their first goal via chat in under 5 minutes.
2. Review and edit the AI-generated plan before saving it.
3. Open the app the next morning and see their day clearly without scrolling past noise.
4. Check off tasks; see them strike through.
5. Open Friday's check-in, see a proposed adjustment, accept it.
6. Install to home screen on iOS or Android and have it feel native enough to forget it's a webpage.

**Instrumentation.** Quality is unmeasurable without tracking. Instrument the following funnel from day one: signup → first goal created → intake completed → plan generated → plan accepted → first task checked → first weekly check-in completed → first replan accepted. Also: trial started, trial converted, subscription started, subscription canceled, account deleted, free-tier cap hit (which cap, which goal). The analytics tool (PostHog, Mixpanel, Amplitude, etc.) is the planning agent's call, but the event taxonomy is spec-level.

## 10. Business model and operational constraints

These are constraints the planning agent should design within, parallel to the product decisions in §8. They affect schema (tier tracking, usage counters), AI architecture (model choice, caching), and what gets gated where.

### Tiers

- **Free.** Up to **3 active goals**. Capped AI usage (see below). All core product features work — dashboard, per-goal page, equipment, weekly check-in.
- **Pro.** Up to **5 active goals**. Unlimited AI usage.
- **Max.** Up to **5 active goals**. Unlimited AI usage. Plus the AI mentor (v2 feature; gated to Max from launch even though it doesn't exist yet — schema should support tier-based feature flags).

### Pricing

Monthly default, with a discounted annual option.

- **Pro: $9.99/mo or $89.99/yr** (annual ≈ 25% savings, ~$7.50/mo equivalent).
- **Max: $19.99/mo or $179.99/yr** (annual ≈ 25% savings, ~$15/mo equivalent).

The agent should design billing so prices are config, not hardcoded.

### Trial

- **One-week free trial of Max only.** Pro has no trial.
- **Card required up front.** Higher-intent funnel, better conversion economics.
- **At trial end:** if the user hasn't canceled, the card is charged and they continue on Max. If they canceled during the trial, the account expires to Free at the end of the trial week.
- **Trial-end downgrade.** Users who created 4 or 5 goals during the trial will exceed Free's 3-goal cap at expiry. The downgrade-and-archive flow described below applies — present the same selection screen at the moment of expiry, not after.

### Refund policy

- **Monthly:** no refunds.
- **Annual:** prorated refunds within 30 days of purchase.

Show the policy in the app's billing settings, not just in the terms of service.

### AI model strategy

**Sonnet 4.6 across all tiers, including Free.** Quality is the conversion driver — degrading the free experience to save AI cost would break the funnel. Don't let the agent silently swap in Haiku for free users as a "cost optimization." Haiku is appropriate only for genuinely lightweight calls (classifications, short summaries) that no tier would notice.

### Free tier usage limits

To keep free-tier unit economics sustainable without compromising quality, cap AI-heavy operations rather than degrading them:

- **3 plan generations per calendar month.** Covers creating new goals or fully regenerating plans.
- **2 replans per calendar month.** Weekly check-ins still happen; the AI just doesn't propose changes more than twice.
- **Unlimited intake conversations.** Cheap, and they're how new users experience the product.

Pro and Max have no caps on either. The schema needs per-user monthly counters with explicit reset semantics (calendar-1st or rolling 30-day — agent's call, but document it).

When a free user hits a cap, the upgrade prompt is the path forward. Don't queue the action or silently skip it.

### Downgrade and cancellation flow

When a Pro or Max user with more active goals than their target tier allows tries to cancel their subscription (or their trial ends without a paid conversion), they must choose which goals to archive before the cancellation completes. This is a deliberate product decision, not a retention dark pattern. A few rules govern how it's built so it stays on the right side of that line.

**The mechanic.** If the user has more active goals than their target tier allows (e.g., 5 active goals downgrading to Free's 3-goal cap), present a screen that:

- States plainly what's happening ("Your Free plan supports 3 active goals. You currently have 5. Choose which 3 to keep active.")
- Lists every active goal with a clear "keep active" / "archive" choice
- Provides a primary action to continue with cancellation once the selection is valid
- Provides a secondary action to back out and stay on the current tier
- Reassures the user that archived goals and their full data are preserved and restorable on re-upgrade

**Framing rules.** Not an error screen. No red warning styling, no "error" or "problem" language. This is a routine step in a legitimate flow, and it should look like one. The user did nothing wrong — they're using a feature the product offers.

**Reachability rules.** This is the only barrier between the user and the cancel button. No additional confirmation screens, no "are you really sure?" interstitials, no offers to talk to support before canceling. One screen, then the cancellation proceeds. This matters both for user trust and for compliance with click-to-cancel regulations (FTC in the US, equivalent consumer protection rules in the EU).

**Archived goals must be genuinely restorable.** Archive is a status change, never a delete. All recurring tasks, milestones, equipment, completion history, and intake summaries are preserved. When the user re-upgrades, all previously archived goals are visible and can be reactivated with a single action.

**Post-cancellation comms.** One transactional email confirming the cancellation and explaining how to resubscribe is appropriate. Recurring retention emails after cancel are not. The planning agent should set up the email system with this constraint in mind.

This same flow applies to Pro→Free, Max→Free, and Max→Pro transitions wherever the destination tier's goal cap is exceeded. Max→Pro is a special case: the goal cap doesn't change (both are 5), but the Max-only mentor feature is lost. For that transition, no archive is needed, but the user should be shown what they're giving up before confirming.

### Account deletion and data export

Two distinct concerns. Both must exist. Both live in settings, one tap from the settings landing — visible but not the very first thing.

**Data export.** One-click JSON export of all the user's data: goals, recurring tasks, completions, milestones, equipment, check-ins, intake summaries. Required for GDPR, expected by power users, and useful for the company's own debugging. Available on all tiers — no premium gating.

**Account deletion.** Distinct from subscription cancellation. Deletion soft-deletes the entire account for a **30-day grace period** — the user can recover by logging in within those 30 days. After 30 days, a background job hard-deletes all personal data. The deletion confirmation screen states this timeline plainly.

### Build-time spend posture

During MVP validation, optimize for product quality over infra cost. No artificial caching, no premature edge migration, no model downgrading to save money. The agent should still avoid obviously wasteful patterns (re-running the same plan generation on every page load, fetching all goals on every render) — that's just good engineering — but it shouldn't make architectural sacrifices for cost at this stage.

### Cost-shape awareness (informational)

The planning agent should know the cost structure to design intelligently, even without optimizing aggressively for it:

- **AI dominates.** At meaningful scale, Anthropic API spend will be 80-95% of infra. Database, hosting, auth are rounding errors.
- **Plan generation is the most expensive single operation** (~$0.05 per call with Sonnet 4.6).
- **Replans are the recurring cost driver** for active paid users.
- **Intake chats are cheap** because they're short and conversational.

This shapes where caching, batching, or model differentiation makes sense later — not now, but the agent should leave room.

## 11. Out of scope for MVP

Defer all of these to v2 or later. Don't let the planning agent quietly include them.

- Push notifications and any kind of scheduled outreach.
- Personality-aware mentor / dynamic intensity tuning.
- Native mobile builds.
- Social features, sharing, community, partner matching.
- Budgeting beyond a per-item cost field.
- Multi-user collaboration on a single goal.
- User-facing analytics dashboards, streaks, gamification, leaderboards. (Internal product analytics from §9 *is* in scope.)

## 12. Forward roadmap (directional, not committed)

### V2

- **Notifications.** Daily server-side job that identifies what each user should be reminded of (incomplete daily task, equipment deadline approaching, weekly session not scheduled), pushed via web push or — once native exists — native push.
- **Smart timing alerts.** "Order crampons now — shipping takes 7-10 days and your milestone is in 18 days." Generated daily from upcoming equipment + milestones.
- **AI mentor.** A persistent persona that adjusts tone and intensity based on the user's history and personality. Layered on top of the existing replan flow, not a separate feature. Max-tier exclusive.
- **Native mobile.** Port to Expo / React Native once notifications make the move worthwhile. Reuse data layer, types, and prompts.

### V3+

- **Partner matching.** Optional, opt-in feature that connects users pursuing similar goals in similar places — a hiking partner for the Mont Buet weekend, a long-run partner for marathon training blocks, a writing accountability buddy. Privacy-respecting: opt-in only, granular controls, never automatic. Uses the structured location and activity-type fields captured in intake (§7A), which is why those fields exist in the MVP schema even though they're not yet user-facing.

## 13. Open product questions

The planning agent should surface these and either propose a recommendation or ask. None are blockers for starting, but the answers shape the build.

- Are recurring task completions pre-generated nightly or created on-demand when checked off? Trade-off: pre-generation makes streaks and analytics easier; on-demand is simpler.
- What happens to a missed daily task — silently skipped, or visible as "incomplete forever"? Either is defensible; pick one and apply it consistently.
- Progress percentage formula. Completed milestones over total is the obvious MVP answer; weighted formulas are a refinement.
- How aggressively does the AI ask follow-up questions during intake? Too few → bad plans. Too many → drop-off. Worth testing with real goals before locking down.
- Should monthly usage counters reset on the calendar 1st or on a rolling 30-day window per user? Calendar-1st is simpler; rolling is fairer.
- How are activity-type values constrained — a fixed enum the AI picks from, or free text the AI infers later? Fixed enum is simpler now but limits future expansion; free text is flexible but messier for matching.

## 14. What's intentionally not specified

The following are deliberately left to the planning agents downstream. Don't treat their absence as oversight.

- Framework, language, hosting, database, ORM, auth provider, styling system, component library.
- Folder structure and file organization.
- Concrete schema, indexes, migrations, RLS rules.
- Whether AI calls are server-routed, edge-routed, or client-direct.
- Build order and task decomposition.
- Testing strategy.
- Deployment and environment management.
- Choice of analytics platform (PostHog, Mixpanel, Amplitude, etc.) — the events are spec'd, the tool isn't.
- Choice of billing provider (Stripe is the obvious answer; agent decides).
- Exact color palette, typography choices, and visual design — the brand *register* in §4 is locked; specific design tokens are a design-phase decision.

The only architectural constraint from the product side is the launch target: **mobile-first responsive web (PWA) for MVP**, with a path to native mobile in v2. Anything compatible with that constraint is fair game.
