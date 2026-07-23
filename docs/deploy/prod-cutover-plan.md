# Production cutover plan — Phase 3 commerce exit gate

**Status:** Proposed · **Date:** 2026-07-20 · **Phase:** 3 (commerce standup)

**Purpose:** the concrete runbook that closes the **issue #70** exit gate — the
production standup (custom domain + Clerk **prod** instance + prod Neon + prod
PostHog + Stripe) deferred out of v0.5.0. This is the gate every Phase-3
commerce slice charges through before it can touch a real paying user.

**Refs:** #70 (cutover tracking) · #7 (launch umbrella) · #92 (Phase-3 slice
scoping) · ADR-0002 (`docs/adr/0002-production-deploy.md`, the frozen deploy
contract). Companion docs: the slice plan
(`planning/phase-3-commerce.md` → "Slice plan") and the security record
(`docs/security/pr-71-retroactive-review.md`).

This plan **records and sequences** the frozen ADR-0002 decisions; it does not
re-litigate them. It uses the ADR-0002 gate names, decision numbers, env-table
format, and the `LAUNCH_CHECKLIST.md` device-matrix vocabulary verbatim.

---

## Phase 0 — Decisions (resolve before touching DNS)

### 0.1 Decide + register the production domain

The **root dependency** of everything below. The domain is **decided:
`joinstrix.com`** (issue #70 — registered at Porkbun 2026-07-22, DNS delegated
to Vercel; **Phase 1 holds until the attorney confirms the trademark**) and
`docs/launch/email-dns.md` is updated to it. The ToS (#8) and Privacy (#9)
drafts still carry the **[PLACEHOLDER: production domain]** pending their own
pass. It binds the Clerk prod instance, the Stripe public-details URLs, and the
Resend sending subdomain. Practically **irreversible**: once Clerk prod cookies,
Stripe URLs, and email DKIM are pinned to it, changing it means re-doing
Phases 1–3.

**Decide, register, and put DNS under management before Phase 1.** A domain
change after Phase 1 restarts from 0.1 (see Revisit triggers).

### 0.2 Clerk dev-user disposition

The Clerk **prod** instance is **NEW**: dev-instance users **do not carry
over**. Decision (accepted): treat dev users as **throwaway pre-launch** — no
migration. The **dev instance survives** for `*.vercel.app` previews
(ADR-0002 Decision 4/5). **Revisit trigger:** any real user signs up on a
preview before cutover — at that point the throwaway assumption breaks and this
must be re-decided (see Revisit triggers).

---

## Phase 1 — One DNS session (start all propagation clocks together)

Do all DNS changes in a **single session** so the propagation clocks run in
parallel rather than end-to-end. Three record sets:

1. **Vercel domain attach** — add the production domain to the Vercel project;
   create the A/CNAME records Vercel dictates.
2. **Clerk prod-instance CNAMEs** — the prod instance's Frontend API / accounts
   / DKIM CNAMEs. **DNS-only, no proxying** (an orange-cloud proxy breaks
   Clerk's cert issuance). Propagation is the long pole here: **up to 48h**.
3. **Resend email DNS** — the DKIM/SPF/MX + DMARC set per
   `docs/launch/email-dns.md` **steps 2–5** (sending subdomain `send.<domain>`,
   DMARC `p=none` on the root). **Pulled forward from #15** on purpose:
   Phase 3 ships the trial-ending reminder email, and a reminder in spam is a
   surprise charge is a chargeback. Email deliverability is load-bearing the
   moment trials exist.

**Rollback:** DNS records are cheap to change or remove. The sticky, expensive
part is the **domain choice** (0.1) — not the records themselves.

---

## Phase 2 — Parallel provisioning tracks (during propagation)

While the DNS clocks run, stand up the vendor projects. These tracks are
independent and run concurrently.

### Track B — Clerk prod instance

- Create the prod instance; complete the domain wiring from Phase 1.
- Create the **prod webhook endpoint** → the Clerk dashboard issues a **new
  prod `CLERK_WEBHOOK_SECRET`**. The dev-instance secret **will not verify**
  prod deliveries (svix signature mismatch) — a fresh secret is mandatory, not
  optional.
- If Google/Apple social login is enabled at cutover: register **own OAuth
  credentials** (prod client IDs/secrets) — an extra Track-B substep. See
  Open question 4.
- **Exit gate:** DNS verified + SSL issued for the prod domain in Clerk.
- Retire **ADR-0002 Decision 4 carve-out (a)** — the accounts.dev dev-browser
  main-frame redirect. With a prod instance + same-domain cookies this
  genuinely resolves (it was always PREVIEW-only). Carve-out **(b)** (OAuth
  social leaves to the provider's consent screen) stays a **permanent NOTE** —
  unavoidable, identical in dev and prod.

### Track C — Neon prod database

- **Separate project** from the preview DB (ADR-0002 Decision 7 — the preview
  DB was always a separate project from the future prod DB). Region
  `us-west-2` (ADR-0002 Decision 1/2, co-located with `pdx1`).
- #70's "branch promoted" reduces to **confirming the default branch** — a
  reversible metadata op, not a data migration.
- Record the **pooled `DATABASE_URL`** (`-pooler` host, `sslmode=require`) and
  the **direct `DIRECT_DATABASE_URL`** (non-pooler host).
- The owner **migrates locally against the DIRECT host only** — `pnpm
  db:migrate` reads `DIRECT_DATABASE_URL` and refuses a `-pooler` host
  (ADR-0002 Decision 1; `src/db/migrate.ts` `resolveMigrationUrl`). A build
  must never mutate prod schema.
- **Precondition:** the **S0 migration-target guard** (see Security gates) must
  be **merged first** — no prod migration runs until the migrate runner asserts
  it is pointed at the intended prod host.
- Verify schema (`pnpm verify:db-schema` against the direct host).
- **Rollback:** Neon PITR / branch. The DB is **empty pre-launch**, so a
  restore loses nothing.

### Track D — PostHog prod project

- Create the prod project (ADR-0002 Decision 8 keeps preview events out of prod
  funnels; this is the prod complement). **Reversible.**
- **Gate PostHog init/capture on consent** (or run it in **cookieless / opt-in
  mode**) **from the flip onward.** Wiring the keys is fine, but because
  `NEXT_PUBLIC_POSTHOG_KEY` is **build-time inlined** the client SDK initializes
  for **every** visitor and the prod origin is **guessable** — an
  "owner-traffic-only, don't publicize the origin" carve-out is **not a
  control**. The control is **consent-gated (or cookieless) capture**. This
  **strengthens**, and does not change, the Tier-B **"#11 before public
  traffic"** gate. See Tier B.

### Track E — Inngest (prod)

- Install the official Inngest Vercel integration on Production (ADR-0002
  Decision 6); it auto-sets `INNGEST_SIGNING_KEY` + `INNGEST_EVENT_KEY` and
  auto-syncs functions. It **rides the first green prod deploy** (Phase 3).
- **Negative check:** `INNGEST_DEV` **absent in every Vercel scope** (ADR-0002
  Decision 6 / B1). Truthy = `/api/inngest` skips signature verification =
  world-callable cron triggers.

---

## Phase 3 — Single atomic env-flip

**Precondition: Tracks B, C, AND D complete.** Never flip with only C — a
live domain backed by a **dev** Clerk instance is the partial state that leaks
real signups into the dev user pool. **Track D is a precondition too:**
`NEXT_PUBLIC_POSTHOG_KEY` is **build-time inlined**, so flipping without the
prod PostHog project bakes an **absent/wrong** key into the prod bundle and
forces a **second flip** to correct it. (Track E legitimately **rides** the
first deploy — its keys are integration-managed at runtime; Track D **cannot**.)

### Set the prod-scope environment

Match the ADR-0002 "Environment surface" format; **prod** scope.

| Variable | server-only / public | Source | build-time / runtime | Set at flip? |
|---|---|---|---|---|
| `DATABASE_URL` | server | Neon prod **pooled** | runtime | **yes** |
| `CLERK_SECRET_KEY` | server | Clerk **prod** (`sk_live_`) | runtime | **yes** |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | public | Clerk **prod** (`pk_live_`) | build-time (inlined) | **yes** |
| `CLERK_WEBHOOK_SECRET` | server | Clerk **prod** webhook endpoint | runtime | **yes** |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` = `/sign-in` | public | — | build-time | **yes** |
| `NEXT_PUBLIC_CLERK_SIGN_UP_URL` = `/sign-up` | public | — | build-time | **yes** |
| `ANTHROPIC_API_KEY` | server | Anthropic | runtime | **yes** |
| `POSTHOG_API_KEY` | server | PostHog **prod** | runtime | **yes** |
| `NEXT_PUBLIC_POSTHOG_KEY` | public | PostHog **prod** | build-time | **yes** |
| `POSTHOG_HOST` = `https://us.i.posthog.com` | server | PostHog | runtime | **yes** |
| `NEXT_PUBLIC_POSTHOG_HOST` = `https://us.i.posthog.com` | public | PostHog | build-time | **yes** |
| `NEXT_PUBLIC_REPLAN_ENABLED` = `true` | public | — | build-time | **yes** |
| `INNGEST_SIGNING_KEY` | server | integration-managed | runtime | Track E |
| `INNGEST_EVENT_KEY` | server | integration-managed | runtime | Track E |
| `DIRECT_DATABASE_URL` | server | Neon **direct** | migration-time only | **NO — never in Vercel runtime** |
| `INNGEST_DEV` | — | — | — | **NO — must be ABSENT in every scope** |
| `STRIX_BUILD_ID` | — | build-injected by serwist | build-time | **NO — not a Vercel var** |

**Key-prefix check (silent-failure guard):** confirm `pk_live_` /`sk_live_`
prefixes on the Clerk keys. A `pk_test_` here is the **silent** failure —
the app boots, auth "works" against the dev pool, and nothing errors.

### The red → green flip

A **fresh prod deploy** is the flip. Before it: the module-scope throw at
`src/db/client.ts:23-25` (`throw new Error("DATABASE_URL is not set")`) fires on
any prod invocation → **red**. After the env is set and a **new** build ships →
**green**. `NEXT_PUBLIC_*` values **bake in at build time** — **never reuse an
old build**; always deploy fresh so the inlined prod keys are the ones served.

### Post-deploy smoke (on the prod origin, before Phase 4)

- **(a)** throwaway **prod** signup → a `users` row appears (proves Clerk prod
  + prod webhook secret + prod DB end-to-end).
- **(b)** unsigned `POST /api/inngest` → **401** (proves `INNGEST_DEV` absent;
  ADR-0002 Decision 6 negative check).
- **(c)** the gate-4 **automated half** on the prod origin
  (`Page.getAppManifest` clean, SW registered with a fetch handler, HTTPS +
  HSTS — per `LAUNCH_CHECKLIST.md`).
- **(d)** sign-in on the domain does **NOT** main-frame-redirect to
  `accounts.dev` (proves Track-B carve-out (a) retired).

---

## Phase 4 — Verification matrix on the prod origin

Re-run the native-feel + gate-9.5 matrix on the **real prod origin** — the
second half of the #70 exit gate. This is the **4-device matrix owed from
v0.5.0's "honest gap"** (`LAUNCH_CHECKLIST.md` — v0.5.0 accepted MacBook-only
coverage and deferred the mobile matrix here).

**Devices:** iPhone 15 Pro (Safari), iPhone SE 3 (Safari), Pixel 8 (Chrome),
Galaxy S22 (Chrome).

| Gate | iPhone 15 Pro | iPhone SE 3 | Pixel 8 | Galaxy S22 |
|---|---|---|---|---|
| 1 — No browser chrome post-install | ☐ | ☐ | ☐ | ☐ |
| 2 — Cold-launch speed (median 5 < 2.0s) | ☐ | ☐ | ☐ | ☐ |
| 3 — No URL-bar reveal on scroll | ☐ | ☐ | ☐ | ☐ |
| 6 — Add-to-Home-Screen / standalone + safe-area | ☐ | ☐ | ☐ | ☐ |
| 7 — In-app nav chrome-less | ☐ | ☐ | ☐ | ☐ |
| 8 — Resume after force-quit (authed) | ☐ | ☐ | ☐ | ☐ |
| 9 — Offline cached dashboard | ☐ | ☐ | ☐ | ☐ |
| 9.5 — Sign-out offline-data isolation | ☐ | ☐ | ☐ | ☐ |

> **No double-counting.** **Gate 10 (Android parity)** is **not** a separate row
> — it *is* the **Pixel 8 / Galaxy S22 columns of gates 6–9.5** above; checking
> those two columns *is* gate 10. **N1** (sign-out offline-data isolation,
> **owner-run**) is a **MacBook-only** owner-device re-confirm per
> `LAUNCH_CHECKLIST.md` line 128 — **distinct** from gate 9.5's per-device
> coverage — so it is **not** a column in this 4-device matrix.

**Pre-check each device:** confirm it resolves the production domain **freshly**
(flush/verify no stale resolver cache) before running its column — a mid-
propagation stale record produces false failures.

**Evidence protocol (per the "Evidence split" rule in ADR-0002 + `LAUNCH_CHECKLIST.md`):**

- **Raw media** (screenshots, recordings, per-cell timings) → the
  **UNCOMMITTED** sibling directory `strix-phase2.5-evidence/` (PII /
  test-account data stays out of git).
- **Verdict table + project-lead sign-off** → **`LAUNCH_CHECKLIST.md`**
  (committed = the durable record).

---

## Phase 5 — Cutover marker (LAST)

Only after Phase 4 is green.

1. Commit the empty marker file **`.prod-cutover-verified`** at the repo root.

   > **Discrepancy resolved (2026-07-22 doc-reconciliation slice):** ADR-0002
   > (lines 173/186) and `LAUNCH_CHECKLIST.md` (line 18) previously named the
   > marker **`PROD_CUTOVER_VERIFIED`**; they now match the enforcing script
   > `scripts/check-prod-cutover-gate.mjs`, whose exported `MARKER_FILE` is
   > **`.prod-cutover-verified`** — the authoritative name to commit. The
   > runtime env var `STRIX_PROD_CUTOVER_VERIFIED=1` (below) is a correctly-named,
   > intentionally distinct variable and was left unchanged. This plan is
   > **not** creating the marker — it documents it.

2. In the **same commit**, land the filled-in `LAUNCH_CHECKLIST.md` Phase-4
   verdict table + sign-off (evidence and marker ship atomically).

3. In the **same session**, set `STRIX_PROD_CUTOVER_VERIFIED=1` in the prod
   Vercel scope — the runtime Stripe-live-key guard (ADR-0002 Phase-3 exit gate,
   implemented in S2/S3) throws unless this is present.

---

## Security gates (from PR #71 retroactive review — `docs/security/pr-71-retroactive-review.md`, verdict APPROVE)

### [cutover-blocking] S0 hardening — MERGE BEFORE Track C migration + Phase 3 flip

The **S0** slice (see the slice plan) must land before any prod migration or the
env-flip:

1. **Prod-target confirmation in `src/db/migrate.ts`** — echo the **resolved
   host only** (never the full URL with credentials) and require an explicit
   confirm or a `STRIX_MIGRATE_TARGET` allowlist match before running. Closes
   the CS-7 "no env-identity assertion on the migration target" Medium.
2. **Code guard** that throws when `INNGEST_DEV` is truthy while `VERCEL` is
   set — turns the ADR-0002 Decision 6 config-only rule into a hard runtime
   assertion (closes the adjacent `/api/inngest` Medium).
3. **(optional)** `import "server-only"` at the top of `src/db/client.ts`.

### [pre-public-launch] (not cutover-blocking; before public traffic)

- **Playground routes:** delete or route-block `src/app/playground/*` and drop
  them from the `src/proxy.ts` public list.
- **Dependency overrides:** add `pnpm.overrides` for `axios >=1.18.0`,
  `brace-expansion >=5.0.7`, `body-parser >=2.3.0` (12 new transitive
  advisories, low reachability). Slots into the existing `pnpm.overrides` block
  in `package.json`.

---

## Three-tier gate table

Which gates block which milestone. Read top-down: nothing in Tier B/C blocks
Tier-A work.

### Tier A — blocks Phase-3 development in **test mode**

- **#10 test-mode prices** created + the four `price_…` IDs recorded (feeds
  `lib/billing/config.ts`; `docs/launch/stripe-setup.md` §2–3).
- **Tax-presentation decision** (inclusive vs exclusive) — changes Price
  creation **and** ToS §5.1; must **precede attorney review** (#8).
- **#8 published ToS URL** — blocks completing the **trial slice's** done-when
  even in test mode (Stripe trial Checkout requires the ToS URL /
  `consent_collection.terms_of_service`). **Non-trial slices are NOT blocked**
  by #8.
  - **Scheduling risk:** this puts **S4's** done-when behind the **longest**
    external lead (attorney review, #8). Consider a **partial done-when** — land
    S4's **non-ToS** parts (silent-conversion, dunning) with only the
    **trial-start Checkout** gated on #8.
- **The cutover marker** gates **any Stripe-importing merge** — the CI tripwire
  (`scripts/check-prod-cutover-gate.mjs`) fails a `stripe` import without
  `.prod-cutover-verified`. **Stance: cutover-before-any-Stripe-merge** — do
  not fight the tripwire. (Open question 3.) **Scope note:** its
  `scanForCommerce` walks only `src/**`, so **keep all Stripe-touching code
  under `src/`** or the tripwire cannot see it.

### Tier B — blocks **charging real users**

- The **full cutover checklist** above, including the **device matrix**
  (Phase 4).
- **#8 + #9** published at **stable prod-domain URLs**, linked from settings +
  signup, and wired into Stripe public details.
- **#10 live half** — Stripe Tax enabled in **live** mode + jurisdiction
  registrations filed (external lead; `docs/launch/stripe-setup.md` §4).
- **#11 cookie consent** shipped **before/with** any PostHog-prod **public**
  traffic (Track D).
- **#18 error monitoring — charging-correctness subset**: at minimum
  **webhook-signature-failure** and **Inngest-job-failure** alerting. A silent
  webhook or archive-job failure **strands a paying customer on the wrong tier**
  — a **charging-correctness** defect, not a scale defect. (#18's broader scope
  stays Tier C.)
- **Vercel account on the Pro plan** — Hobby is **non-commercial-use only** per
  the Vercel ToS; charging real users requires Pro. (Independent of the Tier-C
  Vercel-DPA question below.)

### Tier C — blocks **public launch**

- **#12 DPAs** — the **Inngest DPA is unknown** (`docs/launch/vendor-dpas.md`);
  start the email round-trip **now**. Verify Vercel plan **≥ Pro** (its DPA
  scopes to Pro/Enterprise).
- **#13–#19** (age gate, health-data consent, CSP/security headers, rate
  limiting, error monitoring [**broader scope only** — its
  webhook-signature-failure / Inngest-job-failure alerting subset moved to
  Tier B], spend cap — `LAUNCH_CHECKLIST.md`).
- **C1 tripwire hardening** — extend the CI tripwire beyond `sk_live_` / bare
  `stripe` to `@stripe/*` specifiers + `api.stripe.com`.
- **PR #71 pre-public-launch findings** (playground routes; dependency
  overrides — above).
- **DMARC enforcement ramp** to `p=quarantine`/`p=reject`
  (`docs/launch/email-dns.md` §8).

---

## Lead-time table (start the long poles now)

| External / long lead | Same-day |
|---|---|
| **Attorney review #8 + #9** — the **longest** pole; send **now**, **batch both**; entity/jurisdiction placeholders (Open question 2) must be resolved first | Vercel domain attach |
| Tax-jurisdiction registrations (#10 live) | Env wiring (Phase 3 flip) |
| DNS propagation (Clerk CNAMEs up to 48h) | Neon prod create + migrate |
| PostHog DPA countersign (sign-and-return) | PostHog prod project create |
| Inngest DPA email round-trip (#12) | Device matrix (Phase 4) |
| DMARC monitoring window (2–4 wk before enforcement) | Cutover marker (Phase 5) |
| **Stripe live-mode activation** — business / bank / identity verification, occasionally a manual review pass; **blocks Tier B** (live charges) | — |
| **4 physical devices for the Phase-4 matrix** (iPhone 15 Pro / iPhone SE 3 / Pixel 8 / Galaxy S22) — own / borrow / BrowserStack; the matrix **cannot run** without them | — |

---

## Six start signals (all parallel, this week)

1. **Attorney review #8 + #9** — with placeholders resolved (Open question 2)
   and the tax-presentation decision made.
2. **Tax registrations** (#10 live-half external work).
3. **Inngest DPA email** (#12; `security@inngest.com`).
4. **#11 cookie-consent build.**
5. **#10 test-mode dashboard work** (`docs/launch/stripe-setup.md` §2–6).
6. **Device acquisition** for the Phase-4 4-device matrix (own / borrow /
   BrowserStack) — must be **confirmed available before Phase 4 is scheduled**.

---

## Phase-3 commerce env inventory (consolidated)

The commerce-specific variables Phase-3 slices add on top of the flip above.
These are **not** set at the Phase-3 env-flip — they arrive with their slice
(the first Stripe import is gated by the cutover marker; see the slice plan).

| Variable | server-only / public | Source | Set when |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | server | Stripe (`sk_live_` in prod) | S2 (billing foundation) |
| `STRIPE_WEBHOOK_SECRET` | server | Stripe webhook endpoint | S2 |
| `STRIPE_PRICE_PRO_MONTHLY` | server | Stripe price ID | S2 (recorded in Tier A) |
| `STRIPE_PRICE_PRO_ANNUAL` | server | Stripe price ID | S2 |
| `STRIPE_PRICE_MAX_MONTHLY` | server | Stripe price ID | S2 |
| `STRIPE_PRICE_MAX_ANNUAL` | server | Stripe price ID | S2 |
| `RESEND_API_KEY` | server | Resend | **S4** (trial-reminder email) — **not Phase 4** |
| from-address `no-reply@send.<domain>` | server | Resend sending subdomain (Phase 1 DNS) | **S4** (reminder `from`) |
| `STRIX_PROD_CUTOVER_VERIFIED` = `1` | server | — | **Phase 5**, prod scope, same session as the marker |

> **Doc reconciliation — DONE (2026-07-22 doc-reconciliation slice):**
> `README.md`, `planning/phase-0-foundations.md`, and
> `planning/phase-4-privacy.md` previously placed Resend / `lib/email/send.ts`
> wholly in **Phase 4**. They now record that S4's trial-reminder email pulls a
> **minimal transactional-send helper (`lib/email/send.ts`) plus
> `RESEND_API_KEY` forward**, while the full Resend/email feature set remains
> Phase 4.

---

## Open questions (owner)

1. **Production domain — RESOLVED (#70).** Decided: `joinstrix.com` (registered
   at Porkbun 2026-07-22, DNS delegated to Vercel). Phase 1 still holds until
   the attorney confirms the trademark.
2. **Who resolves the legal-entity placeholders** — entity name, governing
   law, registered address? These feed the ToS, the Privacy policy, and the
   Stripe Tax origin address. (Blocks attorney review — the longest lead.)
3. Confirm **cutover-before-any-Stripe-merge** vs a long-lived red-CI commerce
   branch. Stated stance: cutover first, don't fight the tripwire.
4. Is **Google/Apple social login** enabled at cutover? If yes, **prod OAuth
   credentials** are an extra Track-B substep.
5. **Post-cutover / pre-S3 window:** once the flip lands but before **S3** ships
   functional upgrade CTAs, real prod users can hit **Free caps** with
   **non-functional** upgrade buttons. Decide: **beta-allowlist** until S3, or
   **"coming soon"** CTA copy.

---

## Revisit triggers

- A **real user** signs up on a preview **before** cutover → re-decide 0.2
  (dev users no longer throwaway).
- **Clerk DNS stuck > 48h** → check for accidental **proxying** (must be
  DNS-only).
- **Any Phase-4 gate fails** → **fix-forward**; the marker (Phase 5) waits. No
  partial marker.
- **Domain change after Phase 1** → **restart from 0.1** (Clerk/Stripe/email
  bindings must be redone).
- **Public traffic wanted before #11** → blocked; #11 cookie consent ships
  first (Track D / Tier B).
