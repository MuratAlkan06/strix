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
 * Centering (CS-9): the Clerk card is dropped into a flex container that fills
 * the viewport and centers on both axes — the same pattern /~offline uses. We
 * pin the height with `min-h-dvh` rather than relying on `min-h-full`: the root
 * layout's body is `min-h-full`, which resolves against <html>'s height, and in
 * this auth segment that chain collapses to 0 (nothing forces <html> to a
 * height here), leaving the card pinned top-left with large gutters. `min-h-dvh`
 * sizes against the dynamic viewport directly, so the card centers regardless of
 * the ancestor height chain. The Clerk widget itself is intentionally the
 * default theme — cosmetic appearance + localization are deferred to Phase 5.
 */
import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex min-h-dvh w-full flex-1 items-center justify-center p-4">
      <SignIn />
    </div>
  );
}
