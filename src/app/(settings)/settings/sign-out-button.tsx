"use client";

/**
 * SignOutButton — the app's first sign-out affordance (phase 2.5, S7), with
 * the shared-device cache purge sequenced BEFORE the redirect.
 *
 * ORDERING GUARANTEE (planning doc: "a navigation mid-purge can cut it
 * short"): the handler awaits purgeClientCaches() to full settlement, and
 * only then calls Clerk's signOut({ redirectUrl: "/" }) — the Clerk custom
 * sign-out flow. No router.push / window.location / <Link> is involved
 * anywhere in this flow, so the ONLY navigation is the one signOut itself
 * performs after the purge promise has settled. Nothing can interrupt the
 * purge.
 *
 * Purge failure is non-blocking: auth wins. A device that could not clear
 * its caches must still terminate the session (the warn leaves a trace; the
 * SW's status-200-only admission means nothing new lands post-sign-out).
 *
 * DESIGN.md register: calm destructive-adjacent (the muted ember-red
 * `destructive` variant, not a red screen), icon-paired per §8 ("destructive
 * always pairs an icon"), ≥44px target per §11 (h-11 = 44px; the shared
 * primitive's default h-8 is below the product floor), focus ring from the
 * shared primitive (focus-visible ring, brand-tied).
 */
import { useState } from "react";
import { useClerk } from "@clerk/nextjs";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { purgeClientCaches } from "@/lib/sw/purge";

export function SignOutButton() {
  const { signOut } = useClerk();
  const [pending, setPending] = useState(false);

  const handleSignOut = async () => {
    setPending(true);
    try {
      // Step 1 — purge, awaited to completion. Failure is caught HERE so the
      // sign-out below runs regardless (auth wins over cleanup).
      try {
        await purgeClientCaches();
      } catch (error: unknown) {
        console.warn(
          "[strix] cache purge failed during sign-out; signing out anyway",
          error,
        );
      }
      // Step 2 — only now may a navigation begin: signOut ends the session,
      // then redirects to the public landing page.
      await signOut({ redirectUrl: "/" });
    } catch (error: unknown) {
      // signOut itself failed (e.g. network down): re-enable the button so
      // the user can retry instead of being stuck on a dead control.
      console.error("[strix] sign-out failed", error);
      setPending(false);
    }
  };

  return (
    <Button
      variant="destructive"
      className="h-11 px-4"
      disabled={pending}
      onClick={handleSignOut}
    >
      <LogOut aria-hidden="true" />
      {pending ? "Signing out…" : "Sign out"}
    </Button>
  );
}
