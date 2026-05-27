# Phase 1 — Golden path (the §9 loop, no commerce yet)

**Goal:** A real user can sign up, create a goal via chat, review and edit the AI-generated plan, see today on the dashboard, and check off a task. No payment, no subscription, no caps yet — everyone is effectively unlimited so we can validate the product without commerce noise.

**Prerequisites:** Phase 0 complete (auth, DB, scopedDb, PostHog).

**Gates:** Phase 2 cannot start until a user can complete steps 1–6 of the verification list without intervention.

## Items to build

### Empty-state dashboard

- Route: `app/(dashboard)/page.tsx`. Default landing for authenticated users.
- If `count(goals where status='active') = 0`: render empty state. One primary CTA ("Create your first goal") + 5 example tiles: **Climb a mountain · Learn a language · Run a race · Write a book · Learn an instrument**.
- Clicking a tile navigates to `/goals/new?seed=climb` (etc.) — the seed is a string the intake prompt uses to bias its opening question. The full intake interview still runs.
- Copy register: Patagonia/Arc'teryx. Hero copy is declarative, low on exclamation. No "Crush it" energy. (Final copy pass is Phase 5; first cut must already be in register.)

### Goal intake conversational chat

- Route: `app/(goals)/new/page.tsx`. Streaming chat UI.
- Server-side AI route: `POST /api/ai/intake` — accepts message history + seed, returns a streaming response.
- Model: `claude-sonnet-4-6`. System prompt establishes:
  - Patagonia/Arc'teryx voice — coaching, not cheerleading; declarative; plain.
  - Target 4–6 user turns, hard cap 10. Bias toward fewer turns once required fields are filled.
  - Required structured fields to elicit: one-sentence goal, starting point + prior experience (free text), days/week, time/session, budget, target date, **location (city, region, country)**, **activity_type** from the fixed enum (with `other` + free-text label as escape).
  - Safety pushback: when the stated goal+timeline combination is risky (rapid weight loss, untrained physical extremes, dangerous mountaineering without prerequisites, anything plausibly harmful), push back conversationally with reasoning + safer alternative. **Never refuses.** User can override; the override is recorded in `safety_flags`.
  - Response format: when the assistant determines intake is complete, it returns a final structured JSON block (via tool use or terminal message) containing all fields above.
- Anthropic prompt caching: the system prompt is large and stable — cache it.
- Server-side per-message logging to `intake_summaries.raw_transcript` (jsonb append). PostHog events: `intake_started`, `intake_turn_count` (on completion), `intake_drop_off_turn` (on user navigating away).
- Location and activity_type extraction: a separate Haiku 4.5 (`claude-haiku-4-5`) classifier runs at the end on the full transcript to canonicalize fields if the Sonnet output is loose. This is the only Haiku usage in the system; it qualifies as a "lightweight call no tier would notice" per spec §10.

### Plan generation

- Endpoint: `POST /api/ai/plan` — accepts `intake_summary_id`, returns a single (non-streaming) JSON draft plan. Streaming the JSON would complicate the review UI and the latency is acceptable.
- Model: `claude-sonnet-4-6`. System prompt:
  - Reads intake summary including location, activity_type, prior_experience, intensity_override or user-level intensity.
  - Produces: array of daily habits (cadence=daily), array of weekly sessions (cadence=weekly, weekday 0–6), array of milestones (title + target_date + position), array of equipment items (each linked to a milestone where possible; `standalone_deadline` only if not milestone-linkable).
  - Calibration: realistic to the starting point and intensity, not aspirational. Voice in titles/descriptions matches the brand register.
- Output is **drafted, not saved**. Stored only in client state (or a server-side draft table if we want recoverability — recommended: ephemeral `goal_drafts` table keyed by `user_id + created_at` with TTL).

### Draft-plan review/edit UI

- Route: `app/(goals)/new/review/page.tsx`. Renders the draft as editable sections (daily, weekly, milestones, equipment).
- Inline edit per item, add/remove items, drag-to-reorder for milestones.
- "Save goal" button commits: creates `goal` row, `intake_summary` row, plus all child rows in a single transaction. Color assignment runs here (see context below).
- **Nothing saves silently.** Going back to intake or closing the tab without saving leaves no `goal` row.
- PostHog: `plan_generated`, `plan_accepted` (on save).

### Goals list

- Route: `app/(goals)/page.tsx`.
- Active goals: grid of cards showing color dot, title, progress bar (completed_milestones / total_milestones), target date, next milestone title.
- "Add new goal" tile appears when `active_count < tier_cap` (tier cap is hardcoded to 999 in Phase 1; gated in Phase 3). Color of the tile is the first available palette slot — a preview of which color the new goal will get.
- "Completed" section below; "Archived" section collapsed below that.

### Goal detail

