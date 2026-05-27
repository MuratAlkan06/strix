# Phase 2 — Close the loop

**Goal:** The full §9 loop works: a user does a Friday weekly check-in, sees a proposed adjustment, accepts it, and the plan updates. Goals can be marked complete with a brief celebration and auto-archive after 7 days.

**Prerequisites:** Phase 1 complete (a user can create and edit goals, dashboard shows today's work).

**Gates:** Phase 2.5 cannot start until the replan diff UI works end-to-end and an Inngest job has been verified in dev.

## Items to build

### Weekly check-in UI

- Route: `app/(check-in)/page.tsx`.
- Surfaces as a top-of-dashboard prompt every Friday (in user's timezone) until completed for the current week. Manually accessible any time.
- Form:
  - "How did this week feel?" — one-tap selector: `too_easy | right | too_hard`.
  - "Anything to tell your plan?" — optional free-text notes.
  - "Replan which goals?" — multi-select of active goals (default: all).
- On submit: writes one `weekly_check_ins` row (user-level per spec §5), then triggers replan generation for each selected goal — one `replan_proposals` row per goal, status `pending`.
- "Skip this week" button — writes a `weekly_check_ins` row with `feeling='right'` and no notes; **no replan triggered**. We still capture the cadence event for analytics.

### Replan flow

- Endpoint: `POST /api/ai/replan` — accepts `goal_id`, `trigger` (`weekly_check_in | structural_edit`), and optional `weekly_check_in_id` or `structural_change` payload.
- Model: `claude-sonnet-4-6`. System prompt:
  - Reads goal + intake summary + current recurring_tasks/milestones/equipment + last 4 weeks of `task_completions` for adherence signal + the check-in feeling/notes or structural change.
  - **Intensity rule (spec §5 flag #2):** uses `goals.intensity_override` when explicitly set, otherwise falls back to `users.intensity_preference`. State this clearly in the system prompt.
  - Output: a diff structure — `add`, `modify`, `remove` arrays for each of (recurring_tasks, milestones, equipment). Always proposes a diff, never an absolute replacement.
- Diff stored in `replan_proposals.proposed_changes` (jsonb).
- Anthropic prompt caching on the long system prompt.

### Replan diff UI

- Route: `app/(check-in)/replan/[goalId]/page.tsx` (or inline in goal detail).
- Renders the diff visually: green for additions, struck-through gray for removals, side-by-side before/after for modifications.
- Three actions per change: ✓ Accept, ✎ Edit, ✕ Reject. Bulk "Accept all" available.
- On commit: writes the accepted subset to the live tables, sets `replan_proposals.status` (`accepted | partially_accepted | rejected`) and `decided_at`.
- **The AI proposes; the user approves.** Never apply silently. (Spec §8.)
- PostHog: `first_weekly_check_in_completed`, `first_replan_accepted`, `replan_rejected`, `replan_partially_accepted`.

### Structural-edit replan offer

- In Phase 1, the goal detail page already shows a "want me to update the rest of your plan?" banner on structural edits. Phase 2 wires it up: clicking the banner opens the replan endpoint with `trigger='structural_edit'` and the structural change payload, then routes to the diff UI.
- Examples of "structural" edits that trigger the offer: adding a milestone, removing a recurring task, shifting the target date. Adding equipment or renaming a task does **not** trigger.

### Goal completion celebration + auto-archive

- "Mark complete" button in goal detail header.
- On click: brief celebration moment (a confetti-free, restrained animation — perhaps a quiet check-mark fade + a "Well done." line — register: serious documentary, not Red Bull). Sets `goals.status='completed'`, `completed_at=now`, `auto_archive_at=now + 7 days`.
- Inngest function `archiveCompletedGoals` runs daily, finds goals with `status='completed' AND auto_archive_at <= now`, sets `status='archived'`, `archived_at=now`. (Idempotent.)
- Inngest function `resetMonthlyUsageCounters` registered now (used by Phase 3) but a no-op until tier caps exist.

### Accomplished section on dashboard

- Appears below the upcoming section once `count(goals where status IN ('completed','archived')) >= 1`.
- Shows completed/archived goals as small cards with goal color + title + completion date. Tap to view (read-only goal detail).
- Retention surface per spec §6 — don't hide it after the first one.

## Phase-specific context

### Replan prompt structure (sketch)

```
SYSTEM:
  <voice rules>
  <diff format: { add, modify, remove } per { recurring_tasks, milestones, equipment }>
  <intensity rule: use goal-level if set, else user-level>
  <calibration rule: respond to adherence + check-in feeling>

USER:
  <goal>
  <intake_summary>
  <current_recurring_tasks, milestones, equipment>
  <last_4_weeks_task_completions: aggregated as expected_vs_actual per task>
  <trigger_payload: either { feeling, notes } or { structural_change }>
  <intensity = goal.intensity_override ?? user.intensity_preference>
```

### Why one check-in produces N replan proposals

Spec §5 says weekly check-ins are user-level (one per week). Spec §7C says replan operates on a single goal. The user picks which goals to replan from the check-in; each selected goal gets its own `replan_proposals` row. This means a single check-in can produce 1–5 proposals.

### Auto-archive Inngest job

```ts
inngest.createFunction(
  { id: "archive-completed-goals" },
  { cron: "0 3 * * *" },   // 3am UTC daily
  async ({ step }) => {
    await step.run("archive-due", async () => {
      // unscopedDb because this is a system job
      await unscopedDb.update(goals)
        .set({ status: "archived", archived_at: new Date() })
        .where(and(eq(goals.status, "completed"), lte(goals.auto_archive_at, new Date())))
    })
  }
)
```

### Out of scope for Phase 2

- Tier caps and upgrade prompts (Phase 3).
- PWA install (Phase 2.5 — strictly next).
- Account-deletion and Stripe customer cleanup (Phase 4).

## Verification

End-to-end:

1. From Phase 1 state (a goal with at least 7 days of `task_completions`), trigger a weekly check-in (use a test seam to fast-forward `now`).
2. Select "too hard" + add a note ("can't fit the long run on Saturdays"). Select 1 goal to replan. Submit.
3. Replan endpoint runs Sonnet 4.6 → diff renders in the UI. Verify the diff shape matches the schema and the intensity comparison ran (log shows which value won — goal-level vs user-level).
4. Accept some changes, reject one. Save. Verify `replan_proposals.status='partially_accepted'`, live tables reflect accepted changes only.
5. In goal detail, shift the target date 30 days later. Banner appears: "Want me to update the rest of your plan?" → click → replan diff UI opens with `trigger='structural_edit'`.
6. Mark a goal complete → celebration shown, `status='completed'`, `auto_archive_at` is 7 days from now.
7. Run the Inngest auto-archive function manually with `now=auto_archive_at+1s` → goal flips to `archived`. Idempotent: re-running does nothing.
8. Accomplished section appears on dashboard with the completed goal.

Automated (Vitest):

- Replan prompt input correctly substitutes `goal.intensity_override` when set, falls back to `user.intensity_preference` when null. Both branches tested.
- Auto-archive function archives only completed goals past `auto_archive_at`; leaves paused, active, untouched.
- Diff acceptance: given a fixture diff and a partial accept-set, the resulting live-table state matches expected.
- Weekly check-in "skip" does not create replan_proposals rows.
