/**
 * equipment-model.ts — the pure view-model behind the aggregated equipment
 * view (phase-1-golden-path "Equipment aggregated view"). No DB, no React:
 * the /equipment page feeds it scopedDb rows; /playground/equipment feeds it
 * fixtures with a pinned `today`.
 *
 * Decisions encoded here:
 *   - ACTIVE goals only — equipment whose parent goal is completed/archived
 *     never appears.
 *   - Deadline is DERIVED via equipment-deadline.ts (milestone target_date if
 *     linked, else standalone_deadline). A milestone-linked item whose
 *     milestone has no target_date has no derivable deadline → the honest
 *     "no_date" group. A dangling milestone_id (row vanished between reads)
 *     degrades to no_date rather than crashing the page.
 *   - Urgency grouping via equipment-urgency.ts: overdue rides in this_week
 *     with an `overdue` flag (the view renders the amber note); boundaries
 *     inclusive at 7/30 days.
 *   - Purchased items KEEP their place in their group (struck/muted in the
 *     view) — nothing disappears silently on toggle.
 *   - Within a group rows sort by deadline ascending, ties and the no_date
 *     group alphabetically. Empty groups are omitted (nothing fake).
 */
import { equipmentDeadline } from "@/lib/equipment-deadline";
import {
  equipmentUrgency,
  isOverdue,
  URGENCY_ORDER,
  type EquipmentUrgency,
} from "@/lib/equipment-urgency";

export interface EquipmentRowLike {
  id: string;
  goal_id: string;
  title: string;
  cost_usd: string | null;
  milestone_id: string | null;
  standalone_deadline: string | null;
  purchased_at: Date | string | null;
}

export interface MilestoneDateLike {
  id: string;
  target_date: string | null;
}

export interface GoalLike {
  id: string;
  title: string;
  status: "active" | "completed" | "archived";
  color_index: number;
}

export interface EquipmentRowModel {
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  goalColorIndex: number;
  deadline: string | null;
  overdue: boolean;
  costUsd: string | null;
  purchased: boolean;
}

export interface EquipmentGroupModel {
  urgency: EquipmentUrgency;
  rows: EquipmentRowModel[];
}

/** The result shape the purchased-toggle handler resolves to. */
export type TogglePurchasedResult =
  | { ok: true; purchased: boolean }
  | { ok: false; error: string };

/** Toggle handler — the real server action in product, a local no-op in the
 *  playground harness. */
export type TogglePurchasedHandler = (input: {
  equipmentId: string;
  purchased: boolean;
}) => Promise<TogglePurchasedResult>;

export function buildEquipmentModel(input: {
  equipment: readonly EquipmentRowLike[];
  milestones: readonly MilestoneDateLike[];
  goals: readonly GoalLike[];
  /** YYYY-MM-DD in the user's timezone. */
  today: string;
}): EquipmentGroupModel[] {
  const activeGoals = new Map(
    input.goals.filter((g) => g.status === "active").map((g) => [g.id, g]),
  );
  const milestoneById = new Map(input.milestones.map((m) => [m.id, m]));

  const grouped = new Map<EquipmentUrgency, EquipmentRowModel[]>();
  for (const eq of input.equipment) {
    const goal = activeGoals.get(eq.goal_id);
    if (!goal) continue; // active goals only

    // Derive the deadline; a dangling milestone reference degrades to
    // "no date" instead of throwing the page over.
    const milestone =
      eq.milestone_id !== null
        ? (milestoneById.get(eq.milestone_id) ?? null)
        : null;
    const deadline =
      eq.milestone_id !== null && milestone === null
        ? null
        : equipmentDeadline(eq, milestone);

    const urgency = equipmentUrgency(deadline, input.today);
    const row: EquipmentRowModel = {
      id: eq.id,
      title: eq.title,
      goalId: goal.id,
      goalTitle: goal.title,
      goalColorIndex: goal.color_index,
      deadline,
      overdue: isOverdue(deadline, input.today),
      costUsd: eq.cost_usd,
      purchased: eq.purchased_at != null,
    };
    const list = grouped.get(urgency);
    if (list) list.push(row);
    else grouped.set(urgency, [row]);
  }

  const byDeadlineThenTitle = (a: EquipmentRowModel, b: EquipmentRowModel) => {
    if (a.deadline !== null && b.deadline !== null && a.deadline !== b.deadline) {
      return a.deadline < b.deadline ? -1 : 1;
    }
    return a.title.localeCompare(b.title);
  };

  return URGENCY_ORDER.filter((urgency) => grouped.has(urgency)).map(
    (urgency) => ({
      urgency,
      rows: grouped.get(urgency)!.sort(byDeadlineThenTitle),
    }),
  );
}
