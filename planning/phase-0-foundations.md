# Phase 0 — Foundations

**Goal:** All scaffolding and infrastructure for the §9 loop. No user-facing product yet — just an authenticated empty shell that knows who the user is and can write to the database.

**Prerequisites:** None. This is the first phase.

**Gates:** Phase 1 cannot start until `scopedDb` leak tests pass, a Clerk-authed signup produces a `users` row, and the three webhook signature verifications (Clerk, Stripe-stub, Inngest) reject unsigned payloads.

## Items to build

### Scaffold

- `pnpm create next-app` — Next.js 15 App Router, TypeScript, Tailwind, `src/` directory, ESLint, Turbopack dev.
- Tailwind config: extend palette with 5 `--goal-color-N` CSS variables; **valid earth-tone placeholder values (not literal `...`)** so Phase 1's dashboard renders real colors. Final palette set during Phase 5 design pass.
- shadcn/ui init: install Button, Card, Dialog, Input, Label, Select, Switch, Toast, Tooltip, Sheet to start.
- TypeScript strict mode on. Path aliases: `@/app`, `@/lib`, `@/components`, `@/db`.

### Database

- Neon project created; `DATABASE_URL` in `.env.local` and Vercel env.
- Drizzle config: `drizzle/`, `db/schema.ts`, `db/migrations/`, `drizzle.config.ts`.
- Schema definitions for **all** tables in PLAN.md §2: users, subscriptions, usage_counters, goals, **goal_drafts**, intake_summaries, recurring_tasks, task_completions, milestones, equipment, weekly_check_ins, replan_proposals, **stripe_webhook_events**.
- Postgres enums: `user_tier`, `intensity_level`, `goal_status`, `task_cadence`, `weekly_feeling`, `replan_trigger`, `replan_status`, `activity_type`, `billing_period`, `subscription_status`, `archive_reason`.
- Indexes: `task_completions(user_id, for_date)`, `goals(user_id, status)`, `equipment(goal_id)`, `milestones(goal_id, position)`, `goal_drafts(user_id, expires_at)`, `goal_drafts(session_token)`, `replan_proposals(user_id)`, `users(deleted_at) WHERE deleted_at IS NOT NULL`.
- Unique constraints: `task_completions(recurring_task_id, for_date)`, `usage_counters(user_id, period_start)`, `weekly_check_ins(user_id, week_start_date)`, partial `subscriptions(user_id) WHERE status IN ('trialing','active')`.
- FK ON DELETE behavior per PLAN.md §2 table.
- Migrations run cleanly against a fresh Neon branch.

### Access scoping

