/**
 * /equipment — the aggregated equipment view (phase-1-golden-path "Equipment
 * aggregated view").
 *
 * Routing note: the phase doc names this `app/(equipment)/page.tsx`, but a
 * page at a route group's root resolves to `/` — colliding with the public
 * landing (the same Next 16 collision the dashboard slice resolved, phase doc
 * line 21). The contract-faithful resolution is
 * `app/(equipment)/equipment/page.tsx` serving /equipment; reported as a
 * phase-doc amendment, not silently divergent.
 *
 * Server component: Clerk auth (middleware protects the route — defense in
 * depth), scopedDb reads only, force-dynamic. "Today" is the user's calendar
 * day (users.timezone, UTC fallback) — deadlines are date-only, so urgency
 * must be judged against the user's day, not the server's. Display + the
 * optimistic purchased toggle live in the EquipmentList client view, fed by
 * the pure model the playground harness also uses.
 */
import { auth } from "@clerk/nextjs/server";
import { eq, inArray } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { equipment, goals, milestones } from "@/db/schema";
import { todayInTimeZone } from "@/lib/equipment-urgency";
import { Card } from "@/components/ui/card";
import { buildEquipmentModel } from "./equipment-model";
import { EquipmentList } from "./equipment-list";
import { togglePurchased } from "./toggle-purchased";

// Authenticated, per-request data — never statically rendered.
export const dynamic = "force-dynamic";

export default async function EquipmentPage() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  const sdb = scopedDb(userId);
  const [self, activeGoals] = await Promise.all([
    sdb.getSelf(),
    sdb.selectFrom(goals, { where: eq(goals.status, "active") }),
  ]);

  const activeIds = activeGoals.map((g) => g.id);
  const [equipmentRows, milestoneRows] =
    activeIds.length > 0
      ? await Promise.all([
          sdb.selectFrom(equipment, {
            where: inArray(equipment.goal_id, activeIds),
          }),
          sdb.selectFrom(milestones, {
            where: inArray(milestones.goal_id, activeIds),
          }),
        ])
      : [[], []];

  const groups = buildEquipmentModel({
    equipment: equipmentRows,
    milestones: milestoneRows,
    goals: activeGoals,
    today: todayInTimeZone(self?.timezone),
  });

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Equipment
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything your active goals call for, ordered by when you need it.
        </p>
      </header>

      {groups.length === 0 ? (
        // Honest empty — no equipment across active goals.
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">
            Nothing to gear up for yet. When a plan calls for equipment, it
            shows up here.
          </p>
        </Card>
      ) : (
        <EquipmentList groups={groups} onToggle={togglePurchased} />
      )}
    </main>
  );
}
