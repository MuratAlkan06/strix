# Strix

Goal-tracking app — see [SPEC.md](./SPEC.md) and [PLAN.md](./PLAN.md).

## Phase 0 setup

```bash
pnpm install
cp .env.example .env.local   # then fill in values from each provider's dashboard
```

### Required env vars (Phase 0)

- `DATABASE_URL` — Neon connection string. Use a separate Neon branch per
  developer; `pnpm db:push` writes directly to it.
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` — Clerk app keys.
- `CLERK_WEBHOOK_SECRET` — webhook endpoint signing secret from Clerk's
  dashboard. Verified against svix headers in the route handler.
- `INNGEST_SIGNING_KEY`, `INNGEST_EVENT_KEY` — without `INNGEST_SIGNING_KEY`,
  `serve()` accepts unsigned calls. Always set it.
- `POSTHOG_API_KEY`, `NEXT_PUBLIC_POSTHOG_KEY` — server + client analytics.

Phase 3 adds `STRIPE_*`. Phase 4 adds `RESEND_API_KEY`. The Anthropic key
slots in for Phase 1.

## Database

```bash
pnpm db:generate    # generate SQL migrations from src/db/schema.ts
pnpm db:push        # dev: push schema directly to Neon branch (skips migrations)
pnpm db:migrate     # prod: apply ./drizzle/*.sql migrations
pnpm db:studio      # browse data
```

### Driver choice (Vercel serverless footgun)

`src/db/client.ts` uses the `drizzle-orm/neon-http` driver — stateless HTTP,
safe to import at module scope. Do **not** swap in `@neondatabase/serverless`
`Pool` at module scope; that's the documented Vercel serverless failure mode
(connections leak across invocations). When Phase 1's "Save goal" flow needs
multi-statement transactions, create the `Pool` **inside the request handler**
and close it with `ctx.waitUntil(pool.end())`.

## Access scoping

User-authenticated code paths must use `scopedDb(userId)` from `@/db/scoped`:

```ts
import { scopedDb } from "@/db/scoped";
import { goals } from "@/db/schema";
import { auth } from "@clerk/nextjs/server";

const { userId } = await auth();
if (!userId) return new Response("Unauthorized", { status: 401 });
const sdb = scopedDb(userId);

const list = await sdb.selectFrom(goals);
const total = await sdb.count(goals);
await sdb.insert(goals, { user_id: userId, color_index: 0, title: "…" });

