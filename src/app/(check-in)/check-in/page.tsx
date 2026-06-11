/**
 * /check-in — the weekly check-in (phase-2-close-the-loop "Weekly check-in
 * UI"). Manually accessible any time; the Friday dashboard prompt is a later
 * slice.
 *
 * Routing note: the phase doc names this `app/(check-in)/page.tsx`, but a
 * page at a route group's root resolves to `/` — colliding with the public
 * landing (the same Next 16 collision the dashboard and equipment slices
 * resolved). The contract-faithful resolution is
 * `app/(check-in)/check-in/page.tsx` serving /check-in; the phase doc is
 * amended in the same commit, not silently divergent.
 *
 * Server component: Clerk auth (middleware protects the route — defense in
 * depth), scopedDb reads only, force-dynamic. The week and the usage month
 * are judged on the USER's calendar (users.timezone, UTC fallback) — a
 * Friday-night check-in east of UTC must not land on next week because the
 * server runs in UTC. Display + interaction live in the CheckInForm client
 * view, fed by the pure model the playground harness also uses; writes are
 * the submit/skip server actions.
 */
import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import {
  goals,
  replan_proposals,
  usage_counters,
  weekly_check_ins,
} from "@/db/schema";
import { skipCheckIn, submitCheckIn } from "./actions";
import { CheckInForm } from "./check-in-form";
import { buildCheckInModel, monthStartFor, weekStartFor } from "./check-in-model";

// Authenticated, per-request data — never statically rendered.
export const dynamic = "force-dynamic";

export default async function CheckInPage() {
  const { userId, redirectToSignIn } = await auth();
  // Defense in depth: middleware already protects this route, but never trust
  // an unauthenticated request to reach the scoped client.
  if (!userId) {
    return redirectToSignIn();
  }

  const sdb = scopedDb(userId);
  const [self, activeGoals] = await Promise.all([
    sdb.getSelf(),
    sdb.selectFrom(goals, { where: eq(goals.status, "active") }),
  ]);

  const weekStart = weekStartFor(self?.timezone);
  const monthStart = monthStartFor(self?.timezone);

  const [checkInRows, counterRows] = await Promise.all([
    // This week's row (unique on user + week_start_date — at most one).
    sdb.selectFrom(weekly_check_ins, {
      where: eq(weekly_check_ins.week_start_date, weekStart),
    }),
    // Current month's usage row; absent means zero replans used.
    sdb.selectFrom(usage_counters, {
      where: eq(usage_counters.period_start, monthStart),
    }),
  ]);
  const existing = checkInRows[0] ?? null;

  // Proposals already linked to THIS week's check-in — those goals render
  // checked + disabled and cost nothing against the cap.
  const proposalRows = existing
    ? await sdb.selectFrom(replan_proposals, {
        where: eq(replan_proposals.weekly_check_in_id, existing.id),
      })
    : [];

  const model = buildCheckInModel({
    goals: activeGoals,
    existing,
    alreadyProposedGoalIds: proposalRows.map((p) => p.goal_id),
    tier: self?.tier ?? "free",
    replansUsed: counterRows[0]?.replans_used ?? 0,
  });

  return (
    <CheckInForm model={model} onSubmit={submitCheckIn} onSkip={skipCheckIn} />
  );
}
