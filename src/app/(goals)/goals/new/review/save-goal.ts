/**
 * save-goal.ts — the "Save goal" server action behind the draft-plan review
 * screen (phase-1-golden-path "Draft-plan review/edit UI" commit step).
 *
 * Nothing saves silently: this action is the ONLY path that turns a goal
 * draft into real rows, and it is all-or-nothing — one scopedDb transaction
 * creates the goals row (color assigned per the Phase 1 algorithm), the
 * intake_summaries row (goal_id FK populated HERE, suggested + confirmed
 * intensity, merged safety_flags, raw transcript), the recurring_tasks
 * (daily + weekly), the milestones (positions normalized sequentially), and
 * the equipment (milestone_position resolved to milestone row ids; the
 * exactly-one invariant re-validated server-side via the same zod schema the
 * generator used) — then deletes the goal_drafts row. Any failure rolls the
 * whole thing back and the draft persists.
 *
 * goals.intensity_override is NOT set at creation (phase doc: written only on
 * explicit change in goal detail — the intake confirmed_intensity carries the
 * goal's effective intensity until then).
 *
 * Guards before any write: Clerk auth, the HttpOnly draft cookie (never
 * client input), a draft with a plan AND a confirmed intake, the edited plan
 * re-validated with planDraftSchema (weekday bounds, exactly-one, dangling
 * references), and the active-goal cap (5, hardcoded Phase 1) re-checked
 * INSIDE the transaction.
 *
 * PostHog (after commit): plan_accepted { goal_id, edits_count }; and
 * first_goal_created { goal_id, color_index, activity_type } when this is the
 * user's first goal. On success the draft cookie is cleared and the action
 * redirects to /goals.
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { scopedDb } from "@/db/scoped";
import {
  equipment,
  goals,
  goal_drafts,
  intake_summaries,
  milestones,
  recurring_tasks,
} from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
import { planDraftSchema } from "@/lib/ai/plan-schema";
import { submitIntakeSchema, INTENSITY_LEVELS } from "@/lib/ai/intake-schema";
import {
  asEventLog,
  mergeSafetyFlags,
  stagedFlags,
  type SafetyFlagRecord,
} from "@/lib/ai/safety-flags";
import { ACTIVE_GOAL_CAP, pickColorIndex } from "@/lib/goal-colors";
import { capture } from "@/lib/analytics/server";
import { normalizePlanForSave } from "./review-plan";

export type SaveGoalResult = { ok: true } | { ok: false; error: string };

export interface SaveGoalInput {
  /** The edited plan in the plan-draft wire shape (re-validated here). */
  plan: unknown;
  /** Client-tracked count of user modifications (plan_accepted analytics). */
  editsCount: number;
}

/** A confirmed intake: the staged summary plus the user's explicit pick. */
const confirmedIntakeSchema = submitIntakeSchema.extend({
  confirmed_intensity: z.enum(INTENSITY_LEVELS),
});

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const CAP_MESSAGE =
  "Five goals are already in motion — the most that can run at once. " +
  "Complete one before starting another.";

