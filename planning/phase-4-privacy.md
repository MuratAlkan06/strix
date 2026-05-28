# Phase 4 — Privacy / lifecycle

**Goal:** GDPR-aligned data export and account deletion. Settings page complete. Stripe customer record cleaned up cleanly on hard delete so we never email a deleted user. Hard-delete order is **Stripe → Clerk → DB** so the DB row is the recovery surface if any earlier step fails.

**Prerequisites:** Phase 3 complete (subscriptions table populated, Stripe integration working).

**Gates:** Phase 5 follows.

## Items to build

### Settings page

- Route: `app/(settings)/page.tsx` (replacing the Phase 0 placeholder shell). Spec §6:
  - **Profile** — display name, timezone (auto-detected with override), intensity preference (synced from the user's most recent intake confirmation; editable here).
  - **Subscription** — links to billing settings from Phase 3.
  - **Data** — "Export your data" button, "Delete account" link.
  - Both Data items visible but not the very first thing — under Profile + Subscription per spec §10 "visible but not the very first thing."

### JSON data export

- Spec §10: "One-click JSON export of all the user's data: goals, recurring tasks, completions, milestones, equipment, check-ins, intake summaries. Required for GDPR, expected by power users, and useful for the company's own debugging. Available on all tiers — no premium gating."
- Endpoint: `GET /api/me/export`. **`userId` is sourced exclusively from `auth.userId` (Clerk session)** — never from query string, body, or header. The handler explicitly reads from the auth context and uses `scopedDb(authUserId)` for every read.
- **Rate-limited**: 5 requests per user per hour, returning 429 with `Retry-After` header beyond that. Implemented via an in-memory ring buffer keyed by `userId` (single-instance OK for MVP scale; revisit if multi-region).
- Returns a single JSON blob with all user-owned rows, structured as:

  ```json
  {
    "exported_at": "2026-...",
    "user": { "...all user fields including intensity_preference, timezone..." },
    "subscription": { "..." },
    "goals": [
      {
        "...goal fields including archive_reason, archive_notice_dismissed_at...",
        "intake_summary": {
          "...all intake fields including suggested_intensity, confirmed_intensity...",
          "safety_flags": [ ... ],
          "raw_transcript": [ ... ]
        },
        "recurring_tasks": [ ... ],
        "task_completions": [ ... ],
        "milestones": [ ... ],
        "equipment": [ ... ],
        "replan_proposals": [ ... ]
      }
    ],
    "weekly_check_ins": [ ... ],
    "usage_counters": [ ... ]
  }
  ```
- **`raw_transcript` is explicitly included** — GDPR data-portability requires the full record of stored user-generated content.
- Triggered by a button in settings → downloads `strix-export-{userId}-{date}.json`.
- No file uploads to S3 or email-as-attachment — direct response. Keeps it simple; revisit if exports get large.
- PostHog: `data_exported { bytes }`.

### Account deletion

- Spec §10: distinct from subscription cancellation. Soft-delete for 30-day grace period; hard-delete after 30 days.
- "Delete account" link in settings → confirmation screen:
  - Plain copy: "Deleting your account removes your goals, plans, and check-ins. You can recover by signing in within the next 30 days. After 30 days, all data is permanently deleted."
  - If user has an active subscription: "Your subscription will be canceled at the end of the current billing period. Refund policy applies as usual."
  - Single primary button: "Delete account."
- On click:
  - Set `users.deleted_at = now()`.
  - If user has active subscription: call `stripe.subscriptions.update(subId, { cancel_at_period_end: true })`.
  - Sign the user out via Clerk.
  - Send transactional email via Resend: `account_deletion_initiated` — "We've started deleting your account. To recover, sign in within 30 days at strix.app. After 30 days, all data is permanently removed."
  - PostHog: `account_deleted { had_subscription }`.
- Login recovery: if a user signs in with `users.deleted_at IS NOT NULL AND deleted_at + 30 days > now`, show a recovery screen: "Welcome back. Restore your account?" → primary action clears `deleted_at`, restoring access. PostHog: `account_recovered { days_since_delete }`. **The recovery screen uses `unscopedDb` to bypass the global soft-delete filter** (the filter exists in `scopedDb` from Phase 0).

### Hard-delete cron + cleanup order (Stripe → Clerk → DB)

- Inngest function `hardDeleteAccounts`: `{ id: "hard-delete-accounts", cron: "0 5 * * *" }` (5am UTC daily).
- Finds users with `users.deleted_at IS NOT NULL AND deleted_at + interval '30 days' <= now()`.
- For each user, in this order (DB-last as the recovery surface):
  1. **Stripe customer cleanup**: if `stripe_customer_id` exists, call `stripe.customers.del(stripeCustomerId)`. On Stripe API error (rare; happens with refund-pending invoices), fall back to `stripe.customers.update(id, { metadata: { deleted: "true" }, email: null })`. **Prefer hard delete via API.** If both fail (unrecoverable Stripe error), log and skip this user — retry tomorrow. The Stripe webhook handler is required to check `metadata.deleted === 'true'` and no-op on any event from such customers (see Phase 3).
  2. **Clerk deletion**: `clerkClient.users.deleteUser(userId)`. On error: log and skip this user; retry tomorrow. (Why before DB delete: if Clerk delete fails and DB is already gone, the user could sign in again and re-create a fresh DB row via the Clerk webhook — losing all prior cleanup state. With Clerk delete first, the DB row is still present as a recovery anchor if anything goes wrong.)
  3. **DB cleanup**, wrapped in a transaction (FK order, children first):
     1. Hard-delete all `task_completions` rows for this user.
     2. Hard-delete all `replan_proposals` whose parent goals belong to this user.
     3. Hard-delete all `equipment` whose parent goals belong to this user.
     4. Hard-delete all `milestones` whose parent goals belong to this user.
     5. Hard-delete all `recurring_tasks` whose parent goals belong to this user.
     6. Hard-delete all `intake_summaries` whose parent goals belong to this user (this includes `raw_transcript`).
     7. Hard-delete all `goals` for this user.
     8. Hard-delete `weekly_check_ins`, `usage_counters`, `subscriptions`, `goal_drafts` for this user.
     9. Hard-delete the `users` row.
- Idempotent: re-running the job on a user already hard-deleted is a no-op (the user row is gone, query returns no matches).

### Resend transactional emails

- Templates (text + minimal HTML, Patagonia register):
  - `subscription_canceled` — sent on cancellation (Phase 3 fires this).
  - `trial_ending_tomorrow` — sent by Phase 3's `trialReminderTomorrow` Inngest job.
  - `account_deletion_initiated` — sent on soft-delete with recovery instructions.
  - **No `account_hard_deleted` email.** The previous plan's logic was incoherent (it required a backup email that the deletion UI doesn't collect). At hard-delete time there is no email we can responsibly send: the address is being purged from Stripe and Clerk. Skip the template entirely.
