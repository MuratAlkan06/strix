/**
 * actions.ts — the replan decision-commit server action
 * (phase-2-close-the-loop "Replan diff UI": "On commit: writes the accepted
 * subset to the live tables, sets replan_proposals.status and decided_at").
 * The AI proposes; the user approves — never apply silently (SPEC §8).
 *
 * The full guard line, all zero-write on failure:
 *   - Clerk auth before any DB access.
 *   - zod input validation FIRST (proposalId uuid; decisions keyed by the
 *     stable change identifiers of replan-model.ts, accept|reject + optional
 *     edited fields) before any DB access.
 *   - ONE scopedDb transaction serialized by tx.lockScope("replan") — the
 *     SAME namespace the generation endpoint's persist holds, so a decision
 *     can never race a regeneration into corruption. Inside it, in order:
 *       1. Re-select the proposal; status='pending' or calm error.
 *       2. Re-verify the goal is still ACTIVE — a goal completed/archived
 *          after proposal creation cannot receive plan changes.
 *       3. Read the goal's CURRENT recurring_tasks / milestones / equipment
 *          through the scoped surface, pinned to the PROPOSAL's goal_id.
 *       4. planApplication() — the pure planner validates EVERYTHING before
 *          the first write, including the SECURITY PRECONDITION: every
 *          modify/remove id and every equipment milestone link in the diff
 *          (model output = untrusted input) must resolve against those
 *          scoped rows; any unknown/foreign id refuses the whole commit.
 *       5. The first_replan_accepted gate: PRE-write count of ever-accepted
 *          (accepted | partially_accepted) proposals — fires once, ever.
 *       6. Execute the planned ops. recurring_tasks removes DEACTIVATE
 *          (history survives — the goal-detail removeTask semantic);
 *          milestone removes run LAST with linked equipment re-homed
 *          (the removeMilestone semantic); a zero-row write mid-apply means
 *          a row vanished under us → throw, the whole transaction rolls back.
 *       7. status (accepted | partially_accepted | rejected per the frozen
 *          mapping) + decided_at, WHERE still-pending (belt-and-braces under
 *          the lock).
 *   - PostHog AFTER commit (planning doc verbatim): first_replan_accepted
 *     { goal_id, accept_count, reject_count } once ever (partials gate it
 *     too; rejections never), replan_rejected { goal_id },
 *     replan_partially_accepted { goal_id, accept_count, reject_count }.
 *   - revalidatePath: the goal detail, the dashboard, and this diff page.
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { scopedDb } from "@/db/scoped";
import {
  equipment,
  goals,
  milestones,
  recurring_tasks,
  replan_proposals,
} from "@/db/schema";
import { capture } from "@/lib/analytics/server";
import { ReplanDiffSchema } from "@/lib/ai/replan-diff";
import { planApplication, type PlanFailure } from "./apply-plan";
import {
  isPlaceholderDiff,
  UUID_RE,
  type ReplanActionResult,
} from "./replan-model";

const ERR_SESSION = "Your session expired. Sign in to continue.";
const ERR_INVALID = "Some details need attention before saving.";
const ERR_NOT_FOUND = "We couldn't find that proposal.";
const ERR_DECIDED = "This proposal was already decided.";
const ERR_GOAL_NOT_ACTIVE =
  "This goal is no longer active, so its plan can't change.";
const ERR_NOT_GENERATED = "This proposal hasn't been generated yet.";
const ERR_STALE =
  "Parts of this proposal no longer match your plan. Generate a fresh one.";
const ERR_ANCHOR =
  "Tie that equipment to a milestone or set a date — one or the other.";
const ERR_MILESTONE_BLOCKED =
  "Equipment is tied to a milestone this change removes and there's no " +
  "date to inherit. Give that equipment its own date first.";
const ERR_SAVE = "That didn't save. Try once more.";

const decideSchema = z.object({
  proposalId: z.string().regex(UUID_RE),
  decisions: z.record(
    z.string().min(1).max(120),
    z.object({
      decision: z.enum(["accept", "reject"]),
      edited: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
});

/** Plan-failure kinds → calm constant lines. */
const FAILURE_LINES: Record<PlanFailure["kind"], string> = {
  decisions_mismatch: ERR_INVALID,
  invalid_edit: ERR_INVALID,
  unresolved_id: ERR_STALE,
  equipment_anchor: ERR_ANCHOR,
  milestone_blocked: ERR_MILESTONE_BLOCKED,
};

