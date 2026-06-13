/**
 * Embedded Clerk sign-up (ADR-0002 decision 4 / CS-6). The optional catch-all
 * segment [[...sign-up]] lets Clerk own every sub-step of the flow (email
 * verification, etc.) on this same in-app route, so sign-up stays on-origin —
 * no PWA standalone pop-out.
 *
 * The middleware and Clerk's redirects land here via
 * NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up (.env.example). src/proxy.ts already
 * public-lists /sign-up(.*) so the page renders before auth.
 *
 * Cosmetic appearance + localization are deferred to Phase 5 — keep this minimal.
 */
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return <SignUp />;
}
