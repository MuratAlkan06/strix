/**
 * actions.ts — the goal-detail write surface (phase-1-golden-path "Goal
 * detail": intensity control + inline section edits). This surface writes to
 * LIVE goals, so every action holds the full guard line, all zero-write on
 * failure:
 *
 *   - Clerk auth before any DB access.
 *   - zod input validation (uuid ids, non-empty titles, ISO dates, weekday
 *     bounds 0–6, the equipment exactly-one invariant) before any DB access.
 *   - Ownership via scopedDb: a forged or foreign id matches ZERO rows
 *     (update/delete) or fails the atomic insert proof — detected and
 *     reported; nothing written. Foreign and nonexistent are indistinguishable.
 *   - revalidatePath only AFTER a successful write.
 *
 * Semantics worth naming:
 *   - setGoalIntensity is the ONLY place goals.intensity_override is ever
 *     written (phase doc: explicit change here, never at creation, never on
 *     render). An explicit pick equal to the current effective intensity
 *     still writes the override — the user pinned it.
 *   - removeTask SOFT-deactivates (recurring_tasks.active = false), never
 *     deletes: task_completions history hangs off the row and must survive.
 *   - removeMilestone re-homes linked equipment to a standalone deadline
 *     equal to the milestone's target_date (the derived deadline is identical
 *     before and after — the exactly-one invariant holds, nothing silently
 *     shifts). A dateless milestone with linked equipment blocks removal
 *     (there is no deadline to inherit) with a plain line.
 *   - removeEquipment hard-deletes: no history references equipment rows.
 *   - Structural edits save normally with NO replan side effects — the
 *     Phase 2 banner gate lives in the view (NEXT_PUBLIC_REPLAN_ENABLED).
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { scopedDb } from "@/db/scoped";
import { equipment, goals, milestones, recurring_tasks } from "@/db/schema";
import { INTENSITY_LEVELS } from "@/lib/ai/intake-schema";
import {
  UUID_RE,
  type ActionResult,
  type CreateResult,
} from "./detail-model";

// ---------------------------------------------------------------------------
// Shared schema fragments + calm, in-register error lines
// ---------------------------------------------------------------------------

const uuidSchema = z.string().regex(UUID_RE);
const titleSchema = z.string().trim().min(1).max(200);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const weekdaySchema = z.number().int().min(0).max(6);
const durationSchema = z.number().int().min(1).max(1440).nullable();
// numeric(10,2) ceiling; non-negative.
const costSchema = z.number().min(0).max(99_999_999.99).nullable();

const ERR_SESSION = "Your session expired. Sign in to continue.";
const ERR_NOT_FOUND = "We couldn't find that item.";
const ERR_INVALID = "Some details need attention before saving.";
const ERR_SAVE = "That didn't save. Try once more.";
const ERR_EXACTLY_ONE =
  "Tie this to a milestone or set a date — one or the other.";
const ERR_MILESTONE_HAS_EQUIPMENT =
  "Equipment is tied to this milestone and it has no date to inherit. " +
  "Give that equipment its own date first.";

async function requireUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/** Surfaces the affected goal-detail page plus the aggregates that render the
 *  same rows. Called only after a successful write. */
function revalidateGoalSurfaces(goalId: string, extra: string[] = []) {
  revalidatePath(`/goals/${goalId}`);
  for (const path of extra) revalidatePath(path);
}

// ---------------------------------------------------------------------------
// Intensity override — the contract's core control
// ---------------------------------------------------------------------------

const setIntensitySchema = z.object({
  goalId: uuidSchema,
  intensity: z.enum(INTENSITY_LEVELS),
});

/**
 * Write goals.intensity_override on EXPLICIT user change — the only writer of
 * that column anywhere. Always writes when called with valid input, including
 * a pick equal to the current effective intensity (the user pinned it).
 */