export async function saveGoal(input: SaveGoalInput): Promise<SaveGoalResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "Your session expired. Sign in to continue." };
  }

  const token = (await cookies()).get(DRAFT_COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, error: "We couldn't find your goal draft." };
  }

  const sdb = scopedDb(userId);
  const rows = await sdb.selectFrom(goal_drafts, {
    where: eq(goal_drafts.session_token, token),
  });
  const draft = rows[0];
  if (!draft) {
    return { ok: false, error: "We couldn't find your goal draft." };
  }
  if (draft.plan_draft == null) {
    return { ok: false, error: "There's no plan to save yet." };
  }

  const intake = confirmedIntakeSchema.safeParse(draft.intake_summary_draft);
  if (!intake.success) {
    return { ok: false, error: "Intake isn't finished yet." };
  }

  // Server-side re-validation of the edited plan: weekday bounds 0–6, the
  // equipment exactly-one invariant, milestone-reference resolution — the
  // same gate the generator's output passed.
  const plan = planDraftSchema.safeParse(input.plan);
  if (!plan.success) {
    return { ok: false, error: "Some items need attention before saving." };
  }

  const editsCount =
    Number.isInteger(input.editsCount) && input.editsCount >= 0
      ? input.editsCount
      : 0;

  const normalized = normalizePlanForSave(plan.data);

  // Decisions live in the draft's event log (the cards the user actually
  // saw); model-listed flags merge in with decision fields nulled.
  const mergedSafetyFlags = mergeSafetyFlags(
    stagedFlags(asEventLog(draft.raw_transcript)),
    intake.data.safety_flags as SafetyFlagRecord[],
  );

  const goalTargetDate =
    intake.data.target_date && ISO_DATE_RE.test(intake.data.target_date)
      ? intake.data.target_date
      : null;

  let saved: { goalId: string; colorIndex: number; totalGoals: number };
  try {
    const outcome = await sdb.transaction(async (tx) => {
      // Active-goal cap re-checked inside the transaction (Phase 1: hardcoded
      // 5 — the cap is what keeps the 5-color palette from running out).
      const activeGoals = await tx.selectFrom(goals, {
        where: eq(goals.status, "active"),
      });
      if (activeGoals.length >= ACTIVE_GOAL_CAP) {
        return { capped: true as const };
      }
      const colorIndex = pickColorIndex(
        activeGoals.map((g) => g.color_index),
      );

      const insertedGoals = await tx.insert(goals, {
        user_id: userId,
        title: intake.data.one_sentence_goal,
        status: "active",
        color_index: colorIndex,
        target_date: goalTargetDate,
        started_at: new Date(),
      });
      const goal = insertedGoals[0]!;

      // FK populated here, not before (the schema's nullable-goal_id design).
      await tx.insert(intake_summaries, {
        goal_id: goal.id,
        one_sentence_goal: intake.data.one_sentence_goal,
        starting_point: intake.data.starting_point,
        prior_experience: intake.data.prior_experience ?? null,
        suggested_intensity: intake.data.suggested_intensity,
        confirmed_intensity: intake.data.confirmed_intensity,
        days_per_week: intake.data.days_per_week ?? null,
        time_per_session_min: intake.data.time_per_session_min ?? null,
        budget_usd:
          intake.data.budget_usd != null ? String(intake.data.budget_usd) : null,
        location_city: intake.data.location_city ?? null,
        location_region: intake.data.location_region ?? null,
        location_country: intake.data.location_country ?? null,
        activity_type: intake.data.activity_type,
        activity_type_other_label: intake.data.activity_type_other_label ?? null,
        safety_flags: mergedSafetyFlags,
        raw_transcript: draft.raw_transcript,
      });

      for (const d of normalized.daily) {
        await tx.insert(recurring_tasks, {
          goal_id: goal.id,
          title: d.title,
          cadence: "daily",
          estimated_duration_min: d.estimated_duration_min,
        });
      }
      for (const w of normalized.weekly) {
        await tx.insert(recurring_tasks, {
          goal_id: goal.id,
          title: w.title,
          cadence: "weekly",
          weekday: w.weekday,
          estimated_duration_min: w.estimated_duration_min,
        });
      }

      const milestoneIds: string[] = [];
      for (const m of normalized.milestones) {
        const inserted = await tx.insert(milestones, {
          goal_id: goal.id,
          title: m.title,
          target_date: m.target_date,
          position: m.position,
        });
        milestoneIds.push(inserted[0]!.id);
      }

      for (const e of normalized.equipment) {
        await tx.insert(equipment, {
          goal_id: goal.id,
          title: e.title,
          cost_usd: e.cost_usd != null ? String(e.cost_usd) : null,
          milestone_id:
            e.milestoneIndex !== null ? milestoneIds[e.milestoneIndex]! : null,
          standalone_deadline:
            e.milestoneIndex === null ? e.standalone_deadline : null,
        });
      }

      // Deleting zero rows means the draft vanished mid-save (a concurrent
      // save already committed it) — throw so THIS transaction rolls back
      // rather than minting a duplicate goal.
      const deleted = await tx.delete(goal_drafts, {
        where: eq(goal_drafts.id, draft.id),
      });
      if (deleted.length === 0) {
        throw new Error("goal draft no longer exists — save aborted");
      }

      const totalGoals = await tx.count(goals);
      return { capped: false as const, goalId: goal.id, colorIndex, totalGoals };
    });

    if (outcome.capped) {
      return { ok: false, error: CAP_MESSAGE };
    }
    saved = outcome;
  } catch {
    return { ok: false, error: "That didn't save. Try once more." };
  }

  await capture(userId, "plan_accepted", {
    goal_id: saved.goalId,
    edits_count: editsCount,
  });
  if (saved.totalGoals === 1) {
    await capture(userId, "first_goal_created", {
      goal_id: saved.goalId,
      color_index: saved.colorIndex,
      activity_type: intake.data.activity_type,
    });
  }

  // The draft row is gone; clear its cookie so the next /goals/new starts
  // clean instead of falling through the stale-token path.
  (await cookies()).delete(DRAFT_COOKIE_NAME);

  // Interim 404 until Slice 8 builds the goals list — the route path is the
  // contract; redirect() must stay OUTSIDE the try/catch above.
  redirect("/goals");
}
