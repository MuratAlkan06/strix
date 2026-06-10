/**
 * /dashboard — the authenticated landing (phase-1-golden-path "Empty-state
 * dashboard").
 *
 * Routing note (collision resolution): the phase doc names this
 * `app/(dashboard)/page.tsx`, but a page in the `(dashboard)` group at the root
 * resolves to `/` — the same URL as the existing public landing
 * `src/app/page.tsx`. Two routes resolving to one path is a Next 16 build error.
 * Resolution (smallest, contract-faithful): the dashboard lives at `/dashboard`,
 * and the public root page redirects SIGNED-IN users here (the contract's NOTE
 * sanctions "signed-in users reach the dashboard via redirect from the root
 * page"). The public landing, sign-in/up, and /playground are untouched;
 * /dashboard is already a protected route under the existing proxy.ts matcher.
 *
 * Branch (phase doc): count(goals where status='active'). Zero → empty state.
 * ≥1 → a minimal honest placeholder (Slice 10 builds the real active dashboard).
 */
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goals } from "@/db/schema";
import { EmptyDashboard } from "@/components/empty-dashboard";

// Authenticated: render per-request (reads the user's session + their goals),
// never statically. Matches the (settings) shell posture.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { userId, redirectToSignIn } = await auth();
  // Defense in depth: middleware already protects this route, but never trust
  // an unauthenticated request to reach the scoped client — it requires a userId.
  if (!userId) {
    return redirectToSignIn();
  }

  const activeGoalCount = await scopedDb(userId).count(goals, {
    where: eq(goals.status, "active"),
  });

  if (activeGoalCount === 0) {
    return <EmptyDashboard />;
  }

  // Active state — honest placeholder. Slice 10 builds the real Today / This
  // week / Upcoming composition. No fake data.
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-2 p-6">
      <h1 className="font-heading text-2xl font-medium text-foreground">
        Your day
      </h1>
      <p className="text-sm text-muted-foreground">
        {activeGoalCount === 1
          ? "You have one goal in progress."
          : `You have ${activeGoalCount} goals in progress.`}{" "}
        The daily dashboard is coming soon.
      </p>
    </main>
  );
}