export async function setGoalIntensity(input: {
  goalId: string;
  intensity: string;
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = setIntensitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  let updated: unknown[];
  try {
    updated = await scopedDb(userId).update(goals, {
      set: {
        intensity_override: parsed.data.intensity,
        updated_at: new Date(),
      },
      where: eq(goals.id, parsed.data.goalId),
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (updated.length === 0) return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Daily habits + weekly sessions (recurring_tasks)
// ---------------------------------------------------------------------------

const addTaskSchema = z
  .object({
    goalId: uuidSchema,
    cadence: z.enum(["daily", "weekly"]),
    title: titleSchema,
    weekday: weekdaySchema.nullable(),
    estimatedDurationMin: durationSchema,
  })
  .superRefine((value, ctx) => {
    // Weekly requires a weekday; daily must not carry one (a stray weekday on
    // a daily task would be silent garbage the dashboard never reads).
    if (value.cadence === "weekly" && value.weekday === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "weekday required" });
    }
    if (value.cadence === "daily" && value.weekday !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "weekday forbidden" });
    }
  });

export async function addTask(input: {
  goalId: string;
  cadence: "daily" | "weekly";
  title: string;
  weekday: number | null;
  estimatedDurationMin: number | null;
}): Promise<CreateResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = addTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  let inserted: Array<{ id: string }>;
  try {
    // scopedDb's atomic INSERT … SELECT proves the goal belongs to the live
    // user in the same statement — a foreign goal id inserts zero rows and
    // throws. No write happens on a failed proof.
    inserted = await scopedDb(userId).insert(recurring_tasks, {
      goal_id: parsed.data.goalId,
      title: parsed.data.title,
      cadence: parsed.data.cadence,
      weekday: parsed.data.weekday,
      estimated_duration_min: parsed.data.estimatedDurationMin,
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }

  revalidateGoalSurfaces(parsed.data.goalId, ["/dashboard"]);
  return { ok: true, id: inserted[0]!.id };
}

const updateTaskSchema = z.object({
  goalId: uuidSchema,
  taskId: uuidSchema,
  title: titleSchema,
  weekday: weekdaySchema.optional(),
  estimatedDurationMin: durationSchema,
});

export async function updateTask(input: {
  goalId: string;
  taskId: string;
  title: string;
  weekday?: number;
  estimatedDurationMin: number | null;
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = updateTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  // A weekday patch may only land on a weekly task — the cadence condition in
  // the WHERE means a daily task matches zero rows instead of silently
  // acquiring a weekday.
  const conditions = [
    eq(recurring_tasks.id, parsed.data.taskId),
    eq(recurring_tasks.goal_id, parsed.data.goalId),
    eq(recurring_tasks.active, true),
  ];
  if (parsed.data.weekday !== undefined) {
    conditions.push(eq(recurring_tasks.cadence, "weekly"));
  }

  let updated: unknown[];
  try {
    updated = await scopedDb(userId).update(recurring_tasks, {
      set: {
        title: parsed.data.title,
        estimated_duration_min: parsed.data.estimatedDurationMin,
        ...(parsed.data.weekday !== undefined
          ? { weekday: parsed.data.weekday }
          : {}),
        updated_at: new Date(),
      },
      where: and(...conditions),
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (updated.length === 0) return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId, ["/dashboard"]);
  return { ok: true };
}

const removeTaskSchema = z.object({ goalId: uuidSchema, taskId: uuidSchema });

/**
 * REMOVE = deactivate (active = false), never delete: task_completions rows
 * reference the task and the user's history must survive the plan changing
 * shape. The dashboard and this page only read active tasks.
 */
export async function removeTask(input: {
  goalId: string;
  taskId: string;
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = removeTaskSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  let updated: unknown[];
  try {
    updated = await scopedDb(userId).update(recurring_tasks, {
      set: { active: false, updated_at: new Date() },
      where: and(
        eq(recurring_tasks.id, parsed.data.taskId),
        eq(recurring_tasks.goal_id, parsed.data.goalId),
        eq(recurring_tasks.active, true),
      ),
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (updated.length === 0) return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId, ["/dashboard"]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Milestones (timeline: position-ordered, move up/down)
// ---------------------------------------------------------------------------

const addMilestoneSchema = z.object({
  goalId: uuidSchema,
  title: titleSchema,
  targetDate: isoDateSchema,
});

export async function addMilestone(input: {
  goalId: string;
  title: string;
  targetDate: string;
}): Promise<CreateResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = addMilestoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  let newId: string;
  try {
    newId = await scopedDb(userId).transaction(async (tx) => {
      // Appended at the end of the timeline: max(position) + 1 keeps the
      // save-path's sequential positions unique without renumbering.
      const existing = await tx.selectFrom(milestones, {
        where: eq(milestones.goal_id, parsed.data.goalId),
      });
      const nextPosition =
        existing.length === 0
          ? 0
          : Math.max(...existing.map((m) => m.position)) + 1;
      const inserted = await tx.insert(milestones, {
        goal_id: parsed.data.goalId,
        title: parsed.data.title,
        target_date: parsed.data.targetDate,
        position: nextPosition,
      });
      return inserted[0]!.id;
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }

  revalidateGoalSurfaces(parsed.data.goalId, ["/goals", "/dashboard", "/equipment"]);
  return { ok: true, id: newId };
}

const updateMilestoneSchema = z.object({
  goalId: uuidSchema,
  milestoneId: uuidSchema,
  title: titleSchema,
  targetDate: isoDateSchema,
});

export async function updateMilestone(input: {
  goalId: string;
  milestoneId: string;
  title: string;
  targetDate: string;
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = updateMilestoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  let updated: unknown[];
  try {
    updated = await scopedDb(userId).update(milestones, {
      set: {
        title: parsed.data.title,
        target_date: parsed.data.targetDate,
        updated_at: new Date(),
      },
      where: and(
        eq(milestones.id, parsed.data.milestoneId),
        eq(milestones.goal_id, parsed.data.goalId),
      ),
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (updated.length === 0) return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId, ["/goals", "/dashboard", "/equipment"]);
  return { ok: true };
}

const removeMilestoneSchema = z.object({
  goalId: uuidSchema,
  milestoneId: uuidSchema,
});

/**
 * Remove a milestone, preserving the equipment exactly-one invariant: linked
 * equipment is re-homed to a standalone deadline equal to the milestone's
 * target_date — its DERIVED deadline is identical before and after, so
 * nothing shifts silently. A dateless milestone with linked equipment blocks
 * removal (no deadline to inherit) with a plain line; the user gives that
 * equipment its own date first.
 */
export async function removeMilestone(input: {
  goalId: string;
  milestoneId: string;
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = removeMilestoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  type Outcome =
    | { kind: "removed" }
    | { kind: "not_found" }
    | { kind: "blocked" };
  let outcome: Outcome;
  try {
    outcome = await scopedDb(userId).transaction(async (tx): Promise<Outcome> => {
      const rows = await tx.selectFrom(milestones, {
        where: and(
          eq(milestones.id, parsed.data.milestoneId),
          eq(milestones.goal_id, parsed.data.goalId),
        ),
      });
      const milestone = rows[0];
      if (!milestone) return { kind: "not_found" };

      const linked = await tx.selectFrom(equipment, {
        where: eq(equipment.milestone_id, parsed.data.milestoneId),
      });
      if (linked.length > 0) {
        if (milestone.target_date === null) return { kind: "blocked" };
        await tx.update(equipment, {
          set: {
            milestone_id: null,
            standalone_deadline: milestone.target_date,
            updated_at: new Date(),
          },
          where: eq(equipment.milestone_id, parsed.data.milestoneId),
        });
      }

      const deleted = await tx.delete(milestones, {
        where: and(
          eq(milestones.id, parsed.data.milestoneId),
          eq(milestones.goal_id, parsed.data.goalId),
        ),
      });
      if (deleted.length === 0) {
        // Vanished mid-transaction — roll the equipment re-home back too.
        throw new Error("milestone no longer exists — remove aborted");
      }
      return { kind: "removed" };
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }

  if (outcome.kind === "not_found") return { ok: false, error: ERR_NOT_FOUND };
  if (outcome.kind === "blocked") {
    return { ok: false, error: ERR_MILESTONE_HAS_EQUIPMENT };
  }

  revalidateGoalSurfaces(parsed.data.goalId, ["/goals", "/dashboard", "/equipment"]);
  return { ok: true };
}

const moveMilestoneSchema = z.object({
  goalId: uuidSchema,
  milestoneId: uuidSchema,
  direction: z.enum(["up", "down"]),
});

/**
 * Reorder via move up/down (the established Phase 1 pattern — keyboard-
 * accessible, no drag): swap positions with the neighbor in one transaction.
 * A boundary move is an ok no-op (the UI disables those buttons; a stale
 * click should not error).
 */
export async function moveMilestone(input: {
  goalId: string;
  milestoneId: string;
  direction: "up" | "down";
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = moveMilestoneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  let found = false;
  try {
    found = await scopedDb(userId).transaction(async (tx) => {
      const rows = await tx.selectFrom(milestones, {
        where: eq(milestones.goal_id, parsed.data.goalId),
      });
      const ordered = [...rows].sort(
        (a, b) => a.position - b.position || a.id.localeCompare(b.id),
      );
      const index = ordered.findIndex((m) => m.id === parsed.data.milestoneId);
      if (index === -1) return false;
      const target = parsed.data.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= ordered.length) return true; // boundary no-op
      const a = ordered[index]!;
      const b = ordered[target]!;
      await tx.update(milestones, {
        set: { position: b.position, updated_at: new Date() },
        where: eq(milestones.id, a.id),
      });
      await tx.update(milestones, {
        set: { position: a.position, updated_at: new Date() },
        where: eq(milestones.id, b.id),
      });
      return true;
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (!found) return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId, ["/goals"]);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Equipment (exactly one of milestone link / standalone date)
// ---------------------------------------------------------------------------

const equipmentFieldsSchema = z
  .object({
    title: titleSchema,
    costUsd: costSchema,
    milestoneId: uuidSchema.nullable(),
    standaloneDeadline: isoDateSchema.nullable(),
  })
  .superRefine((value, ctx) => {
    // The application-level invariant (phase doc "Equipment deadline
    // derivation"): exactly one of milestone link / standalone date.
    const linked = value.milestoneId !== null;
    const standalone = value.standaloneDeadline !== null;
    if (linked === standalone) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "exactly one" });
    }
  });

const addEquipmentSchema = z
  .object({ goalId: uuidSchema })
  .and(equipmentFieldsSchema);

export async function addEquipment(input: {
  goalId: string;
  title: string;
  costUsd: number | null;
  milestoneId: string | null;
  standaloneDeadline: string | null;
}): Promise<CreateResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = addEquipmentSchema.safeParse(input);
  if (!parsed.success) {
    const exactlyOne = parsed.error.issues.some(
      (i) => i.message === "exactly one",
    );
    return { ok: false, error: exactlyOne ? ERR_EXACTLY_ONE : ERR_INVALID };
  }

  let newId: string | null;
  try {
    newId = await scopedDb(userId).transaction(async (tx) => {
      // A milestone link must point inside THIS goal — linking across goals
      // (even the user's own) would corrupt the deadline derivation.
      if (parsed.data.milestoneId !== null) {
        const ms = await tx.selectFrom(milestones, {
          where: and(
            eq(milestones.id, parsed.data.milestoneId),
            eq(milestones.goal_id, parsed.data.goalId),
          ),
        });
        if (ms.length === 0) return null;
      }
      const inserted = await tx.insert(equipment, {
        goal_id: parsed.data.goalId,
        title: parsed.data.title,
        cost_usd:
          parsed.data.costUsd !== null ? String(parsed.data.costUsd) : null,
        milestone_id: parsed.data.milestoneId,
        standalone_deadline: parsed.data.standaloneDeadline,
      });
      return inserted[0]!.id;
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (newId === null) return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId, ["/equipment", "/dashboard"]);
  return { ok: true, id: newId };
}

const updateEquipmentSchema = z
  .object({ goalId: uuidSchema, equipmentId: uuidSchema })
  .and(equipmentFieldsSchema);

export async function updateEquipment(input: {
  goalId: string;
  equipmentId: string;
  title: string;
  costUsd: number | null;
  milestoneId: string | null;
  standaloneDeadline: string | null;
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = updateEquipmentSchema.safeParse(input);
  if (!parsed.success) {
    const exactlyOne = parsed.error.issues.some(
      (i) => i.message === "exactly one",
    );
    return { ok: false, error: exactlyOne ? ERR_EXACTLY_ONE : ERR_INVALID };
  }

  type Outcome = "updated" | "not_found";
  let outcome: Outcome;
  try {
    outcome = await scopedDb(userId).transaction(async (tx): Promise<Outcome> => {
      if (parsed.data.milestoneId !== null) {
        const ms = await tx.selectFrom(milestones, {
          where: and(
            eq(milestones.id, parsed.data.milestoneId),
            eq(milestones.goal_id, parsed.data.goalId),
          ),
        });
        if (ms.length === 0) return "not_found";
      }
      const updated = await tx.update(equipment, {
        set: {
          title: parsed.data.title,
          cost_usd:
            parsed.data.costUsd !== null ? String(parsed.data.costUsd) : null,
          milestone_id: parsed.data.milestoneId,
          standalone_deadline: parsed.data.standaloneDeadline,
          updated_at: new Date(),
        },
        where: and(
          eq(equipment.id, parsed.data.equipmentId),
          eq(equipment.goal_id, parsed.data.goalId),
        ),
      });
      return updated.length === 0 ? "not_found" : "updated";
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (outcome === "not_found") return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId, ["/equipment", "/dashboard"]);
  return { ok: true };
}

const removeEquipmentSchema = z.object({
  goalId: uuidSchema,
  equipmentId: uuidSchema,
});

/** Equipment removal is a hard delete — nothing references equipment rows
 *  (purchase state lives on the row itself; no history table). */
export async function removeEquipment(input: {
  goalId: string;
  equipmentId: string;
}): Promise<ActionResult> {
  const userId = await requireUserId();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = removeEquipmentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };

  let deleted: unknown[];
  try {
    deleted = await scopedDb(userId).delete(equipment, {
      where: and(
        eq(equipment.id, parsed.data.equipmentId),
        eq(equipment.goal_id, parsed.data.goalId),
      ),
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }
  if (deleted.length === 0) return { ok: false, error: ERR_NOT_FOUND };

  revalidateGoalSurfaces(parsed.data.goalId, ["/equipment", "/dashboard"]);
  return { ok: true };
}
