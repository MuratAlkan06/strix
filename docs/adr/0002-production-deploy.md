# ADR-0002 — Production deploy decisions for v0.5.0

**Status:** Accepted (frozen) · **Date:** 2026-06-13 · **Phase:** 2.5 → 3 (deploy)

References ADR-0001 (AI client stack). Supersedes nothing.

## Context

Strix is code-complete at `v0.5.0-rc.1` (Phase 2.5 all build slices S1–S9 merged;
every automated gate green). Two things now require a live deployed **HTTPS**
origin to close, and neither works against `http://localhost` on a physical
device:

- Phase 2.5 **gate 4** (installability) — the HTTPS/DevTools half
  (`planning/phase-2.5-pwa-polish.md` gate 4).
- The **device matrix** in `LAUNCH_CHECKLIST.md` (PWA install / standalone /
  SW-offline / sign-out isolation on real iPhones and Androids).

This is net-new production infrastructure across multiple vendors (DB, auth,
background jobs, analytics). The hosting platform is **DECIDED = Vercel**
(Next 16-native; the `next build && serwist build` two-step in `package.json`
already assumes it, and the app uses Turbopack which rules out the classic
webpack-plugin SW mode — see `serwist.config.mjs`).

The decisions below are **frozen**. They are recorded faithfully, not
re-litigated.

## Decisions

### 1. Database — Neon serverless Postgres (US West, `us-west-2`)

- Runtime `DATABASE_URL` = the Neon **POOLED** string (`-pooler` host,
  `sslmode=require`).
- Schema migrations run **MANUALLY by the owner** against the **DIRECT**
  (non-pooled) host via a dedicated `DIRECT_DATABASE_URL` — **never** in the
  Vercel build. Locally this is `pnpm db:migrate` (`tsx src/db/migrate.ts`).
  The migration runner reads `DIRECT_DATABASE_URL` (falling back to
  `DATABASE_URL`) and **refuses** a resolved `-pooler` host (CS-7).
- The Vercel serverless pooling footgun is **already handled in code**: the
  WebSocket `Pool` is constructed **per call inside `withTransactionalDb`**
  (`src/db/client.ts`), not at module scope. The default driver is
  `drizzle-orm/neon-http` (stateless HTTP, safe at module scope). This is the
  same posture documented in `README.md` §"Driver choice (Vercel serverless
  footgun)".

### 2. Region — `pdx1` (US West, Oregon)

Vercel functions pinned to `pdx1`, co-located with the reused Neon `us-west-2`
DB and the operator's US-West location (PostHog US ingestion is region-agnostic)
to minimize cross-region latency on every request and background job.

### 3. `STRIX_BUILD_ID` — build-injected, not an env var

- `STRIX_BUILD_ID` is **NOT** a Vercel environment variable. It is injected by
  `serwist build` via an esbuild `define` from `.next/BUILD_ID`
  (`serwist.config.mjs`), so the value reaches the service-worker bundle (an env
  var would never reach the SW).
- Slice **CS-1** pins Next's `generateBuildId` to `VERCEL_GIT_COMMIT_SHA`, so the
  SW cache version (`strix-shell-<id>`, `strix-dashboard-<id>`) equals the commit
  SHA. Result: deterministic cache eviction on deploy and self-healing rollback.
  Local builds fall back to Next's default `BUILD_ID`.

### 4. Auth — decouple the custom domain; adopt embedded Clerk auth now (D1 + A2)

**Decouple the custom domain from the v0.5.0 gate.** Run the device matrix on a
`*.vercel.app` **PREVIEW** with a Clerk **DEV** instance. Clerk prohibits
production keys on `*.vercel.app`; dev-on-preview is Clerk's documented
recommendation.

**Adopt embedded Clerk auth now (A2).** Add `app/sign-in/[[...sign-in]]` and
`app/sign-up/[[...sign-up]]` rendering `<SignIn/>` / `<SignUp/>`, with
`NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in` and
`NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up`, so `redirectToSignIn()` and the
middleware route **in-app**. The middleware already public-lists `/sign-in(.*)`
and `/sign-up(.*)` (`src/proxy.ts`). Cosmetic appearance/localization is deferred
to Phase 5.

Result: email/password auth stays **on-origin** (no PWA standalone pop-out).

**Residual native-feel carve-out** (NOTE, not FAIL, on the device matrix):

- (a) the Clerk DEV-instance dev-browser handshake can main-frame-redirect to
  `accounts.dev` — **PREVIEW-only**, genuinely resolved at the prod cutover with
  a prod instance + same-domain cookies;
