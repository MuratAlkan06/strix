/**
 * apply-plan.ts — the pure application planner behind the replan decision
 * commit (phase-2-close-the-loop "Replan diff UI": "writes the accepted
 * subset to the live tables"). No DB, no React: the decision server action
 * feeds it the stored diff, the user's decisions, and the goal's CURRENT
 * rows (read through scopedDb INSIDE the decision transaction) — it answers
 * with either one calm failure or the EXACT table operations to execute.
 * Planning before writing is what makes the commit all-or-nothing: every
 * validation, including the security id resolution, completes before the
 * first write is issued.
 *
 * SECURITY PRECONDITION (release-gate-recorded, frozen): every modify/remove
 * id and every equipment milestone_id in the diff is UNTRUSTED MODEL OUTPUT.
 * All of them must resolve against rows belonging to the proposal's goal —
 * the caller proves ownership by fetching the current rows through scopedDb
 * scoped to that goal, and THIS module refuses the whole commit when any id
 * fails to resolve in those rows (diff-wide, accepted or not; a stale or
 * adversarial diff is never partially applied — regeneration is the way
 * out). Equipment milestone links (proposed OR user-edited, in adds AND
 * modifies) must resolve to a milestone of the SAME goal.
 *
 * Application semantics:
 *   - recurring_tasks remove ⇒ DEACTIVATE (active=false), never delete:
 *     task_completions rows hang off the task (FK restrict) and history
 *     must survive the plan changing shape — the goal-detail removeTask
 *     semantic. (The slice contract says "remove"; this is the only remove
 *     this schema supports.)
 *   - milestones remove ⇒ hard delete, LAST, with linked equipment re-homed
 *     to a standalone deadline equal to the milestone's target_date (the
 *     goal-detail removeMilestone semantic — the derived deadline is
 *     identical before and after). A dateless milestone with surviving
 *     linked equipment blocks the commit with a plain line.
 *   - equipment remove ⇒ hard delete (nothing references equipment rows).
 *   - EDITS: the user may adjust the proposed change's own fields (title,
 *     weekday 0–6, positive duration, ISO dates, cost, position, milestone
 *     link) before accepting — the edited value is what's applied. Field
 *     rules mirror ReplanDiffSchema; ids are never editable; a modify edit
 *     may only touch fields the proposal itself changes.
 *   - EXACTLY-ONE invariant (equipment): re-validated on the accepted
 *     subset's FINAL state (current row + effective change), the same gate
 *     every other equipment write path holds. Explicitly anchoring
 *     equipment to a milestone the same commit removes is refused.
 *
 * Pure and side-effect free; unit-tested against the planning-doc fixture
 * ("given a fixture diff and a partial accept-set, the resulting live-table
 * state matches expected").
 */
import { z } from "zod";

import type { ReplanDiff } from "@/lib/ai/replan-diff";
import {
  decisionStatus,
  enumerateChanges,
  UUID_RE,
  type CurrentEquipmentLike,
  type CurrentMilestoneLike,
  type CurrentTaskLike,
  type DecidedStatus,
  type DecisionMap,
} from "./replan-model";

// ---------------------------------------------------------------------------
// Edited-field validation (mirrors ReplanDiffSchema rules + ISO dates)
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const titleEdit = z.string().trim().min(1).max(200);
const weekdayEdit = z.number().int().min(0).max(6).nullable();
const durationEdit = z.number().int().positive();
const isoDateEdit = z.string().regex(ISO_DATE_RE);
const costEdit = z.number().min(0).nullable();
const milestoneLinkEdit = z.string().regex(UUID_RE).nullable();
const positionEdit = z.number().int();

/** What ✎ may touch, per section × kind. `active` is deliberately absent —
 *  the frozen edit scope is title / weekday / duration / dates / cost /
 *  position / milestone link; a pause proposal is accepted or rejected
 *  as-is. Removes carry nothing editable. */
