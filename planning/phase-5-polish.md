# Phase 5 — Polish & instrumentation

**Goal:** Full event taxonomy wired into PostHog. Patagonia-register copy across every customer-facing surface, including third-party defaults. Accessibility audit. Playwright golden-path E2E protects the §9 loop in CI.

**Prerequisites:** Phases 0–4 complete.

**Gates:** This phase is the launch gate.

## Items to build

### Full PostHog event taxonomy

Spec §9 instrumentation list — every event below must fire from a centralized `lib/analytics/events.ts` so the taxonomy is enforced (typed event names, typed properties, single point of truth). Earlier phases wire the fire sites; Phase 5 enforces the canonical names/properties and adds the ESLint rule.

| Event | Properties | Fires from | Fires when |
|---|---|---|---|
| `signup` | `{ method }` | Phase 0 | First successful Clerk auth → users row insert |
| `first_goal_created` | `{ goal_id, color_index, activity_type }` | Phase 1 | `count(goals) = 1` after Save goal |
| `intake_started` | `{ goal_draft_id, seed?: string }` | Phase 1 | User sends first intake message |
| `intake_completed` | `{ goal_draft_id, turn_count, structured_fields_count }` | Phase 1 | Intake produces final structured summary |
| `intake_turn_count` | `{ goal_draft_id, turn_count }` | Phase 1 | Per-completed-intake (flat view of the same fact) |
| `intake_drop_off_turn` | `{ goal_draft_id?, last_turn }` | Phase 1 | User navigates away from in-progress intake |
| `plan_generated` | `{ goal_draft_id }` | Phase 1 | Sonnet 4.6 plan-generation call succeeds |
| `plan_accepted` | `{ goal_id, edits_count }` | Phase 1 | Draft saved to live tables |
| `first_task_checked` | `{ task_id, goal_id }` | Phase 1 | First `task_completions` row for the user |
| `first_weekly_check_in_completed` | `{ feeling, goals_selected_count }` | Phase 2 | First **non-skipped** `weekly_check_ins` row (a `feeling='skipped'` row is not funnel completion) |
| `first_replan_accepted` | `{ goal_id, accept_count, reject_count }` | Phase 2 | First `replan_proposals.status='accepted'` |
| `replan_rejected` | `{ goal_id }` | Phase 2 | `replan_proposals.status='rejected'` |
| `replan_partially_accepted` | `{ goal_id, accept_count, reject_count }` | Phase 2 | `replan_proposals.status='partially_accepted'` |
| `trial_started` | `{ tier: "max" }` | Phase 3 | Stripe checkout completed for trial |
| `trial_converted` | `{ tier: "max", billing_period: "monthly" \| "annual" }` | Phase 3 | Stripe webhook flips trial → active |
| `subscription_started` | `{ tier: "pro" \| "max", billing_period: "monthly" \| "annual" }` | Phase 3 | Non-trial subscription created (Pro signup) |
| `subscription_canceled` | `{ tier, reason: "user_cancel" \| "payment_failed", billing_period }` | Phase 3 | User completes downgrade flow (`user_cancel` — fires **exactly once, at the cancel-click decision moment**, never again at trial-end) or dunning exhausts after trial-end charge failure (`payment_failed`). **Silent trial expiry without payment failure is a `trial_converted`, never a `subscription_canceled`.** A user who cancels then resumes fires `subscription_resumed` — churn analysis nets the two; the click-time fire alone overcounts resumers. |
| `subscription_resumed` | `{ tier, billing_period }` | Phase 3 | User clicks "Resume Max" before trial-end |
| `free_tier_cap_hit` | `{ cap: "plan_generations" \| "replans" \| "active_goals", goal_id? }` | Phase 3 | Cap response returned from API |
| `account_deleted` | `{ had_subscription }` | Phase 4 | Soft-delete initiated |
| `account_recovered` | `{ days_since_delete }` | Phase 4 | User logs in within recovery window |
| `data_exported` | `{ bytes }` | Phase 4 | `/api/me/export` returns 200 |
| `email_sent` | `{ template, user_id }` | Phase 4 | Any Resend send via `lib/email/send.ts` |

- Centralized `track(eventName, props)` function with strict types — discourages ad-hoc events drifting from the taxonomy.
- Server-side events use `posthog-node` with explicit `distinctId = userId`. Client-side events use `posthog-js`.
- No PII in event properties beyond what's already on the user record.

### Patagonia-register copy pass

Spec §4 brand register — voice is "Coaching, not cheerleading." Declarative, plain, low on exclamation.