- (b) OAuth social (Google/Apple) inherently leaves to the provider's consent
  screen — unavoidable and identical in dev and prod.

### 5. v0.5.0 reframing

**v0.5.0 certifies native-feel on the PREVIEW environment.** The **PRODUCTION**
standup (custom domain + Clerk PROD instance + prod Neon + prod PostHog +
Stripe) is **Phase 3**.

### 6. Inngest — official Vercel integration (D2)

- Use the official **Inngest Vercel integration** (auto-sets
  `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY`, auto-syncs functions on deploy).
  Install on PREVIEW now; Production rides the cutover.
- **SECURITY (B1):** `INNGEST_DEV` **must be ABSENT in every Vercel scope.** If
  truthy, `/api/inngest` skips signature verification — world-callable cron
  triggers. Verify with an **unsigned POST → expect 401**. (The route is
  Clerk-public by design in `src/proxy.ts`; the SDK verifies the signing key
  itself, so the signature check is the only gate.)

### 7. Preview database — one shared preview Neon DB (D3)

ONE shared preview Neon DB (a **separate project** from the future prod DB),
migrated against the **direct** host and seeded **before** the matrix runs.
**NOT** branch-per-preview.

### 8. Preview analytics — separate preview PostHog project (D4)

A separate preview PostHog project, to keep matrix events out of prod funnels.

### 9. Spend + protection (D5)

