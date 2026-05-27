# Phase 4 — Privacy / lifecycle

**Goal:** GDPR-aligned data export and account deletion. Settings page complete. Stripe customer record cleaned up cleanly on hard delete so we never email a deleted user.

**Prerequisites:** Phase 3 complete (subscriptions table populated, Stripe integration working).

**Gates:** Phase 5 follows.

## Items to build

### Settings page

- Route: `app/(settings)/page.tsx`. Spec §6:
  - **Profile** — display name, timezone (auto-detected with override), intensity preference.
  - **Subscription** — links to billing settings from Phase 3.
  - **Data** — "Export your data" button, "Delete account" link.
  - Both Data items visible but not the very first thing — under Profile + Subscription per spec §10 "visible but not the very first thing."

### JSON data export

- Spec §10: "One-click JSON export of all the user's data: goals, recurring tasks, completions, milestones, equipment, check-ins, intake summaries. Required for GDPR, expected by power users, and useful for the company's own debugging. Available on all tiers — no premium gating."
- Endpoint: `GET /api/me/export` (authenticated). Returns a single JSON blob with all user-owned rows, structured as:

  ```json
  {
    "exported_at": "2026-...",
    "user": { ... },
    "subscription": { ... },
    "goals": [
      {
        "...goal fields...",
        "intake_summary": { ... },
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
- Triggered by a button in settings → downloads `strix-export-{userId}-{date}.json`.
- No file uploads to S3 or email-as-attachment — direct response. Keeps it simple; revisit if exports get large.

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
  - Send transactional email via Resend: "We've started deleting your account. To recover, sign in within 30 days at strix.app. After 30 days, all data is permanently removed."
  - PostHog: `account_deleted` (soft-delete event).
- Login recovery: if a user signs in with `users.deleted_at IS NOT NULL AND deleted_at + 30 days > now`, show a recovery screen: "Welcome back. Restore your account?" → primary action clears `deleted_at`, restoring access. PostHog: `account_recovered`.

### Hard-delete cron + Stripe customer cleanup

- Inngest function `hardDeleteAccounts` runs daily.
- Finds users with `deleted_at IS NOT NULL AND deleted_at + 30 days <= now()`.
- For each:
  1. **Stripe customer cleanup** (per user-approved Phase 4 detail): if `stripe_customer_id` exists, call `stripe.customers.del(stripeCustomerId)` OR `stripe.customers.update(id, { metadata: { deleted: "true" }, email: null })`. **Prefer hard delete via API.** Use the metadata-mark approach only if Stripe returns an error (rare; happens with refund-pending invoices). Either way, the customer must not be reachable for future emails.
  2. Hard-delete all `task_completions` rows for this user.
  3. Hard-delete all `replan_proposals`, `equipment`, `milestones`, `recurring_tasks`, `intake_summaries` rows whose parent `goals.user_id` is this user.
  4. Hard-delete all `goals` for this user.
  5. Hard-delete `weekly_check_ins`, `usage_counters`, `subscriptions` for this user.
  6. Hard-delete the `users` row.
  7. Notify Clerk to delete the user (`clerkClient.users.deleteUser(userId)`).
- Idempotent: re-running the job on a user already hard-deleted is a no-op (the user row is gone).
- The order matters because of FK constraints — children first, parents last. Wrap each user's cleanup in a transaction.

### Resend transactional emails

- Templates (text + minimal HTML, Patagonia register):
  - `subscription_canceled` — sent on cancellation. One email, no follow-up retention emails per spec §10.
  - `account_deletion_initiated` — sent on soft-delete with recovery instructions.
  - `account_hard_deleted` — sent at hard-delete. **Only if** the user gave a backup email at deletion (rare; skip if none). If the only email is the one being deleted from Stripe, skip — we don't want to email an address we just purged.
  - `trial_ending_tomorrow` — sent 24h before trial-end (Phase 3 callback).
- All emails go through `lib/email/send.ts` which logs to PostHog `email_sent { template, user_id }` for deliverability tracking.
- **No retention emails** ever per spec §10.

## Phase-specific context

### Why Stripe customer cleanup matters

If we soft-delete in our DB but leave the Stripe customer record intact:

- Future Stripe automated emails (failed payments, renewal notices) could still hit the user's email.
- If we later integrate any "win-back" email tooling that syncs from Stripe customer list, we'd accidentally email a deleted user.
- GDPR right-to-erasure is about *all* systems holding the data, not just our DB.

Hard-deleting the Stripe customer (`stripe.customers.del`) is the canonical fix. Stripe retains the customer reference on past invoices for tax purposes (legal requirement) but the customer record itself is gone — no email, no future communication.

### Why login-recovery is automatic, not "click a link in an email"

Spec §10: "the user can recover by logging in within those 30 days." Just logging in is the recovery action. No email link, no support ticket. The recovery screen on login is the only friction.

### Soft-delete query rules

Add a global filter to `scopedDb` that excludes rows where `users.deleted_at IS NOT NULL` from authenticated user-facing queries. The recovery screen uses `unscopedDb` to read the soft-deleted user.

### Out of scope

- GDPR data portability beyond JSON export (e.g., CSV, XML, etc. — v2 or on-request).
- Subject Access Requests via email (handle manually via the JSON export until volume warrants automation).

## Verification

End-to-end:

1. As authenticated user with at least one goal, navigate to Settings → Data → "Export your data" → JSON downloads containing all expected sections (user, subscription, goals with nested children, check-ins, usage_counters).
2. Validate the export JSON against a schema (Vitest).
3. As authenticated user, navigate to Settings → "Delete account" → confirmation screen plain, single button. Click → `deleted_at` set, signed out, transactional email sent.
4. Within 30 days, log back in → recovery screen → click "Restore" → `deleted_at` cleared, full access restored.
5. Test seam: set `deleted_at` to 31 days ago, run `hardDeleteAccounts` manually → user row gone, all child rows gone, Clerk user deleted, Stripe customer deleted (or marked).
6. Verify in Stripe dashboard that the customer record is either deleted or has `metadata.deleted=true` and `email=null`.
7. Verify no email was sent to the deleted user's old email at hard-delete (unless explicit backup email was provided — Phase 4 ships without backup email, so always skipped).

Automated (Vitest):

- `/api/me/export` returns all user-owned data and **no other user's data** (seeded fixture with two users).
- Soft-delete idempotency: marking a user `deleted_at` twice doesn't double-cancel the subscription.
- Login recovery within window works; outside window, the next morning's hard-delete cron removes them.
- `hardDeleteAccounts` is idempotent (no error if user already gone).
- FK delete order: deleting a user with full goal+completions+milestones+equipment tree succeeds without constraint violation.
- Stripe customer deletion is attempted; on failure (mock 500), the metadata-mark fallback runs and the user delete still proceeds.
