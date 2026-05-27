# Phase 3 — Commerce

**Goal:** Tier-gated billing per spec §10. Free-tier caps enforced. Max-only trial-with-card. Click-to-cancel-compliant downgrade-and-archive flow. Annual prorated refunds within 30 days.

**Prerequisites:** Phase 2.5 PWA gate passed.

**Gates:** Phase 4 follows immediately. Don't start until §10 verification items are exercised end-to-end including the trial → cancel-during-trial path.

## Items to build

### Stripe products + prices

- Create in Stripe dashboard or via API:
  - `pro_monthly` — $9.99/mo
  - `pro_annual` — $89.99/yr
  - `max_monthly` — $19.99/mo
  - `max_annual` — $179.99/yr
- IDs stored in `lib/billing/config.ts`:

  ```ts
  export const PRICES = {
    pro_monthly: process.env.STRIPE_PRICE_PRO_MONTHLY!,
    pro_annual: process.env.STRIPE_PRICE_PRO_ANNUAL!,
    max_monthly: process.env.STRIPE_PRICE_MAX_MONTHLY!,
    max_annual: process.env.STRIPE_PRICE_MAX_ANNUAL!,
  } as const

  export const DISPLAY_PRICES = {
    pro: { monthly: "$9.99/mo", annual: "$89.99/yr (~$7.50/mo)" },
    max: { monthly: "$19.99/mo", annual: "$179.99/yr (~$15/mo)" },
  }
  ```
- **Prices are config, not hardcoded in business logic** (spec §10).

### Trial-with-card signup (Max only)

- Spec §10: "One-week free trial of Max only. Card required up front. Pro has no trial."
- Stripe Checkout session with `trial_period_days: 7`, `payment_method_collection: "always"`, and the chosen Max price.
- On checkout success → webhook `customer.subscription.created` → write `subscriptions` row with `status='trialing'`, `trial_start`, `trial_end`, `tier='max'`, link `users.stripe_customer_id`.
- Trial conversion: Stripe sends `customer.subscription.updated` when trial ends and the card is charged → update `subscriptions.status='active'`. PostHog `trial_converted`.
- Trial cancellation during the week: handled in the downgrade flow below.

### Free-tier usage caps

- Spec §10: 3 plan generations / month, 2 replans / month, intake unlimited.
- Counter logic in `lib/billing/usage.ts`:

  ```ts
  async function checkAndIncrement(userId, kind: "plan" | "replan"): Promise<{ ok: true } | { ok: false; cap: number }> {
    const user = await scopedDb(userId).users.findFirst()
    if (user.tier !== "free") return { ok: true }
    const counter = await ensureCurrentMonthCounter(userId, user.timezone)
    const limit = kind === "plan" ? 3 : 2
    const used = kind === "plan" ? counter.plan_generations_used : counter.replans_used
    if (used >= limit) return { ok: false, cap: limit }
    await increment(counter, kind)
    return { ok: true }
  }
  ```
- Called inside the `/api/ai/plan` and `/api/ai/replan` route handlers **before** the Anthropic call. Returns 402-style payload to the client when capped.
- Inngest cron `resetMonthlyUsageCounters` (registered in Phase 2 as a no-op) now creates new `usage_counters` rows for the new calendar month on the 1st of each user's local timezone. (Implementation: run hourly UTC, find users whose local-month-start just crossed.)

### Upgrade prompt on cap hit

- When the API returns the cap response, the client renders a modal:
  - Plain copy ("You've used your 3 plan generations this month. Upgrade to Pro or Max for unlimited.")
  - Compare Pro vs Max in a two-card layout.
  - Primary CTAs: "Start Max trial" (with "Card required • Cancel anytime within the week"), "Switch to Pro" (no trial, immediate charge).
- **No queueing, no silent skip** per spec §10.
- PostHog: `free_tier_cap_hit` with `{ cap: "plan_generations" | "replans", goal_id }`.

### Goal-cap enforcement (active goal count)

- Free: 3 active goals max. Pro / Max: 5.
- "Add new goal" tile on the goals list is hidden when `active_count >= tier_cap`.
- Hard-block in the goal save endpoint: returns a cap error if the user tries to bypass.
- PostHog: `free_tier_cap_hit` with `cap: "active_goals"`.

### Downgrade-and-archive selection screen

- Spec §10 mandates: not error-styled, single barrier, restorable archive, no extra confirmation.
- Route: `app/(settings)/billing/downgrade/page.tsx`.
- Triggered when:
  - User clicks "Cancel subscription" and `active_goals > target_tier_cap`.
  - Trial ends without conversion and `active_goals > 3` (Free cap).
  - Max → Free or Pro → Free where `active_goals > 3`.
- Screen content (copy in spec §10 register):
  - Headline: "Your Free plan supports 3 active goals. You currently have {N}. Choose which 3 to keep active."
  - List every active goal with keep/archive toggle. Selection state shows running count: "3 of 3 kept" → primary button enabled.
  - Reassurance text: "Archived goals and their full data are preserved. You can reactivate them any time you re-upgrade."
  - Primary button: "Cancel subscription" (when downgrading to Free) / "Continue" (when downgrading to Pro). Single barrier — no "are you sure?" interstitial.
  - Secondary button: "Back" → returns to current-tier settings.
- **No red warning styling, no "error" or "problem" language.** This is a routine flow.
- On primary action:
  - Archive the goals the user chose to archive (set `status='archived'`, `archived_at=now`, drop `auto_archive_at`).
  - Call `stripe.subscriptions.update(subId, { cancel_at_period_end: true })`.
  - Set `subscriptions.canceled_at=now`. (The actual subscription status flips when Stripe webhooks `customer.subscription.deleted` after period end.)
  - PostHog: `subscription_canceled`.

