# Security review record — PR #71 (ADR-0002 hardening slices CS-5/CS-6/CS-7)

**Date:** 2026-07-20 · **Reviewer:** security-dependency-reviewer (Opus) ·
**Verdict:** **APPROVE**

**Scope:** slices **CS-5**, **CS-6**, **CS-7** from ADR-0002 "Code slices", as
merged in **PR #71**. Reviewed against **current `master`**, verified
**byte-identical** to the PR #71 merge state (no post-merge drift in the
reviewed files).

**Refs:** ADR-0002 (`docs/adr/0002-production-deploy.md`) · #70 (prod cutover) ·
#7 (launch umbrella) · #92 (Phase-3 slice scoping). Companion docs: the
production cutover plan (`docs/deploy/prod-cutover-plan.md` → "Security gates")
and the slice plan (`planning/phase-3-commerce.md` → "Slice plan", slice **S0**
carries the cutover-blocking fixes).

This is a **retroactive** record: the slices already merged green. The review
confirms they are safe **and** surfaces the residual findings that gate the
Phase-3 cutover, so S0 can carry them explicitly rather than rediscovering them
mid-cutover.

---

## What each slice was

- **CS-5** — `import "server-only"` on `src/lib/analytics/server.ts` and
  `src/lib/ai/client.ts` (keep server secrets out of any client bundle).
- **CS-6** — embedded auth routes `app/sign-in/[[...sign-in]]` /
  `app/sign-up/[[...sign-up]]` (ADR-0002 Decision 4; keeps email/password auth
  on-origin).
- **CS-7** — `src/db/migrate.ts` reads `DIRECT_DATABASE_URL ?? DATABASE_URL`
  and refuses a `-pooler` host; `drizzle.config.ts` mirrors the preference.

---

## Findings

| Item | Concern reviewed | Verdict | Residual finding | Severity | Bucket |
|---|---|---|---|---|---|
| **CS-5** | server-only boundary on the two named modules | **CLEAN** | `src/db/client.ts` (holds `DATABASE_URL` + Neon client) has no `import "server-only"` | **Low** | [pre-public-launch] |
| **CS-6** | embedded auth routes, middleware public-listing | **CLEAN** | `src/app/playground/*` routes are public (public-listed in `src/proxy.ts`) and ship to prod | **Low** | [pre-public-launch] |
| **CS-7** | direct-host preference + `-pooler` rejection | **CLEAN on the stated concerns** | no **env-identity assertion** on the resolved migration target — the guard rejects a pooler host but never confirms *which prod DB* it is about to migrate | **Medium** | **[cutover-blocking]** |
| **CS-7** | migration failure surface | — | raw error object surfaced on failure (may echo the connection string / host) | **Low** | [pre-public-launch] |
| **Adjacent** | `/api/inngest` signature gate | — | `INNGEST_DEV` is a **config-only** gate (ADR-0002 Decision 6); truthy → signature verification skipped → world-callable cron. No runtime assertion binds it. | **Medium** | **[now] / [cutover-blocking]** |
| **Dependencies** | transitive advisories | — | **12 new** transitive advisories across **axios**, **brace-expansion**, **body-parser**; **low reachability** (not on a request path we invoke) | (advisory) | [pre-public-launch] |

**Net:** no Highs, no Criticals; the reviewed slices are CLEAN. Two **Medium**
items are **cutover-blocking** (migration-target identity; the Inngest
config-only gate). Everything else is **[pre-public-launch]**.

---

## Required fixes (4) + optional hardening

Carried by slice **S0** in the slice plan; the two cutover-blocking items must
**merge before Track C migration and the Phase-3 env-flip**
(`docs/deploy/prod-cutover-plan.md`).

**Required — [cutover-blocking]:**

1. **Migration prod-target confirmation** in `src/db/migrate.ts` — echo the
   **resolved host only** (never the full credentialed URL) and require an
   explicit confirm **or** a `STRIX_MIGRATE_TARGET` allowlist match before
   `migrate()` runs. Closes the CS-7 Medium.
2. **`INNGEST_DEV`-while-`VERCEL` guard** — a code guard that **throws** when
   `INNGEST_DEV` is truthy while `VERCEL` is set. Turns ADR-0002 Decision 6's
   config-only rule into a hard runtime assertion. Closes the adjacent Medium.

**Required — [pre-public-launch]:**

3. **Playground routes** — delete or route-block `src/app/playground/*` and drop
   them from the `src/proxy.ts` public list before public traffic.
4. **Dependency overrides** — add `pnpm.overrides` for `axios >=1.18.0`,
   `brace-expansion >=5.0.7`, `body-parser >=2.3.0` (slots into the existing
   `pnpm.overrides` block in `package.json`).

**Optional hardening:**

- `import "server-only"` at the top of `src/db/client.ts` (defense-in-depth for
  the CS-5 Low; the module is already import-restricted by
  `scripts/check-unscoped-db.mjs`).

Additionally noted for **Tier C** (`docs/deploy/prod-cutover-plan.md`): the CI
tripwire (`scripts/check-prod-cutover-gate.mjs`) should later be hardened to
catch `@stripe/*` specifiers + `api.stripe.com` (C1), and the raw
migration-error surface (CS-7 Low) should be reduced to host-only.
