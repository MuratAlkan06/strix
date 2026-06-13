/**
 * Embedded Clerk sign-in (ADR-0002 decision 4 / CS-6). The optional catch-all
 * segment [[...sign-in]] lets Clerk own every sub-step of the flow (factor-two,
 * SSO callback, etc.) on this same in-app route, so email/password auth stays
 * on-origin — no PWA standalone pop-out.
 *
 * redirectToSignIn() and the middleware land here via
 * NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in (.env.example). src/proxy.ts already
 * public-lists /sign-in(.*) so the page renders before auth.
 *
 * Cosmetic appearance + localization are deferred to Phase 5 — keep this minimal.
 */
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return <SignIn />;
}
