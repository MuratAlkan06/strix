# Strix — Privacy Policy

> **DRAFT — NOT LEGAL ADVICE — REQUIRES ATTORNEY REVIEW BEFORE PUBLICATION**
>
> Drafted internally on 2026-06-10 from SPEC.md §7A (data gathered at intake), SPEC.md §10 (deletion, export, retention), PLAN.md §1–2 (processor list, schema, retention windows), and planning/phase-4-privacy.md (export and deletion mechanics). No attorney has reviewed this text. Do not publish or link it from the app until counsel has reviewed it — including the GDPR Article 9 health-data treatment, the international-transfer mechanisms, and whether an EU/UK representative under GDPR Article 27 is required — and every placeholder below is resolved. Tracked as issue #9.

## Placeholders to resolve before publication

| Placeholder | What is needed |
|---|---|
| **[PLACEHOLDER: entity name]** | The legal entity that operates Strix (the data controller) |
| **[PLACEHOLDER: production domain]** | The production domain where Strix and this policy are published |
| **[PLACEHOLDER: contact address]** | Registered postal address |
| **[PLACEHOLDER: contact email]** | Privacy contact email |
| **[PLACEHOLDER: effective date]** | Set when the final reviewed version is published |
| **[PLACEHOLDER: EU/UK representative]** | Whether an Article 27 representative is required, and who |
| **[PLACEHOLDER: analytics retention period]** | Event-data retention configured in the PostHog project |

**Effective date: [PLACEHOLDER: effective date]**

---

## 1. Who we are

Strix, at **[PLACEHOLDER: production domain]**, is operated by **[PLACEHOLDER: entity name]** ("we," "us"). We are the data controller for the personal data described in this policy. Contact details are in §12.

Strix is a goal-tracking app: you describe a goal, an AI assistant interviews you, and the app generates and tracks a structured plan. That design means you tell us things about yourself in free text. This policy describes exactly what we collect, who processes it, how long we keep it, and the controls you have.

## 2. Data we collect

**Account data.** Email address, display name, timezone, and authentication identifiers, managed through our sign-in provider (Clerk). If you sign in with Google or Apple, we receive the basic profile data those providers share.

**Goal and intake content.** The substance of the product. When you create a goal, the AI interviews you in free text about: the goal itself, your honest starting point and prior experience, your constraints (days per week, time per session, budget), and your target date. From that conversation we derive structured fields: a one-sentence goal, an activity type, a suggested and confirmed intensity preference, and any safety concerns raised (including whether you chose to override them). The full intake conversation transcript is stored with your goal.

**Location (coarse).** During intake we capture your city, region, and country as structured fields — used to plan realistically (terrain, season, travel) and to support future, strictly opt-in features. We do not collect GPS coordinates and we do not track your device's location.

**Health data you choose to share (special category).** Fitness-related intakes can elicit information such as weight, injury history, medical context, and training background. Under the GDPR (Article 9) this is "special category" health data. We process it **only with your explicit consent**, which we ask for in plain terms at the start of intake, and only to generate and adjust your plan. You can decline — the AI will plan around the gap — and you can remove the data by deleting the goal or your account. See §7 for retention.

**Progress and check-in data.** Which tasks you complete and when, your weekly check-in answers ("too easy / right / too hard") and free-text notes, and the history of plan adjustments you accepted or rejected.

**Billing data.** Payments are processed by Stripe. We never see or store full card numbers. We store your Stripe customer reference and your subscription state (tier, billing period, trial and renewal dates).

**Usage analytics.** Product events (for example: signup, goal created, plan generated, plan accepted, task checked off, check-in completed, subscription started or canceled) with device and browser metadata, via PostHog. In regions that require it, analytics runs only after you opt in (§8).

**Technical logs.** Like any web service, requests to Strix pass through our hosting provider (Vercel) and generate standard server logs — IP address, request time, user agent — used for security and operations.

## 3. What we use data for

- Generating and adjusting your goal plans, including sending your intake conversation and plan content to our AI provider (Anthropic) for processing.
- Operating your account: sign-in, sync, dashboard, equipment lists, check-ins.
- Billing: subscriptions, trials, refunds, tax.
- Transactional email only — cancellation confirmations, account-deletion confirmations, trial-ending reminders. **We do not send marketing or retention email.**
- Product analytics: understanding which parts of the product work, with consent where required.
- Security, abuse prevention, and legal compliance.

We do not sell your personal data, and we do not use your content for advertising.

### A note on AI processing

Your intake conversations and plan content are processed by Anthropic's API to generate responses. Anthropic processes this data as our data processor under a data processing addendum; under Anthropic's commercial terms, API content is not used to train Anthropic's models.

## 4. Who processes your data

We use a small set of service providers (processors) to run Strix. Each one has access only to what its role requires, under a data processing agreement (GDPR Article 28).

