# Runbook — Resend sending domain and email DNS (DKIM / SPF / DMARC)

Operator runbook for authenticating the transactional-email sending domain. Without these records, cancellation receipts, deletion confirmations, and trial reminders land in spam — and the domain is spoofable. Strix sends **transactional email only** (PLAN.md §1; no retention emails per SPEC §10), so volume is low but deliverability is load-bearing: a missed trial-ending reminder is a surprise charge.

Tracked as issue #15 under umbrella #7. LAUNCH_CHECKLIST: "DKIM + SPF + DMARC records on the Resend sending domain."

---

## 1. Decide the production domain

The production domain is **decided: `joinstrix.com`** (issue #70 — registered at Porkbun on 2026-07-22; nameservers delegated to Vercel DNS, with the domain held at the Vercel team level and not yet assigned to the project). **Phase 1 HOLDS until the attorney confirms the trademark:** the decision is recorded here, but the real DNS records below are not created until the Phase-1 DNS session. This choice binds the Clerk prod instance, the Stripe public-details URLs, and the Resend sending subdomain, and also issues #8/#9 (the legal docs publish at this domain).

**Done when:** the domain is decided, registered, and its DNS is managed somewhere you can add records — **done** (`joinstrix.com`, DNS on Vercel); record creation still gated on the attorney trademark check.

## 2. Use a sending subdomain

Recommendation: send transactional mail from a dedicated subdomain, e.g. `send.joinstrix.com` (so mail comes from `no-reply@send.joinstrix.com` or similar).

Why: it isolates the email reputation of transactional mail from the root domain, keeps the root's DNS clean, and is Resend's recommended pattern. The DMARC policy still lives on the root domain and covers the subdomain.

**Done when:** subdomain name chosen (no DNS work yet — Resend generates the records in step 3).

## 3. Add the domain in Resend

1. Resend dashboard → **Domains** → **Add Domain**.
2. Enter the sending subdomain (`send.<domain>`), choose the sending region closest to the user base.
3. Resend displays the exact DNS records to create — DKIM records, plus SPF (TXT) and an MX record scoped to the sending subdomain for bounce handling.

**Done when:** the domain appears in Resend in "pending" state with its record list visible.

## 4. Create the DNS records at the DNS host

1. At the DNS host for **`joinstrix.com`** (Vercel DNS), create **exactly** the records Resend lists — copy them verbatim (names, types, values). Do not hand-author SPF or DKIM values; Resend's are authoritative for its infrastructure and may change between accounts.
2. Typical set: 1–3 DKIM records (TXT or CNAME), 1 SPF TXT on the sending subdomain, 1 MX on the sending subdomain. Keep TTLs at the host's default.

**Done when:** all records Resend listed resolve publicly (`dig TXT <name>` / the DNS host's preview shows them).

## 5. Add a DMARC record (start at monitoring)

DMARC is set on the **root** domain, not the sending subdomain, and starts in monitor-only mode:

1. Create a TXT record:
   - Name: `_dmarc.joinstrix.com`
   - Value: `v=DMARC1; p=none; rua=mailto:[PLACEHOLDER: DMARC report mailbox]`
2. `p=none` means: enforce nothing yet, send aggregate reports to the `rua` mailbox so we can see who is sending as the domain.

**Done when:** `dig TXT _dmarc.<domain>` returns the record.

## 6. Verify in Resend

1. Back in Resend → Domains → the pending domain → **Verify**.
2. DNS propagation can take minutes to hours. Re-check until status is **Verified** for all records.

**Done when:** the domain shows **Verified** in Resend.

## 7. Send a test mail and check authentication headers

1. From Resend (dashboard test send or API) send a message from the new domain to a Gmail address you control.
2. In Gmail: open the message → ⋮ → **Show original**.
3. Confirm all three:
   - `SPF: PASS`
   - `DKIM: PASS` (signed with `d=send.<domain>`)
   - `DMARC: PASS`
4. Confirm the message arrived in the inbox, not spam.

**Done when:** `spf=pass dkim=pass dmarc=pass` on a real received message.

## 8. DMARC ramp to enforcement

`p=none` is a starting state, not an end state:

1. **Monitor 2–4 weeks** of aggregate reports at the `rua` mailbox. Confirm all legitimate mail (Resend) aligns and nothing unexpected sends as the domain.
2. Move to `p=quarantine` (failing mail goes to spam).
3. After another clean monitoring window, move to `p=reject` (failing mail is refused) — the anti-spoofing end state.
4. Track the ramp as a follow-up task; do not jump straight to `p=reject` before monitoring.

**Done when:** DMARC is at `p=quarantine` or stricter with no legitimate-mail losses observed.

## Final checklist

- [x] Production domain decided: **`joinstrix.com`** (Porkbun, DNS on Vercel; Phase-1 record creation holds on attorney trademark confirmation)
- [ ] Sending subdomain chosen (recommendation: `send.<domain>`)
- [ ] Domain added in Resend; DNS records copied verbatim to the DNS host
- [ ] DMARC `p=none` + `rua` reporting live on the root domain
- [ ] Domain **Verified** in Resend
- [ ] Test mail shows `spf=pass dkim=pass dmarc=pass` in Gmail headers
- [ ] DMARC ramp to `quarantine`/`reject` scheduled after monitoring window