- All emails go through `lib/email/send.ts` which logs to PostHog `email_sent { template, user_id }` for deliverability tracking.
- **No retention emails** ever per spec §10.

### Email verification mechanism

- Phase 4 verification of "email was sent" uses one of two mechanisms (CI uses (a), local dev uses either):
  - **(a) Resend test mode**: `RESEND_API_KEY` for test mode does not actually send; the API returns a payload with the message ID. Test assertion: `lib/email/send.ts` returns the test-mode response shape and the `email_sent` PostHog event is captured.
  - **(b) `email_sent` event**: assert the PostHog event fired with the right `template` property.
- The Vitest suite uses (b) (no network); Playwright uses (a) where possible.

## Phase-specific context

### Why Stripe → Clerk → DB

Previous plan: DB then Clerk. Failure mode: if Clerk delete fails, the next login fires a fresh `user.created` webhook (Phase 0 handler) and creates a brand-new `users` row at `tier='free'` — the user has effectively been reincarnated with no prior history and no cleanup signal. With Clerk-first, if anything fails along the way the DB row is still present (with `deleted_at` set), so the user lands on the recovery screen on next login instead of a ghost-fresh account. Stripe is first because it's an independent system — getting the customer out of Stripe early stops any further automated communication regardless of what happens next.

### Why login-recovery is automatic, not "click a link in an email"

Spec §10: "the user can recover by logging in within those 30 days." Just logging in is the recovery action. No email link, no support ticket. The recovery screen on login is the only friction.

### Soft-delete query rules — Phase 0 + Phase 4 regression matrix

The `users.deleted_at` filter is **built into `scopedDb` from Phase 0**, not retroactively in Phase 4. Phase 4's responsibility is to (a) wire the deletion flow and (b) verify the filter has not regressed any Phase 1-3 surface.

