# Phase 1 — Golden path (the §9 loop, no commerce yet)

**Goal:** A real user can sign up, create a goal via chat, review and edit the AI-generated plan, see today on the dashboard, and check off a task. No payment, no subscription, no full caps yet — but the active-goal cap is clamped to 5 (the highest paid-tier cap) so the 5-color palette doesn't run out.

**Prerequisites:** Phase 0 complete (auth, DB, scopedDb with the soft-delete filter, PostHog, `/settings` shell, signed-webhook handlers).

**Gates:** Phase 2 cannot start until a user can complete steps 1–8 of the verification list without intervention.

### Design-system handoff (added 2026-06-10)

- All Phase 1 UI builds on the FROZEN DAWN system — docs/DESIGN.md is the binding oracle: V1 Dusk dark-primary tokens live in src/app/globals.css (no re-mint); Fraunces + Hanken Grotesk load app-wide from the root layout; the anti-slop banlist (§9), state philosophy (§8), and motion personality (§7) are binding on every surface in this phase.
- REUSE, do not rebuild: src/components/scene.tsx + scene-data.ts, horizon-header.tsx, goal-chip.tsx, countdown-stat.tsx, emblem.tsx, and ui/checkbox graduate from the playground to product surfaces. The empty-state dashboard's 5 example tiles ARE the existing Scene variants (mountain / language / race / book / instrument) rendered in pre-dawn state (DESIGN.md §4); they switch to dawn once a goal exists.
- Graduation requirements (DESIGN.md §11, binding when these components land on product surfaces): interactive targets ≥44×44px (the playground's 16px checkbox / 28px button must NOT be copied as-is); the shared button primitive gains cursor-pointer; one h1 per page.
- The active dashboard is the playground composition graduated: HorizonHeader (dawn state), GoalChip text-paired color attribution (color never the sole signal), tabular-nums countdowns.
- verify:ui currently baselines /playground/dashboard; when the product dashboard ships, extend or re-target the harness — keep the playground (noindexed, Clerk-excluded) until then.

## Items to build

### Empty-state dashboard

- Route: app/(dashboard)/dashboard/page.tsx, serving /dashboard. The default landing for authenticated users (signed-in users hitting / are redirected here). / itself stays the public landing page. (Routing decision 2026-06-10: a page in the (dashboard) group at the root would resolve to /, colliding with the public landing; serving the dashboard at /dashboard and redirecting signed-in users from / keeps / static/SEO-clean for the Phase3 + public marketing/pricing surface.)
- If `count(goals where status='active') = 0`: render empty state. One primary CTA ("Create your first goal") + 5 example tiles: **Climb a mountain · Learn a language · Run a race · Write a book · Learn an instrument**. (Tiles = existing Scene variants — see Design-system handoff above.)
- Clicking a tile navigates to `/goals/new?seed=climb` (and `language`, `race`, `book`, `instrument`). **Seed values are whitelisted server-side to exactly `{climb, language, race, book, instrument}`** — any other value is rejected before being passed to the AI prompt (prompt-injection mitigation).
- Copy register: Patagonia/Arc'teryx. Hero copy is declarative, low on exclamation. No "Crush it" energy. (Final copy pass is Phase 5; first cut must already be in register.)

### Goal intake conversational chat

- Route: `app/(goals)/goals/new/page.tsx (serving /goals/new)`. Streaming chat UI. **All intake state (raw transcript, partial structured fields) is staged in `goal_drafts`** — on first landing, the server generates a random `session_token` (~32 bytes base64url), inserts a `goal_drafts` row keyed by `session_token`, and writes the token to an HttpOnly cookie. Every subsequent request reads the cookie → loads the draft. Drafts expire after 30 days (Inngest sweep handles cleanup).
- Server-side AI route: `POST /api/ai/intake` — accepts message history + seed + draft_id, returns a streaming response. Server-side per-message logging appends to `goal_drafts.raw_transcript` (jsonb append).
- Model: `claude-sonnet-4-6`. System prompt establishes:
  - Patagonia/Arc'teryx voice — coaching, not cheerleading; declarative; plain.
  - Target 4–6 user turns, hard cap 10. Bias toward fewer turns once required fields are filled.
  - Required structured fields to elicit: one-sentence goal, starting point + prior experience (free text), days/week, time/session, budget, target date, **location (city, region, country)**, **activity_type** from the fixed enum (with `other` + free-text label as escape), **suggested_intensity** (the AI's suggestion: `comfortable|challenging|brutal` with brief reasoning).
  - **Safety pushback** (see safety-override flow below): when the stated goal+timeline combination is risky, push back conversationally with reasoning + safer alternative. **Never refuses.**
  - Response format: when the assistant determines intake is complete, it returns a final structured JSON block (via tool use or terminal message) containing all fields above, including its `suggested_intensity` + one-sentence reasoning.
- **Anthropic prompt caching**: the system prompt is large and stable — cache it.
- Location and activity_type extraction: a separate Haiku 4.5 (`claude-haiku-4-5`) classifier runs at the end on the full transcript to canonicalize fields if the Sonnet output is loose. This is the only Haiku usage in the system; it qualifies as a "lightweight call no tier would notice" per spec §10.
- PostHog events: `intake_started { goal_draft_id, seed? }` on first message; `intake_completed { goal_draft_id, turn_count, structured_fields_count }` when the AI emits the final JSON; `intake_turn_count { goal_draft_id, turn_count }` on completion; `intake_drop_off_turn { goal_draft_id?, last_turn }` on navigating away mid-intake.

### Intensity confirmation step

- After the AI returns its final JSON, the UI surfaces a **required confirmation card** before plan generation:
  - Header: "Pick your intensity for this goal."
  - The AI's `suggested_intensity` is pre-selected with its one-sentence reasoning shown ("For a 3-year marathon timeline starting from couch level, comfortable is the realistic call.").
  - Three radio options: **Comfortable · Challenging · Brutal**, each with a one-line description anchored to the goal context.
  - Primary action: "Continue with {selected}" — writes `intake_summaries.suggested_intensity` and `intake_summaries.confirmed_intensity` (the latter being the user's pick), updates `users.intensity_preference` with the user's pick via `scopedDb.updateSelf()`, then proceeds to plan generation. `users.intensity_preference`'s roles are: the **final fallback** in the intensity chain (`goals.intensity_override` → `intake_summaries.confirmed_intensity` → `users.intensity_preference`) and the default shown in Settings. It does **not** anchor future confirmation cards — every goal's card pre-selects the AI's `suggested_intensity` for that goal.
- The user **must pick explicitly** — no auto-proceed, no default-on-skip. If they navigate away without picking, the draft persists and they resume here on return.
- Spec §8 compliance: the AI suggests, the user actively chooses; never silent, never auto-applied.
- Build note (2026-06-10): a narrow product-architect pass at phase kickoff decides whether this card is built as a generic "AI-suggests → user-confirms" ritual component (coach-temperament extension point, DESIGN.md §12) — incorporate its verdict before implementing this card.

### Safety-override flow

- When the AI emits a `safety_flags` entry during intake, the chat UI renders a **decision card** alongside the message:
  - Header (Patagonia register): "We should reconsider {concern}."
  - Body: the AI's reasoning + safer alternative.
  - Two buttons:
    - Primary: **"Use the safer plan"** — sets `safety_flags[i].user_overrode = false`, `decided_at = now()`. Intake continues with the safer alternative as the working goal.
    - Secondary: **"Proceed with the original plan"** — sets `safety_flags[i].user_overrode = true`, `decided_at = now()`. Intake continues with the original; the safety flag stays on record.
  - Neither button is destructive-styled; both are explicit choices. **The user is the decider** (SPEC §7A).
- Override decisions persist to `intake_summaries.safety_flags` at intake completion.

### Plan generation

- Endpoint: `POST /api/ai/plan` — accepts `goal_draft_id`, returns a single (non-streaming) JSON draft plan written to `goal_drafts.plan_draft`. Streaming the JSON would complicate the review UI and the latency is acceptable.
- Model: `claude-sonnet-4-6`. **Anthropic prompt caching enabled on the system prompt** (large + stable, same posture as intake). System prompt:
  - Reads intake summary including location, activity_type, prior_experience, the user's `confirmed_intensity`.
  - Produces: array of daily habits (cadence=daily), array of weekly sessions (cadence=weekly, weekday 0–6), array of milestones (title + target_date + position), array of equipment items (each linked to a milestone where possible; `standalone_deadline` only if not milestone-linkable).
  - Calibration: realistic to the starting point and confirmed intensity, not aspirational. Voice in titles/descriptions matches the brand register.
- PostHog: `plan_generated { goal_draft_id }`.

### Draft-plan review/edit UI

- Route: `app/(goals)/goals/new/review/page.tsx`. Renders `goal_drafts.plan_draft` as editable sections (daily, weekly, milestones, equipment).
- Inline edit per item, add/remove items, reorder via move up/down controls (Phase 1 cut, keyboard-accessible)
- "Save goal" button commits: creates `goal` row (with `started_at=now()`), `intake_summary` row (FK populated at this point — `intake_summaries.goal_id` is set here, not before), plus all child rows in a single transaction; deletes the `goal_drafts` row. Color assignment runs here (see context below).
- **Nothing saves silently.** Going back to intake or closing the tab without saving leaves no `goal` row.
- **Medical disclaimer for physical/fitness goals.** When the intake's `activity_type ∈ {climbing, mountaineering, running, cycling, swimming, strength}`, the review screen surfaces a single-line disclaimer under the plan header: "This plan is generated guidance, not medical advice. Check with a physician before starting a demanding physical program." Patagonia register, factual, no modal interstitial, no acknowledgment required to save. Non-physical activity types (language, writing, instrument, business, study, other) do not surface the disclaimer.
- PostHog: `plan_accepted { goal_id, edits_count }` on save; **`first_goal_created { goal_id, color_index, activity_type }`** when `count(goals where user_id = $userId) = 1` after save.

### Goals list

- Route: `app/(goals)/goals/page.tsx`.
- Active goals: grid of cards showing color dot, title, progress bar (completed_milestones / total_milestones), target date, next milestone title.
- "Add new goal" tile appears when `active_count < tier_cap`. **Phase 1 cap is hardcoded to 5** (matching the highest paid-tier cap) — gated to true tier cap in Phase 3. This keeps the 5-color palette algorithm coherent in Phase 1 (which has no archived goals yet to recycle from). Color of the tile is the first available palette slot — a preview of which color the new goal will get.
- "Completed" section below; "Archived" section collapsed below that (empty in Phase 1; populated by Phase 2).

### Goal detail

- Route: `app/(goals)/[id]/page.tsx`.
- Sections: header (title, color, intensity control), daily habits, weekly sessions, milestones (timeline), equipment.
- All sections editable: add/remove/reschedule items inline.
- **Intensity control**: per PLAN.md §5 flag #2 + flag #6 resolution. When `goals.intensity_override` is unset, the control shows the goal's effective intensity — its intake `confirmed_intensity` — as the active selection, with copy "Follows your intake intensity" (not "account preference": the chain prefers the intake pick). When the user changes it, sets `goals.intensity_override`; `intensity_override` is written **only** on explicit change here, never at goal creation.
- "Adjust plan" button — placeholder in Phase 1 (Phase 2 wires the actual replan flow).
- **Structural-edit replan banner is feature-flagged OFF in Phase 1.** The banner ("Want me to update the rest of your plan?") is gated behind `NEXT_PUBLIC_REPLAN_ENABLED=true`, which is `false` until Phase 2 ships the endpoint. With the flag off, structural edits save normally with no banner. Phase 2 flips the flag on. (Avoids a Phase-1-ship-window dead button per the review.)

### Dashboard (active state)

- Layout: three sections vertically:
  - **Today** — daily tasks for today (across all active goals) + any weekly task whose `weekday` matches today + any milestone or equipment whose deadline is today.
  - **This week** — remaining weekly tasks for the current week + milestones/equipment due this week.
  - **Upcoming** — next 14 days of milestones and equipment.
- Each row: colored dot (goal color) + title + secondary line (goal name). Tap to expand; tap goal name to deep-link to goal detail.
- Task check-off: tap the checkbox → optimistic strikethrough → server action inserts a `task_completions` row with `for_date = today` and `recurring_task_id`. **The server action uses `scopedDb`, whose `task_completions` insert is a single atomic `INSERT … SELECT` that proves the recurring task belongs to the requesting (live) user and derives `goal_id` server-side from the task's parent** — a forged or mismatched id inserts zero rows and throws (prevents forged-task-id DoS and denormalized-goal_id corruption — Phase 0). Unique constraint prevents double-completion.
- PostHog: **`first_task_checked { task_id, goal_id }`** when this is the user's first-ever `task_completions` row.

### Equipment aggregated view

- Route: `app/(equipment)/equipment/page.tsx`.
- All equipment across active goals, grouped by urgency:
  - **This week** — deadline within 7 days
  - **This month** — deadline within 30 days
  - **Later** — beyond 30 days
- Each row: title, parent goal (colored dot + name), deadline (derived from milestone if linked, else `standalone_deadline`), optional cost, purchased checkbox.

## Phase-specific context

### Color assignment

```
On goal creation (Phase 1 cap is 5; no archived goals exist yet):
  used = set of goals.color_index where status = 'active' for this user
  available = [0,1,2,3,4] minus used
  pick min(available)  // always exists since active count <= 5
```

Phase 2 onward (archived goals exist):

```
  used = set of goals.color_index where status IN ('active','completed','archived') for this user
  available = [0,1,2,3,4] minus used
  if available is empty: pick the lowest color_index whose goals are all archived (color recycling)
  else: pick min(available)
```

Reassignment in goal detail is allowed — Phase 1 ships a simple "swap with goal X" picker if needed. Cap of 5 distinct *active* colors per spec §8 is preserved by the algorithm.

### Equipment deadline derivation

```ts
function equipmentDeadline(eq, milestone) {
  if (eq.milestone_id) return milestone.target_date  // must exist
  return eq.standalone_deadline                       // must exist
}
```

Application-level invariant: exactly one is set. Enforce in the save path and in tests.

### Intake prompt structure (sketch)

```
SYSTEM (cached):
  <voice rules: Patagonia register, declarative, plain, no exclamation>
  <pacing rules: 1-2 questions per turn, target 4-6 user turns, hard cap 10>
  <required structured fields: list including suggested_intensity>
  <safety rules: soft pushback with reasoning + alternative; never refuse>
  <intensity suggestion rule: at the end, propose comfortable/challenging/brutal
   based on goal + timeline, with one-sentence reasoning>
  <termination rule: when all required fields elicited, output final JSON block>

ASSISTANT (turn 1):
  <opens on the seed if provided; else opens neutrally>
```

### Plan-generation prompt structure (sketch)

```
SYSTEM (cached):
  <voice rules>
  <calibration rules: realistic to starting_point + confirmed_intensity, not aspirational>
  <equipment rule: prefer milestone-linked deadlines; standalone only if needed>

USER:
  <intake_summary as JSON>
  <intensity = intake_summary.confirmed_intensity>

ASSISTANT:
  <returns single JSON object with daily[], weekly[], milestones[], equipment[]>
```

### Out of scope for Phase 1

- Subscription tiers (caps are clamped to 5 not 999; gated in Phase 3).
- Weekly check-in and replan AI (Phase 2).
- Goal completion celebration + auto-archive (Phase 2).
- Structural-edit replan banner — feature-flagged off (Phase 2 turns on).
- Push notifications (out of MVP entirely per spec §11).
- PWA install (Phase 2.5).

## Verification

End-to-end (manual, mobile viewport):

1. Sign up via Clerk → land on empty-state dashboard with 5 tiles.
2. Visit `/goals/new?seed=evil_payload` → server rejects with 400; navigating via the legitimate tile "Run a race" opens intake with a contextual opener.
3. Complete intake in 4–6 turns. Confirm `goal_drafts.raw_transcript` has the message history and the AI's final JSON includes `suggested_intensity` with reasoning.
4. The intensity confirmation card appears; the AI's suggestion is pre-selected. Pick a different value (e.g., suggestion = `comfortable`, user picks `challenging`). Continue.
5. Plan generation runs → review screen shows daily/weekly/milestones/equipment. Edit one milestone title and one equipment deadline. Click "Save goal."
6. Verify: `goals` row created with `started_at=now()`, `intake_summary` row created with FK populated and `confirmed_intensity='challenging'`, `intake_summaries.suggested_intensity='comfortable'`, `goal_drafts` row deleted. PostHog `first_goal_created` event fired.
7. Land on goals list → see the new active goal with a color, progress bar, target date.
8. Open goal detail → all sections render and are editable. Toggle intensity from `challenging` to `brutal` → goal's `intensity_override` is set.
9. Navigate to dashboard → today's daily task and today's weekly task (if scheduled) show with the goal's color dot. This week's remaining items show under "This week." Equipment items appear in the equipment page grouped by urgency.
10. Check off today's daily task → strikethrough applies, `task_completions` row written, unique `(recurring_task_id, for_date)` prevents double-write. PostHog `first_task_checked` fired.
11. Trigger a safety-flag scenario in intake ("lose 20 lbs in 2 weeks") → decision card appears with safer-alternative + proceed-with-original buttons. Pick "Proceed with the original." Verify `safety_flags[0].user_overrode = true`.
12. With `NEXT_PUBLIC_REPLAN_ENABLED=false`, edit a milestone in goal detail → no banner appears. Save edits normally.

Automated (Vitest):

- Equipment deadline derivation (milestone-linked vs standalone) with both branches.
- Color assignment algorithm produces distinct colors for goals 1–5; algorithm in Phase 1 never reaches the "all archived" branch because cap=5.
- `task_completions` unique constraint rejects double-completion.
- `task_completions` server-action ownership: forged `recurring_task_id` → atomic insert lands zero rows → throws; stored `goal_id` always equals the task's parent goal (derived, not trusted).
- `scopedDb` queries cannot return another user's goals (seeded fixture with two users).
- Intake seed param: known values pass; arbitrary strings reject with 400.
- Intake termination: given a fixture transcript with all required fields elicited (including `suggested_intensity`), the parser produces a valid intake_summary payload.
- Intensity confirmation save: `users.intensity_preference` is updated to the user's pick; `intake_summaries.confirmed_intensity` and `suggested_intensity` are both persisted; the goal's effective intensity at plan-gen is the user's pick.
- Safety-override card persistence: `safety_flags[i].user_overrode` correctly reflects the button clicked.