- **Audit every customer-facing string.** Walk the app screen by screen and rewrite anything that drifts into cheerleader voice.
- **Override third-party defaults**:
  - Clerk auth UI: customize via Clerk's `appearance` and `localization` props. Replace "Welcome back!" with "Sign in." Replace "Continue" with explicit verbs.
  - Stripe Checkout: pass `custom_text` for `submit.message`, `terms_of_service_acceptance.message`. Locale strings overridden.
  - shadcn toast/error copy: replace "Success!" with the concrete outcome ("Goal saved."). Replace "Oops, something went wrong" with specific error language where possible.
- Banned phrasings: "Crush it," "You got this," "Let's go!", any string ending with `!` outside of bona fide alerts. Use periods.
- Example rewrites (style anchors):
  - ❌ "Way to go! You crushed your first task!" → ✓ "Task done."
  - ❌ "Crush your next goal!" → ✓ "Add another goal."
  - ❌ "Welcome to Strix!" → ✓ "Welcome to Strix."
  - ❌ "Oops, something went wrong" → ✓ "Couldn't save. Please try again."
- Reviewer test: a stranger reading the empty-state CTA, the intake first message, a success toast, and an error toast should not be able to tell which is which from voice alone.

### Accessibility audit

- Run `axe-core` against every route in dev. Fix all violations except documented exceptions.
- Keyboard navigation: tab through full intake, replan diff, downgrade screen — every action reachable without a pointer.
- Screen reader pass on: dashboard "today" section (must read goal color via ARIA label, not just visual cue), check-off (must announce state change), replan diff (must clearly separate additions/removals).
- Contrast: earth-tone palette must meet WCAG AA on body text. Goal colors are visual indicators, not the sole carrier of meaning — always paired with text labels.
- Touch targets ≥ 44pt (already enforced in Phase 2.5; re-verify after polish).

### Playwright golden-path E2E

One end-to-end test that exercises the §9 loop. Runs against a Neon preview branch on CI.

- Steps:
  1. Sign up (test-mode Clerk session).
  2. From empty-state dashboard, click "Run a half marathon" tile.
  3. Drive the intake chat with deterministic responses (Anthropic SDK is mocked with a recorded fixture).
  4. Plan generation returns a fixture plan; verify the review screen renders all sections.
  5. Save the goal.
  6. Verify dashboard shows the new goal's tasks today.
  7. Check off the daily task.
  8. Open weekly check-in (test seam advances time 7 days).
  9. Submit "too hard"; replan returns a fixture diff; accept all changes.
  10. Assert final DB state.
- Runs on every PR.
- Mock Anthropic with `@anthropic-ai/sdk`-compatible test fixtures so AI calls are deterministic and free.

### Manual verification dry-run

Before declaring launch-ready, a non-team user (or a team member who hasn't seen the build) walks through:

1. Sign up to checking-off a task in under 5 minutes (spec §9 #1).
2. Reviews/edits the AI-generated plan before saving (spec §9 #2).
3. Opens the app next morning, sees the day clearly (spec §9 #3).
4. Checks off tasks, sees strikethrough (spec §9 #4).
5. Friday: opens check-in, accepts a proposed adjustment (spec §9 #5).
6. Installs to home screen, can't tell it's a webpage (spec §9 #6).

If any step has friction, fix and repeat. The bar is binary.

## Phase-specific context

### Why a copy pass is its own phase, not "as we go"

Voice drifts when individual engineers ship features without a single editor. Patagonia register is acquired by reading the whole product top to bottom in one sitting, then rewriting drift. Doing it incrementally produces a 70% register, which is worse than either pure register (you can't write marketing against it).

### Don't enable PostHog feature flags for §3.4 intake calibration as part of launch

Ship the 4–6 turn / hard-cap-10 default. PostHog feature flags exist (configured in Phase 0) but no A/B is designed up front. Tune from `intake_turn_count` and `intake_drop_off_turn` distributions after launch.

### Out of scope

- Push notifications (v2 per spec §11).
- Native mobile (v2 per spec §12).
- Streaks, gamification, user-facing dashboards (out of MVP per spec §11).
- Partner matching (v3 per spec §12; the structured location and activity_type fields are already in place from Phase 1 to support it without a future migration).

## Verification

End-to-end:

1. PostHog dashboard shows all 23 events from the taxonomy firing during a fresh user walkthrough (some events like `replan_rejected`, `subscription_resumed`, `email_sent` exercised via targeted scenarios).
2. Lighthouse PWA score still ≥ 90 after polish.
3. axe-core reports zero violations on dashboard, goal detail, intake, replan diff, settings, billing.
4. Playwright golden-path E2E passes on a clean Neon preview.
5. Non-team-member dry-run hits all §9 bars without friction.
6. Read-through of every customer-facing string. Zero "Crush it" energy.

Automated:

- Playwright golden-path runs in CI on every PR.
- axe-core CI job runs against built routes.
- `lib/analytics/events.ts` is the only file that calls `posthog.capture` — enforced via an ESLint custom rule or a simple grep check in CI.
