# Phase 2.5 — PWA polish

**Goal:** §9 quality bar #6: "Install to home screen on iOS or Android and have it feel native enough to forget it's a webpage." This is the polish gate that prevents shipping a "kind of native" experience into commerce.

**Prerequisites:** Phase 2 complete. The full §9 product loop works on a browser.

**Gates:** **Strictly gates Phase 3.** Do not start commerce until install passes the "feels native enough to forget it's a webpage" bar on both iOS Safari and Android Chrome.

## Items to build

### Manifest

- `public/manifest.webmanifest` with:
  - `name: "Strix"`, `short_name: "Strix"`.
  - `display: "standalone"`.
  - `start_url: "/"` (or `"/dashboard"` after auth).
  - `theme_color` and `background_color` from the earth-tone palette.
  - Icons: 192, 512, maskable variants. Real icons; no placeholders into this phase's verification.
  - `orientation: "portrait"`.
- `<link rel="manifest">` in the root layout. iOS-specific tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style="black-translucent"`, `apple-touch-icon` for each size.

### Service worker

- Use Workbox via `@serwist/next` (or `next-pwa` if simpler) — pick whichever is currently best-supported with Next.js 15 App Router at build time.
- Strategy:
  - **App shell** (JS/CSS chunks, fonts): `CacheFirst`.
  - **Dashboard route HTML**: `StaleWhileRevalidate` so the user sees yesterday's dashboard instantly offline, then fresh data lands when online.
  - **API routes**: `NetworkOnly`. No offline mutations in MVP — show a clear "offline" state on the check-off action; queue is v2 territory.
  - **AI endpoints**: `NetworkOnly` and excluded from any cache. AI responses must never be replayed.
- Versioning: cache name includes a build hash so old caches are evicted on deploy.

### iOS standalone polish

- Status bar styling: `black-translucent` with safe-area-aware padding-top on the header.
- Safe-area inset CSS (`env(safe-area-inset-*)`) on the root layout and any fixed elements (bottom nav, modals).
- No-bounce overscroll on body via `overscroll-behavior: contain`.
- Touch callout disabled on non-interactive elements.
- Splash screen images for iPhone sizes (8/X/12/14/15 — pragmatic set, not exhaustive).
- Tap targets ≥ 44pt.
- Dynamic island handled by safe-area insets (no special-case work).

### Install affordance

- After the user has at least one active goal **and** has been authenticated for 3+ sessions, surface a small dismissible "Add to home screen" banner. iOS-specific instructions when `navigator.standalone === false`; Chrome shows the native `beforeinstallprompt` flow.
- Dismissal persists in localStorage. Never nag.

### Offline dashboard shell

- Service worker pre-caches `/dashboard` shell and last-loaded JSON for today's tasks.
- When offline: dashboard renders with cached data + a subtle "Offline" indicator. Check-off button visibly disabled with tooltip "Reconnects when you're online."
- All other routes (goal detail, new goal, equipment, settings) show a polite offline screen — no crash, no half-broken UI.

### Lighthouse / install audit

- Run Lighthouse PWA audit. Target: PWA score ≥ 90, no failing audits.
- Real-device manual install on:
  - iPhone (iOS Safari latest) — install, open from home screen, navigate, kill app, reopen. No browser chrome should appear.
  - Android (Chrome latest) — install via prompt, open from app drawer, navigate, kill app, reopen.

## Phase-specific context

### Why this phase is its own gate

§9 #6 ("forget it's a webpage") is a binary quality bar. Half-passing it means the user feels the browser through the experience — and once they notice, the brand register (serious, considered, Patagonia) collapses. Defer commerce so that the version users start paying for clears this bar.

### Workbox vs serwist vs next-pwa

Pick the one that's currently maintained against Next.js 15 App Router. As of early 2026, `@serwist/next` is the maintained successor to `next-pwa`. Verify at build time; switch if better tooling exists.

### Out of scope

- Push notifications (v2, requires service worker hooks but the UX is deferred per spec §11).
- Background sync for offline mutations (v2). MVP shows "offline" and disables.
- Native Expo build (v2 per spec §12).

## Verification

End-to-end (real devices, not simulator):

1. Install on iPhone via Safari → "Add to Home Screen" → app opens in standalone mode, no browser chrome, status bar styled, safe area respected at top and bottom.
2. From the installed app, navigate dashboard → goal detail → back. No browser back button visible; no URL bar.
3. Force-quit the app, reopen → resumes at the dashboard (not on the sign-in page) for an authenticated session.
4. Toggle airplane mode → dashboard renders from cache with "Offline" indicator; check-off button disabled with tooltip; no crash.
5. Repeat 1–4 on Android Chrome.
6. Lighthouse PWA audit on the deployed preview ≥ 90.
7. The §9 #6 acceptance check: hand the installed app to someone who hasn't seen the project. Ask them if it's a website or an app. If they hesitate, you haven't passed.

Automated:

- Build emits a valid manifest (validated against the W3C manifest spec).
- Service worker registers cleanly in dev and prod builds.
- Playwright headless run of the dashboard offline (mocked offline) renders the shell without errors.