Phase 4 verification adds a regression matrix:

| Surface | Test | Pass criteria |
|---|---|---|
| Phase 1 dashboard query | Non-deleted user A logs in → sees own goals | Goals listed |
| Phase 1 dashboard query | Soft-deleted user B's session token used → recovery screen, no goals shown | No goals leak |
| Phase 1 goal-save | Non-deleted user saves new goal | Goal created |
| Phase 1 task check-off | Non-deleted user checks off task | Row inserted |
| Phase 2 weekly check-in | Non-deleted user submits | Check-in row created |
| Phase 2 replan endpoint | Non-deleted user triggers replan | Endpoint returns diff |
| Phase 3 cap check | Non-deleted Free user near cap | `checkAndIncrement` works |
| Phase 3 Stripe webhook | Customer event for non-deleted user | Subscription updated |
| Phase 3 Stripe webhook | Customer event for soft-deleted user during grace | No update (filter rejects) — but webhook still 200-OKs idempotently |

Add Vitest fixtures with two users, one with `deleted_at` set, and assert each surface's expected behavior.

### Out of scope

- GDPR data portability beyond JSON export (e.g., CSV, XML, etc. — v2 or on-request).
- Subject Access Requests via email (handle manually via the JSON export until volume warrants automation).

## Verification

End-to-end:

1. As authenticated user with at least one goal, navigate to Settings → Data → "Export your data" → JSON downloads containing all expected sections (user, subscription, goals with nested children including `raw_transcript`, check-ins, usage_counters). PostHog `data_exported` fires.
2. Validate the export JSON against a schema (Vitest).
3. Hit `/api/me/export` 6 times in an hour → 6th returns 429 with `Retry-After`.
4. POST to `/api/me/export?userId=<otherUser>` → still scoped to auth userId; returns the caller's data, not the queried user's.
5. As authenticated user, navigate to Settings → "Delete account" → confirmation screen plain, single button. Click → `deleted_at` set, signed out, `account_deletion_initiated` email captured in PostHog `email_sent` event.
6. Within 30 days, log back in → recovery screen → click "Restore" → `deleted_at` cleared, full access restored.
7. Test seam: set `deleted_at` to 31 days ago, run `hardDeleteAccounts` manually → execution order is Stripe→Clerk→DB; final state: user row gone, all child rows gone, Clerk user deleted, Stripe customer deleted (or marked).
8. Inject a Clerk delete failure for one user via mock → Stripe deleted (step 1 success), Clerk delete fails (step 2 failure), DB unchanged (step 3 not reached). Next run of the cron: retries from step 1 (Stripe delete is idempotent), succeeds on Clerk this time, proceeds to DB. User eventually hard-deleted.
9. Verify in Stripe dashboard that the customer record is either deleted or has `metadata.deleted=true` and `email=null`.
10. Verify no email was sent at hard-delete (no `account_hard_deleted` template exists; PostHog `email_sent` for that template is never captured).
11. Run the Phase 4 regression matrix — all rows pass.

Automated (Vitest):

- `/api/me/export` returns all user-owned data and **no other user's data** (seeded fixture with two users).
- `/api/me/export` reads userId from auth context, not from query/body.
- `/api/me/export` rate limit triggers at 6th request within the hour.
- `/api/me/export` JSON includes `raw_transcript` for every intake summary.
- Soft-delete idempotency: marking a user `deleted_at` twice doesn't double-cancel the subscription.
- Login recovery within window works; outside window, the next morning's hard-delete cron removes them.
- `hardDeleteAccounts` is idempotent (no error if user already gone).
- `hardDeleteAccounts` execution order: Stripe call precedes Clerk call precedes DB delete. Verified via mock call order.
- `hardDeleteAccounts` on Clerk failure: skip user, retry tomorrow (no DB mutation in this run).
- FK delete order: deleting a user with full goal+completions+milestones+equipment tree succeeds without constraint violation.
- Stripe customer deletion is attempted; on failure (mock 500), the metadata-mark fallback runs and the user delete still proceeds.
- Stripe webhook for a customer with `metadata.deleted='true'`: handler no-ops cleanly.
- `account_hard_deleted` template does not exist in `lib/email/templates/`.
- Phase 4 regression matrix (10 rows from above) all pass.
