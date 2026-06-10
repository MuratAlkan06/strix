# Runbook — Stripe setup (test mode)

Operator runbook for configuring the Stripe account ahead of Phase 3. Everything here happens in the Stripe Dashboard, in **test mode**; production mode repeats the same steps at launch. Engineering integration (Checkout sessions, webhooks, `lib/billing/config.ts`) is Phase 3 implementation work, not this runbook.

Sources of truth: SPEC.md §10 (pricing matrix, trial, refunds), PLAN.md §1 + §5 flag 1 (custom cancel, Portal scope), planning/phase-3-commerce.md (price naming and env vars). Tracked as issue #10 (Stripe Tax) under umbrella #7.

> Tax registration has legal and accounting consequences. Confirm jurisdiction registrations with a tax advisor before enabling collection in production.

---

## 1. Preconditions

1. Stripe account exists; you can sign in to the Dashboard.
2. The **Test mode** toggle (top right) is ON for every step below.
3. Open decision to record before production setup: **tax-inclusive vs tax-exclusive pricing** **[PLACEHOLDER: tax presentation]**. EU consumer pricing is conventionally tax-inclusive; US conventionally tax-exclusive. This decision changes how Prices are created (Stripe "Price includes tax" setting) and must match the Terms of Service §5.1 wording (issue #8).

**Done when:** dashboard access confirmed, test mode active.

## 2. Create Products and Prices (the SPEC §10 matrix)

Create **two Products**, each with **two Prices**. Prices below are copied from SPEC.md §10 — do not round, "simplify," or substitute.

| Product | Price nickname | Amount | Interval | Suggested `lookup_key` |
|---|---|---|---|---|
| Strix Pro | Pro monthly | **$9.99** | monthly | `pro_monthly` |
| Strix Pro | Pro annual | **$89.99** | yearly | `pro_annual` |
| Strix Max | Max monthly | **$19.99** | monthly | `max_monthly` |
| Strix Max | Max annual | **$179.99** | yearly | `max_annual` |

Steps:

1. Dashboard → **Product catalog** → **Add product**. Name: `Strix Pro`. Add the first price: recurring, monthly, USD 9.99.
2. On the saved product, **Add another price**: recurring, yearly, USD 89.99.
3. Repeat for `Strix Max`: recurring monthly USD 19.99, recurring yearly USD 179.99.
4. Set a **lookup key** on each price using the suggested values above (price detail → Edit; or via API). Lookup keys let the application resolve prices by stable name (`pro_monthly`, …) so price *objects* can later be rotated without code changes — they also match the naming in planning/phase-3-commerce.md.
5. Free has no Stripe product — it is the absence of a subscription.

**Done when:** 4 Prices exist with the exact amounts above, each with its lookup key set.

## 3. Record the Price IDs

Phase 3's `lib/billing/config.ts` reads price IDs from environment variables (planning/phase-3-commerce.md). Record the four test-mode `price_…` IDs now so they are ready when Phase 3 starts.

| Env var (Phase 3) | Price | Test-mode Price ID |
|---|---|---|
| `STRIPE_PRICE_PRO_MONTHLY` | Pro monthly $9.99 | record `price_…` |
| `STRIPE_PRICE_PRO_ANNUAL` | Pro annual $89.99 | record `price_…` |
| `STRIPE_PRICE_MAX_MONTHLY` | Max monthly $19.99 | record `price_…` |
| `STRIPE_PRICE_MAX_ANNUAL` | Max annual $179.99 | record `price_…` |

Store them in **[PLACEHOLDER: env/secret management location]** (Vercel project env vars are the expected home once Phase 3 wires billing).

**Done when:** all four IDs are recorded somewhere the Phase 3 implementer will find them. Production IDs will differ — repeat at launch.

## 4. Enable Stripe Tax

Launching to the EU without VAT collection is non-compliant from day one (LAUNCH_CHECKLIST). Stripe Tax automates calculation and collection, but **you** must register in each jurisdiction and file returns.

1. Dashboard → **Settings → Tax** (Stripe Tax).
2. Set the **origin address** (the business's registered address — **[PLACEHOLDER: entity registered address]**).
3. Set the default **product tax category** (software-as-a-service / digital services).
4. Under **Registrations**, add each jurisdiction where the business is registered to collect tax. Registration itself happens outside Stripe:
   - **EU:** register for VAT One-Stop Shop (OSS, union or non-union scheme as applicable) through one member state's tax portal; add the OSS registration in Stripe.
   - **US:** register in states where economic nexus is reached; Stripe Tax's **Thresholds** monitoring shows where obligations are approaching.
   - **UK and others:** per-jurisdiction registration as sales warrant.
5. Enable automatic tax calculation. (Phase 3 must then pass `automatic_tax: { enabled: true }` on Checkout sessions — note for the implementer.)
6. Decide and configure tax-inclusive vs tax-exclusive presentation consistently with §1.3 above.

**Done when:** Stripe Tax is enabled in test mode with origin address and at least one test registration, and threshold monitoring is visible. Production registrations filed before real EU/US sales — confirm with the tax advisor.

## 5. Terms of Service URL for trial Checkout — blocked by issue #8

Stripe Checkout's trial flows require a published Terms of Service URL (LAUNCH_CHECKLIST; the ToS draft is docs/legal/terms-of-service.md, issue #8). Until the ToS is published at a stable URL, trial Checkout cannot be fully configured.

1. After the ToS is published: Dashboard → **Settings → Business → Public details** → set **Terms of service** URL (and **Privacy policy** URL — issue #9) to their pages on **[PLACEHOLDER: production domain]**.
2. Note for the Phase 3 implementer: trial Checkout sessions must surface/require ToS consent (the checklist calls this the `terms_of_service_url` requirement; in the current API this is the ToS URL in public details plus `consent_collection.terms_of_service` on the session).

**Done when:** a test Checkout session with `trial_period_days: 7` creates successfully and shows the ToS consent. Blocked until #8 ships.

## 6. Customer Portal — payment methods and invoices ONLY, never cancel

PLAN.md §5 flag 1 (resolved, do not revisit): cancellation goes through the in-app downgrade-and-archive screen, which SPEC §10 mandates as the **only** barrier. The Stripe Customer Portal injects its own confirmation step and retention surfaces, which would violate click-to-cancel compliance. The Portal is used **only** for payment-method updates and invoice history.

1. Dashboard → **Settings → Billing → Customer portal**.
2. **Enable:** payment method update; invoice history.
3. **Disable:** subscription cancellation; subscription pausing; plan switching/upgrades (plan changes also go through the in-app flow).
4. Save the configuration.

**Done when:** a test Portal session shows payment-method and invoice sections and **no cancel button**.

## 7. Out of scope for this runbook

- Webhook endpoint creation and signing secret (`/api/webhooks/stripe`) — Phase 3 implementation.
- Checkout session parameters, trial logic, refund API calls — Phase 3 implementation (planning/phase-3-commerce.md).
- Production-mode repeat of steps 2–6 — at launch, after #8/#9 publish.

## Final checklist

- [ ] 4 test-mode Prices created at exactly $9.99 / $89.99 / $19.99 / $179.99 with lookup keys
- [ ] 4 Price IDs recorded for `lib/billing/config.ts` env vars
- [ ] Stripe Tax enabled; origin address set; registrations added; thresholds monitored
- [ ] Tax-inclusive vs tax-exclusive decision recorded and reflected in ToS draft
- [ ] ToS + Privacy URLs set in Stripe public details (after #8/#9 publish)
- [ ] Customer Portal configured with cancel disabled, payment methods + invoices enabled
