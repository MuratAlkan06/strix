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
`src/lib/inngest/**`, `src/app/api/webhooks/**`, and
`src/lib/auth/lifecycle.ts` (Phase 4's soft-delete + recovery module). CI
enforces this:

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
| `pnpm ci:check-unscoped` | Four-layer access-isolation check (unscopedDb imports, raw-client imports, scopedDb call shape — default-deny, raw driver imports) |
| `pnpm ci:check-doc-parity` | Deterministic doc↔code parity (layer-count phrase, allowlist quotes, enum lists in PLAN.md/verify-schema, README layout-tree paths). Invariants are admitted only after a real drift burned us — see the script header. |
| `pnpm verify:phase-0` | Run the full Phase 0 verification matrix |
| `pnpm verify:ui` | UI gate: Playwright + axe-core (WCAG 2.1 AA, zero violations) on `/playground/dashboard` + screenshot baselines. Production server, reduced motion. First run on a new machine: `pnpm exec playwright install chromium`. |
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
│   │   ├── inngest/route.ts         # serve({ signingKey })
│   │   ├── me/goals/route.ts        # authed scopedDb round trip (Phase 1 seed)
│   │   └── webhooks/clerk/
│   │       ├── route.ts             # svix-verified Clerk webhook + signup analytics
│   │       └── route.test.ts        # signature-gate integration tests
│   ├── (dashboard)/
│   │   ├── layout.tsx               # authenticated product-shell segment
│   │   └── dashboard/page.tsx       # /dashboard — empty-state / active landing
│   ├── (settings)/settings/page.tsx # placeholder shell
│   ├── globals.css                  # goal-color palette CSS vars + shadcn tokens
│   ├── page.tsx                     # public landing; redirects signed-in → /dashboard
│   └── layout.tsx                   # ClerkProvider
├── components/
│   ├── ui/                          # shadcn/ui (button, card, dialog, … sonner)
│   ├── scene.tsx                    # the one DAWN illustration primitive (tiles are data)
│   └── empty-dashboard.tsx          # empty-state composition (pre-dawn scene + CTA + tiles)
├── db/
│   ├── schema.ts                    # all tables, enums, indexes
│   ├── client.ts                    # drizzle + neon-http (private; Layer 2/4 guarded)
│   ├── scoped.ts                    # scopedDb(userId) — atomic inserts, self accessors
│   ├── scoped.test.ts               # synchronous-guard unit tests
│   ├── unscoped.ts                  # escape hatch (CI-restricted)
│   └── migrate.ts                   # prod migration runner
├── lib/
│   ├── analytics/{server,client}.ts # PostHog wrappers
│   ├── inngest/
│   │   ├── client.ts                # Inngest client
│   │   └── sweep-expired-goal-drafts.ts # daily cron: prune expired goal_drafts
│   ├── goal-seeds.ts                # empty-state tiles + the {climb,…} seed whitelist
│   └── utils.ts                     # shadcn cn() helper
└── proxy.ts                         # clerkMiddleware + public-route whitelist
                                     # (Next 16 renamed middleware.ts → proxy.ts)
```

## Local webhook delivery

Clerk delivers webhooks over the public internet. For local testing, expose
the dev server with `ngrok http 3000` (or use Clerk's test mode) and point
the dashboard's webhook endpoint at `https://<ngrok>/api/webhooks/clerk`.