export async function decideReplan(input: {
  proposalId: string;
  decisions: Record<
    string,
    { decision: "accept" | "reject"; edited?: Record<string, unknown> }
  >;
}): Promise<ReplanActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = decideSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };
  const { proposalId, decisions } = parsed.data;

  const sdb = scopedDb(userId);
  type Outcome =
    | {
        kind: "ok";
        goalId: string;
        status: "accepted" | "partially_accepted" | "rejected";
        acceptCount: number;
        rejectCount: number;
        fireFirst: boolean;
      }
    | { kind: "not_found" }
    | { kind: "decided" }
    | { kind: "goal_not_active" }
    | { kind: "not_generated" }
    | { kind: "plan_failure"; error: string };
  let outcome: Outcome;
  try {
    outcome = await sdb.transaction(async (tx): Promise<Outcome> => {
      // Same namespace as the generation endpoint's persist: a decision and
      // a regeneration for this user queue instead of interleaving.
      await tx.lockScope("replan");

      const proposalRows = await tx.selectFrom(replan_proposals, {
        where: eq(replan_proposals.id, proposalId),
      });
      const proposal = proposalRows[0];
      // Foreign and nonexistent proposals are indistinguishable here — the
      // scope filter returned zero rows either way.
      if (!proposal) return { kind: "not_found" };
      if (proposal.status !== "pending") return { kind: "decided" };

      const diff = ReplanDiffSchema.safeParse(proposal.proposed_changes);
      // A stored diff that no longer parses is corrupt — nothing applicable.
      if (!diff.success) return { kind: "not_generated" };
      if (isPlaceholderDiff(diff.data)) return { kind: "not_generated" };

      // The goal must still be ACTIVE: completed/archived goals do not
      // receive plan changes, however old the pending proposal.
      const goalRows = await tx.selectFrom(goals, {
        where: and(
          eq(goals.id, proposal.goal_id),
          eq(goals.status, "active"),
        ),
      });
      if (goalRows.length === 0) return { kind: "goal_not_active" };

      // The goal's current rows, read through the scoped surface pinned to
      // the PROPOSAL's goal — membership in these is the same-goal ownership
      // proof the planner's id resolution rides on. Tasks include inactive
      // ones (a modify may reactivate a paused task).
      const tasks = await tx.selectFrom(recurring_tasks, {
        where: eq(recurring_tasks.goal_id, proposal.goal_id),
      });
      const milestoneRows = await tx.selectFrom(milestones, {
        where: eq(milestones.goal_id, proposal.goal_id),
      });
      const equipmentRows = await tx.selectFrom(equipment, {
        where: eq(equipment.goal_id, proposal.goal_id),
      });

      // Everything — decisions parity, edit validity, the security id
      // resolution, equipment invariants — is validated HERE, before any
      // write. One failure refuses the whole commit with zero writes.
      const plan = planApplication({
        diff: diff.data,
        decisions,
        tasks,
        milestones: milestoneRows,
        equipment: equipmentRows,
      });
      if (!plan.ok) {
        return { kind: "plan_failure", error: FAILURE_LINES[plan.kind] };
      }

      // first_replan_accepted gate on the PRE-write count of ever-accepted
      // proposals (user-level): an upsert-free insert path, so pre-write is
      // the only exact gate — same posture as the check-in first event.
      const priorAccepted = await tx.count(replan_proposals, {
        where: inArray(replan_proposals.status, [
          "accepted",
          "partially_accepted",
        ]),
      });

      const now = new Date();
      const goalId = proposal.goal_id;

      // --- recurring tasks -------------------------------------------------
      for (const t of plan.taskInserts) {
        await tx.insert(recurring_tasks, { goal_id: goalId, ...t });
      }
      for (const u of plan.taskUpdates) {
        const updated = await tx.update(recurring_tasks, {
          set: { ...u.set, updated_at: now },
          where: and(
            eq(recurring_tasks.id, u.id),
            eq(recurring_tasks.goal_id, goalId),
          ),
        });
        if (updated.length === 0) {
          throw new Error("task vanished mid-apply — commit aborted");
        }
      }
      for (const id of plan.taskDeactivates) {
        const updated = await tx.update(recurring_tasks, {
          set: { active: false, updated_at: now },
          where: and(
            eq(recurring_tasks.id, id),
            eq(recurring_tasks.goal_id, goalId),
          ),
        });
        if (updated.length === 0) {
          throw new Error("task vanished mid-apply — commit aborted");
        }
      }

      // --- milestones (adds/modifies now; removes LAST) --------------------
      for (const m of plan.milestoneInserts) {
        await tx.insert(milestones, { goal_id: goalId, ...m });
      }
      for (const u of plan.milestoneUpdates) {
        const updated = await tx.update(milestones, {
          set: { ...u.set, updated_at: now },
          where: and(
            eq(milestones.id, u.id),
            eq(milestones.goal_id, goalId),
          ),
        });
        if (updated.length === 0) {
          throw new Error("milestone vanished mid-apply — commit aborted");
        }
      }

      // --- equipment --------------------------------------------------------
      for (const e of plan.equipmentInserts) {
        await tx.insert(equipment, {
          goal_id: goalId,
          title: e.title,
          cost_usd: e.cost_usd !== null ? String(e.cost_usd) : null,
          milestone_id: e.milestone_id,
          standalone_deadline: e.standalone_deadline,
        });
      }
      for (const u of plan.equipmentUpdates) {
        // cost_usd is a numeric(10,2) column — drizzle wants string | null.
        const { cost_usd, ...rest } = u.set;
        const updated = await tx.update(equipment, {
          set: {
            ...rest,
            ...(cost_usd !== undefined
              ? { cost_usd: cost_usd !== null ? String(cost_usd) : null }
              : {}),
            updated_at: now,
          },
          where: and(eq(equipment.id, u.id), eq(equipment.goal_id, goalId)),
        });
        if (updated.length === 0) {
          throw new Error("equipment vanished mid-apply — commit aborted");
        }
      }
      for (const r of plan.equipmentRehomes) {
        const updated = await tx.update(equipment, {
          set: {
            milestone_id: null,
            standalone_deadline: r.standalone_deadline,
            updated_at: now,
          },
          where: and(eq(equipment.id, r.id), eq(equipment.goal_id, goalId)),
        });
        if (updated.length === 0) {
          throw new Error("equipment vanished mid-apply — commit aborted");
        }
      }
      for (const id of plan.equipmentRemoves) {
        const deleted = await tx.delete(equipment, {
          where: and(eq(equipment.id, id), eq(equipment.goal_id, goalId)),
        });
        if (deleted.length === 0) {
          throw new Error("equipment vanished mid-apply — commit aborted");
        }
      }

      // --- milestone removes LAST (linked equipment already re-homed) ------
      for (const id of plan.milestoneRemoves) {
        const deleted = await tx.delete(milestones, {
          where: and(eq(milestones.id, id), eq(milestones.goal_id, goalId)),
        });
        if (deleted.length === 0) {
          throw new Error("milestone vanished mid-apply — commit aborted");
        }
      }

      // --- decide -----------------------------------------------------------
      // WHERE pins still-pending: under the lock this can't race, but a
      // zero-row update would mean it did — abort everything.
      const decided = await tx.update(replan_proposals, {
        set: { status: plan.status, decided_at: now, updated_at: now },
        where: and(
          eq(replan_proposals.id, proposalId),
          eq(replan_proposals.status, "pending"),
        ),
      });
      if (decided.length === 0) {
        throw new Error("proposal no longer pending — commit aborted");
      }

      return {
        kind: "ok",
        goalId,
        status: plan.status,
        acceptCount: plan.acceptCount,
        rejectCount: plan.rejectCount,
        fireFirst: priorAccepted === 0 && plan.status !== "rejected",
      };
    });
  } catch {
    // ScopedDbError (soft-deleted user, failed ownership proof), a mid-apply
    // vanish, or transport failure — the transaction rolled back; nothing
    // was written.
    return { ok: false, error: ERR_SAVE };
  }

  if (outcome.kind === "not_found") return { ok: false, error: ERR_NOT_FOUND };
  if (outcome.kind === "decided") return { ok: false, error: ERR_DECIDED };
  if (outcome.kind === "goal_not_active") {
    return { ok: false, error: ERR_GOAL_NOT_ACTIVE };
  }
  if (outcome.kind === "not_generated") {
    return { ok: false, error: ERR_NOT_GENERATED };
  }
  if (outcome.kind === "plan_failure") {
    return { ok: false, error: outcome.error };
  }

  // PostHog after commit (planning doc verbatim). A first-ever partial fires
  // BOTH first_replan_accepted and replan_partially_accepted.
  if (outcome.fireFirst) {
    await capture(userId, "first_replan_accepted", {
      goal_id: outcome.goalId,
      accept_count: outcome.acceptCount,
      reject_count: outcome.rejectCount,
    });
  }
  if (outcome.status === "rejected") {
    await capture(userId, "replan_rejected", { goal_id: outcome.goalId });
  }
  if (outcome.status === "partially_accepted") {
    await capture(userId, "replan_partially_accepted", {
      goal_id: outcome.goalId,
      accept_count: outcome.acceptCount,
      reject_count: outcome.rejectCount,
    });
  }

  // The applied changes render on the goal detail and the dashboard buckets;
  // this page flips to the decided summary.
  revalidatePath(`/goals/${outcome.goalId}`);
  revalidatePath("/dashboard");
  revalidatePath(`/replan/${outcome.goalId}`);
  return { ok: true };
}
