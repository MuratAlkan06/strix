import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

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
]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
    // Always run for Clerk's auto-proxy path (required for Clerk's frontend
    // API to be reachable through this app's own domain).
    "/__clerk/(.*)",
  ],
};
