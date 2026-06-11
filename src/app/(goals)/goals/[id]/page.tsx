/**
 * /goals/[id] — the goal-detail page (phase-1-golden-path "Goal detail",
 * route file app/(goals)/goals/[id]/page.tsx under the established /goals
 * nesting; the phase doc's "app/(goals)/[id]/page.tsx" is reported for
 * amendment).
 *
 * Server component: Clerk auth (middleware already protects the route —
 * defense in depth), scopedDb reads only, force-dynamic. A malformed,
 * unknown, or FOREIGN goal id all resolve to the same notFound() — scopedDb's
 * ownership filter returns zero rows for another user's goal, so existence is
 * never leaked.
 *
 * All display/edit logic lives in the pure detail-model + the GoalDetail
 * client surface; the real server actions are passed as props (the
 * playground harness passes deterministic no-ops to the same component).
 */
import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import {
  equipment,
  goals,
  intake_summaries,
  milestones,
  recurring_tasks,
} from "@/db/schema";
import {
  buildGoalDetailModel,
  isUuid,
  resolveGoalRow,
  type GoalDetailActions,
} from "./detail-model";
import { GoalDetail } from "./goal-detail";
import {
  addEquipment,
  addMilestone,
  addTask,
  completeGoal,
  moveMilestone,
  removeEquipment,
  removeMilestone,
  removeTask,
  setGoalIntensity,
  updateEquipment,
  updateMilestone,
  updateTask,
} from "./actions";

// Authenticated, per-request data — never statically rendered.
export const dynamic = "force-dynamic";

const ACTIONS: GoalDetailActions = {
  setIntensity: setGoalIntensity,
  completeGoal,
  addTask,
  updateTask,
  removeTask,
  addMilestone,
  updateMilestone,
  removeMilestone,
  moveMilestone,
  addEquipment,
  updateEquipment,
  removeEquipment,
};

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function GoalDetailPage({ params }: PageProps) {
  const { id } = await params;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  // Malformed ids 404 before any DB access (and never reach a uuid cast).
  if (!isUuid(id)) notFound();

  const sdb = scopedDb(userId);
  const goalRows = await sdb.selectFrom(goals, { where: eq(goals.id, id) });
  const goal = resolveGoalRow(id, goalRows);
  // Unknown and foreign ids are indistinguishable here: the scope filter
  // returned zero rows either way.
  if (!goal) notFound();

  const [summaries, tasks, milestoneRows, equipmentRows, self] =
    await Promise.all([
      sdb.selectFrom(intake_summaries, {
        where: eq(intake_summaries.goal_id, id),
      }),
      // Only active tasks: removed tasks are deactivated, not deleted, and
      // never render here.
      sdb.selectFrom(recurring_tasks, {
        where: and(
          eq(recurring_tasks.goal_id, id),
          eq(recurring_tasks.active, true),
        ),
      }),
      sdb.selectFrom(milestones, { where: eq(milestones.goal_id, id) }),
      sdb.selectFrom(equipment, { where: eq(equipment.goal_id, id) }),
      sdb.getSelf(),
    ]);

  const model = buildGoalDetailModel({
    goal,
    intakeConfirmed: summaries[0]?.confirmed_intensity ?? null,
    accountPreference: self?.intensity_preference ?? null,
    activityType: summaries[0]?.activity_type ?? null,
    tasks,
    milestones: milestoneRows,
    equipment: equipmentRows,
  });

  return (
    <GoalDetail
      model={model}
      actions={ACTIONS}
      replanFlag={process.env.NEXT_PUBLIC_REPLAN_ENABLED}
    />
  );
}
