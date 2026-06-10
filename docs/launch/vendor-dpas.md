# Runbook — Vendor Data Processing Agreements (DPAs)

GDPR Article 28 requires a written data processing agreement with **every** processor that handles personal data on our behalf. This runbook tracks all of them to executed status. Tracked as issue #12 under umbrella #7.

Scope note: LAUNCH_CHECKLIST names six vendors (Anthropic, Clerk, Stripe, Neon, Resend, PostHog). PLAN.md §1's architecture table adds two more that also touch personal data and therefore also need DPAs: **Vercel** (hosting — every request, with IPs and payloads, transits it) and **Inngest** (background jobs — event payloads carry user identifiers). Eight total.

DPA URLs below were checked on **2026-06-10**. "Auto-incorporated" means the DPA is part of the vendor's standard terms and binds on acceptance — no signature round-trip; record the URL and version/date instead. "Sign-and-return" means an execution step is required.

---

## DPA tracker

| Vendor | Personal data it touches | Where the DPA lives | Execution method | Status |
|---|---|---|---|---|
| **Anthropic** | Intake conversations, goal/plan text, check-in notes sent for AI processing — may include user-disclosed health context | <https://www.anthropic.com/legal/data-processing-addendum> (verified 2026-06-10; effective 2025-02-24) | Auto-incorporated into the Anthropic Commercial Terms of Service (includes SCCs). Applies to commercial API accounts | [ ] |
| **Clerk** | Email, name, auth identifiers, session/sign-in data | <https://clerk.com/legal/dpa> (verified 2026-06-10) — note: clerk.**com**, not clerk.io (different company) | Auto-incorporated as a standing legal term of the service agreement; contact Clerk if a counter-signed copy is needed for records | [ ] |
| **Stripe** | Billing identity, payment details, transaction and tax records | <https://stripe.com/legal/dpa> (verified 2026-06-10; FAQs at /legal/dpa/faqs) | Auto-incorporated — forms part of the Stripe Services Agreement; Data Transfers Addendum incorporated | [ ] |
| **Neon** | The entire application database — all user data categories | <https://neon.com/dpa> (verified 2026-06-10) | Auto-incorporated into Neon's Terms of Service / MSA; a separately signable copy is offered for customers that need one on file | [ ] |
| **Resend** | Recipient email addresses, names, transactional message content | <https://resend.com/legal/dpa> (verified 2026-06-10) | Auto-incorporated on acceptance of the agreement; Resend also publishes a pre-signed PDF (<https://resend.com/static/documents/resend-dpa-signed.pdf>) to keep on file | [ ] |
| **PostHog** | Usage events, device/browser metadata, pseudonymous + account identifiers | <https://posthog.com/dpa> (verified 2026-06-10) | **Sign-and-return**: generate via PostHog's DPA generator (US vs EU cloud variant), sign, PostHog counter-signs | [ ] |
| **Vercel** | All request traffic in transit (IPs, headers, payloads), server logs | <https://vercel.com/legal/dpa> (verified 2026-06-10) | Auto-incorporated — but its own text scopes coverage to **Pro and Enterprise plans**; confirm the account is on ≥ Pro before relying on it | [ ] |
| **Inngest** | Background job/event payloads carrying user IDs (auto-archive, usage resets, trial reminders, account hard-deletion) | **UNVERIFIED — no public DPA page found** (2026-06-10). Trust center: <https://trust.inngest.com/>; security page: <https://www.inngest.com/security> | Unknown — request via security@inngest.com (expect sign-and-return or trust-center download); SOC 2 Type II reports available via trust center | [ ] |

## Operator steps

1. For each **auto-incorporated** vendor (Anthropic, Clerk, Stripe, Neon, Resend, Vercel): open the DPA URL, confirm it covers the services we use, save a dated PDF/print of the page, and record the version or effective date in the tracker above. For Vercel, additionally confirm the plan tier is Pro or Enterprise.
2. For **PostHog**: run the DPA generator at <https://posthog.com/dpa> (pick the variant matching our PostHog Cloud region), sign, submit for counter-signature, and file the fully executed copy.
3. For **Inngest**: email security@inngest.com (or check <https://trust.inngest.com/>) requesting their DPA; execute per their process; file the result. Until executed, treat Inngest as the open Article 28 gap.
4. Sanity-check each DPA's subprocessor list for surprises (e.g., Resend's subprocessors at <https://resend.com/legal/subprocessors>).
5. Store every executed/recorded DPA in **[PLACEHOLDER: DPA storage location]** (one folder, one file per vendor, dated filenames), and tick the Status box in the tracker.
6. Keep the privacy policy's processor table (docs/legal/privacy-policy.md §4) in sync with this list — they must never diverge.

**Done when:** all eight rows are ticked, each with a dated executed copy or dated record of the auto-incorporated version in **[PLACEHOLDER: DPA storage location]**, and the Inngest gap is closed.
