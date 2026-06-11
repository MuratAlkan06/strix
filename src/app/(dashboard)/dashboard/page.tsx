/**
 * /dashboard — the authenticated landing (phase-1-golden-path "Empty-state
 * dashboard" + "Dashboard (active state)").
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
 * ≥1 → the active dashboard: Today / This week / Upcoming, bucketed by the
 * pure dashboard-model on the USER's calendar day (users.timezone — a date
 * judged on the server's clock would shift every section overnight for any
 * user east of UTC). Reads are scopedDb only; the check-off write is the
 * completeTask server action (check-task.ts).
 */
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import {
  equipment,
  goals,
  milestones,
  recurring_tasks,
  task_completions,
} from "@/db/schema";
import { todayInTimeZone } from "@/lib/equipment-urgency";
import { EmptyDashboard } from "@/components/empty-dashboard";
import { ActiveDashboard } from "./active-dashboard";
import {
  buildDashboardModel,
  dashboardDateLabel,
  greetingForHour,
  hourInTimeZone,
  weekStartOf,
} from "./dashboard-model";
import { completeTask } from "./check-task";

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

  const sdb = scopedDb(userId);
  const [self, activeGoals] = await Promise.all([
    sdb.getSelf(),
    sdb.selectFrom(goals, { where: eq(goals.status, "active") }),
  ]);

  if (activeGoals.length === 0) {
    return <EmptyDashboard />;
  }

  const today = todayInTimeZone(self?.timezone);
  const weekStart = weekStartOf(today);
  const activeIds = activeGoals.map((g) => g.id);

  const [taskRows, milestoneRows, equipmentRows, completionRows] =
    await Promise.all([
      sdb.selectFrom(recurring_tasks, {
        where: and(
          inArray(recurring_tasks.goal_id, activeIds),
          eq(recurring_tasks.active, true),
        ),
      }),
      sdb.selectFrom(milestones, {
        where: inArray(milestones.goal_id, activeIds),
      }),
      sdb.selectFrom(equipment, {
        where: inArray(equipment.goal_id, activeIds),
      }),
      // Current week only (weekStart … today): today's rows drive the checked
      // state; earlier days defensively exclude an already-completed weekly.
      sdb.selectFrom(task_completions, {
        where: and(
          inArray(task_completions.goal_id, activeIds),
          gte(task_completions.for_date, weekStart),
          lte(task_completions.for_date, today),
        ),
      }),
    ]);

  const model = buildDashboardModel({
    goals: activeGoals,
    tasks: taskRows,
    milestones: milestoneRows,
    equipment: equipmentRows,
    completions: completionRows,
    today,
  });

  return (
    <ActiveDashboard
      greeting={greetingForHour(
        hourInTimeZone(self?.timezone),
        self?.display_name,
      )}
      dateLabel={dashboardDateLabel(today)}
      today={today}
      model={model}
      onComplete={completeTask}
    />
  );
}
