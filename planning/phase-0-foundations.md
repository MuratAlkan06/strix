# Phase 0 — Foundations

**Goal:** All scaffolding and infrastructure for the §9 loop. No user-facing product yet — just an authenticated empty shell that knows who the user is and can write to the database.

**Prerequisites:** None. This is the first phase.

**Gates:** Phase 1 cannot start until `scopedDb` leak tests pass and a Clerk-authed signup produces a `users` row.

## Items to build

### Scaffold

- `pnpm create next-app` — Next.js 15 App Router, TypeScript, Tailwind, `src/` directory, ESLint, Turbopack dev.
- Tailwind config: extend palette with 5 `--goal-color-N` CSS variables; placeholder earth-tone values (final palette set during Phase 5 design pass).
- shadcn/ui init: install Button, Card, Dialog, Input, Label, Select, Switch, Toast, Tooltip, Sheet to start.
- TypeScript strict mode on. Path aliases: `@/app`, `@/lib`, `@/components`, `@/db`.

### Database

- Neon project created; `DATABASE_URL` in `.env.local` and Vercel env.
- Drizzle config: `drizzle/`, `db/schema.ts`, `db/migrations/`, `drizzle.config.ts`.
- Schema definitions for **all** tables in PLAN.md §2: users, subscriptions, usage_counters, goals, intake_summaries, recurring_tasks, task_completions, milestones, equipment, weekly_check_ins, replan_proposals.
- Postgres enums: `user_tier`, `intensity_level`, `goal_status`, `task_cadence`, `weekly_feeling`, `replan_trigger`, `replan_status`, `activity_type`, `billing_period`, `subscription_status`.
- Indexes: `task_completions(user_id, for_date)`, `goals(user_id, status)`, `equipment(goal_id)`, `milestones(goal_id, position)`, unique constraint on `task_completions(recurring_task_id, for_date)`.
- Migrations run cleanly against a fresh Neon branch.

### Access scoping

- `lib/db/scoped.ts` exports `scopedDb(userId: string)` returning a Drizzle proxy that automatically injects `eq(table.user_id, userId)` (or a transitive constraint via `goal_id → goals.user_id`) into every read and write. Direct-user-id tables: goals, usage_counters, weekly_check_ins, subscriptions, task_completions. Transitive tables (scoped by `goal_id`): intake_summaries, recurring_tasks, milestones, equipment, replan_proposals.
- A "raw" `unscopedDb` exists for genuinely cross-user operations (webhooks, Inngest jobs) — explicitly named to make grep-for-leaks easy.
- Unit tests assert that helper functions throw when called without a `userId` and that cross-user queries return empty.

### Auth

- Clerk app provisioned. Magic-link, Google, Apple Sign-In enabled.
- `middleware.ts` protects all routes except `/`, `/sign-in`, `/sign-up`, `/api/webhooks/*`.
- Clerk webhook at `/api/webhooks/clerk` handles `user.created` → inserts `users` row with default `tier='free'`, `intensity_preference='challenging'` (middle of the three), `timezone` from request header (fallback UTC), `display_name` from Clerk profile. `user.updated` syncs email/display_name. `user.deleted` is **not handled here** — account deletion is a Phase 4 in-app flow, not a Clerk dashboard action.
- Local dev: `ngrok` or Clerk's test mode for webhook delivery.

### Observability

- PostHog cloud project. `posthog-node` (server) + `posthog-js` (client) installed. `lib/analytics/{client,server}.ts` wrappers — no direct PostHog imports in feature code, so taxonomy can be enforced centrally in Phase 5.
- Identify call on signup with Clerk user_id; no PII beyond email.
- Sentry optional but recommended; defer unless errors are masking work.

### Inngest

- Inngest app provisioned. `/api/inngest` route handler. No functions registered yet — Phase 2 adds the first (auto-archive).

### Repository hygiene

- `.env.example` lists all required env vars: `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `STRIPE_SECRET_KEY` (Phase 3), `STRIPE_WEBHOOK_SECRET` (Phase 3), `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `RESEND_API_KEY` (Phase 4).
- `README.md` covers local setup, env vars, `pnpm db:push` for dev, `pnpm db:migrate` for prod.

## Phase-specific context

### scopedDb shape

```ts
// Direct ownership (table has user_id):
scopedDb(userId).goals.select()        // adds WHERE user_id = $userId
scopedDb(userId).goals.update({...})   // adds WHERE user_id = $userId

// Transitive ownership (table has goal_id, goal has user_id):
scopedDb(userId).milestones.select()   // joins goals, adds WHERE goals.user_id = $userId

// Escape hatch — name signals intent:
unscopedDb.users.findFirst({ where: eq(users.id, userId) })  // Clerk webhook
```

### Why no RLS

RLS adds debugging friction (RLS errors show up as empty result sets, not loud exceptions) without much win when the same backend owns every query. The `scopedDb` helper gives equivalent safety, and a single grep for `unscopedDb` audits every cross-user code path.

### Color palette CSS variables

```css
:root {
  --goal-color-0: ...;  /* placeholder; finalized Phase 5 */
  --goal-color-1: ...;
  --goal-color-2: ...;
  --goal-color-3: ...;
  --goal-color-4: ...;
}
```

Components read via `var(--goal-color-${color_index})`. Color assignment lives in Phase 1.

## Verification

- `pnpm db:push` against a fresh Neon branch creates all tables and enums; no manual SQL needed.
- Signing up via the Clerk widget creates a `users` row visible in Neon SQL editor.
- Calling any `scopedDb(userId)` query with a wrong user_id returns empty; calling without a user_id throws.
- `posthog-node` capture for a test event appears in PostHog within 30s.
- A signed-in user can hit a route handler that calls `scopedDb(auth.userId).goals.select()` and gets `[]`.
- All env vars in `.env.example` are documented and the app boots cleanly with them set.