// The user's own `users` row is reachable only via the self accessors:
const me = await sdb.getSelf();
await sdb.updateSelf({ timezone: "Europe/Istanbul" }); // profile fields only
```

Inserts are single atomic `INSERT … SELECT` statements whose SELECT side
proves ownership (and that the user isn't soft-deleted) — zero rows inserted
means the proof failed and scopedDb throws.

The escape hatch `unscopedDb` (in `@/db/unscoped`) is allowed only in
`src/lib/inngest/**`, `src/app/api/webhooks/**`,
`src/lib/auth/lifecycle.ts` (Phase 4's soft-delete + recovery module), and
`src/db/scoped.integration.test.ts` (env-gated live-DB test — fixture user
lifecycle + residue checks only). CI enforces this:

```bash
pnpm ci:check-unscoped
```

## Scripts

| Script | Purpose |
|---|---|
| `pnpm dev` | Next dev server |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest in watch mode |
| `pnpm test:run` | Vitest, one-shot |
| `pnpm db:*` | Drizzle commands (see above) |
| `pnpm ci:check-unscoped` | Five-layer access-isolation check (unscopedDb imports, raw-client imports, scopedDb call shape — default-deny, raw driver imports, scopedDb aliasing) |
| `pnpm ci:check-doc-parity` | Deterministic doc↔code parity (layer-count phrase, allowlist quotes, enum lists in PLAN.md/verify-schema, README layout-tree paths). Invariants are admitted only after a real drift burned us — see the script header. |
| `pnpm verify:phase-0` | Run the full Phase 0 verification matrix |
| `pnpm verify:ui` | UI gate: Playwright + axe-core (WCAG 2.1 AA, zero violations) on the `/playground/*` harness states (`e2e/playground-*.spec.ts`) + screenshot baselines. Production server, reduced motion. First run on a new machine: `pnpm exec playwright install chromium`. |
| `pnpm verify:ui:update` | Regenerate screenshot baselines for the current platform (run after an intentional visual change). |
| `pnpm verify:db-schema` | Live-DB introspection: assert tables, enums, FKs, partial indexes match PLAN.md §2 (requires `DATABASE_URL`) |
| `pnpm smoke:scoped-db` | Live-DB cross-user / soft-delete / forged-insert smoke test for `scopedDb` (requires `DATABASE_URL`). Self-cleaning. Re-run any time scopedDb changes. |

## Phase verification

Each phase has a single command that runs every check it needs to call itself done:

```bash
pnpm verify:phase-0   # typecheck + lint + ci:check-unscoped + ci:check-doc-parity + db:generate + test:run + build
```

Output is a pass/fail matrix at the end. If any row fails, the script exits 1 and tells you which.

GitHub Actions runs the same matrix on every push to `master` and every PR
(`.github/workflows/ci.yml`) — no repository secrets needed; the script falls
back to placeholder env values for `db:generate` and `build`. The live-DB
checks (`smoke:scoped-db`, `verify:db-schema`) stay local since they need a
real Neon branch.

**Pre-push (UI):** there is no git hook — run **`pnpm verify:ui`** before pushing
UI changes. CI runs it as a separate `verify-ui` job (axe always; screenshot
comparison against committed Linux baselines). Screenshot baselines are
**per-platform** (`…-chromium-linux.png` for CI, `…-chromium-darwin.png` for
local macOS) so cross-OS font antialiasing never causes false diffs; after an
intentional visual change, refresh both — your platform with `pnpm verify:ui:update`,
and the Linux baseline in the matching Playwright Docker image (see DESIGN.md §11).

**Transient live-env failures:** capture the complete failing output *before*
any debugging or rerun — protocol in [docs/TESTING.md](docs/TESTING.md).

## Session handoff (context-packager habit)

Building work across multiple sessions in the same phase loses context unless you actively preserve it. The convention: **at the end of a building session, invoke `/context-packager`** to write a handoff packet into the project's memory directory. The next session loads MEMORY.md automatically; the packet's pointer lives there.

Use it when:
- You're closing a session mid-phase and expect to resume later.
- You're handing the project off (to a different machine, a teammate, a future you with no recall).
- A long debugging detour produced findings the next session shouldn't have to re-derive.

Don't bother for short fixes or single-purpose sessions — the cost outweighs the value.

## Project layout

```
src/
├── app/
│   ├── api/
│   │   ├── ai/intake/route.ts       # POST: streaming (SSE) goal-intake endpoint
│   │   ├── ai/plan/route.ts         # POST: one-shot plan generation (non-streaming)
│   │   ├── ai/replan/route.ts       # POST: fill-vs-create replan proposal generation
│   │   ├── inngest/route.ts         # serve({ signingKey })
│   │   ├── me/goals/route.ts        # authed scopedDb round trip (Phase 1 seed)
│   │   └── webhooks/clerk/
│   │       ├── route.ts             # svix-verified Clerk webhook + signup analytics
│   │       └── route.test.ts        # signature-gate integration tests
│   ├── (check-in)/
│   │   ├── layout.tsx               # authenticated check-in-shell segment
│   │   ├── check-in/
│   │   │   ├── page.tsx             # /check-in — weekly check-in form
│   │   │   ├── check-in-form.tsx    # feeling + notes + replan goal picker
│   │   │   │                        #   + per-goal generation fan-out (client)
│   │   │   ├── check-in-model.ts    # pure view-model: cap math, default selection
│   │   │   └── actions.ts           # server actions: submit / skip (upsert + proposals)
│   │   └── replan/
│   │       ├── generate-replan-client.ts  # the client callers of POST /api/ai/replan
│   │       │                        #   (weekly check-in + structural-edit banner)
│   │       └── [goalId]/
│   │           ├── page.tsx         # /replan/<goalId> — diff review / generate / summary
│   │           ├── replan-diff-view.tsx   # diff UI: ✓/✎/✕ per change + commit bar (client)
│   │           ├── replan-model.ts  # pure view-model: change keys, before/after, modes
│   │           ├── apply-plan.ts    # pure planner: decisions → exact table ops (id security)
│   │           └── actions.ts       # server action: atomic decision commit (lockScope)
│   ├── (dashboard)/
│   │   ├── layout.tsx               # authenticated product-shell segment
│   │   └── dashboard/
│   │       ├── page.tsx             # /dashboard — empty-state / active landing
│   │       ├── active-dashboard.tsx # active composition (graduated from playground)
│   │       ├── dashboard-model.ts   # pure view-model: Today / This week / Upcoming
│   │       │                        #   + Accomplished cards + Friday-prompt predicate
│   │       └── check-task.ts        # server action: today's task check-off
│   ├── (equipment)/
│   │   ├── layout.tsx               # authenticated equipment-shell segment
│   │   └── equipment/
│   │       ├── page.tsx             # /equipment — aggregated equipment view
│   │       ├── equipment-list.tsx   # list + optimistic purchased checkbox (client)
│   │       ├── equipment-model.ts   # pure view-model: active goals, urgency buckets
│   │       └── toggle-purchased.ts  # server action: flip purchased_at (zero-write guards)
│   ├── (goals)/
│   │   ├── layout.tsx               # authenticated goals-shell segment
│   │   └── goals/
│   │       ├── page.tsx             # /goals — all-goals list
│   │       ├── goals-list.tsx       # presentational list (server-safe; links only)
│   │       ├── list-model.ts        # pure view-model: progress + next milestone per card
│   │       ├── [id]/
│   │       │   ├── page.tsx         # /goals/:id — goal detail
│   │       │   ├── goal-detail.tsx  # editable detail surface (client)
│   │       │   ├── detail-model.ts  # pure view-model: effective-intensity chain
│   │       │   └── actions.ts       # server actions: intensity override + inline edits
│   │       └── new/
│   │           ├── page.tsx         # /goals/new — intake chat (seed-validated)
│   │           ├── draft.ts         # read-only draft lookup via HttpOnly cookie
│   │           ├── seed-guard.ts    # pure ?seed= 400-decision predicate
│   │           ├── intake-chat.tsx  # streaming chat UI (client)
│   │           ├── intake-flow.tsx  # client orchestrator: chat → confirm → interim
│   │           ├── safety-decision-card.tsx # safety-override card (user decides)
│   │           ├── decide-safety.ts # server action: record the override decision
│   │           ├── intensity-confirm-card.tsx # required intensity confirmation card
│   │           ├── intensity-confirm.ts # pure confirm-step logic
│   │           ├── confirm-intensity.ts # server action: stage confirmed intensity
│   │           ├── plan-generation.tsx # post-confirm surface: kicks POST /api/ai/plan
│   │           ├── bootstrap/
│   │           │   ├── route.ts     # GET: draft mint + cookie on one redirect
│   │           │   └── single-flight.ts # serialized minting (double-GET race)
│   │           └── review/
│   │               ├── page.tsx     # /goals/new/review — draft-plan review/edit
│   │               ├── plan-review.tsx # editable review surface (client)
│   │               ├── review-plan.ts # pure review/edit + color/deadline rules
│   │               └── save-goal.ts # "Save goal": one transaction, draft → rows
│   ├── (settings)/settings/
│   │   ├── page.tsx                 # /settings — account section (first sign-out UI)
│   │   ├── sign-out-button.tsx      # purge AWAITED, then signOut() redirects (S7)
│   │   ├── session-watch.tsx        # best-effort expiry/revocation purge watcher
│   │   └── session-watch-model.ts   # pure signed-in→out transition machine
│   ├── ~offline/page.tsx            # offline fallback screen (SW-precached, served
│   │                                #   for any document request that fails offline)
│   ├── globals.css                  # goal-color palette CSS vars + shadcn tokens
│   ├── page.tsx                     # public landing; redirects signed-in → /dashboard
│   ├── sw.ts                        # service-worker entry — `serwist build` → public/sw.js
│   └── layout.tsx                   # ClerkProvider + SerwistProvider (sw.js registration)
├── components/
│   ├── ui/                          # shadcn/ui (button, card, dialog, … sonner)
│   ├── scene.tsx                    # the one DAWN illustration primitive (tiles are data)
│   ├── scene-data.ts                # DAWN scene definitions as data (drive <Scene>)
│   ├── completion-scene.tsx         # the one signature moment: sunrise on completion
│   ├── motion-provider.tsx          # app-wide Motion runtime (reserved for the sunrise)
│   ├── horizon-header.tsx           # full-bleed dashboard header (scene + greeting scrim)
│   ├── emblem.tsx                   # the Strix owl mark (flat geometric, no face)
│   ├── goal-chip.tsx                # goal dot + name (color never the sole carrier)
│   ├── upgrade-modal.tsx            # free-cap dialog (no upgrade CTA until Phase 3)
│   ├── countdown-stat.tsx           # tabular number + label primitive
│   └── empty-dashboard.tsx          # empty-state composition (pre-dawn scene + CTA + tiles)
├── db/
│   ├── schema.ts                    # all tables, enums, indexes
│   ├── client.ts                    # drizzle + neon-http (private; Layer 2/4 guarded)
│   ├── scoped.ts                    # scopedDb(userId) — atomic inserts, self accessors
│   ├── scoped.test.ts               # synchronous-guard unit tests
│   ├── scoped.integration.test.ts   # live-DB proofs (env-gated on DATABASE_URL)
│   ├── unscoped.ts                  # escape hatch (CI-restricted)
│   └── migrate.ts                   # prod migration runner
├── lib/
│   ├── ai/                          # Anthropic chokepoint (ADR-0001): client, models,
│   │                                #   intake, plan, prompts, schemas, canonicalize,
│   │                                #   session, transcript, safety-flags, today, log,
│   │                                #   replan-diff (the Zod-typed proposal diff),
│   │                                #   replan, adherence
│   ├── analytics/{server,client}.ts # PostHog wrappers
│   ├── inngest/
│   │   ├── client.ts                # Inngest client
│   │   ├── functions.ts             # the serve() registry (3 functions)
│   │   ├── archive-completed-goals.ts # nightly cron: archive due completed goals
│   │   ├── reset-monthly-usage-counters.ts # hourly cron shell (Phase 3 fills body)
│   │   └── sweep-expired-goal-drafts.ts # daily cron: prune expired goal_drafts
│   ├── equipment-deadline.ts        # derived deadline (milestone XOR standalone)
│   ├── equipment-urgency.ts         # urgency buckets from the derived deadline
│   ├── format.ts                    # deterministic display formatters (en-US pinned)
│   ├── goal-colors.ts               # color assignment + the active-goal cap
│   ├── goal-progress.ts             # milestone-derived progress + next milestone
│   ├── goal-scene.ts                # activity_type → Scene variant (completion moment)
│   ├── goal-seeds.ts                # empty-state tiles + the {climb,…} seed whitelist
│   ├── limits.ts                    # free-tier usage caps (SPEC §10)
│   ├── sw/runtime-caching.ts        # SW caching rules — versioned strix-* caches;
│   │                                #   /api/ai/* pinned never-cached; /~offline fallback
│   ├── sw/purge.ts                  # session-end full Cache Storage purge (S7)
│   └── utils.ts                     # shadcn cn() helper
└── proxy.ts                         # clerkMiddleware + public-route whitelist
                                     # (Next 16 renamed middleware.ts → proxy.ts)
```

Architecture decisions live in `docs/adr/` — `0001-ai-client-stack.md` records
the direct-`@anthropic-ai/sdk` choice and the `src/lib/ai/` chokepoint.

Compliance docs live in `docs/legal/` (terms-of-service and privacy-policy
drafts) and `docs/launch/` (ops runbooks: email DNS, Stripe setup, vendor
DPAs).

## Local webhook delivery

Clerk delivers webhooks over the public internet. For local testing, expose
the dev server with `ngrok http 3000` (or use Clerk's test mode) and point
the dashboard's webhook endpoint at `https://<ngrok>/api/webhooks/clerk`.