### Custom cancel — not Stripe Customer Portal

- Settings page "Cancel subscription" button routes to a server action that either:
  - If goals already fit target tier: opens the downgrade screen with no archive UI, just the confirmation message + "Cancel" button.
  - If goals exceed target tier: opens the full downgrade-and-archive screen above.
- **Stripe Customer Portal is exposed only for payment-method updates and invoice history**, not cancel. Spec §10 + §5 flag #1.

### Max → Pro transition

- Goal cap is the same (5 → 5), so no archive needed.
- Show a "what you're losing" screen: AI mentor (when v2 ships); preserved access to plan generation, replans, and intake. Single confirm.

### Trial-end downgrade

- Stripe webhook `customer.subscription.updated` with `cancel_at_period_end=true` at trial-end and the user has not converted → if they have > 3 active goals, send a notification (in-app banner + email) before the trial ends so they hit the downgrade-and-archive screen *before* expiry, not after. Spec §10: "present the same selection screen at the moment of expiry, not after."

### Billing settings

- Route: `app/(settings)/billing/page.tsx`.
- Sections:
  - Current plan + price + next renewal date.
  - "Change plan" → opens upgrade/downgrade flow.
  - "Cancel subscription" → routes to downgrade flow above.
  - "Manage payment method" → Stripe Customer Portal session for payment methods only.
  - **Refund policy displayed in-app, not just in ToS** (spec §10): "Monthly subscriptions are not refundable. Annual subscriptions are eligible for a prorated refund within 30 days of purchase. Request a refund below if eligible."
  - "Request refund" button visible when `billing_period='annual'` AND `now() < current_period_start + 30 days`. On click → server action computes prorated amount, calls `stripe.refunds.create({ payment_intent, amount })`, downgrades the subscription.

### Stripe webhooks

- `/api/webhooks/stripe` handles: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- Idempotent: each webhook records the event ID and skips duplicates.
- Updates `subscriptions` row + `users.tier` accordingly.

## Phase-specific context

### Why custom cancel and not Customer Portal

Stripe Customer Portal injects its own confirmation step ("Are you sure you want to cancel?") and surfaces retention offers. Spec §10 explicitly forbids both: "No additional confirmation screens, no 'are you really sure?' interstitials, no offers to talk to support before canceling. One screen, then the cancellation proceeds." Portal violates this. Our custom screen is the only path.

### Monthly counter reset details

- Counters are keyed by `(user_id, period_start)` where `period_start` is the first day of the current calendar month in the user's timezone.
- `ensureCurrentMonthCounter` does a get-or-create: if no row for the current period exists, create one with zeros.
- The cron job is not strictly necessary (get-or-create handles it lazily), but it's useful for analytics queries that want every active user to have a current-month row.

### Trial mechanics edge cases

- User signs up via Max trial → creates 4 active goals during trial week.
- 24 hours before trial ends: in-app banner + transactional email. "Your trial ends tomorrow. If you don't choose a paid plan, you'll move to Free, which supports 3 active goals. Choose which to keep."
- At trial-end webhook: if user took action → respect it. If silent → downgrade to Free + archive the 4th goal by `created_at` order, **but** mark `archive_reason='trial_expired_no_action'` and surface a banner on next login: "We had to archive {goal} when your trial ended. Restore it any time."
- This is a fallback for truly silent users. Spec §10 says "present the same selection screen at the moment of expiry, not after" — we prefer the user to choose before expiry, but if they don't, we don't lock them out.

### Out of scope

- Account deletion (Phase 4).
- Data export (Phase 4).
- Refunds for monthly (forbidden by policy — show clear policy text but no refund button).

## Verification

End-to-end:

1. As Free user, generate plans 1, 2, 3 in a month → all succeed. Attempt 4 → cap modal shown; `free_tier_cap_hit { cap: "plan_generations" }` fires.
2. As Free user, create 3 goals → "Add new goal" tile hidden. Attempt save via API → 402-like error.
3. Sign up fresh → start Max trial via Stripe Checkout → card captured, `subscriptions.status='trialing'`, `trial_end` 7 days out.
4. During trial week, create 4 active goals.
5. Cancel during trial → downgrade-and-archive screen shows 4 goals; select 3 to keep, archive 1. Primary button proceeds (no second confirmation). `subscriptions.cancel_at_period_end=true`, `canceled_at=now`.
6. Wait until `trial_end` (test seam) → Stripe webhook flips `status` to `canceled`, `users.tier='free'`. Archived goal stays archived.
7. Re-upgrade to Pro → archived goal can be reactivated from goals list ("Restore").
8. As Pro annual user, request refund within 30 days → prorated refund issued via Stripe API, subscription downgrades.
9. As monthly user, request refund → no button shown; clear policy text visible.
10. Max → Pro downgrade: "what you're losing" screen shown, no archive UI (goal cap unchanged).
11. PostHog receives: `trial_started`, `trial_converted` (if scenario), `subscription_started`, `subscription_canceled`, `free_tier_cap_hit { cap, goal_id }`.

Automated (Vitest):

- `checkAndIncrement` enforces 3 plan / 2 replan limits for Free; passes for Pro/Max.
- Monthly counter reset creates new rows at month boundary; doesn't disturb other users' counters.
- Goal-cap enforcement on save endpoint blocks Free user trying to save a 4th active goal.
- Downgrade-and-archive selection validity: cannot proceed with > target_cap kept.
- Refund eligibility: monthly → false; annual within 30d → true; annual day 31 → false.
- Stripe webhook handler is idempotent (replaying the same event ID is a no-op).