const EDIT_SCHEMAS = {
  "recurring_tasks:add": z
    .object({
      title: titleEdit.optional(),
      weekday: weekdayEdit.optional(),
      estimated_duration_min: durationEdit.optional(),
    })
    .strict(),
  "recurring_tasks:modify": z
    .object({
      title: titleEdit.optional(),
      weekday: weekdayEdit.optional(),
      estimated_duration_min: durationEdit.optional(),
    })
    .strict(),
  "milestones:add": z
    .object({
      title: titleEdit.optional(),
      target_date: isoDateEdit.optional(),
      position: positionEdit.optional(),
    })
    .strict(),
  "milestones:modify": z
    .object({
      title: titleEdit.optional(),
      target_date: isoDateEdit.optional(),
      position: positionEdit.optional(),
    })
    .strict(),
  "equipment:add": z
    .object({
      title: titleEdit.optional(),
      cost_usd: costEdit.optional(),
      milestone_id: milestoneLinkEdit.optional(),
      standalone_deadline: isoDateEdit.nullable().optional(),
    })
    .strict(),
  "equipment:modify": z
    .object({
      title: titleEdit.optional(),
      cost_usd: costEdit.optional(),
      milestone_id: milestoneLinkEdit.optional(),
      standalone_deadline: isoDateEdit.nullable().optional(),
    })
    .strict(),
} as const;

// ---------------------------------------------------------------------------
// Outcome shapes
// ---------------------------------------------------------------------------

/** One calm failure — the action maps kinds onto constant user lines.
 *  Whatever the kind: NOTHING gets written. */
export type PlanFailure =
  | { ok: false; kind: "decisions_mismatch" }
  | { ok: false; kind: "invalid_edit" }
  /** The security abort: a modify/remove id or an equipment milestone link
   *  did not resolve to a row of the proposal's goal. */
  | { ok: false; kind: "unresolved_id" }
  /** Equipment final state breaks exactly-one, or anchors to a milestone
   *  this same commit removes. */
  | { ok: false; kind: "equipment_anchor" }
  /** A removed milestone has no target_date to re-home its equipment to. */
  | { ok: false; kind: "milestone_blocked" };

export interface PlannedOps {
  ok: true;
  taskInserts: Array<{
    title: string;
    cadence: "daily" | "weekly";
    weekday: number | null;
    estimated_duration_min: number;
  }>;
  taskUpdates: Array<{
    id: string;
    set: Partial<{
      title: string;
      weekday: number | null;
      estimated_duration_min: number;
      active: boolean;
    }>;
  }>;
  /** recurring_tasks removes — applied as active=false (see header). */
  taskDeactivates: string[];
  milestoneInserts: Array<{
    title: string;
    target_date: string;
    position: number;
  }>;
  milestoneUpdates: Array<{
    id: string;
    set: Partial<{ title: string; target_date: string; position: number }>;
  }>;
  /** Hard deletes — the action runs these LAST (equipment already re-homed). */
  milestoneRemoves: string[];
  equipmentInserts: Array<{
    title: string;
    cost_usd: number | null;
    milestone_id: string | null;
    standalone_deadline: string | null;
  }>;
  equipmentUpdates: Array<{
    id: string;
    set: Partial<{
      title: string;
      cost_usd: number | null;
      milestone_id: string | null;
      standalone_deadline: string | null;
    }>;
  }>;
  equipmentRemoves: string[];
  /** Milestone-removal fallout for rows with no other accepted update. */
  equipmentRehomes: Array<{ id: string; standalone_deadline: string }>;
  acceptCount: number;
  rejectCount: number;
  status: DecidedStatus;
}

export type PlanResult = PlannedOps | PlanFailure;

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

