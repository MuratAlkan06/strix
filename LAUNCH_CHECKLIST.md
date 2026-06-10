# Strix Launch Checklist

Compliance and operational items that gate launch but are **not engineering tasks for the Phase 0–5 build sequence**. These belong to a separate pre-launch track — do not fold them into phase files.

Tracking doc only. Each item: what it is and why it's needed. Specifics live wherever the owner of the item documents them.

Umbrella tracking issue: #7. Each item below carries its issue number and, where one exists, its runbook or draft path.

---

## Phase-3-blocking

Must exist before taking payment or shipping to the EU. If any of these is missing when Phase 3 ships, Phase 3 cannot go live.

- [ ] **Terms of Service** — published at a stable URL. Stripe Checkout requires a `terms_of_service_url` parameter on trial flows; GDPR requires a ToS. Without it, Stripe Checkout rejects the session config and EU users have grounds for complaint.

  Tracking: #8 — draft at docs/legal/terms-of-service.md

- [ ] **Privacy Policy** — published at a stable URL. GDPR (EU) and CCPA (California) require a published policy describing what data is collected, what third-party subprocessors handle it, how long it's retained, and the user's rights (access, rectification, deletion, portability). Linked from settings + signup.

  Tracking: #9 — draft at docs/legal/privacy-policy.md

- [ ] **Stripe Tax enabled** + tax-jurisdiction registration filed. EU VAT collection is legally required when selling to EU consumers; US sales tax is required in nexus states. Stripe Tax automates collection but the merchant must (a) enable it in Stripe and (b) register in each jurisdiction. Launching to EU without VAT is non-compliant from day one.

  Tracking: #10 — runbook at docs/launch/stripe-setup.md

- [ ] **Cookie consent UI** for PostHog analytics cookies. GDPR ePrivacy directive requires explicit opt-in for non-essential cookies. PostHog has a built-in GDPR mode + recommended banner pattern. Without consent collection, EU sessions can't be analytics-tracked legally.

  Tracking: #11

---

## Pre-public-launch

Required before real scale. Not Phase-3-blocking — internal/closed-beta on Phase 3 can proceed without these, but a public launch cannot.

- [ ] **Signed DPAs** (Data Processing Agreements) with all subprocessors: Anthropic, Clerk, Stripe, Neon, Resend, PostHog. Each vendor has a standard DPA. GDPR Article 28 requires written agreements with every processor that handles personal data on behalf of the controller (us). One per vendor; counter-signed.

  Tracking: #12 — runbook at docs/launch/vendor-dpas.md (adds Vercel + Inngest per PLAN.md architecture table)

- [ ] **Age gate** at signup. COPPA (US) prohibits collecting data from under-13 without verifiable parental consent; GDPR-K (EU) sets the age between 13–16 depending on member state. The intake chat collects free-text personal info — having no age check is a regulatory exposure. Implement as a date-of-birth question or an attestation at signup; reject under-13 signups.

  Tracking: #13

- [ ] **Health-data consent** at intake start. Fitness intakes elicit weight, medical history, training/injury context. GDPR Article 9 classifies health data as "special category" — requires explicit consent beyond standard ToS acceptance, with the purpose stated plainly. Surface as a one-line consent in the intake opening for fitness-coded goals (or for all goals, for simplicity).

  Tracking: #14

- [ ] **DKIM + SPF + DMARC** records on the Resend sending domain. Operational: required for email deliverability (otherwise transactional mail lands in spam) and for anti-spoofing. Resend provides the records; we set them in DNS for `strix.app` (or whatever the production domain is).

  Tracking: #15 — runbook at docs/launch/email-dns.md

- [ ] **Content Security Policy + security headers** (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). CSP must allowlist Stripe (`js.stripe.com`, `checkout.stripe.com`), Clerk (Clerk's CDN + iframe domains), and PostHog (`*.posthog.com` or the EU host). Without CSP, the app is XSS-permissive by default.

  Tracking: #16

- [ ] **Rate limiting** on AI endpoints (`/api/ai/intake`, `/api/ai/plan`, `/api/ai/replan`), the refund route, and the goal-save endpoint. The `/api/me/export` route already has its own limit (Phase 4). Without rate limits, a buggy client or an attacker can drive Anthropic spend through the roof or trigger denial-of-service against the refund flow.

  Tracking: #17

- [ ] **Sentry (or equivalent) error monitoring**, promoted from "optional" to required before launch. Without it, silent webhook signature failures, `checkAndIncrement` race-condition drift, Inngest job failures, and scopedDb leak attempts (caught throws) are invisible. Set up with a Strix-specific project and PII filtering rules.

  Tracking: #18

- [ ] **Per-user Anthropic spend cap + anomaly detection**. Alert when any user's daily or monthly Anthropic cost exceeds a threshold (suggested: $5/day or $50/month for any individual). Catches bugs (infinite-loop intakes) and abuse (someone scripting against the AI endpoints) before they bill significantly. Anthropic doesn't expose per-user usage natively — track from server-side logs.

  Tracking: #19
