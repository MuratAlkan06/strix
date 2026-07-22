# Strix — Counsel review package (cover memo)

> **FOR ATTORNEY REVIEW — prepared by the owner, not legal advice.**
>
> This memo batches every legal question blocking the Strix commerce launch into
> a single review pass. It accompanies two drafts for review — the Terms of
> Service (`docs/legal/terms-of-service.md`, issue #8) and the Privacy Policy
> (`docs/legal/privacy-policy.md`, issue #9) — plus a trademark-clearance ask.
> Refs: #7 (launch umbrella), #8 (ToS), #9 (Privacy).

## 1. Purpose & timing

Requesting legal review ahead of the Strix commerce launch (paid subscriptions).

This is the project's **longest external lead**, and two launch-critical paths
hold on its output:

- The **production-cutover DNS phase** holds on the trademark read (**ask 4**) —
  the domain is irreversible once Clerk prod cookies, Stripe URLs, and email
  DKIM pin to it, so we want a clearance opinion before we commit.
- The **Max-trial billing slice** holds on **ToS publication** (**ask 1**) —
  Stripe Checkout will not create a trial session without a published
  terms-of-service URL.

**Please treat this as one batch.** Everything below — ToS, Privacy, entity/
jurisdiction advice, trademark clearance, tax presentation — is needed before
first charge; reviewing it in one pass is the shortest path to launch.

## 2. Product summary (for counsel context)

**Strix** is a consumer fitness/goal-planning web app (installable PWA) at
**joinstrix.com**. The brand presents as "Strix"; the domain is deliberately a
composite (`join` + `strix`) rather than the bare mark — see ask 4.

**Subscription billing (Stripe):**

| Tier | Price | Trial | Charge behavior |
|---|---|---|---|
| **Free** | $0 (capped usage) | — | — |
| **Pro** | $9.99/mo or $89.99/yr | none | immediate charge on signup |
| **Max** | $19.99/mo or $179.99/yr | **7-day free trial**, card required up front | card charged at trial end **unless** the user cancels |

- **Click-to-cancel:** single-screen cancellation — no confirmation
  interstitials, no retention offers, no "contact support" requirement.
- **Refunds:** monthly non-refundable; annual prorated refund within 30 days of
  purchase.
- **Data:** GDPR Art. 9 **health data** collected via fitness-intake
  conversations (weight, injury history, medical/training context — explicit
  consent at intake). Subprocessors: **Anthropic** (AI), **Clerk** (auth),
  **Stripe** (billing), **Neon** (database), **Resend** (transactional email),
  **PostHog** (analytics), **Vercel** (hosting), **Inngest** (background jobs).
- **Launch geography:** **US first, EU close behind** — EU VAT registrations
  planned at launch.
- **Operator:** the owner is currently an **individual** — no entity formed yet.

## 3. Review asks

1. **Terms of Service** (`docs/legal/terms-of-service.md`) — full review.
   Confirm the draft correctly covers the billing terms in §2 above (tiers,
   trial-with-card, silent trial conversion, click-to-cancel, refund policy,
   30-day deletion). Note: **Stripe Checkout will collect explicit ToS consent
   on trial signups** (`consent_collection.terms_of_service`) referencing the
   published URL — so the published text is the text the customer legally
   accepts at checkout.
2. **Privacy Policy** (`docs/legal/privacy-policy.md`) — full review for
   **GDPR + CCPA**. In particular: the **Art. 9 health-data basis** (explicit
   consent at intake, Art. 9(2)(a)); retention specifics (**30-day account
   soft-delete window**, **indefinite intake-transcript retention** while the
   account is active, **30-day goal-draft TTL**); and the mapping of user
   rights to product features (**JSON data export**, **in-app account
   deletion**).
3. **Entity & jurisdiction.** The owner operates as an **individual** today —
   please advise on **entity formation** (e.g., LLC) before charging customers,
   plus **governing law** and **business address**. Your answers resolve the
   remaining open placeholders in both drafts (see the table in §4).
4. **Trademark clearance ("Strix").** An internal knockout screen (findings +
   method caveat in §6) found **no fitness/health "Strix"** but a **crowded
   software field**. Please pull **live USPTO TSDR + EUIPO** records for the
   marks listed and run a **likelihood-of-confusion / dilution** analysis for
   "Strix" (as used with domain **joinstrix.com**) in **Nice classes 9 / 41 /
   42 / 44**, **US + EU**.
5. **Tax presentation.** Our recommendation is in §5 — please **validate EU
   consumer price-display compliance and US practice** before Stripe prices are
   created. The choice changes both the **Stripe Price configuration** and the
   **ToS pricing language** (§5.1 "tax presentation" placeholder), so it must
   land before the drafts are finalized.

## 4. Placeholder status

The drafts carry deliberate placeholders. This package resolves one and hands
the rest to counsel.

| Placeholder | Status | Owner |
|---|---|---|
| Production domain | **RESOLVED → `joinstrix.com`** (this package) | — |
| Entity name | **OPEN** | counsel (ask 3) |
| Governing law / venue | **OPEN** | counsel (ask 3) |
| Business / contact address | **OPEN** | counsel (ask 3) |
| Tax presentation | **RECOMMENDED tax-inclusive**, pending validation | counsel (ask 5) |

> Contact email, effective date, EU/UK Art. 27 representative, and analytics
> retention period are owner/operational fills set at publication, not counsel
> questions — noted here only so the drafts read complete.

## 5. Tax-presentation recommendation (inclusive) + rationale

**Recommendation: tax-inclusive display** — the advertised price is the charged
price in **every** jurisdiction.

- **Fits the product's register.** Strix sells no-surprise billing (card
  charged = the price you saw). A tax-inclusive price keeps that promise at
  checkout in every market.
- **One global price stays EU-compliant.** EU B2C rules require VAT-inclusive
  advertised prices; a single inclusive price is compliant everywhere **without
  geo-differentiated marketing**.
- **Operationally simplest** for a solo operator — one price string per plan, no
  per-region display variants.
- **Cost:** the merchant **absorbs VAT/sales tax** in taxed jurisdictions
  (~**17–27%** of EU revenue at EU VAT rates).

**Alternative considered — tax-exclusive** (US norm; preserves margin because
tax is added on top at checkout). **Rejected pending counsel view:** it still
requires VAT-inclusive display variants for EU marketing, so it reintroduces the
geo-differentiated-display complexity that inclusive avoids — for a solo
operator that trade-off does not pay for itself. We ask counsel to confirm
before we commit the Stripe Price configuration.

## 6. Trademark knockout findings (internal, indicative)

> **Method caveat.** The official registers (USPTO `tmsearch`, EUIPO
> `eSearch`, WIPO) **blocked automated access**. These findings are drawn from
> third-party indexes (Justia, Trademarkia, TrademarkElite) plus app-store and
> live-site checks. They are **indicative, not authoritative** — hence ask 4
> (a live TSDR/EUIPO pull by counsel).

**No kill.** No **Strix**-branded fitness / health / wellness / goal-planning
app or registration was found anywhere. **No live Strix in Class 44** at all;
**none in Class 41** for fitness/coaching.

**Cautions (for counsel's confusion/dilution analysis):**

- **(a) STRIX, LLC** (Bozeman, MT) — **US Reg. 5,101,574**, **Class 42** SaaS
  (customs/freight), **LIVE**, registered & renewed. **Identical mark, same
  class, different field.**
  <https://trademarks.justia.com/867/64/strix-86764152.html>
- **(b) ROG STRIX** (ASUSTeK) — **US Reg. 6,016,069**, **Class 9**, **LIVE**,
  incontestable; gaming hardware + gaming-adapted OS software. **Famous-mark /
  dilution consideration.**
  <https://trademark.justia.com/877/10/rog-87710019.html>
- **(c) Strix** (Swedish TV production company) — **Class 41**, EU-relevant.
  <https://en.wikipedia.org/wiki/Strix_(TV_production_company)>
- **(d) Live software uses of the bare name:** "Strix" AI security agent
  (`app.usestrix.com`, `github.com/usestrix/strix`); "Strix" IPTV Android app
  (`play.google.com/store/apps/details?id=xyz.wambly.iptv`).
- **(e) Phonetic neighbors (avoided):** **STRYX** — live **Class 3** cosmetics,
  **EUTM 018532771** + US, `stryx.com`; **STRYXX** fitness-coaching app
  (`play.google.com/store/apps/details?id=com.stryxx.app`).

**Dead marks (no obstacle):** ASUS STRIX **US 4,742,083** (cancelled §8, 2021);
STRIX **Class 28 US 5,277,812** (cancelled §8, 2024).

**Mitigation already taken:** composite domain **joinstrix.com** rather than the
bare `strix.com` / `strix.app`; the "Stryx" / "usestrix" variants ruled out.

## 7. Publication plan (the end state counsel is reviewing toward)

- **ToS** → `https://joinstrix.com/terms`
- **Privacy** → `https://joinstrix.com/privacy`

Stable URLs, linked from **signup + settings**; the **ToS URL is wired into
Stripe Checkout consent collection**. Publication happens **only after counsel
sign-off** and after every remaining placeholder (§4) is resolved. Tracked as
issues **#8** (ToS) and **#9** (Privacy).