- `lib/db/scoped.ts` exports `scopedDb(userId: string)` returning a Drizzle proxy that:
  - On `select` / `update` / `delete` / `count` / aggregate queries: injects `eq(table.user_id, userId)` for direct-ownership tables; injects an existence-join `EXISTS (SELECT 1 FROM goals WHERE goals.id = <table>.goal_id AND goals.user_id = $userId)` for transitive-ownership tables.
  - On `insert` to direct-ownership tables: validates `user_id` in the payload matches `userId`; throws otherwise.
  - On `insert` to transitive-ownership tables (intake_summaries, recurring_tasks, milestones, equipment, replan_proposals): runs a pre-insert `SELECT 1 FROM goals WHERE id = $goal_id AND user_id = $userId LIMIT 1` and throws if no row.
  - **`task_completions` insert** has an additional pre-check: `SELECT 1 FROM recurring_tasks rt JOIN goals g ON g.id = rt.goal_id WHERE rt.id = $recurring_task_id AND g.user_id = $userId LIMIT 1`. Prevents forged-recurring_task_id DoS via the unique-constraint collision.
  - Applies a global filter excluding rows where the parent user has `deleted_at IS NOT NULL` — built in from Phase 0, not retroactively in Phase 4. (Phase 4's verification re-tests this across Phase 1-3 surfaces.)
- Direct-user-id tables: goals, goal_drafts, usage_counters, weekly_check_ins, subscriptions, task_completions. Transitive tables (scoped by `goal_id`): intake_summaries, recurring_tasks, milestones, equipment, replan_proposals.
- A "raw" `unscopedDb` exists for genuinely cross-user operations (webhooks, Inngest jobs) — explicitly named to make grep-for-leaks easy. **CI lint rule** restricts `unscopedDb` imports to `lib/inngest/*` and `app/api/webhooks/*` (ESLint custom rule or simple grep check in CI; fails the build on violation).
- Unit tests assert: (a) helper functions throw without a `userId`; (b) cross-user reads return empty; (c) cross-user inserts throw on transitive ownership check; (d) `task_completions` insert with a forged `recurring_task_id` throws; (e) soft-deleted user's data is excluded from authenticated queries.

### Auth

- Clerk app provisioned. Magic-link, Google, Apple Sign-In enabled.
- `middleware.ts` protects all routes except `/`, `/sign-in`, `/sign-up`, `/api/webhooks/*`, **`/api/inngest`** (signature-verified at the handler level).
- Clerk webhook at `/api/webhooks/clerk` handles `user.created` → inserts `users` row with default `tier='free'`, `intensity_preference=NULL` (set explicitly at first intake — see Phase 1), `timezone` from request header (fallback UTC), `display_name` from Clerk profile. `user.updated` syncs email/display_name. `user.deleted` is **not handled here** — account deletion is a Phase 4 in-app flow, not a Clerk dashboard action.
- **Clerk webhook signature verification is required.** Use `svix` to verify `svix-id`, `svix-timestamp`, `svix-signature` headers against `CLERK_WEBHOOK_SECRET` before any DB write. Unsigned or invalid requests return 400. **Verified by an integration test in Phase 0** (post unsigned payload → 400; post valid signed payload → 200 + row inserted).
- Local dev: `ngrok` or Clerk's test mode for webhook delivery.

### Observability

- PostHog cloud project. `posthog-node` (server) + `posthog-js` (client) installed. `lib/analytics/{client,server}.ts` wrappers — no direct PostHog imports in feature code, so taxonomy can be enforced centrally in Phase 5.
- Identify call on signup with Clerk user_id; no PII beyond email.
- Sentry optional but recommended; defer unless errors are masking work. **Without Sentry, silent webhook-signature failures are invisible — wire at least a route-level log to stderr.**

### Inngest

- Inngest app provisioned. `/api/inngest` route handler using the Inngest SDK's `serve()` adapter.
- **`serve()` MUST be configured with `signingKey: process.env.INNGEST_SIGNING_KEY`** — without this, anyone reaching the route could fire jobs that mutate or delete data. Unsigned or invalid requests are rejected by the SDK.
- No functions registered yet. Later phases add: `archiveCompletedGoals` (Phase 2), `resetMonthlyUsageCounters` (Phase 2 as no-op, fleshed out in Phase 3), `trialReminderTomorrow` (Phase 3), `applyPendingArchive` (Phase 3), `hardDeleteAccounts` (Phase 4), `sweepExpiredGoalDrafts` (Phase 0 if simple, otherwise Phase 1).

### Settings shell

- Placeholder `app/(settings)/page.tsx` returns a thin shell ("Settings — coming soon") so the `(settings)` route group exists. Phase 3 adds `/billing/`, Phase 4 fills out the landing. Without this, Phase 3's nested billing routes would not have a parent layout.

### Repository hygiene

- `.env.example` lists all required env vars: `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `STRIPE_SECRET_KEY` (Phase 3), `STRIPE_WEBHOOK_SECRET` (Phase 3), `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `RESEND_API_KEY` (Phase 4).
- `README.md` covers local setup, env vars, `pnpm db:push` for dev, `pnpm db:migrate` for prod.

## Phase-specific context

### scopedDb shape (Drizzle-accurate)

Drizzle's API is `db.select().from(table).where(...)`. `scopedDb(userId)` returns a builder that pre-applies a `.where()` clause and validates inserts:

```ts
const sdb = scopedDb(userId)

// Direct ownership:
await sdb.select().from(goals)                     // .where(eq(goals.user_id, userId)) auto-added
await sdb.select({ count: count() }).from(goals)   // count() composes correctly with the injected where
await sdb.update(goals).set({...}).where(eq(goals.id, goalId))  // user_id filter still applied
await sdb.insert(goals).values({ user_id: userId, title: "..." })  // throws if user_id mismatch

// Transitive ownership (via goal_id):
await sdb.select().from(milestones)                // EXISTS-subquery on goals.user_id = userId
await sdb.insert(milestones).values({ goal_id, title: "..." })  // pre-validates goal_id ownership

// task_completions insert (extra guard):
await sdb.insert(taskCompletions).values({ recurring_task_id, goal_id, user_id, for_date })
// runs: SELECT 1 FROM recurring_tasks rt JOIN goals g ON g.id = rt.goal_id
// WHERE rt.id = $recurring_task_id AND g.user_id = $userId LIMIT 1
// throws if no row

// Soft-deleted user filter is applied transitively via the parent users join.

// Escape hatch — name signals intent:
import { unscopedDb } from "@/db/unscoped"
unscopedDb.select().from(users).where(eq(users.id, userId))  // Clerk webhook only
```

### Why no Postgres RLS

RLS adds debugging friction (RLS errors show up as empty result sets, not loud exceptions) without much win when the same backend owns every query. The `scopedDb` helper gives equivalent safety with louder errors, and the CI lint rule on `unscopedDb` imports prevents drift.

### Color palette CSS variables

```css
:root {
  --goal-color-0: #8a6a4f;  /* placeholder earth tones; finalized Phase 5 */
  --goal-color-1: #4a5d4a;
  --goal-color-2: #3a4e5f;
  --goal-color-3: #6b4a3a;
  --goal-color-4: #5a4a5a;
}
```

Components read via `var(--goal-color-${color_index})`. Color assignment lives in Phase 1.

## Verification

- `pnpm db:push` against a fresh Neon branch creates all tables, enums, indexes, and unique constraints; no manual SQL needed.
- Signing up via the Clerk widget creates a `users` row visible in Neon SQL editor.
- POSTing to `/api/webhooks/clerk` without a valid Svix signature returns 400; with a valid signature returns 200 + inserts the row.
- POSTing to `/api/inngest` without a valid Inngest signature is rejected by the SDK (401/403).
- Calling any `scopedDb(userId)` query with a wrong user_id returns empty; calling without a user_id throws.
- Calling `scopedDb(userId).insert(milestones).values({ goal_id: <victim's goal>, ... })` throws.
- Calling `scopedDb(userId).insert(taskCompletions).values({ recurring_task_id: <victim's task>, ... })` throws.
- `scopedDb(userA).select({ count: count() }).from(goals)` returns only user A's goal count even if user B has goals in the table.
- `posthog-node` capture for a test event appears in PostHog within 30s.
- A signed-in user can hit a route handler that calls `scopedDb(auth.userId).select().from(goals)` and gets `[]`.
- Visiting `/settings` returns the placeholder shell, not a 404.
- All env vars in `.env.example` are documented and the app boots cleanly with them set.
- CI lint rule rejects a PR that imports `unscopedDb` outside `lib/inngest/*` or `app/api/webhooks/*`.
