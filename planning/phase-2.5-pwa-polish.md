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
  - `theme_color` and `background_color` from the DAWN palette (V1 Dusk tokens in src/app/globals.css — background oklch(0.18 0.035 264) family; see docs/DESIGN.md §2).
  - Icons: 192, 512, maskable variants. Real icons; no placeholders into this phase's verification.
  - `orientation: "portrait"`.
- `<link rel="manifest">` in the root layout. iOS-specific tags: `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style="black-translucent"`, `apple-touch-icon` for each size.

### Service worker

- Use Workbox via `@serwist/next` (or `next-pwa` if simpler) — pick whichever is currently best-supported with Next.js 15 App Router at build time. (Chosen: `@serwist/next` in **configurator mode** — the repo is Next 16, which builds with Turbopack, and the classic webpack-plugin mode does not support Turbopack. `serwist build serwist.config.mjs` compiles `src/app/sw.ts` → `public/sw.js` after `next build`; registration via `<SerwistProvider>` in the root layout.)
- Strategy:
  - **App shell** (JS/CSS chunks, fonts): `CacheFirst`.
  - **Dashboard route HTML**: `StaleWhileRevalidate` so the user sees yesterday's dashboard instantly offline, then fresh data lands when online. (Implemented for the route HTML AND its RSC payloads — same pathname — in the named `strix-dashboard-<build>` cache. S6 amendment: "fresh data lands when online" happens via SWR revalidation on the next navigation, NOT a forced reload — `<SerwistProvider reloadOnOnline={false}>`, because the provider's default `location.reload()` on reconnect would discard in-memory state such as a mid-conversation AI intake on `/goals/new`.)
  - **API routes**: `NetworkOnly`. No offline mutations in MVP — show a clear "offline" state on the check-off action; queue is v2 territory.
  - **AI endpoints**: `NetworkOnly` and excluded from any cache. AI responses must never be replayed.
- Versioning: cache name includes a build hash so old caches are evicted on deploy. (Implemented: `strix-shell-<BUILD_ID>` / `strix-dashboard-<BUILD_ID>` from `.next/BUILD_ID`; an activate-time hook in `sw.ts` deletes `strix-*` caches from other builds.)
- **Cached dashboard JSON carve-out**: "last-loaded JSON for today's tasks" (offline shell below) is authenticated user data, so it cannot ride the `NetworkOnly` API rule — name its storage mechanism explicitly (a dedicated SW data cache via `cache.put`, or IndexedDB) so the purge below can target it. Do not let it land in localStorage implicitly. (Satisfied by the `strix-dashboard-<build>` cache above: the server-rendered HTML/RSC payloads ARE the last-loaded dashboard data — no separate JSON/IndexedDB store exists; the purge enumerates `caches.keys()` and hits it by name.)
- **Session-end purge (shared-device safety)**: on sign-out — and on session expiry / remote revocation when detected — clear **all SW caches and the client-side dashboard data store** before the redirect completes (`await caches.keys() → caches.delete(...)`; a navigation mid-purge can cut it short). The next user on a shared device must not see the previous user's dashboard offline. Account deletion (Phase 4) routes through this same purge. Full-clear also evicts the user-agnostic app shell — accepted for MVP (one static re-download) over per-user cache partitioning. (Release-coupled: S4 shipped the `strix-dashboard-<build>` cache, S7 ships this purge — S4 must not reach production users without S7; see PR #61 "Release coupling".) (Shipped in S7 — release coupling CLOSED: `purgeClientCaches()` in `src/lib/sw/purge.ts` full-clears `caches.keys()`; the /settings sign-out button awaits the purge to settlement BEFORE `signOut({ redirectUrl })` performs the only navigation; expiry/remote-revocation is covered best-effort by a settings-mounted watcher on the `isSignedIn` true→false flip — app-wide mounting in the root layout is a one-line follow-up after S6 merges.)

### iOS standalone polish

(Shipped across S1 + S9. S1 laid the base: the root `viewport` opts into
`viewportFit:"cover"` and `metadata.appleWebApp` carries
`statusBarStyle:"black-translucent"` + the apple-touch icons. S9 added the
safe-area / overscroll / splash / tap-target layer on top. VERIFICATION LIMIT:
`env(safe-area-inset-*)` is 0 in every non-notched browser — including the
verify:ui headless Chromium — so the automated suite proves the CSS is APPLIED
and computes to its correct off-device baseline (a no-op that shifts no layout),
but TRUE notch / dynamic-island / home-indicator behaviour is only verifiable on
a real device — that is the §"Lighthouse / install audit" device matrix, S11,
user-owned.)