| Processor | Role | Personal data it touches |
|---|---|---|
| **Anthropic** | AI processing | Intake conversations, goal and plan text, check-in notes sent for plan generation and adjustment — including any health context you chose to share |
| **Clerk** | Authentication | Email address, name, sign-in identifiers and session data |
| **Stripe** | Billing and payments | Payment details, billing identity, transaction and tax records |
| **Neon** | Database hosting | The application database — all categories described in §2 |
| **Resend** | Transactional email | Your email address and the content of the transactional messages we send you |
| **PostHog** | Product analytics | Usage events, device/browser metadata, pseudonymous and account identifiers (consent-gated where required) |
| **Vercel** | Application hosting | All requests to Strix transit Vercel's infrastructure — IP addresses, request metadata, and request content in transit; server logs |
| **Inngest** | Background jobs | Job and event payloads carrying user identifiers — for scheduled work such as archiving completed goals, usage-counter resets, trial reminders, and account hard-deletion |

The current list is maintained here; if we add or replace a processor, we will update this policy.

## 5. Legal bases (GDPR)

Where the GDPR applies, we rely on: **contract** (running the service you signed up for — account, plans, billing); **explicit consent** for special-category health data shared at intake (Article 9(2)(a)) and for analytics cookies; **legitimate interests** for security, abuse prevention, and service operations; and **legal obligation** for tax and accounting records. You can withdraw consent at any time (§6), without affecting processing already performed.

## 6. Your rights and the controls built into the product

These rights are wired into the product — you do not need to email us to exercise the main ones:

- **Access and portability.** Settings → Data → "Export your data" downloads a complete JSON export of everything we hold on you: account data, goals, plans, task history, milestones, equipment, check-ins, intake summaries, and the full intake transcripts. Available on every tier, free included.
- **Erasure.** Settings → "Delete account" deletes your account: a 30-day recovery window (sign back in to restore), then permanent deletion of all personal data (§7).
- **Rectification.** Edit your profile, goals, plans, and preferences directly in the app. For anything you cannot edit in-app, contact us.
- **Restriction, objection, and consent withdrawal.** You can withdraw analytics consent in Settings at any time — the Analytics toggle stops collection immediately and clears the analytics cookies from your device. For health-data consent, restriction, or objection requests, contact us at **[PLACEHOLDER: contact email]**.
- **Complaint.** If you are in the EU/EEA or UK, you can lodge a complaint with your local supervisory authority.

**California residents (CCPA/CPRA).** You have the rights to know, correct, and delete personal information, exercised through the same product features above or by contacting us. **We do not sell your personal information and we do not share it for cross-context behavioral advertising**, so there is nothing to opt out of under "Do Not Sell or Share." We will never discriminate against you for exercising your rights.

## 7. How long we keep data

| Data | Retention |
|---|---|
| Account data and goals (active account) | For the life of your account |
| Account deletion | Soft-deleted for a **30-day grace period** (recoverable by signing in), then **permanently deleted** by an automated job — account, goals, plans, completions, check-ins, intake summaries and transcripts, counters, and subscription records |
| Intake conversation transcripts | Kept while your account is active (they give the AI context for plan adjustments); included in your data export; **permanently deleted with your account** |
| In-progress goal drafts (intake conversations not yet saved as a goal) | **30 days** from creation, then swept automatically; deleted immediately with account deletion |
| Billing and transaction records | Subscription state lives and dies with your account. Stripe retains transaction records independently where tax, accounting, and anti-fraud law requires it — a legal-obligation carve-out that survives account deletion |
| Records we must keep by law (tax, accounting, dispute) | For the legally required period only |
| Analytics events | **[PLACEHOLDER: analytics retention period]** per our PostHog project configuration |

## 8. Cookies

| Cookie | Purpose | Consent |
|---|---|---|
| Clerk session cookies | Essential — keeping you signed in securely | Not consent-gated (strictly necessary) |
| Intake draft session cookie | Essential — keeps your in-progress goal draft attached to your browser before you save it (HttpOnly) | Not consent-gated (strictly necessary) |
| PostHog analytics cookies | Product analytics | **Set only after you accept** in the consent banner — the analytics SDK does not load until then, so no cookie is set. Withdraw any time in Settings |

We use no advertising or cross-site tracking cookies.

## 9. International transfers

Our processors (§4) are based in the United States, so personal data of EU/EEA, UK, and Swiss users is transferred to the US. Those transfers rely on the European Commission's Standard Contractual Clauses in each processor's data processing agreement and, where the processor is certified, the EU-U.S. Data Privacy Framework (and its UK and Swiss extensions). *(Attorney note: confirm the transfer mechanism per processor at publication time, and whether **[PLACEHOLDER: EU/UK representative]** is required under Article 27.)*

## 10. Security

Data is encrypted in transit. Access to production systems is restricted and authenticated. AI calls are routed through our servers — your browser never talks to the AI provider directly, and our API keys and your data scope are enforced server-side. Payments are handled entirely by Stripe; card numbers never touch our systems.

## 11. Children

Strix is not directed at children. You must be at least 13 to use it, or older where your country sets a higher age for consenting to data processing. We do not knowingly collect personal data from children below the applicable age; if we learn we have, we will delete it. If you believe a child is using Strix, contact us.

## 12. Contact

**[PLACEHOLDER: entity name]**
**[PLACEHOLDER: contact address]**
**[PLACEHOLDER: contact email]**

## 13. Changes to this policy

If we change this policy materially — a new processor, a new data category, a new purpose — we will notify you in the app or by email before the change takes effect, and update the effective date above.
