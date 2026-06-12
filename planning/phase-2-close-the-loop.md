# Phase 2 — Close the loop

**Goal:** The full §9 loop works: a user does a Friday weekly check-in, sees a proposed adjustment, accepts it, and the plan updates. Goals can be marked complete with a brief celebration and auto-archive after 7 days.

**Prerequisites:** Phase 1 complete (a user can create and edit goals, dashboard shows today's work).

**Gates:** Phase 2.5 cannot start until the replan diff UI works end-to-end and an Inngest job has been verified in dev.

## Items to build

### Weekly check-in UI

- Route: `app/(check-in)/check-in/page.tsx`.
- Surfaces as a top-of-dashboard prompt every Friday **and Saturday** (in user's timezone; the week's last two days — weekdays 5–6 of the Sun–Sat week) until handled for the current week: ANY `weekly_check_ins` row, submitted or skipped, retires the prompt. Manually accessible any time.
- Form:
  - "How did this week feel?" — one-tap selector: `too_easy | right | too_hard`.
  - "Anything to tell your plan?" — optional free-text notes.
  - "Replan which goals?" — multi-select of active goals. **For Free users, the selectable count is capped at `remaining replan quota`** (computed from current month's `usage_counters.replans_used`); goals beyond the quota are shown in the list but the checkbox is disabled with inline tooltip: "You've used X of 2 replans this month. Upgrade for unlimited." Tapping a disabled goal opens the upgrade modal (same modal as cap-hit elsewhere). **No silent skip; no partial fail.** Pro/Max users see all goals selectable. Default selection: all goals up to the cap (Free) / all goals (Pro/Max).
- On submit: writes one `weekly_check_ins` row (user-level per spec §5; unique `(user_id, week_start_date)` — re-submission upserts and triggers replans only for newly-selected goals), then triggers replan generation for each selected goal — one `replan_proposals` row per goal, status `pending`.
- "Skip this week" button — writes a `weekly_check_ins` row with **`feeling='skipped'`** (enum value added in Phase 0) and NULL notes; **no replan triggered**. Skips are not sentiment data: they must be distinguishable from `'right'` in every downstream query, and replan prompts exclude skipped weeks from the feeling signal. The row exists (rather than a PostHog-only event) so the Friday prompt knows the week is handled and so a later real submission upserts over it cleanly. A real re-submission in the same week replaces the skip and triggers replans normally.

### Replan flow

- Endpoint: `POST /api/ai/replan` — accepts `goal_id`, `trigger` (`weekly_check_in | structural_edit`), and optional `weekly_check_in_id` or `structural_change` payload. **The endpoint calls `checkAndIncrement(userId, 'replan')` in Phase 3**; in Phase 2 this is a stub that always returns `{ ok: true }` so the endpoint shape is stable.
- Model: `claude-sonnet-4-6`. **Anthropic prompt caching on the long system prompt.** System prompt:
  - Reads goal + intake summary + current recurring_tasks/milestones/equipment + last 4 weeks of `task_completions` for adherence signal + the check-in feeling/notes or structural change.
  - **Intensity rule (spec §5 flag #2 + flag #6):** uses `goals.intensity_override` when explicitly set, otherwise falls back to `intake_summaries.confirmed_intensity`, otherwise to `users.intensity_preference`. State this clearly in the system prompt.
  - Output: a diff structure — `add`, `modify`, `remove` arrays for each of (recurring_tasks, milestones, equipment). Always proposes a diff, never an absolute replacement.
- Diff stored in `replan_proposals.proposed_changes` (jsonb), Zod-typed:

```ts
// lib/ai/replan-diff.ts
import { z } from "zod"

export const ReplanDiffSchema = z.object({
  recurring_tasks: z.object({
    add: z.array(z.object({
      title: z.string(),
      cadence: z.enum(["daily","weekly"]),
      weekday: z.number().int().min(0).max(6).nullable(),
      estimated_duration_min: z.number().int().positive(),
    })),
    modify: z.array(z.object({
      id: z.string(),
      changes: z.object({
        title: z.string().optional(),
        weekday: z.number().int().min(0).max(6).nullable().optional(),
        estimated_duration_min: z.number().int().positive().optional(),
        active: z.boolean().optional(),
      }),
    })),
    remove: z.array(z.object({ id: z.string() })),
  }),
  milestones: z.object({
    add: z.array(z.object({
      title: z.string(),
      target_date: z.string(),
      position: z.number().int(),
    })),
    modify: z.array(z.object({
      id: z.string(),
      changes: z.object({
        title: z.string().optional(),
        target_date: z.string().optional(),
        position: z.number().int().optional(),
      }),
    })),
    remove: z.array(z.object({ id: z.string() })),
  }),
  equipment: z.object({
    add: z.array(z.object({
      title: z.string(),
      cost_usd: z.number().nullable(),
      milestone_id: z.string().nullable(),
      standalone_deadline: z.string().nullable(),
    })),
    modify: z.array(z.object({
      id: z.string(),
      changes: z.object({
        title: z.string().optional(),
        cost_usd: z.number().nullable().optional(),
        milestone_id: z.string().nullable().optional(),
        standalone_deadline: z.string().nullable().optional(),
      }),
    })),
    remove: z.array(z.object({ id: z.string() })),
  }),
})

export type ReplanDiff = z.infer<typeof ReplanDiffSchema>
```

The AI's response is parsed and validated against this schema before persisting. Failed validation returns a 502 with the raw response logged.

### Replan diff UI

- Route: `app/(check-in)/replan/[goalId]/page.tsx` (or inline in goal detail).
- Renders the diff visually: green for additions, struck-through gray for removals, side-by-side before/after for modifications.
- Three actions per change: ✓ Accept, ✎ Edit, ✕ Reject. Bulk "Accept all" available.
- On commit: writes the accepted subset to the live tables, sets `replan_proposals.status` (`accepted | partially_accepted | rejected`) and `decided_at`.
- **The AI proposes; the user approves.** Never apply silently. (Spec §8.)
- PostHog: `first_weekly_check_in_completed { feeling, goals_selected_count }` — fires on the user's first **non-skipped** check-in row (a skip is not funnel completion), `first_replan_accepted { goal_id, accept_count, reject_count }`, `replan_rejected { goal_id }`, `replan_partially_accepted { goal_id, accept_count, reject_count }`.

### Structural-edit replan banner — wired on

- Phase 1 ships the banner behind `NEXT_PUBLIC_REPLAN_ENABLED`. Phase 2 flips the flag to `true` in env and wires the click action: opens the replan endpoint with `trigger='structural_edit'` and the structural change payload, then routes to the diff UI.
- Examples of "structural" edits that trigger the banner: adding a milestone, removing a recurring task, shifting the target date. Adding equipment or renaming a task does **not** trigger.

### Goal completion celebration + auto-archive

- "Mark complete" button in goal detail header.
- On click: brief celebration moment (a confetti-free, restrained animation — the goal's scene transitions to sunrise over ~900ms, the sky brightens and the sun rises, then a "Well done." line fades in; `prefers-reduced-motion` → a 250ms sky crossfade instead of the rise; register: serious documentary, not Red Bull — see docs/DESIGN.md §4). Sets `goals.status='completed'`, `completed_at=now`, `auto_archive_at=now + 7 days`, `archive_reason='user_action'`.
- Inngest function `archiveCompletedGoals`: `{ id: "archive-completed-goals", cron: "0 3 * * *" }`. Finds goals with `status='completed' AND auto_archive_at <= now` (excluding goals whose owner has `users.deleted_at IS NOT NULL`), sets `status='archived'`, `archived_at=now`. (Idempotent.)
- Inngest function `resetMonthlyUsageCounters`: `{ id: "reset-monthly-usage-counters", cron: "0 * * * *" }` (hourly UTC). Registered in Phase 2 with a no-op body that returns immediately if no users are in a local-midnight-just-crossed window; Phase 3 fills out the body. Hourly cadence catches every timezone's local-month boundary.
- Inngest function `sweepExpiredGoalDrafts`: already shipped in Phase 0/1 as `{ id: "sweep-expired-goal-drafts", cron: "0 6 * * *" }` (daily 06:00 UTC — off the midnight herd; this doc originally sketched 04:00). Deletes `goal_drafts` where `expires_at < now()`. Not rebuilt in Phase 2.

### Accomplished section on dashboard

- Appears below the upcoming section once `count(goals where status IN ('completed','archived')) >= 1`.
- Shows completed/archived goals as small cards with goal color + title + completion date (`completed_at`, which survives auto-archive; an archived row without one — possible via future archive paths — falls back to `archived_at` with an honest "Archived …" label; neither date ⇒ no date line, never a fake one). Tap to view (read-only goal detail: non-active goals render with zero edit affordances).
- Retention surface per spec §6 — don't hide it after the first one. A user whose every goal is finished still gets the dashboard (honest empty sections + their wins), not the first-run empty state.

## Phase-specific context

### Replan prompt structure (sketch)

```
SYSTEM (cached):
  <voice rules>
  <diff format: matches ReplanDiffSchema; { add, modify, remove } per type>
  <intensity rule: use goal-level if set, else intake confirmed_intensity, else user-level>
  <calibration rule: respond to adherence + check-in feeling>

USER:
  <goal>
  <intake_summary>
  <current_recurring_tasks, milestones, equipment>
  <last_4_weeks_task_completions: aggregated as expected_vs_actual per task>
  <trigger_payload: either { feeling, notes } or { structural_change }>
  <intensity = goals.intensity_override ?? intake_summaries.confirmed_intensity ?? users.intensity_preference>
```

### Why one check-in produces N replan proposals

Spec §5 says weekly check-ins are user-level (one per week). Spec §7C says replan operates on a single goal. The user picks which goals to replan from the check-in; each selected goal gets its own `replan_proposals` row. This means a single check-in can produce 1–5 proposals (capped at remaining Free-tier quota when applicable).

### Auto-archive Inngest job

```ts
inngest.createFunction(
  { id: "archive-completed-goals" },
  { cron: "0 3 * * *" },   // 3am UTC daily
  async ({ step }) => {
    await step.run("archive-due", async () => {
      // unscopedDb because this is a system job
      await unscopedDb
        .update(goals)
        .set({ status: "archived", archived_at: new Date() })
        .where(and(
          eq(goals.status, "completed"),
          lte(goals.auto_archive_at, new Date()),
          notExists(
            unscopedDb.select().from(users)
              .where(and(
                eq(users.id, goals.user_id),
                isNotNull(users.deleted_at)
              ))
          )
        ))
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
3. Replan endpoint runs Sonnet 4.6 → diff renders in the UI. Verify the diff shape parses cleanly against `ReplanDiffSchema` and the intensity comparison ran (log shows which value won — goal-level vs intake-confirmed vs user-level).
4. Accept some changes, reject one. Save. Verify `replan_proposals.status='partially_accepted'`, live tables reflect accepted changes only.
5. In goal detail, with the replan flag enabled, shift the target date 30 days later. ("Shift the target date" here means a milestone target date — there is no goal-level date editor in Phase 1/2; a future goal-level date editor would need to extend GoalDetailEdit and add a `structuralEditFor` payload.) Banner appears: "Want me to update the rest of your plan?" → click → replan diff UI opens with `trigger='structural_edit'`.
6. Mark a goal complete → celebration shown, `status='completed'`, `auto_archive_at` is 7 days from now, `archive_reason='user_action'`.
7. Run the Inngest auto-archive function manually with `now=auto_archive_at+1s` → goal flips to `archived`. Idempotent: re-running does nothing.
8. Accomplished section appears on dashboard with the completed goal.
9. As a simulated Free user with `replans_used = 0` of 2: open weekly check-in with 3 active goals. Two goals are enabled, one is disabled with the inline tooltip. Tap the disabled goal → upgrade modal opens.
10. Submit the check-in with the 2 enabled goals selected → 2 `replan_proposals` rows created; `usage_counters.replans_used` does not increment in Phase 2 (Phase 3 adds the increment).

Automated (Vitest):

- Replan prompt input correctly substitutes `goals.intensity_override` when set, falls back to `intake_summaries.confirmed_intensity` when override is null, falls back to `users.intensity_preference` when the override is null **and no intake summary row exists** (`confirmed_intensity` is NOT NULL, so the third branch is only reachable via an absent summary — the fixture must construct it that way). All three branches tested.
- `ReplanDiffSchema.safeParse` rejects malformed AI output; passes valid output.
- Auto-archive function archives only completed goals past `auto_archive_at`; leaves active, untouched.
- Auto-archive excludes goals whose owner has `users.deleted_at` set.
- Diff acceptance: given a fixture diff and a partial accept-set, the resulting live-table state matches expected.
- Weekly check-in "skip" writes `feeling='skipped'` with NULL notes and does not create replan_proposals rows.
- A real submission after a skip in the same week upserts over the `'skipped'` row and triggers replans for all selected goals.
- Replan prompt construction excludes `'skipped'` rows from any feeling signal.
- Weekly check-in re-submission for the same `(user_id, week_start_date)` upserts and only triggers replans for newly-selected goals.
- `sweepExpiredGoalDrafts` deletes only rows where `expires_at < now()`.