- **DEFER** the Anthropic spend guardrail (issue #19).
- Do **NOT** enable Vercel **Deployment Protection** — it gates the whole origin
  and breaks clean-install gates 1/6/7. Verified: no path-scoped mode exists.
- Compensating controls: `clerkMiddleware` already gates `/api/ai/*`; the
  preview URL stays unpublicized; a short matrix window; **DELETE** the preview
  deployment **and** the installed preview PWA after the matrix.

### 10. Secrets

All server secrets are **server-only** in Vercel env; none appear in any
`NEXT_PUBLIC_*` variable.

## Environment surface

| Variable | server-only / public | Source | build-time / runtime | Vercel scope |
|---|---|---|---|---|
| `DATABASE_URL` | server | Neon **pooled** | runtime | preview (+ prod later) |
| `DIRECT_DATABASE_URL` | server | Neon **direct** | migration-time only | **not** in Vercel runtime — used locally for `db:migrate` |
| `CLERK_SECRET_KEY` | server | Clerk **dev** (for preview) | runtime | preview |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public | Clerk **dev** (for preview) | build-time (inlined) | preview |
| `CLERK_WEBHOOK_SECRET` | server | dev-instance webhook (for preview) | runtime | preview |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` = `/sign-in` | public | — | build-time | preview |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` = `/sign-up` | public | — | build-time | preview |
| `ANTHROPIC_API_KEY` | server | Anthropic | runtime | preview |
| `INNGEST_SIGNING_KEY` | server | integration-managed | runtime | preview |
| `INNGEST_EVENT_KEY` | server | integration-managed | runtime | preview |
| `INNGEST_DEV` | server | — | — | **MUST be absent** in preview + prod |
| `STRIX_BUILD_ID` | — | **build-injected** by serwist | build-time | **NOT a Vercel var** |
| `POSTHOG_API_KEY` | server | PostHog | runtime | preview |
| `NEXT_PUBLIC_POSTHOG_KEY` | public | PostHog | build-time | preview |
| `POSTHOG_HOST` = `https://us.i.posthog.com` | server | PostHog | runtime | preview |
| `NEXT_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com` | public | PostHog | build-time | preview |
| `NEXT_PUBLIC_REPLAN_ENABLED` = `true` | public | — | build-time | preview |

## Code slices (specs only — implemented in later commits)

- **CS-1** — `next.config.ts`: `generateBuildId` → `VERCEL_GIT_COMMIT_SHA`
  (fallback `null` locally, i.e. Next's default `BUILD_ID`).
- **CS-2** — new `vercel.json`: `{ "regions": ["pdx1"] }`. Do **NOT** override
  `buildCommand` — keep `next build && serwist build`.
- **CS-3** — add `export const maxDuration = 300` to
  `src/app/api/inngest/route.ts`. Valid on Hobby **and** Pro under Vercel fluid
  compute — confirm fluid compute is enabled (the existing AI routes' 120/90/90
  already depend on it).
- **CS-4** — mount `<SessionWatch/>` in `src/app/layout.tsx` **inside**
  `<ClerkProvider>`, wrapping `<MotionProvider>`. This closes the S7
  "settings-only" limitation now that S6 merged and strengthens gate 9.5. Flip
  the limitation note in `planning/phase-2.5-pwa-polish.md` and
  `docs/DECISIONS.md`.
- **CS-5** — add `import "server-only"` to `src/lib/analytics/server.ts` and
  `src/lib/ai/client.ts`.
- **CS-6** — embedded auth routes per Decision 4.
- **CS-7** — `src/db/migrate.ts` reads `DIRECT_DATABASE_URL ?? DATABASE_URL`
  and refuses a `-pooler` host; `drizzle.config.ts` mirrors the preference
  (no reject — it also backs `db:generate`/`db:push`).
- **CI tripwire** — fail CI if Stripe/commerce code (an `sk_live_` literal or a
  `stripe` import) appears without a committed `.prod-cutover-verified` marker.

## Phase-3 commerce exit gate (flag #1, BLOCKING)

Before **any** Phase-3 commerce/Stripe ships to a real paying user, **both** must
pass:

1. the prod cutover — custom domain + Clerk **prod** instance + prod Neon + prod
   PostHog; **and**
2. a **re-run** of the native-feel + gate-9.5 matrix on the **real prod origin**.

Enforced by:

- the **CI tripwire** (the `.prod-cutover-verified` marker);
- a **runtime Stripe-live-key guard** to be implemented in Phase 3 (throw unless
  `STRIX_PROD_CUTOVER_VERIFIED=1`);
- tracking issue **#70**.

## Provisioning runbook (PREVIEW), ordered

1. Deploy preview.
2. Install the Inngest integration → **REDEPLOY** → verify the app is synced in
   the Inngest dashboard.
3. Wire the Clerk dev-instance webhook + dev `CLERK_WEBHOOK_SECRET` → the preview
   URL.
4. Verify **one throwaway signup** creates a `users` row (webhook delivery)
   **BEFORE** the matrix.
5. Migrate the preview DB against the **DIRECT** host → seed → verify a known
   row.
6. Confirm `INNGEST_DEV` is absent in all Vercel scopes + fluid compute enabled +
   no Deployment Protection.
7. Run the device matrix.
8. Teardown: delete the preview deployment + the installed preview PWA.

## Verification

- **gate-4 installability** — the DevTools/HTTPS half (supersedes the Lighthouse
  PWA score per `docs/DECISIONS.md`).
- **gate-9.5** — sign-out cache purge on the real HTTPS authed `/dashboard`
  (Clerk-instance-agnostic; the purge lives in `src/lib/sw/purge.ts` and the
  `SessionWatch` path).
- **design-reviewer APPROVE** on the embedded-auth + install-affordance UI.
- **owner-run device matrix** per `LAUNCH_CHECKLIST.md` (iPhone 15 Pro, SE 3,
  Pixel 8, Galaxy S22; gates 1, 2, 3, 6, 7, 8, 9, 9.5, 10).

**Evidence split (N1):** raw phone screenshots/recordings → the **UNCOMMITTED**
sibling dir `strix-phase2.5-evidence/` (PII / test-account data stays out of
git); the pass/fail table + project-lead sign-off → `LAUNCH_CHECKLIST.md`
(committed = the durable verdict).

## Rollback

- **Deployment unit = the Vercel build** → promote the previous production
  deployment (instant alias swap).
- `v0.5.0-rc.1` stays the safe fallback (additive slices, no destructive code
  migration).
- SW rollback **self-heals** via `deleteStaleStrixCaches` on `activate`.
- DB via Neon point-in-time restore / branch.
- The Clerk dev instance is untouched, so previews keep working.

## Rejected alternatives

- **AWS via OpenNext** — Next-native Vercel wins pre-launch.
- **A single `DATABASE_URL` on the direct host** — forgoes pooling for the `Pool`
  path.
- **`STRIX_BUILD_ID` as a Vercel env var** — would never reach the serwist SW
  bundle.
- **Auto-migrate in the Vercel build** — a build must never mutate prod schema.
- **The Vercel Deployment Protection wall** — gates the origin, breaks
  clean-install gates.
- **Hosted-Account-Portal-only for v0.5.0** — a permanent off-origin auth
  pop-out; superseded by A2 embedded auth.

## Consequences

- Minimal code change.
- Previews authenticate against the Clerk dev pool.
- Migrations are a deliberate, manually gated step.
- The single deferred risk (prod-only auth re-verify) is **enforced**, not just
  documented.
