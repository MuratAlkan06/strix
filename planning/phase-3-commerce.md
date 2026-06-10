# Phase 3 — Commerce

**Goal:** Tier-gated billing per spec §10. Free-tier caps enforced. Max-only trial-with-card. Pro signup (no trial). Click-to-cancel-compliant downgrade-and-archive flow with **deferred-execution timing** for trial cancellations (decide at click, execute at trial-end). Annual prorated refunds within 30 days.

**Prerequisites:** Phase 2.5 PWA gate passed.

**Gates:** Phase 4 follows immediately. Don't start until §10 verification items are exercised end-to-end including the trial → cancel-during-trial → trial-end path (the deferred-archive flow).

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

### Stripe webhook signature verification

- `/api/webhooks/stripe` handler verifies the signature on every request:

  ```ts
  const sig = req.headers.get("stripe-signature")!
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET!)
  } catch (err) {
    return new Response("Bad signature", { status: 400 })
  }
  ```
- **Verified by integration test in Phase 3** (post unsigned payload → 400; post valid signed payload → 200).
- Idempotent: handler records the event ID in a `stripe_webhook_events` log table and skips duplicates.
- **No-op safely when the user is gone**: if any handler can't find the matching `users` row (hard-deleted in Phase 4 or never existed), it returns 200 immediately without modifying anything. Comment: "user row missing — treating as no-op (likely post-hard-delete window)."
- **Selective guard for soft-deleted users** (`users.deleted_at IS NOT NULL` — the handlers run on `unscopedDb`, which has no soft-delete filter, so the check must be explicit): **keep syncing billing state** (`subscriptions.*`, `users.tier`) — during the 30-day grace window the Stripe subscription keeps evolving (period-end deletion, dunning), the idempotency log makes suppressed events unreplayable, and a recovered user must come back to accurate billing state, not a phantom paid tier. **Suppress side-effects**: no goal archiving jobs, no banners, no emails, no user-facing analytics events. Always return 200. (A blanket no-op was considered and rejected: it permanently desyncs tier for anyone who recovers after their subscription transitioned during grace.)

### Trial-with-card signup (Max only)

- Spec §10: "One-week free trial of Max only. Card required up front. Pro has no trial."
- Spec §10 trial-end semantics (load-bearing — do not "simplify"): **"At trial end: if the user hasn't canceled, the card is charged and they continue on Max."** Silent expiry is a CONVERSION, not a downgrade. The only paths that drop the user to Free are (a) explicit cancellation during the trial week, and (b) trial-end charge failure followed by dunning exhaustion.
- Entry points: (a) the empty-state dashboard CTA for users who explicitly choose "Try Max", (b) the cap-hit modal's "Start Max trial" button, (c) the billing settings page. Enumerated; no other paths.
- Stripe Checkout session with `trial_period_days: 7`, `payment_method_collection: "always"`, and the chosen Max price.
- On checkout success → webhook `customer.subscription.created` (where `status='trialing'`) → write `subscriptions` row with `status='trialing'`, `trial_start`, `trial_end`, `tier='max'`, link `users.stripe_customer_id`, set `users.tier='max'`. PostHog: `trial_started { tier: "max" }`.
- **Silent trial expiry (no cancellation, charge succeeds):** Stripe fires `customer.subscription.updated` with `status` transitioning `trialing` → `active`. Handler updates `subscriptions.status='active'`, keeps `users.tier='max'`, leaves all goals active. PostHog: `trial_converted { tier: "max", billing_period }`. **No archive, no downgrade, no goal loss.** This is the default path for users who never opened the cancel screen — they wanted Max and they kept Max.

### Pro signup (no trial)

- Spec §10: "Pro has no trial." Card charged immediately.
- Entry points: (a) the cap-hit modal's "Switch to Pro" button, (b) billing settings "Upgrade to Pro" CTA.
- Stripe Checkout session with **no `trial_period_days`**, `payment_method_collection: "always"`, and the chosen Pro price (`pro_monthly` or `pro_annual` per user choice).
- On checkout success → webhook `customer.subscription.created` (where `status='active'`) → write `subscriptions` row with `status='active'`, `tier='pro'`, set `users.tier='pro'`, link `users.stripe_customer_id`. PostHog: `subscription_started { tier: "pro", billing_period }`.
- A user moving from Max (trialing or active) to Pro is treated as a downgrade, not a fresh signup — see "Max → Pro transition" below.

### Free-tier usage caps

