/**
 * equipment-deadline.ts — the equipment deadline derivation
 * (phase-1-golden-path "Equipment deadline derivation").
 *
 * Application-level invariant on `equipment` rows: EXACTLY ONE of
 * milestone_id / standalone_deadline is set (schema.ts documents the same
 * rule; the save path and the plan-draft zod gate enforce it). A
 * milestone-linked item's deadline IS its milestone's target_date; a
 * standalone item carries its own date.
 *
 * Pure and client-safe — the review screen derives display deadlines with it
 * now; the aggregated equipment view (Slice 8) groups by it later.
 */

interface EquipmentLike {
  milestone_id: string | null;
  standalone_deadline: string | null;
}

interface MilestoneLike {
  target_date: string | null;
}

/**
 * Derive an equipment item's effective deadline.
 *
 * @param eq        The equipment row (or draft shape carrying the same pair).
 * @param milestone The linked milestone — required (and must carry a
 *                  target_date) when eq.milestone_id is set.
 */
export function equipmentDeadline(
  eq: EquipmentLike,
  milestone?: MilestoneLike | null,
): string | null {
  if (eq.milestone_id !== null) {
    if (!milestone) {
      throw new Error(
        "equipmentDeadline: milestone-linked equipment requires its milestone.",
      );
    }
    return milestone.target_date;
  }
  return eq.standalone_deadline;
}
