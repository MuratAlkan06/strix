/**
 * /replan/[goalId] — the replan diff review page (phase-2-close-the-loop
 * "Replan diff UI", route per the phase doc:
 * app/(check-in)/replan/[goalId]/page.tsx).
 *
 * Server component: Clerk auth (middleware protects the route — defense in
 * depth), scopedDb reads only, force-dynamic. A malformed, unknown, or
 * FOREIGN goal id all resolve to the same notFound() — the goal-detail
 * posture; existence is never leaked.
 *
 * Loads the goal's most recent PENDING proposal (else the most recent
 * decided one for the read-only summary), plus the goal's current
 * recurring_tasks / milestones / equipment for the before/after rendering.
 * All display + interaction live in the ReplanDiffView client surface, fed
 * by the pure replan-model the playground harness also uses; the commit is
 * the decideReplan server action; Generate posts to /api/ai/replan from the
 * client.
 */
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import {
  equipment,
  goals,
  milestones,
  recurring_tasks,
  replan_proposals,
} from "@/db/schema";
import { ReplanDiffSchema } from "@/lib/ai/replan-diff";
import { decideReplan } from "./actions";
import { ReplanDiffView } from "./replan-diff-view";
import {
  buildReplanPageModel,
  selectDisplayProposal,
  UUID_RE,
} from "./replan-model";

// Authenticated, per-request data — never statically rendered.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ goalId: string }>;
}

export default async function ReplanPage({ params }: PageProps) {
  const { goalId } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  // Malformed ids 404 before any DB access (and never reach a uuid cast).
  if (!UUID_RE.test(goalId)) notFound();

  const sdb = scopedDb(userId);
  const goalRows = await sdb.selectFrom(goals, {
    where: eq(goals.id, goalId),
  });
  const goal = goalRows[0];
  // Unknown and foreign ids are indistinguishable here: the scope filter
  // returned zero rows either way.
  if (!goal) notFound();

  const [proposals, tasks, milestoneRows, equipmentRows] = await Promise.all([
    sdb.selectFrom(replan_proposals, {
      where: eq(replan_proposals.goal_id, goalId),
    }),
    // Inactive tasks included — a modify may reactivate a paused task, and
    // its before/after must render from the real row.
    sdb.selectFrom(recurring_tasks, {
      where: eq(recurring_tasks.goal_id, goalId),
    }),
    sdb.selectFrom(milestones, { where: eq(milestones.goal_id, goalId) }),
    sdb.selectFrom(equipment, { where: eq(equipment.goal_id, goalId) }),
  ]);

  const proposal = selectDisplayProposal(proposals);
  // A stored diff is model output — parse, never trust. Unparseable pending
  // diffs fall back to the Generate surface (regeneration overwrites them).
  const parsed = proposal
    ? ReplanDiffSchema.safeParse(proposal.proposed_changes)
    : null;

  const model = buildReplanPageModel({
    goal,
    proposal,
    diff: parsed?.success ? parsed.data : null,
    tasks,
    milestones: milestoneRows,
    equipment: equipmentRows,
  });

  return <ReplanDiffView model={model} onDecide={decideReplan} />;
}