- Status bar styling: `black-translucent` with safe-area-aware padding-top on the header. (S1 set `black-translucent`. S9: `src/components/horizon-header.tsx` gives the emblem `top:max(1rem, env(safe-area-inset-top))` and grows the reserved height by the same inset, so the brand scene still paints under the clock while the emblem/greeting clear it. `max()` = exactly the prior 1rem off-device → no baseline shift.)
- Safe-area inset CSS (`env(safe-area-inset-*)`) on the root layout and any fixed elements (bottom nav, modals). (S9: `.pt-safe/.pb-safe/.pl-safe/.pr-safe` utilities in `globals.css`; the root layout body wrapper carries all four (app-wide top/bottom/side reserve); the replan sticky commit bar carries `.pb-safe-plus-3` (`calc(0.75rem + env(...))`, additive over its prior `py-3`). No bottom nav/modals are fixed-positioned in the MVP surface.)
- No-bounce overscroll on body via `overscroll-behavior: contain`. (S9: on `body` in `globals.css`; `contain` not `none` so in-page scrollers still work. Verified `contain` on both axes in `e2e/ios-safe-area.spec.ts`.)
- Touch callout disabled on non-interactive elements. (S9: `-webkit-touch-callout:none` on `body` in `globals.css`, surgically RE-enabled on `input/textarea/select/a[href]` + an opt-in `[data-touch-callout="true"]` hook — never a blanket selection kill.)
- Splash screen images for iPhone sizes (8/X/12/14/15 — pragmatic set, not exhaustive). (S9: 9 real PNGs in `public/splash/` — the V6a brand mark on the flat dusk ground, one per device at its physical resolution — generated by `scripts/generate-splash.mts` from the V6a icon geometry. The device table lives in `src/lib/ios-splash.ts`, the SINGLE source the layout's `appleWebApp.startupImage` <link> media queries and the generator both read, so a query can never disagree with the file it selects. Pinned by `src/lib/ios-splash.test.ts` + `e2e/ios-safe-area.spec.ts`.)
- Tap targets ≥ 44pt. (S9 audit of owned surfaces: `replan-diff-view.tsx` controls are all `h-11 min-h-11` (44px); `horizon-header.tsx` has no interactive controls. No sub-44 targets in owned files.)
- Dynamic island handled by safe-area insets (no special-case work). (S9: covered by the same `.pt-safe` body reserve + the header inset — the dynamic island shares `safe-area-inset-top`.)

### Install affordance

- After the user has at least one active goal **and** has been authenticated for 3+ sessions, surface a small dismissible "Add to home screen" banner. iOS-specific instructions when `navigator.standalone === false`; Chrome shows the native `beforeinstallprompt` flow.
- Dismissal persists in localStorage. Never nag.

> **Shipped in S8** (`src/components/install-banner.tsx` + `src/lib/use-local-storage.ts` + `src/lib/install-platform.ts`). Eligibility is two-gated: the server-known half (≥1 active goal) flows from the dashboard page → `ActiveDashboard` as a prop (a Next layout→page data-flow forbids passing the count UP to the route-group layout, so the smallest-correct mount is the page that already computes it), and the client half (authenticated session count ≥3) is read per-user from localStorage. **Session counter:** a durable `strix.install.sessions.<userId>` count incremented AT MOST ONCE per browser session via a `strix.install.counted.<userId>` sessionStorage flag, keyed per Clerk user id so a shared device never bleeds counts between users. **Platform branch:** already-standalone (`navigator.standalone` OR `display-mode: standalone`) renders nothing; iOS Safari (no `beforeinstallprompt`) shows calm "Add to Home Screen" instructions; Chrome/Android captures `beforeinstallprompt` (preventDefault + stash) behind an Install button calling `prompt()`, hidden after the choice. **Dismissal** persists in `strix.install.dismissed.<userId>` and never reappears; on dismiss the banner `<section>` unmounts, so focus is moved DELIBERATELY to the hero countdown region (`#install-dismiss-focus-target`, `tabIndex=-1`) rather than dropping to `<body>` (a WCAG 2.4.3 focus-order failure — the S3 regression class), and a body-level polite live region announces "Install prompt dismissed" for screen-reader users. **localStorage invariant (binding):** S4/S7 documented "Strix keeps nothing in localStorage" — S8 makes that false, so every key is user-scoped AND the session-end purge (`src/lib/sw/purge.ts`) was extended to sweep all `strix.install.*` keys on sign-out / expiry, preserving the shared-device clean-slate (unit-tested in `purge.test.ts`). Harness: `/playground/install-banner` renders the isolated reachable states (ios / chrome / dismissed) for axe + screenshot coverage; `/playground/active-dashboard?state=install-chrome|install-ios` mounts the eligible banner IN CONTEXT (between the check-in prompt and the hero countdown) by bypassing the Clerk/localStorage gates for the harness only (`installBannerPreview`, never wired in production), so the in-place placement and the dismiss-focus behavior are reviewable + `verify:ui`-pinned.

### Offline dashboard shell

- Service worker pre-caches `/dashboard` shell and last-loaded JSON for today's tasks. (Shipped across S4+S6: the `strix-dashboard-<build>` StaleWhileRevalidate cache IS the shell-plus-data store — see "Service worker" above. S6's actual *pre*cache is targeted at exactly one URL, the `/~offline` fallback screen, revisioned by the build ID via `additionalPrecacheEntries`; the full static manifest stays off so precache can never shadow the versioned runtime caches.)
- When offline: dashboard renders with cached data + a subtle "Offline" indicator. Check-off button visibly disabled with tooltip "Reconnects when you're online." (Implemented in S6: an SSR-safe `useOnline` hook — `navigator.onLine` + the window online/offline events — drives a quiet `role="status"` line under the header and an `aria-disabled`, dimmed check-off carrying that exact tooltip. No queued mutations; check-off simply isn't offered offline.)
- All other routes (goal detail, new goal, equipment, settings) show a polite offline screen — no crash, no half-broken UI. (Implemented in S6 via Serwist `fallbacks` plus a last-position NetworkOnly document rule in the runtime table — Serwist only attaches its fallback plugin to runtime strategies, so unmatched documents needed a rule to fail through. Any same-origin document request that fails offline gets the precached `/~offline`, including `/dashboard` itself when its cache is empty (the signed-out / post-purge device). The route is Clerk-public so the precache install fetch never receives an auth redirect. Pinned by `e2e/offline.spec.ts`.)

### Lighthouse / install audit

- Run Lighthouse PWA audit. Target: PWA score ≥ 90, no failing audits.
- **Device matrix** for real-device manual install (sign-off owner: project lead, recorded in the launch checklist):
  - **iPhone 15 Pro** (iOS 17+) — install via Safari, open from home screen, navigate, kill app, reopen. No browser chrome appears.
  - **iPhone SE 3rd gen** (iOS 17+) — same checks; safe-area edge cases differ from notch devices.
  - **Pixel 8** (Android 14+, Chrome stable) — install via prompt, open from app drawer, navigate, kill app, reopen.
  - **Samsung Galaxy S22** (Android 14+, Chrome stable) — same checks; touch-target sizing differs.
  - One older device of each OS family if available (iPhone XS / Pixel 5) — soft-target, not a gate.

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

**Formal gate to Phase 3 — all five must pass; no exceptions:**

1. **Zero browser-chrome elements** visible after install on iPhone 15 Pro + Pixel 8. No URL bar, no Safari/Chrome top bar, no back-button chrome. Verified by screenshot in standalone mode.
2. **Cold launch < 2.0s** from home-screen tap to dashboard first paint on the iPhone 15 Pro reference device (median of 5 trials, app force-quit between trials).
3. **No URL-bar reveal during scroll** on either reference device. Scroll the dashboard top-to-bottom and bottom-to-top; the URL bar must not appear at any point.
4. **Lighthouse PWA score ≥ 90** on the deployed preview, with zero failing audits.
5. **Manifest validates** against the W3C manifest spec (`web-app-manifest` validator).

**End-to-end (real devices, not simulator):**

6. Install on iPhone via Safari → "Add to Home Screen" → app opens in standalone mode, no browser chrome, status bar styled, safe area respected at top and bottom.
7. From the installed app, navigate dashboard → goal detail → back. No browser back button visible; no URL bar.
8. Force-quit the app, reopen → resumes at the dashboard (not on the sign-in page) for an authenticated session.
9. Toggle airplane mode → dashboard renders from cache with "Offline" indicator; check-off button disabled with tooltip; no crash.
9.5. Sign out, then toggle airplane mode and reopen the app → no prior user's dashboard data renders (caches and the dashboard data store are empty); the offline screen or sign-in shell shows instead.
10. Repeat 6–9.5 on Pixel 8 / Galaxy S22 Chrome.

**Soft signal (not a formal gate):**

11. The §9 #6 acceptance check: hand the installed app to someone who hasn't seen the project. Ask them if it's a website or an app. If they hesitate, the brand register has leaked — investigate, but do not block the phase boundary on a single subjective response.

Automated:

- Build emits a valid manifest (validated against the W3C manifest spec).
- Service worker registers cleanly in dev and prod builds. (Dev: `pnpm dev` one-shot-builds the worker before `next dev`, registration stays enabled — no dev-disable. Prod: pinned by e2e/service-worker.spec.ts against the verify:ui prod server.)
- Playwright headless run of the dashboard offline (mocked offline) renders the shell without errors. (e2e/offline.spec.ts, in `verify:ui`: the offline dashboard renders from the SWR cache hydrated with zero page errors, indicator visible, check-off disabled with the tooltip; uncached routes and the empty-cache `/dashboard` get the precached `/~offline`.)
