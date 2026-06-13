import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isGoalSeed } from "@/lib/goal-seeds";

const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Webhooks verify their own signatures; Clerk auth must not block them.
  "/api/webhooks/(.*)",
  // Inngest's signed handshake also needs to bypass Clerk auth — the SDK
  // verifies INNGEST_SIGNING_KEY itself.
  "/api/inngest",
  // Throwaway DAWN design-curation route — must be reachable without auth so it
  // can be captured/reviewed. Removed when the playground is torn down post-mint.
  "/playground(.*)",
  // The offline fallback screen (phase 2.5 S6) — static, no user data. The
  // service worker precaches it at install time; that fetch must receive the
  // page itself, never an auth redirect (a redirect would poison the precache
  // and break every offline fallback).
  "/~offline",
]);

// /goals/new and its draft-bootstrap Route Handler both accept ?seed= — the
// whitelist gate must cover both entrances.
const isIntakeRoute = createRouteMatcher(["/goals/new", "/goals/new/bootstrap"]);

export default clerkMiddleware(async (auth, req) => {
  // Seed whitelist enforced at the edge, BEFORE auth: a non-empty,
  // non-whitelisted ?seed= on /goals/new is rejected with 400 regardless of
  // auth state, so a prompt-injection payload never matters (App Router pages
  // can't set a 400 status on render). The same predicate lives in
  // goal-seeds.ts; the page re-derives the validated seed for the draft from
  // this trusted set.
  if (isIntakeRoute(req)) {
    const seed = req.nextUrl.searchParams.get("seed");
    if (seed !== null && seed !== "" && !isGoalSeed(seed)) {
      return new NextResponse("Invalid seed.", { status: 400 });
    }
  }
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params.
    // Also skip /playground and /~offline: both are auth-exempt by design and
    // hold no user data, so clerkMiddleware has nothing to do on them. Keeping
    // the middleware off them means neither ever emits the `dev-browser-missing`
    // directive that makes clerk-js run its dev-browser handshake by navigating
    // the main frame to the Clerk Frontend API host — a host the `verify:ui`
    // harness points at a deliberately unreachable dummy (pk_test_…example.com).
    // That handshake redirect resolves locally but hard-fails as
    // net::ERR_NAME_NOT_RESOLVED on the GitHub runner; excluding /~offline here
    // (the precached offline fallback — a static screen with zero Clerk UI) is
    // what makes its online render deterministic on CI, the same reason
    // /playground is excluded. Real product routes are unaffected.
    "/((?!_next|playground|~offline|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk's auto-proxy path (required for Clerk's frontend
    // API to be reachable through this app's own domain).
    "/__clerk/(.*)",
  ],
};
