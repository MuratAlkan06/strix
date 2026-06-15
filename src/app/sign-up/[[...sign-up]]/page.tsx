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
 * Centering (CS-9): same pattern as the sign-in route — a flex container that
 * fills the viewport via `min-h-dvh` and centers the Clerk card on both axes.
 * `min-h-dvh` (not `min-h-full`) because the root body's `min-h-full` resolves
 * against an <html> whose height chain collapses to 0 in this auth segment,
 * which otherwise pins the card top-left. The Clerk widget stays the default
 * theme — cosmetic appearance + localization are deferred to Phase 5.
 */
import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh w-full flex-1 items-center justify-center p-4">
      <SignUp />
    </div>
  );
}