- Spec §10: 3 plan generations / month, 2 replans / month, intake unlimited.
- **`checkAndIncrement` is a single atomic conditional UPDATE** to avoid TOCTOU races — and it goes through `scopedDb` (usage_counters is a direct-ownership table; the counter columns aren't forbidden keys; the scoped `update` takes an extra `where` and a SQL `set` expression and returns the updated rows). No `unscopedDb` here — this is a single-user operation and the escape hatch is for cross-user work only:

  ```ts
  // lib/billing/usage.ts
  async function checkAndIncrement(userId, kind: "plan" | "replan"):
    Promise<{ ok: true; periodStart: string } | { ok: false; cap: number; used: number }> {
    const sdb = scopedDb(userId)
    const user = await sdb.getSelf()
    if (!user) throw new Error("no live user")          // soft-deleted users can't consume quota
    if (user.tier !== "free") return { ok: true, periodStart: "" }

    await ensureCurrentMonthCounter(userId, user.timezone)

    const col = kind === "plan" ? usage_counters.plan_generations_used : usage_counters.replans_used
    const limit = kind === "plan" ? 3 : 2
    const periodStart = currentPeriodStart(user.timezone)

    const updated = await sdb.update(usage_counters, {
      set: { [col.name]: sql`${col} + 1` },
      where: and(eq(usage_counters.period_start, periodStart), sql`${col} < ${limit}`),
    })
    if (updated.length === 0) {
      const current = (await sdb.selectFrom(usage_counters, {
        where: eq(usage_counters.period_start, periodStart),
      }))[0]
      return { ok: false, cap: limit, used: current?.[col.name] ?? limit }
    }
    return { ok: true, periodStart }
  }
  ```
  The `WHERE … AND used < limit` clause makes the increment atomic — concurrent requests cannot both pass the check. (Only `ensureCurrentMonthCounter`'s `ON CONFLICT DO NOTHING` get-or-create exceeds the scoped surface; implement it as a scoped insert that catches the unique-constraint violation, or add a narrow scoped upsert helper — not by reaching for `unscopedDb`.)
- **Quota refund on AI failure**: a `refundUsage(userId, kind, periodStart)` counterpart decrements the same counter when the metered AI call fails after a successful increment — a 502 must not burn a Free user's monthly quota. Rules:
  - Decrement targets the **`periodStart` captured at increment time** (a failure straddling local midnight on the 1st must not decrement the new month's row).
  - Guarded `AND ${col} > 0` — there is no DB CHECK ≥ 0, and a negative counter would silently satisfy `used < limit` forever; make double-refund bugs loud, not generous.
  - The endpoints need an explicit **error-handling contract around the Anthropic call** (transport errors, timeouts, Zod-validation 502s — Phase 1's plan endpoint currently specifies none) so the refund has a hook for every failure class. Refund transport/availability failures unconditionally; for repeated Zod-validation failures, rate-limit the refund (model output is prompt-influenced — refund-on-every-failure converts the cap into "3 successes plus unlimited failed Anthropic spend").
  - The failure path also marks the stranded `replan_proposals` row (created `pending` before generation) as failed/deleted rather than leaving it dangling.
  - Applies to **every** metered caller: `/api/ai/plan`, `/api/ai/replan` from check-ins, and replans with `trigger='structural_edit'` including archived-goal Restore.
- **Retrofitted into Phase 1's `/api/ai/plan` and Phase 2's `/api/ai/replan` route handlers** as the first step inside the handler (before the Anthropic call). Phase 3 deliverable: edit both endpoints, replace the Phase 2 stub with the real call, add the failure-path refund, and add the 402-style response shape: `{ error: "cap_hit", cap: 3, used: 3, kind: "plan_generations" }`.
- Inngest cron `resetMonthlyUsageCounters` (registered in Phase 2 as a no-op): body now finds users whose local-month just started in the last hour and creates the new `usage_counters` row (idempotent via the `(user_id, period_start)` unique constraint).

### Upgrade prompt on cap hit

- When the API returns the cap response, the client renders a modal:
  - Plain copy ("You've used your 3 plan generations this month. Upgrade to Pro or Max for unlimited.")
  - Compare Pro vs Max in a two-card layout.
  - Primary CTAs: "Start Max trial" (with "Card required • Cancel anytime within the week"), "Switch to Pro" (no trial, immediate charge).
- **No queueing, no silent skip** per spec §10.
- PostHog: `free_tier_cap_hit { cap: "plan_generations" | "replans", goal_id? }`.

### Goal-cap enforcement (active goal count)

- Free: 3 active goals max. Pro / Max: 5.
- "Add new goal" tile on the goals list is hidden when `active_count >= tier_cap`.
- **Hard-block in the goal save endpoint** (`POST /api/goals`): returns a 402-style cap error if the user tries to bypass. (Phase 1 already validates 5; Phase 3 tightens to per-tier and returns the cap-hit payload.)
- PostHog: `free_tier_cap_hit { cap: "active_goals" }`.

### Downgrade-and-archive selection screen

- Spec §10 mandates: not error-styled, single barrier, restorable archive, no extra confirmation.
- Route: `app/(settings)/billing/downgrade/page.tsx`.
- Triggered when the user clicks "Cancel subscription" or "Switch to Pro" and `active_goals > target_tier_cap`.
- Screen content (copy in spec §10 register):
  - Headline: "Your Free plan supports 3 active goals. You currently have {N}. Choose which 3 to keep active."
  - List every active goal with keep/archive toggle. Selection state shows running count: "3 of 3 kept" → primary button enabled.
  - Reassurance text: "Archived goals and their full data are preserved. You can reactivate them any time you re-upgrade."
  - Primary button: "Cancel subscription" (when downgrading to Free) / "Continue" (when downgrading to Pro). Single barrier — no "are you sure?" interstitial.
  - Secondary button: "Back" → returns to current-tier settings.
- **No red warning styling, no "error" or "problem" language.** This is a routine flow.

### Trial-cancel deferred-execution flow (per SPEC §10:149)

**Scenario:** a Max trial user with 4 or 5 goals clicks "Cancel subscription."

- The downgrade-and-archive selection screen shows. User picks which 3 to keep.
- On primary action:
  1. Write the selection to `subscriptions.pending_archive_goal_ids` (jsonb array of goal IDs to archive) and `subscriptions.pending_archive_decided_at = now()`.
  2. Call `stripe.subscriptions.update(subId, { cancel_at_period_end: true })`. Stripe will charge $0 and stop billing at trial-end.
  3. Set `subscriptions.canceled_at = now()` (write-once — schema enforces).
  4. PostHog: `subscription_canceled { tier: "max", reason: "user_cancel", billing_period }`. **This is the event's only user-cancel fire** — at the decision moment, never again at trial-end (see taxonomy note in Phase 5; `subscription_resumed` is the compensating event for users who cancel then resume, so churn analysis nets the two).
- **No goal is archived at click-time.** All goals remain `active`, the user retains Max-tier (5-goal cap, full AI access) through trial-end.
- If the user resumes Max (clicks "Keep Max" before trial-end): handler calls `stripe.subscriptions.update(subId, { cancel_at_period_end: false })`, clears `pending_archive_goal_ids` and `pending_archive_decided_at`, sets `canceled_at = NULL` (the single exception to write-once — explicit user reversal). PostHog: `subscription_resumed { tier, billing_period }`.
- At trial-end on this path, Stripe fires `customer.subscription.deleted` (subscription ends without charge because `cancel_at_period_end=true` was set at click-time). The handler routes it per the **deleted-event routing** rules below, lands on the user-cancel branch, and:
  - Sets `users.tier = 'free'`, `subscriptions.status = 'canceled'`.
  - Inngest function `applyPendingArchive` runs immediately (triggered via `inngest.send`):
    1. For each goal_id in `pending_archive_goal_ids`: archive it — **skipping any goal that is no longer `active`** (a goal completed or already archived mid-trial keeps its own `status`/`archive_reason`; never clobber `completed` back to `archived`). Sets `status='archived'`, `archived_at=now()`, `archive_reason='downgrade_selection'` on the ones it archives. Missing IDs are skipped idempotently.
    2. **Defensive re-validation**: if `count(active goals)` still exceeds the target tier cap — the user canceled with ≤cap goals (empty pending list) or created/restored goals during the remaining trial week — archive down to the cap using the same 30-day activity heuristic as `applyPaymentFailureArchive`, with `archive_reason='downgrade_selection'` (its banner copy is accurate: the goal *was* archived when the trial ended). Tag these with a PostHog property (`heuristic: true`) so system-chosen archives are measurable against user-chosen ones.
    3. Clears `pending_archive_goal_ids`.
  - No PostHog `subscription_canceled` here — it fired once, at cancel-click.
  - Surfaces the trial-expired banner on next login (see below).

### Deleted-event routing (customer.subscription.deleted)

Every immediate cancellation produces a `deleted` event with `cancel_at_period_end=false`, so the local flag alone cannot distinguish paths. The handler routes **in this order**:

1. **Superseded** (`subscriptions.superseded_at IS NOT NULL`): this deletion is one half of a tier transition (Max→Pro cancel+create). Sync `subscriptions.status='canceled'` and stop — no tier write, no archive, no events. The replacement subscription's `created` webhook owns `users.tier`.
2. **Payment failure** (`event.data.object.cancellation_details.reason === 'payment_failed'` — Stripe's own discriminator, and the only signal that means dunning exhausted): the payment-failure path below.
3. **User cancel** (local `cancel_at_period_end = true`): the trial-end / period-end path above.
4. **Anything else** (refund-route downgrade, account-deletion cancel, manual dashboard cancel): plain sync — `subscriptions.status='canceled'`, `users.tier='free'` *unless another live subscription row exists*, **never** an archive job and **never** a `payment_failed` event or banner. The flow that initiated the cancel owns its own goal-cap reconciliation and analytics.

`superseded_at` lifecycle: set by the transition server action on the old row *synchronously at the cancel API call* (together with `status='canceled'` — see Max → Pro below); cleared if the transition aborts before the new subscription activates. A stale marker would no-op a future legitimate cancel, so abort paths must clean up. Enumerated `deleted`-event producers, for the test matrix: trial-end user-cancel, period-end paid cancel, dunning exhaustion, Max→Pro supersede, refund-route downgrade, account-deletion (Phase 4).

**Paid-tier cancellation** (Pro → Free, Max → Free where `active_goals > 3`) uses the same screen but **executes archival at click-time** (no trial to preserve access during). Implementation: same screen, but selection writes to `pending_archive_goal_ids` only when `status='trialing'`; otherwise archive runs immediately with `archive_reason='downgrade_selection'`.

### Trial reminder (24h before trial-end)

- Inngest scheduled function `trialReminderTomorrow`: `{ id: "trial-reminder-tomorrow", cron: "0 * * * *" }` (hourly UTC). Each run:
  - Finds users with `subscriptions.status='trialing'` and `trial_end BETWEEN now() AND now() + interval '25 hours'` (1h cushion) who haven't received the reminder yet (`subscriptions.trial_reminder_sent_at IS NULL`).
  - For each: in-app banner (set a server flag the dashboard reads) + Resend transactional email `trial_ending_tomorrow`. Sets `subscriptions.trial_reminder_sent_at = now()`.
  - Idempotent via the `trial_reminder_sent_at` marker.
- Copy (anchored to spec §10 behavior — silent expiry = charge, not downgrade): "Your Max trial ends tomorrow. Your card will be charged {$19.99 / $179.99} unless you cancel by then. Cancel anytime from billing settings."
- The banner links to billing settings where the user can cancel (deferred-execution flow), edit a pending selection if one exists, or resume Max.

### Payment-failure handling (distinct from silent expiry)

Silent trial expiry where the card charge **fails** is the only no-cancellation path that leads to downgrade. It is rare and operationally distinct from the spec's "silent expiry converts" default.

- At trial-end, if Stripe attempts to charge and the card is declined / expired / insufficient funds, Stripe fires `invoice.payment_failed`. Subscription transitions to `status='past_due'`. Handler updates the local row.
- **Stripe Smart Retries / dunning** takes over: Stripe retries the charge over several days (default ~3 weeks, configurable in the Stripe dashboard) and sends card-update emails to the customer directly. We do not duplicate those emails.
- We also send one in-app banner: "Your card couldn't be charged for your Max plan. Update it from billing settings — your trial features stay active while Stripe retries." (No threat language; this is operational.)
- If the customer updates their card and the retry succeeds → `customer.subscription.updated` to `active` → `trial_converted { tier, billing_period }` fires (the eventual conversion path).
- If dunning is exhausted → Stripe fires `customer.subscription.deleted` with `cancellation_details.reason='payment_failed'` — **this reason field is the sole discriminator for the payment-failure branch** (per the deleted-event routing rules above; the local `cancel_at_period_end` flag is false on *every* immediate cancel and proves nothing). Webhook handler:
  - Sets `users.tier='free'`, `subscriptions.status='canceled'`.
  - Triggers Inngest function `applyPaymentFailureArchive` via `inngest.send`.
  - PostHog: `subscription_canceled { tier: "max", reason: "payment_failed", billing_period }`.

### applyPaymentFailureArchive Inngest function

- `{ id: "apply-payment-failure-archive" }` (event-triggered, not cron).
- For the affected user, picks goals to **keep** (not archive) using the activity heuristic with a **30-day window**:
  - Compute `last_completion_at` per active goal = `max(task_completions.completed_at) WHERE completed_at >= now() - interval '30 days'`, joined via recurring_tasks. `NULL` if the goal has no completions in the 30-day window.
  - Sort goals by `(last_completion_at DESC NULLS LAST, created_at DESC)`.
  - Keep the top 3 ("most recent 30-day activity, with `created_at DESC` as the tie-break / fallback when no goal has completions in the window"). A goal with 100 completions older than 30 days has `last_completion_at = NULL` per this rule, and ranks below any goal with even 1 completion in the window.
  - Archive the rest: `status='archived'`, `archived_at=now()`, `archive_reason='trial_expired_no_action'`.
- Surfaces the trial-expired banner for each archived goal.
- Idempotent: re-running on a user whose `active_goals <= 3` is a no-op.

### Trial-expired banner

- Surfaced on next login when any of the user's goals has `archive_reason IN ('trial_expired_no_action','downgrade_selection')` and `archive_notice_dismissed_at IS NULL`.
- Copy varies by reason **and by whether the cancellation was a trial** (`archive_reason` alone is reused by paid-tier cancels — keying copy on it unconditionally would tell a year-long Pro subscriber their "trial" ended):
  - `downgrade_selection`, archived at trial-end: "{goal_title} was archived when your trial ended. Restore it anytime by upgrading."
  - `downgrade_selection`, archived on a paid-tier cancel/refund: "{goal_title} was archived when your plan changed. Restore it anytime by upgrading."
  - `trial_expired_no_action` (payment-failure path): "{goal_title} was archived when your Max plan didn't renew. Update your card and re-upgrade to restore it."
- Single dismiss button → sets `goals.archive_notice_dismissed_at = now()` for that goal. Banner does not reappear.
- If multiple goals share this state, banner cycles or lists them concisely.

### Custom cancel — not Stripe Customer Portal

- Settings page "Cancel subscription" button routes to a server action that either:
  - If goals already fit target tier: opens the downgrade screen with no archive UI, just the confirmation message + "Cancel" button. (Trial users on this path still use deferred execution — Stripe `cancel_at_period_end=true`, no archive needed since cap not exceeded.)
  - If goals exceed target tier: opens the full downgrade-and-archive screen above.
- **Stripe Customer Portal is exposed only for payment-method updates and invoice history**, not cancel. Spec §10 + PLAN.md §5 flag #1.

### Archived-goal reactivation ("Restore")

When a user clicks "Restore" on an archived goal — available from the goals list any time their tier cap allows reactivation:

- Goal's static fields (title, description, intensity_override, color_index) restore as-is.
- **Recurring tasks, milestones, and equipment dates do NOT restore as-is** — they would otherwise be set in the past, invalidating the entire plan. The Restore flow opens the existing replan UI by calling `POST /api/ai/replan` with `trigger='structural_edit'` and a `structural_change = { type: "reactivation", restore_date: now(), original_archived_at: goals.archived_at }` payload. The replan AI proposes:
  - All recurring tasks re-activated (`active=true`).
  - Milestones rebased forward — each milestone's `target_date` shifted by `(now() - original archived_at)` so relative pacing is preserved, or re-calibrated by the AI based on the goal's `target_date` and current state.
  - Equipment deadlines re-derived from the new milestone dates (when milestone-linked) or shifted by the same delta (when standalone).
- The user reviews the proposed restoration as a normal replan diff and accepts / edits / rejects. **AI proposes, user approves** — consistent with SPEC §8. No silent reactivation with stale dates.
- On accept: goal flips to `status='active'`, `archived_at=NULL`, `archive_reason=NULL`, `archive_notice_dismissed_at=NULL`. Restoration counts as a replan against the Free-tier monthly cap (calls `checkAndIncrement('replan')` before the AI call).
- If the user wants to keep the original (recent) dates verbatim — e.g., a goal archived 2 days ago — they can edit or reject the date-shift items in the diff before accepting.
- **Tier-cap enforced**: cannot reactivate if `active_goals >= tier_cap` — return 402-style cap error and surface the upgrade modal.

### Max → Pro transition

- Goal cap is the same (5 → 5), so no archive needed.
- Show a "what you're losing" screen: AI mentor (when v2 ships); preserved access to plan generation, replans, and intake. Single confirm.
- Trial users transitioning Max → Pro: cancel the Max trial subscription (no charge), create a Pro subscription with immediate charge. No grace period; user moves to Pro now. **Transition mechanics (ordering is load-bearing):**
  1. The server action marks the local Max row `superseded_at = now()` **and** `status='canceled'` synchronously at the Stripe cancel API call — not when the webhook arrives. Two reasons: the `created`/`deleted` webhook pair arrives in arbitrary order (without the marker, the Max `deleted` event would route down a cancel branch and clobber the freshly-set Pro tier — or worse, the payment-failure branch, archiving a paying customer's goals); and the partial unique index `subscriptions(user_id) WHERE status IN ('trialing','active')` would reject the Pro row's insert while the Max row still reads `trialing`.
  2. Create the Pro subscription. If creation/charge **fails or is abandoned**, clear `superseded_at`, un-cancel or recreate Max where possible, and keep `users.tier` untouched until one subscription is definitively live — the user must never end up tierless-but-paying or Max-for-free.
  3. The Pro `created` webhook sets `users.tier='pro'`; the Max `deleted` webhook no-ops via the superseded rule.
  - *Implementation option to evaluate*: for a trialing Max→Pro, Stripe supports updating the existing subscription in place (swap price, end trial) — fires `customer.subscription.updated` instead of `deleted`, no second subscription, no ordering race, no index collision. If it proves clean in the Stripe test clock, prefer it; `superseded_at` stays in the schema regardless for any cancel+create path.

### Billing settings

- Route: `app/(settings)/billing/page.tsx`.
- Sections:
  - Current plan + price + next renewal date.
  - **For users with `cancel_at_period_end=true` (deferred cancel): show pending selection** ("{N} goals will be archived when your trial ends on {date}: {list}") with "Edit selection" and "Resume Max" CTAs.
  - "Change plan" → opens upgrade/downgrade flow.
  - "Cancel subscription" → routes to downgrade flow above.
  - "Manage payment method" → Stripe Customer Portal session for payment methods only.
  - **Refund policy displayed in-app, not just in ToS** (spec §10): "Monthly subscriptions are not refundable. Annual subscriptions are eligible for a prorated refund within 30 days of purchase. Request a refund below if eligible."
  - "Request refund" button visible when `billing_period='annual'` AND `status='active'` AND `now() < current_period_start + 30 days` (a trialing annual sub has no charge to refund — no button). **Server-side re-check** in the refund route handler before calling `stripe.refunds.create`: same conditions, plus no prior refund on the charge; any failure returns 403 regardless of how the request was crafted. On valid request, in order:
    1. **Goal-cap reconciliation first**: the refund downgrade lands the user on Free — if `active_goals > 3`, route through the downgrade-and-archive selection screen *before* anything irreversible. The refund path must not bypass the reconciliation every other downgrade gets.
    2. Compute the prorated amount, call `stripe.refunds.create({ payment_intent, amount })`.
    3. Cancel the subscription immediately and sync local state in the same action: `subscriptions.status='canceled'`, `users.tier='free'`, archive the selection from step 1 with `archive_reason='downgrade_selection'`. The resulting `customer.subscription.deleted` webhook routes to the plain-sync branch of the deleted-event routing (no archive job, no payment-failure misclassification — this user got money back, not a card decline). PostHog: `subscription_canceled { tier, reason: "user_cancel", billing_period: "annual" }` fires here (this is the decision moment for this path).

### Stripe webhooks

- `/api/webhooks/stripe` handles: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- Idempotent: each webhook records the event ID and skips duplicates.
- Updates `subscriptions` row + `users.tier` accordingly.
- All handlers no-op safely if no `users` row matches the customer; for **soft-deleted** users they sync billing state but suppress side-effects (selective guard above).

## Phase-specific context

### Why custom cancel and not Customer Portal

Stripe Customer Portal injects its own confirmation step ("Are you sure you want to cancel?") and surfaces retention offers. Spec §10 explicitly forbids both: "No additional confirmation screens, no 'are you really sure?' interstitials, no offers to talk to support before canceling. One screen, then the cancellation proceeds." Portal violates this. Our custom screen is the only path.

### Why deferred-execution for trial cancels

SPEC §10:149 says trial users who cancel keep access until trial-end. Archiving at click-time forces them off Max immediately — violating the spec and dropping their 4th/5th goals before they should. The pending-selection pattern preserves Max access while still capturing their choice once.

### Monthly counter reset details

- Counters are keyed by `(user_id, period_start)` where `period_start` is the first day of the current calendar month in the user's timezone.
- `ensureCurrentMonthCounter` does a get-or-create with `ON CONFLICT DO NOTHING` (safe under the unique constraint).
- The hourly cron is a backstop: it ensures every active user has a current-month row even if they never trigger lazy creation by hitting an AI endpoint. Useful for analytics queries that want every active user to have a current-month row.

### Trial-end test seam

- A server-only helper `lib/billing/test-seams.ts` exposes:

  ```ts
  // Only available when process.env.NODE_ENV !== 'production' AND a test-only header is set
  export async function fastForwardTrial(userId: string) {
    if (process.env.NODE_ENV === "production") throw new Error("test seam disabled in prod")
    // Set trial_end to now - 1 second; manually fire the customer.subscription.deleted webhook
    // by calling the webhook handler directly with a synthesized event
  }
  ```
- Playwright + Vitest tests use this to simulate trial expiry without waiting 7 days. **Guarded by env var to ensure it can't run in production.**

### Out of scope

- Account deletion (Phase 4).
- Data export (Phase 4).
- Refunds for monthly (forbidden by policy — show clear policy text but no refund button).

## Verification

End-to-end:

1. As Free user, generate plans 1, 2, 3 in a month → all succeed. Attempt 4 → cap modal shown; `free_tier_cap_hit { cap: "plan_generations" }` fires. Verify the atomic UPDATE by making 4 concurrent plan-gen requests at `used=2`: exactly one succeeds, three return cap-hit.
2. As Free user, create 3 goals → "Add new goal" tile hidden. Attempt save via API → 402-like error.
3. Sign up fresh → start Max trial via Stripe Checkout → card captured, `subscriptions.status='trialing'`, `trial_end` 7 days out. PostHog `trial_started`.
4. During trial week, create 4 active goals.
5. Cancel during trial → downgrade-and-archive screen shows 4 goals; select 3 to keep, archive 1. Primary button proceeds (no second confirmation). **Verify all 4 goals remain `active` immediately after click.** `subscriptions.cancel_at_period_end=true`, `canceled_at=now`, `pending_archive_goal_ids=['<goal_id>']`.
6. Mid-trial, return to billing settings → "Resume Max" → all pending state cleared, subscription continues. Re-cancel and re-select.
7. Trigger trial-reminder seam at `trial_end - 24h` → banner appears in app + Resend email queued. `subscriptions.trial_reminder_sent_at` set.
8. Fast-forward to `trial_end` (test seam) → `customer.subscription.deleted` webhook fires → `applyPendingArchive` runs → the 1 pending goal flips to `archived` with `archive_reason='downgrade_selection'`, the other 3 stay `active`, `users.tier='free'`, `subscriptions.status='canceled'`, `canceled_at` unchanged from step 5. PostHog `subscription_canceled` does **not** fire again here (exactly one fire, at step 5's click).
8.1. **Defensive re-validation path**: cancel during trial with exactly 3 goals (no archive screen, empty pending list), then create 2 more during the trial week. Fast-forward to `trial_end` → `applyPendingArchive`'s re-validation archives down to 3 via the 30-day activity heuristic with `archive_reason='downgrade_selection'` and the `heuristic: true` property; trial-expired banner shows for the archived 2.
8.2. **Completed-goal protection**: select a goal for pending archive, mark it complete mid-trial → at trial-end it keeps `status='completed'` / `archive_reason='user_action'` — not clobbered to archived.
9. Re-upgrade to Pro via "Switch to Pro" → Stripe Checkout with no trial → webhook `customer.subscription.created` (status=active) → `subscriptions` row created, `users.tier='pro'`, PostHog `subscription_started { tier: "pro", billing_period: "monthly" }`.
9.5. From the goals list, click "Restore" on the archived goal → replan diff UI opens with `trigger='structural_edit'`, payload `{ type: "reactivation", restore_date: now() }`. AI proposes shifted milestone dates relative to `now()`; accept → goal flips to `status='active'`, `archived_at=NULL`, `archive_reason=NULL`. `checkAndIncrement('replan')` was consumed (verify the counter incremented for a Free user; verify Pro/Max passes through).
10. As Pro annual user with 5 active goals, request refund within 30 days → the downgrade-and-archive selection screen appears **before** the refund completes; after selection: prorated refund issued via Stripe API, subscription canceled immediately, `users.tier='free'`, exactly 3 goals remain active, and the resulting `deleted` webhook routes to plain-sync (no payment-failure banner, no archive job).
11. As Pro annual user past day 30, POST directly to the refund route → server returns 403.
12. As monthly user, request refund → button not shown; POST directly → server returns 403.
13. Max → Pro downgrade: "what you're losing" screen shown, no archive UI (goal cap unchanged).
14. **Trial-end silent path (conversion, per SPEC §10):** sign up Max, create 4 goals, never cancel, never open settings. Fast-forward to `trial_end` with a working test card → Stripe charges → `customer.subscription.updated` fires (status `trialing → active`) → `users.tier='max'`, `subscriptions.status='active'`, **all 4 goals remain active**, PostHog `trial_converted { tier: "max", billing_period: "monthly" }` fires. No archive, no downgrade.
15. **Payment-failure path (dunning exhaustion):** sign up Max, create 4 goals with varying activity (goal A has 5 task completions in week 1, B has 1, C has 0, D has 2). Never cancel. Fast-forward to `trial_end` with a Stripe test card that always fails → `invoice.payment_failed` → `subscriptions.status='past_due'`, in-app banner shown ("Your card couldn't be charged…"). Simulate dunning exhaustion (Stripe test helper or `customer.subscription.deleted` with `cancellation_details.reason='payment_failed'`) → `applyPaymentFailureArchive` runs → keeps goals A, D, B (top 3 by recent activity); archives C with `archive_reason='trial_expired_no_action'`. Trial-expired banner shows for C with the payment-failure copy variant. Dismiss → `archive_notice_dismissed_at` set; banner does not reappear.
16. **Payment-failure recovery:** repeat the trial-end-with-failing-card path, then before dunning exhausts, update the card to a working one via Stripe Customer Portal (payment-method route). Retry succeeds → `customer.subscription.updated` to `active` → `trial_converted` fires; no archive ran. All 4 goals stay active.
17. POST to `/api/webhooks/stripe` without a valid signature → 400. Replay a valid webhook event → second call no-ops via idempotency record.
18. POST `customer.subscription.deleted` for a non-existent customer → 200 no-op (deleted-user safety).
19. PostHog receives across the test scenarios: `trial_started`, `trial_converted` (silent-expiry path + payment-recovery path), `subscription_started`, `subscription_canceled { tier, reason: "user_cancel" | "payment_failed", billing_period }`, `subscription_resumed`, `free_tier_cap_hit { cap, goal_id? }`.

Automated (Vitest):

- `checkAndIncrement` enforces 3 plan / 2 replan limits for Free; passes for Pro/Max.
- `checkAndIncrement` under concurrent N=10 calls at `used=0`, limit=3: exactly 3 succeed, 7 fail. (Atomicity test.)
- **Quota refund**: a failed AI call after a successful increment leaves the counter net unchanged (`refundUsage` decrements the captured-period row); the decrement floors at 0 (`AND col > 0`) — a double-refund cannot go negative; the refund fires for `structural_edit`/Restore replans too.
- **Deleted-event routing**: a `deleted` event for a superseded row syncs `status='canceled'` and touches nothing else; only `cancellation_details.reason='payment_failed'` triggers `applyPaymentFailureArchive`; a refund-initiated deletion routes to plain-sync (no archive job, no `payment_failed` event); `subscription_canceled` fires exactly once per cancel decision.
- **`applyPendingArchive`**: skips non-active pending IDs (completed goals keep their status/reason); re-validates the active count at execution and heuristic-archives down to the cap when exceeded.
- **Soft-deleted selective guard**: a subscription event for a soft-deleted user updates `subscriptions.status`/`users.tier` but produces no archive job, banner flag, email, or analytics event; returns 200.
- Monthly counter reset creates new rows at month boundary; doesn't disturb other users' counters.
- Goal-cap enforcement on save endpoint blocks Free user trying to save a 4th active goal.
- Downgrade-and-archive selection validity: cannot proceed with > target_cap kept.
- Refund eligibility: monthly → 403; annual within 30d → 200; annual day 31 → 403. **Server-side enforcement, not just UI.**
- Stripe webhook signature verification rejects unsigned and tampered payloads.
- Stripe webhook handler is idempotent (replaying the same event ID is a no-op).
- Stripe webhook handler returns 200 no-op when no matching user row exists.
- Trial-cancel deferred execution: cancel-click does NOT archive goals; trial-end webhook does, reading from `pending_archive_goal_ids`.
- Trial resume clears pending state and re-enables the subscription.
- **Silent-expiry conversion**: `customer.subscription.updated` to `active` at trial-end (no prior cancellation) sets `users.tier='max'`, does not archive any goals, fires `trial_converted`.
- **Payment-failure dunning**: `invoice.payment_failed` does not immediately archive; subscription transitions to `past_due`. Only `customer.subscription.deleted` with `cancellation_details.reason='payment_failed'` triggers `applyPaymentFailureArchive`.
- **Activity heuristic in `applyPaymentFailureArchive`**: with 4 active goals sorted as `[A: 5 completions in last 30d, B: 1, C: 0, D: 2]`, keeps `[A, D, B]`, archives `[C]`. With all goals at 0 completions in the 30-day window, falls back to `created_at DESC`. A goal with 100 completions older than 30 days has `last_completion_at = NULL` per the window rule and ranks below any goal with ≥1 completion in the window.
- **Archived-goal reactivation**: clicking Restore on an archived goal opens the replan diff with rebased milestone dates relative to `now()`; accepting flips status to `active` and clears archive metadata; calls `checkAndIncrement('replan')` (consumes Free-tier replan quota; pass-through for Pro/Max); blocks with a cap error if `active_goals >= tier_cap`.