export function planApplication(input: {
  diff: ReplanDiff;
  decisions: DecisionMap;
  tasks: readonly CurrentTaskLike[];
  milestones: readonly CurrentMilestoneLike[];
  equipment: readonly CurrentEquipmentLike[];
}): PlanResult {
  const changes = enumerateChanges(input.diff);
  if (changes.length === 0) return { ok: false, kind: "decisions_mismatch" };

  // Every change decided, no unknown keys — exact set equality.
  const decidedKeys = Object.keys(input.decisions);
  if (decidedKeys.length !== changes.length) {
    return { ok: false, kind: "decisions_mismatch" };
  }
  const changeKeys = new Set(changes.map((c) => c.key));
  for (const key of decidedKeys) {
    if (!changeKeys.has(key)) return { ok: false, kind: "decisions_mismatch" };
  }

  const tasksById = new Map(input.tasks.map((t) => [t.id, t]));
  const milestonesById = new Map(input.milestones.map((m) => [m.id, m]));
  const equipmentById = new Map(input.equipment.map((e) => [e.id, e]));

  // -------------------------------------------------------------------------
  // SECURITY: resolve ALL referenced ids — diff-wide, decisions irrelevant.
  // The row maps above came from scopedDb reads pinned to the proposal's
  // goal, so membership IS the same-goal ownership proof. One miss refuses
  // the whole commit.
  // -------------------------------------------------------------------------
  for (const change of changes) {
    if (change.kind === "add") continue;
    const pool =
      change.section === "recurring_tasks"
        ? tasksById
        : change.section === "milestones"
          ? milestonesById
          : equipmentById;
    if (!pool.has(change.id)) return { ok: false, kind: "unresolved_id" };
  }
  // Equipment milestone links — proposed values first (edited values are
  // checked after edit validation below; both must prove same-goal).
  for (const add of input.diff.equipment.add) {
    if (add.milestone_id !== null && !milestonesById.has(add.milestone_id)) {
      return { ok: false, kind: "unresolved_id" };
    }
  }
  for (const m of input.diff.equipment.modify) {
    const link = m.changes.milestone_id;
    if (link !== undefined && link !== null && !milestonesById.has(link)) {
      return { ok: false, kind: "unresolved_id" };
    }
  }

  // -------------------------------------------------------------------------
  // Edits: validate shape, restrict modifies to the proposal's own fields,
  // forbid edits on removes. Effective change = proposed ⊕ edited.
  // -------------------------------------------------------------------------
  const effectiveEdits = new Map<string, Record<string, unknown>>();
  for (const change of changes) {
    const entry = input.decisions[change.key]!;
    if (entry.edited === undefined) continue;
    if (change.kind === "remove") return { ok: false, kind: "invalid_edit" };

    const schema = EDIT_SCHEMAS[`${change.section}:${change.kind}`];
    const parsed = schema.safeParse(entry.edited);
    if (!parsed.success) return { ok: false, kind: "invalid_edit" };
    const edited = parsed.data as Record<string, unknown>;

    if (change.kind === "modify") {
      // Only fields the proposal itself changes may be adjusted — an edit
      // must not silently widen the modify. Exception: equipment's milestone
      // link + standalone date are ONE exactly-one anchor, so touching
      // either half opens both to the edit (re-anchoring coherently always
      // writes the pair).
      const anchorOpen =
        change.section === "equipment" &&
        ("milestone_id" in change.changes ||
          "standalone_deadline" in change.changes);
      for (const key of Object.keys(edited)) {
        if (key in change.changes) continue;
        if (
          anchorOpen &&
          (key === "milestone_id" || key === "standalone_deadline")
        ) {
          continue;
        }
        return { ok: false, kind: "invalid_edit" };
      }
    }
    // Edited equipment milestone links carry the same same-goal burden as
    // proposed ones.
    const editedLink = edited.milestone_id;
    if (
      typeof editedLink === "string" &&
      !milestonesById.has(editedLink)
    ) {
      return { ok: false, kind: "unresolved_id" };
    }
    effectiveEdits.set(change.key, edited);
  }

  // -------------------------------------------------------------------------
  // Build the accepted operation set.
  // -------------------------------------------------------------------------
  const ops: PlannedOps = {
    ok: true,
    taskInserts: [],
    taskUpdates: [],
    taskDeactivates: [],
    milestoneInserts: [],
    milestoneUpdates: [],
    milestoneRemoves: [],
    equipmentInserts: [],
    equipmentUpdates: [],
    equipmentRemoves: [],
    equipmentRehomes: [],
    acceptCount: 0,
    rejectCount: 0,
    status: "rejected",
  };

  const removedMilestoneIds = new Set<string>();
  const removedEquipmentIds = new Set<string>();
  // Equipment whose final anchor changed via an accepted modify — feeds the
  // re-home computation below.
  const finalEquipmentAnchors = new Map<
    string,
    { milestone_id: string | null; standalone_deadline: string | null }
  >();

  for (const change of changes) {
    const entry = input.decisions[change.key]!;
    if (entry.decision === "reject") {
      ops.rejectCount += 1;
      continue;
    }
    ops.acceptCount += 1;
    const edited = effectiveEdits.get(change.key) ?? {};

    if (change.section === "recurring_tasks") {
      if (change.kind === "add") {
        const merged = { ...change.add, ...edited };
        ops.taskInserts.push({
          title: merged.title,
          cadence: merged.cadence,
          weekday: merged.weekday,
          estimated_duration_min: merged.estimated_duration_min,
        });
      } else if (change.kind === "modify") {
        ops.taskUpdates.push({
          id: change.id,
          set: { ...change.changes, ...edited },
        });
      } else {
        ops.taskDeactivates.push(change.id);
      }
      continue;
    }

    if (change.section === "milestones") {
      if (change.kind === "add") {
        const merged = { ...change.add, ...edited };
        ops.milestoneInserts.push({
          title: merged.title,
          target_date: merged.target_date,
          position: merged.position,
        });
      } else if (change.kind === "modify") {
        ops.milestoneUpdates.push({
          id: change.id,
          set: { ...change.changes, ...edited },
        });
      } else {
        ops.milestoneRemoves.push(change.id);
        removedMilestoneIds.add(change.id);
      }
      continue;
    }

    // equipment
    if (change.kind === "add") {
      const merged = { ...change.add, ...edited };
      // Exactly-one (application invariant, schema.ts): the accepted add's
      // final anchor must be a milestone link XOR a standalone date.
      if ((merged.milestone_id !== null) === (merged.standalone_deadline !== null)) {
        return { ok: false, kind: "equipment_anchor" };
      }
      ops.equipmentInserts.push({
        title: merged.title,
        cost_usd: merged.cost_usd,
        milestone_id: merged.milestone_id,
        standalone_deadline: merged.standalone_deadline,
      });
    } else if (change.kind === "modify") {
      const set = { ...change.changes, ...edited } as Partial<{
        title: string;
        cost_usd: number | null;
        milestone_id: string | null;
        standalone_deadline: string | null;
      }>;
      const current = equipmentById.get(change.id)!;
      const finalMilestone =
        set.milestone_id !== undefined ? set.milestone_id : current.milestone_id;
      const finalStandalone =
        set.standalone_deadline !== undefined
          ? set.standalone_deadline
          : current.standalone_deadline;
      if ((finalMilestone !== null) === (finalStandalone !== null)) {
        return { ok: false, kind: "equipment_anchor" };
      }
      ops.equipmentUpdates.push({ id: change.id, set });
      finalEquipmentAnchors.set(change.id, {
        milestone_id: finalMilestone,
        standalone_deadline: finalStandalone,
      });
    } else {
      ops.equipmentRemoves.push(change.id);
      removedEquipmentIds.add(change.id);
    }
  }

  // -------------------------------------------------------------------------
  // Milestone-removal fallout (the removeMilestone semantic).
  // -------------------------------------------------------------------------
  if (removedMilestoneIds.size > 0) {
    // Explicitly anchoring equipment to a milestone this commit removes is a
    // contradiction — refuse rather than guess.
    for (const ins of ops.equipmentInserts) {
      if (ins.milestone_id !== null && removedMilestoneIds.has(ins.milestone_id)) {
        return { ok: false, kind: "equipment_anchor" };
      }
    }
    // Only an EXPLICIT re-anchor onto a dying milestone is the
    // contradiction; a row that merely remains linked is the re-home case
    // below.
    for (const u of ops.equipmentUpdates) {
      if (
        u.set.milestone_id !== undefined &&
        u.set.milestone_id !== null &&
        removedMilestoneIds.has(u.set.milestone_id)
      ) {
        return { ok: false, kind: "equipment_anchor" };
      }
    }
    // Surviving rows still anchored to a removed milestone inherit its
    // target_date as a standalone deadline; a dateless milestone with such
    // rows blocks the whole commit (no deadline to inherit).
    for (const row of input.equipment) {
      if (removedEquipmentIds.has(row.id)) continue;
      const anchor = finalEquipmentAnchors.get(row.id) ?? {
        milestone_id: row.milestone_id,
        standalone_deadline: row.standalone_deadline,
      };
      if (
        anchor.milestone_id === null ||
        !removedMilestoneIds.has(anchor.milestone_id)
      ) {
        continue;
      }
      const milestone = milestonesById.get(anchor.milestone_id)!;
      if (milestone.target_date === null) {
        return { ok: false, kind: "milestone_blocked" };
      }
      const update = ops.equipmentUpdates.find((u) => u.id === row.id);
      if (update) {
        update.set.milestone_id = null;
        update.set.standalone_deadline = milestone.target_date;
      } else {
        ops.equipmentRehomes.push({
          id: row.id,
          standalone_deadline: milestone.target_date,
        });
      }
    }
  }

  ops.status = decisionStatus(ops.acceptCount, changes.length);
  return ops;
}