- Route: `app/(goals)/[id]/page.tsx`.
- Sections: header (title, color, intensity control), daily habits, weekly sessions, milestones (timeline), equipment.
- All sections editable: add/remove/reschedule items inline.
- **Intensity control**: per spec §5 flag #2 resolution. Defaults to "Follows your account preference" with the user's global intensity shown in muted text. When the user changes it, sets `goals.intensity_override`.
- "Adjust plan" button — placeholder in Phase 1 (Phase 2 wires the actual replan flow).
- Structural edits (add/remove milestone, shift target date, remove a recurring task) trigger an inline non-modal banner: "Want me to update the rest of your plan?" — clicking opens the replan flow. **Never automatic.** (Replan endpoint itself is Phase 2.)

### Dashboard (active state)

- Layout: three sections vertically:
  - **Today** — daily tasks for today (across all active goals) + any weekly task whose `weekday` matches today + any milestone or equipment whose deadline is today.
  - **This week** — remaining weekly tasks for the current week + milestones/equipment due this week.
  - **Upcoming** — next 14 days of milestones and equipment.
- Each row: colored dot (goal color) + title + secondary line (goal name). Tap to expand; tap goal name to deep-link to goal detail.
- Task check-off: tap the checkbox → optimistic strikethrough → server action inserts `task_completions` row with `for_date = today`, `recurring_task_id`, `goal_id`, `user_id`. Unique constraint prevents double-completion.

### Equipment aggregated view

- Route: `app/(equipment)/page.tsx`.
- All equipment across active goals, grouped by urgency:
  - **This week** — deadline within 7 days
  - **This month** — deadline within 30 days
  - **Later** — beyond 30 days
- Each row: title, parent goal (colored dot + name), deadline (derived from milestone if linked, else `standalone_deadline`), optional cost, purchased checkbox.

## Phase-specific context

### Color assignment

```
On goal creation:
  used = set of goals.color_index where status IN ('active','paused','completed','archived') for this user
  available = [0,1,2,3,4] minus used
  if available is empty: pick the lowest color_index whose goals are all archived
  else: pick min(available)
```

Reassignment in goal detail is allowed — Phase 1 ships a simple "swap with goal X" picker if needed. Cap is 5 distinct *active* colors per spec §8.

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
SYSTEM:
  <voice rules: Patagonia register, declarative, plain, no exclamation>
  <pacing rules: 1-2 questions per turn, target 4-6 user turns, hard cap 10>
  <required structured fields: list>
  <safety rules: soft pushback with reasoning + alternative; never refuse>
  <termination rule: when all required fields elicited, output final JSON block>

ASSISTANT (turn 1):
  <opens on the seed if provided; else opens neutrally>
```

The seed for "Climb a mountain" might be: "I want to climb a mountain." The opening assistant turn responds to that.

### Plan-generation prompt structure (sketch)

```
SYSTEM:
  <voice rules>
  <calibration rules: realistic to starting_point + intensity, not aspirational>
  <equipment rule: prefer milestone-linked deadlines; standalone only if needed>

USER:
  <intake_summary as JSON>
  <intensity = goal.intensity_override ?? user.intensity_preference>

ASSISTANT:
  <returns single JSON object with daily[], weekly[], milestones[], equipment[]>
```

### Out of scope for Phase 1

- Subscription tiers (caps are off / set high — gated in Phase 3).
- Weekly check-in and replan AI (Phase 2).
- Goal completion celebration + auto-archive (Phase 2).
- Push notifications (out of MVP entirely per spec §11).
- PWA install (Phase 2.5).

## Verification

End-to-end (manual, mobile viewport):

1. Sign up via Clerk → land on empty-state dashboard with 5 tiles.
2. Click "Run a half marathon" tile → intake chat opens with a contextual opener.
3. Complete intake in 4–6 turns. Confirm `intake_summaries` row has all structured fields populated: `location_city`, `location_region`, `location_country`, `activity_type='running'`, `safety_flags=[]`.
4. Plan generation runs → review screen shows daily/weekly/milestones/equipment. Edit one milestone title and one equipment deadline. Click "Save goal."
5. Land on goals list → see the new active goal with a color, progress bar, target date.
6. Open goal detail → all sections render and are editable. Toggle intensity from "Follows your account preference" to "Brutal" → goal's `intensity_override` is set.
7. Navigate to dashboard → today's daily task and today's weekly task (if scheduled) show with the goal's color dot. This week's remaining items show under "This week." Equipment items appear in the equipment page grouped by urgency.
8. Check off today's daily task → strikethrough applies, `task_completions` row written, unique `(recurring_task_id, for_date)` prevents double-write.

Automated (Vitest):

- Equipment deadline derivation (milestone-linked vs standalone) with both branches.
- Color assignment algorithm produces distinct colors for goals 1–5 and recycles archived colors at goal 6.
- `task_completions` unique constraint rejects double-completion.
- `scopedDb` queries cannot return another user's goals (seeded fixture with two users).
- Intake termination: given a fixture transcript with all required fields elicited, the parser produces a valid intake_summary payload.
