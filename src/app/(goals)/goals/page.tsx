/**
 * /goals — the goals list (phase-1-golden-path "Goals list", route
 * app/(goals)/goals/page.tsx). The save-goal action's post-save redirect
 * target now resolves here.
 *
 * Server component: Clerk auth (middleware already protects the route —
 * defense in depth), scopedDb reads only, force-dynamic. All display logic
 * lives in the pure list-model + the GoalsList view, which the playground
 * harness reuses deterministically.
 */
import { auth } from "@clerk/nextjs/server";
import { inArray } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goals, milestones } from "@/db/schema";
import { buildGoalsListModel, type MilestoneRowLike } from "./list-model";
import { GoalsList } from "./goals-list";

// Authenticated, per-request data — never statically rendered.
export const dynamic = "force-dynamic";

export default async function GoalsPage() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  const sdb = scopedDb(userId);
  const [self, goalRows] = await Promise.all([
    sdb.getSelf(),
    sdb.selectFrom(goals),
  ]);

  // Milestones are only needed for active goals (progress + next milestone).
  const activeIds = goalRows
    .filter((g) => g.status === "active")
    .map((g) => g.id);
  const milestoneRows: MilestoneRowLike[] =
    activeIds.length > 0
      ? await sdb.selectFrom(milestones, {
          where: inArray(milestones.goal_id, activeIds),
        })
      : [];

  // Tier gates the "Add new goal" tile (Free = 3, Pro/Max = 5). A missing self
  // (soft-deleted mid-request) falls back to the strictest cap.
  return (
    <GoalsList
      model={buildGoalsListModel(goalRows, milestoneRows, self?.tier ?? "free")}
    />
  );
}
