# Phase 0 — Foundations

**Status: CLOSED 2026-06-10.** All gates satisfied: scopedDb leak tests pass (27 unit/integration tests, 17 live-DB smoke assertions, 17 schema invariants, CI green); a real Clerk-authed signup produced a `users` row (verified, plus the signed-in `/api/me/goals` → `[]` and `/settings` shell checks); Clerk webhook signature verification rejects unsigned payloads (live 400 + integration test suite). Two notes: the Inngest unsigned-rejection check is deferred to first deploy (`INNGEST_DEV=1` bypasses validation locally by design, and no functions register until Phase 2 — the `serve()` config already passes `signingKey`); the gate line's "Stripe-stub" has no Phase 0 route to verify — Phase 3 builds the Stripe webhook with its own signature integration test.

**Goal:** All scaffolding and infrastructure for the §9 loop. No user-facing product yet — just an authenticated empty shell that knows who the user is and can write to the database.

**Prerequisites:** None. This is the first phase.

**Gates:** Phase 1 cannot start until `scopedDb` leak tests pass, a Clerk-authed signup produces a `users` row, and the three webhook signature verifications (Clerk, Stripe-stub, Inngest) reject unsigned payloads.

## Items to build

### Scaffold

- `pnpm create next-app` — Next.js 15 App Router, TypeScript, Tailwind, `src/` directory, ESLint, Turbopack dev.
- Tailwind config: extend palette with 5 `--goal-color-N` CSS variables; **valid earth-tone placeholder values (not literal `...`)** so Phase 1's dashboard renders real colors. Final palette set during Phase 5 design pass. [Superseded 2026-06-10: goal colors now minted as DAWN dark-ramp OKLCH values in globals.css — see docs/DESIGN.md §5.]
- shadcn/ui init: install Button, Card, Dialog, Input, Label, Select, Switch, Sonner (shadcn's toast successor — the `toast` component is deprecated in the registry), Tooltip, Sheet to start.
- TypeScript strict mode on. Path aliases: `@/app`, `@/lib`, `@/components`, `@/db`.

### Database

- Neon project created; `DATABASE_URL` in `.env.local` and Vercel env.
- Drizzle config: `drizzle/`, `db/schema.ts`, `db/migrations/`, `drizzle.config.ts`.
- Schema definitions for **all** tables in PLAN.md §2: users, subscriptions, usage_counters, goals, **goal_drafts**, intake_summaries, recurring_tasks, task_completions, milestones, equipment, weekly_check_ins, replan_proposals, **stripe_webhook_events**.
- Postgres enums: `user_tier`, `intensity_level`, `goal_status`, `task_cadence`, `weekly_feeling`, `replan_trigger`, `replan_status`, `activity_type`, `billing_period`, `subscription_status`, `archive_reason`. **`weekly_feeling` includes `'skipped'`** — written only by Phase 2's check-in skip path and excluded from every feeling-signal query (skips are not sentiment data).
- Indexes: `task_completions(user_id, for_date)`, `goals(user_id, status)`, `equipment(goal_id)`, `milestones(goal_id, position)`, `goal_drafts(user_id, expires_at)`, **unique** `goal_drafts(session_token)` (cookie-mapped lookup credential — one draft per token), `replan_proposals(user_id)`, `users(deleted_at) WHERE deleted_at IS NOT NULL`.
- Unique constraints: `task_completions(recurring_task_id, for_date)`, `usage_counters(user_id, period_start)`, `weekly_check_ins(user_id, week_start_date)`, partial `subscriptions(user_id) WHERE status IN ('trialing','active')`.
- FK ON DELETE behavior per PLAN.md §2 table.
- Migrations run cleanly against a fresh Neon branch.

### Access scoping

- `src/db/scoped.ts` exports `scopedDb(userId: string)` returning a constrained surface (`selectFrom` / `count` / `insert` / `update` / `delete` / `getSelf` / `updateSelf`) that:
  - On `selectFrom` / `count` / `update` / `delete`: injects `eq(table.user_id, userId)` for direct-ownership tables; injects an existence-join `EXISTS (SELECT 1 FROM goals JOIN users … WHERE goals.id = <table>.goal_id AND goals.user_id = $userId AND users.deleted_at IS NULL)` for transitive-ownership tables.
  - On **every `insert`**: issues a single atomic `INSERT … SELECT` whose SELECT side carries the ownership proof — zero rows inserted ⇒ throw. Direct-ownership inserts prove the scoped user exists and is live; transitive inserts prove the target goal belongs to the (live) scoped user. No check-then-insert window, one round-trip instead of two, and a soft-deleted user's writes are rejected the same way their reads come back empty.
  - **`task_completions` insert**: `goal_id` is **derived server-side** from the recurring task's parent (`SELECT …, rt.goal_id, … FROM recurring_tasks rt JOIN goals g JOIN users u WHERE rt.id = $recurring_task_id AND g.user_id = $userId AND u.deleted_at IS NULL`) — the stored `goal_id` can never disagree with `rt.goal_id`. A caller-supplied `goal_id` is validated in the same statement and rejected on mismatch. Also prevents forged-recurring_task_id DoS via the unique-constraint collision.
  - On `update().set()`: validates the payload against per-table **forbidden mutation keys** — `user_id`/`id` on direct-ownership tables, `goal_id`/`id` on transitive tables, plus `recurring_task_id`+`goal_id` on task_completions and the denormalized `user_id` on replan_proposals. The WHERE scope governs *which* rows are touchable; this governs *what* can be written into them (without it, `set({user_id})` transfers a row into another account and `set({goal_id})` injects rows into another goal). Re-parenting is rejected outright — no same-user re-parent path exists in MVP, and if one is ever needed it must add ownership validation rather than relax this. The guarantee assumes plain parameterized `set` values; raw `sql\`\`` fragments bypass key inspection and must never carry user input.
  - Applies a global filter excluding rows where the parent user has `deleted_at IS NOT NULL` — on reads **and writes**, built in from Phase 0, not retroactively in Phase 4. (Phase 4's verification re-tests this across Phase 1-3 surfaces.)
- Direct-user-id tables: goals, goal_drafts, usage_counters, weekly_check_ins, subscriptions, task_completions. Transitive tables (scoped by `goal_id`): intake_summaries, recurring_tasks, milestones, equipment, replan_proposals.
- The `users` row is reachable only through `getSelf()` / `updateSelf()` — pinned to the scoped user's own live row; `updateSelf` forbids system-managed columns (`id`, `email`, `tier`, `stripe_customer_id`, `deleted_at`) and permits only `display_name` / `timezone` / `intensity_preference`. This is the sanctioned path for Phase 1's intake-confirmation write, Phase 2's replan-prompt read, and Phase 4's profile settings — no `unscopedDb` needed for any of them.
- A "raw" `unscopedDb` exists for genuinely cross-user or lifecycle operations — explicitly named to make grep-for-leaks easy. **CI check** (`scripts/check-unscoped-db.mjs`, five layers, fails the build on violation):
  - **Layer 1** — `unscopedDb` imports allowed only in `lib/inngest/*`, `app/api/webhooks/*`, `lib/auth/lifecycle.ts` (the soft-delete + login-recovery module, which must see soft-deleted users), and the env-gated live-DB tests `db/scoped.integration.test.ts` (Phase 1) and `lib/billing/usage.integration.test.ts` (Phase 3 — fixture user lifecycle + residue checks only). Additions to this allowlist are made in that script only — never weaken the rule inline at a call site.
  - **Layer 2** — the raw client (`internalDb` from `db/client.ts`) importable only by `scoped.ts` / `unscoped.ts` / `migrate.ts`, so the Layer-1 rule can't be bypassed with zero indirection.
  - **Layer 3** — `scopedDb(...)` call sites must pass `userId` (destructured from `auth()`) or `auth().userId`; **default-deny** — any argument shape the check can't parse is a violation, so wrapping user input in a helper call doesn't slip through. Test files exempt.
  - **Layer 4** — the raw Neon/drizzle driver is importable only by `db/client.ts` (plus the two operator-run live-DB scripts, allowlisted by name), so no file can mint a fresh query-capable client around the other layers.
  - **Layer 5** — `scopedDb` may not be aliased: outside plain import/export specifiers, every occurrence in non-test `src/` code must be a direct `scopedDb(...)` call, so rebinding/renaming can't detach call sites from the Layer-3 shape check. Test files exempt.
- Unit tests assert: (a) helper functions throw without a `userId`; (b) cross-user reads return empty; (c) cross-user inserts throw on the atomic transitive ownership proof; (d) `task_completions` insert with a forged `recurring_task_id` throws; (e) soft-deleted user's data is excluded from authenticated queries **and their inserts are rejected**; (f) `update().set({user_id})` on a direct table throws; (g) `update().set({goal_id})` on a transitive table throws; (h) `task_completions` insert with a mismatched `goal_id` (even the user's own other goal) is rejected — stored `goal_id` always equals `rt.goal_id`; (i) `updateSelf` rejects system-managed columns.

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

- `.env.example` lists all required env vars: `DATABASE_URL`, `CLERK_SECRET_KEY`, `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY`, `STRIPE_SECRET_KEY` (Phase 3), `STRIPE_WEBHOOK_SECRET` (Phase 3), `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY`, `RESEND_API_KEY` (minimal sender at prod-cutover S4; full email set Phase 4).
- `README.md` covers local setup, env vars, `pnpm db:push` for dev, `pnpm db:migrate` for prod.

## Phase-specific context

### scopedDb surface (as implemented)

`scopedDb(userId)` exposes a deliberately narrow surface — not the raw Drizzle builder chain — so every operation passes through the scope injection and payload validation:

```ts
const sdb = scopedDb(userId)   // throws synchronously without a userId

// Direct ownership:
await sdb.selectFrom(goals)                          // WHERE user_id = $userId AND user-is-live
await sdb.count(goals)                               // same scope, COUNT(*)
await sdb.update(goals, { set: {...}, where: eq(goals.id, goalId) })
//   scope AND-merged with the extra where; set() rejects forbidden keys (user_id, id, …)
await sdb.delete(goals, { where: eq(goals.id, goalId) })
await sdb.insert(goals, { user_id: userId, title: "...", color_index: 0 })
//   atomic INSERT … SELECT … FROM users WHERE id = $userId AND deleted_at IS NULL
//   → zero rows (missing/soft-deleted user) throws; payload user_id mismatch throws first

// Transitive ownership (via goal_id):
await sdb.selectFrom(milestones)                     // EXISTS-join proves parent-goal ownership
await sdb.insert(milestones, { goal_id, title: "..." })
//   atomic INSERT … SELECT … FROM goals JOIN users
//   WHERE goals.id = $goal_id AND goals.user_id = $userId AND users.deleted_at IS NULL
//   → zero rows ⇒ not owned ⇒ throws

// task_completions — goal_id derived, never trusted:
await sdb.insert(taskCompletions, { recurring_task_id, user_id, for_date })
//   INSERT … SELECT …, rt.goal_id, … FROM recurring_tasks rt
//   JOIN goals g ON g.id = rt.goal_id JOIN users u ON u.id = g.user_id
//   WHERE rt.id = $recurring_task_id AND g.user_id = $userId AND u.deleted_at IS NULL
//   goal_id omitted → derived from rt; supplied → validated in-SQL, mismatch ⇒ zero rows ⇒ throws

// Own users row — the only path to it:
await sdb.getSelf()                                  // own live row, or null if soft-deleted
await sdb.updateSelf({ timezone: "Europe/Istanbul" })
//   display_name / timezone / intensity_preference only;
//   id / email / tier / stripe_customer_id / deleted_at are system-managed and rejected

// Escape hatch — name signals intent; importable only where Layer 1 allows:
import { unscopedDb } from "@/db/unscoped"
unscopedDb.insert(users).values({...})               // Clerk webhook only
```

### Why no Postgres RLS

RLS adds debugging friction (RLS errors show up as empty result sets, not loud exceptions) without much win when the same backend owns every query. The `scopedDb` helper gives equivalent safety with louder errors, and the CI lint rule on `unscopedDb` imports prevents drift.

### Color palette CSS variables

```css
:root {
  --goal-color-0: #8a6a4f;  /* placeholder earth tones; finalized Phase 5 */
  /* [Superseded 2026-06-10: goal colors now minted as DAWN dark-ramp OKLCH values in globals.css — see docs/DESIGN.md §5.] */
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
- Calling `scopedDb(userId).insert(milestones, { goal_id: <victim's goal>, ... })` throws (zero-row atomic ownership proof).
- Calling `scopedDb(userId).insert(taskCompletions, { recurring_task_id: <victim's task>, ... })` throws.
- `task_completions` insert **omitting `goal_id`** stores `rt.goal_id` (derivation); supplying a mismatched `goal_id` — including the user's own *other* goal — throws. Stored `goal_id` always equals the task's parent.
- `update(goals, { set: { user_id: <victim> } })` and `update(milestones, { set: { goal_id: <victim's goal> } })` throw on the forbidden-keys check.
- A soft-deleted user's `insert` throws (live-user guard) — writes are rejected, not just reads emptied.
- `getSelf()` returns the own row (null when soft-deleted); `updateSelf({ tier })` / `({ deleted_at })` / `({ email })` throw.
- `scopedDb(userA).count(goals)` returns only user A's goal count even if user B has goals in the table.
- `posthog-node` capture for a test event appears in PostHog within 30s.
- A signed-in user can hit a route handler that calls `scopedDb(auth.userId).select().from(goals)` and gets `[]`.
- Visiting `/settings` returns the placeholder shell, not a 404.
- All env vars in `.env.example` are documented and the app boots cleanly with them set.
- CI check rejects: `unscopedDb` imports outside `lib/inngest/*` / `app/api/webhooks/*` / `lib/auth/lifecycle.ts` (Layer 1); raw-client imports outside the db plumbing modules (Layer 2); any `scopedDb(...)` call whose argument isn't `userId` / `auth().userId` — including parenthesized wrappers like `scopedDb(getUserId(req))`, which are denied by default rather than skipped (Layer 3); raw Neon/drizzle driver imports outside `db/client.ts` (Layer 4).
