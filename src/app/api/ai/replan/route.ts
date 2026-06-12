/**
 * POST /api/ai/replan — non-streaming replan generation
 * (phase-2-close-the-loop "Replan flow").
 *
 * Body: { goal_id: uuid, trigger: 'weekly_check_in' | 'structural_edit',
 *         weekly_check_in_id?: uuid, structural_change?: { summary: 1..500 } }
 * with trigger-conditional requirements — each trigger REQUIRES its payload
 * and rejects the other's.
 *
 * Flow:
 *   1. Clerk auth → userId (never from body/params).
 *   2. zod body validation FIRST — before any DB access.
 *   3. Goal must be OWNED and status='active', read through the scoped DB
 *      surface — a foreign or archived goal 404s with a constant string.
 *   4. Fill-vs-create (the frozen Slice-2 contract):
 *      - weekly_check_in: the triggering check-in row loads through the same
 *        scoped surface; its feeling/notes are the trigger payload, and a
 *        'skipped' row is refused — skips are not sentiment data. If a
 *        proposal row exists for (goal_id, weekly_check_in_id): pending →
 *        regenerate and UPDATE its
 *        proposed_changes (regeneration overwrites while pending); decided →
 *        409, row untouched. No row → create one.
 *      - structural_edit: always creates a NEW row (weekly_check_in_id NULL).
 *   5. checkAndIncrement(userId, 'replan') — the Phase-2 stub — is awaited
 *      BEFORE the model call so the endpoint shape is stable when Phase 3
 *      fills in the real quota gate.
 *   6. generateReplan() — one cached-prefix Sonnet call, structured output,
 *      zod-validated (src/lib/ai/replan.ts). The user message aggregates the
 *      goal, intake summary, current plan, last-28-days adherence, the
 *      trigger payload, and the resolved intensity
 *      (goals.intensity_override → intake_summaries.confirmed_intensity →
 *      users.intensity_preference).
 *   7. Persist AFTER generation succeeds — a failed generation corrupts
 *      nothing (the pending row keeps its prior diff; the create path writes
 *      no row). The persist runs inside ONE transaction holding the per-user
 *      lockScope("replan") advisory lock (the Slice-1 check-in pattern),
 *      which re-resolves fill-vs-create authoritatively: the proposal can be
 *      decided — or created — during the multi-second model call, so the
 *      pre-generation reads are cheap early rejections only. Generation
 *      stays OUTSIDE the lock so concurrent replans for different goals keep
 *      generating in parallel (the Slice-3 fan-out property); the lock also
 *      closes the duplicate-insert window (replan_proposals has no unique
 *      index on (goal_id, weekly_check_in_id) — index is Phase-3 follow-up).
 *
 * Responses: { ok: true, proposal_id } on success; 401 unauth; 400 validation
 * (incl. a 'skipped' triggering check-in); 404 goal/check-in not found; 409
 * decided-proposal regeneration; 502 model output failed ReplanDiffSchema
 * (raw response logged server-side via logAiError); 503 no client configured.
 * Clients only ever see constant strings.
 *
 * All AI access goes through src/lib/ai/* — never @anthropic-ai/sdk directly.
 */
import { auth } from "@clerk/nextjs/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";

import { scopedDb } from "@/db/scoped";
import {
  equipment,
  goals,
  intake_summaries,
  milestones,
  recurring_tasks,
  replan_proposals,
  task_completions,
  weekly_check_ins,
} from "@/db/schema";
import { adherenceWindowStart, aggregateAdherence } from "@/lib/ai/adherence";
import { logAiError } from "@/lib/ai/log";
import {
  generateReplan,
  ReplanUnavailableError,
  resolveIntensity,
  type ReplanTriggerPayload,
} from "@/lib/ai/replan";
import { checkAndIncrement } from "@/lib/limits";
import { todayInTimeZone } from "@/lib/equipment-urgency";

export const dynamic = "force-dynamic";

/**
 * Function-duration bound, seconds (issue #45). Same generation profile as
 * /api/ai/plan — one non-streaming Sonnet call with max_tokens 4096 — plus
 * the post-generation transactional persist under the per-user advisory
 * lock; 90s is roughly 3x tail headroom over the multi-second model call
 * while cutting a hung provider call off long before the 300s default.
 */
export const maxDuration = 90;

const ERR_UNAUTHORIZED = "Unauthorized";
const ERR_INVALID = "Invalid request.";
const ERR_GOAL_NOT_FOUND = "Goal not found.";
const ERR_CHECK_IN_NOT_FOUND = "Check-in not found.";
const ERR_SKIPPED_TRIGGER = "A skipped check-in cannot trigger a replan.";
const ERR_DECIDED = "Replan proposal already decided.";
const ERR_UNAVAILABLE = "AI service unavailable.";
const ERR_FAILED = "Replan generation failed.";

const bodySchema = z
  .object({
    goal_id: z.string().uuid(),
    trigger: z.enum(["weekly_check_in", "structural_edit"]),
    weekly_check_in_id: z.string().uuid().optional(),
    structural_change: z
      .object({ summary: z.string().trim().min(1).max(500) })
      .optional(),
  })
  .superRefine((body, ctx) => {
    if (body.trigger === "weekly_check_in") {
      if (!body.weekly_check_in_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weekly_check_in_id"],
          message: "required when trigger is 'weekly_check_in'",
        });
      }
      if (body.structural_change) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["structural_change"],
          message: "only valid when trigger is 'structural_edit'",
        });
      }
    } else {
      if (!body.structural_change) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["structural_change"],
          message: "required when trigger is 'structural_edit'",
        });
      }
      if (body.weekly_check_in_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["weekly_check_in_id"],
          message: "only valid when trigger is 'weekly_check_in'",
        });
      }
    }
  });

/** The intake fields the prompt reads — never the raw transcript (huge and
 *  already distilled into the summary) and never row plumbing (ids/timestamps). */
function projectIntakeSummary(
  row: typeof intake_summaries.$inferSelect,
): Record<string, unknown> {
  return {
    one_sentence_goal: row.one_sentence_goal,
    starting_point: row.starting_point,
    prior_experience: row.prior_experience,
    confirmed_intensity: row.confirmed_intensity,
    days_per_week: row.days_per_week,
    time_per_session_min: row.time_per_session_min,
    budget_usd: row.budget_usd,
    location_city: row.location_city,
    location_region: row.location_region,
    location_country: row.location_country,
    activity_type: row.activity_type,
    activity_type_other_label: row.activity_type_other_label,
    safety_flags: row.safety_flags,
  };
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response(ERR_UNAUTHORIZED, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return new Response(ERR_INVALID, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return new Response(ERR_INVALID, { status: 400 });
  }
  const body = parsed.data;

  const sdb = scopedDb(userId);
  // Timezone + intensity_preference both live on the users row; a missing/
  // soft-deleted self means the session no longer maps to a live user.
  const self = await sdb.getSelf();
  if (!self) {
    return new Response(ERR_UNAUTHORIZED, { status: 401 });
  }

  // The goal must be the user's own AND active — archived/completed goals do
  // not re-enter the replan loop (the check-in surface enforces the same).
  const goalRows = await sdb.selectFrom(goals, {
    where: and(eq(goals.id, body.goal_id), eq(goals.status, "active")),
  });
  const goal = goalRows[0];
  if (!goal) {
    return new Response(ERR_GOAL_NOT_FOUND, { status: 404 });
  }

  // Resolve the trigger payload BEFORE spending a model call, and reject the
  // already-rejectable cheaply: a decided proposal 409s here with zero AI
  // cost. This read is an early rejection ONLY — the authoritative
  // fill-vs-create resolution happens inside the locked transaction below,
  // because the row can change during the multi-second model call.
  let trigger: ReplanTriggerPayload;
  let checkInId: string | null = null;

  if (body.trigger === "weekly_check_in") {
    const checkInRows = await sdb.selectFrom(weekly_check_ins, {
      where: eq(weekly_check_ins.id, body.weekly_check_in_id!),
    });
    const checkIn = checkInRows[0];
    if (!checkIn) {
      return new Response(ERR_CHECK_IN_NOT_FOUND, { status: 404 });
    }
    // Skips are not sentiment data (DECISIONS): the skip path never creates
    // proposals, so a skipped trigger here is a confused caller — refuse.
    if (checkIn.feeling === "skipped") {
      return new Response(ERR_SKIPPED_TRIGGER, { status: 400 });
    }
    checkInId = checkIn.id;
    trigger = {
      kind: "weekly_check_in",
      feeling: checkIn.feeling,
      notes: checkIn.notes,
    };

    const proposalRows = await sdb.selectFrom(replan_proposals, {
      where: and(
        eq(replan_proposals.goal_id, goal.id),
        eq(replan_proposals.weekly_check_in_id, checkIn.id),
      ),
    });
    const existing = proposalRows[0];
    if (existing && existing.status !== "pending") {
      return new Response(ERR_DECIDED, { status: 409 });
    }
  } else {
    trigger = {
      kind: "structural_edit",
      summary: body.structural_change!.summary,
    };
  }

  // Phase-2 quota stub — awaited BEFORE the model call so the endpoint shape
  // is stable when Phase 3 fills in the real check (zero counter writes now).
  await checkAndIncrement(userId, "replan");

  // ---- Prompt inputs (all scopedDb; the goal is already proven owned) ------
  const today = todayInTimeZone(self.timezone);
  const windowStart = adherenceWindowStart(today);

  const [intakeRows, taskRows, milestoneRows, equipmentRows, completionRows] =
    await Promise.all([
      sdb.selectFrom(intake_summaries, {
        where: eq(intake_summaries.goal_id, goal.id),
      }),
      sdb.selectFrom(recurring_tasks, {
        where: eq(recurring_tasks.goal_id, goal.id),
      }),
      sdb.selectFrom(milestones, { where: eq(milestones.goal_id, goal.id) }),
      sdb.selectFrom(equipment, { where: eq(equipment.goal_id, goal.id) }),
      sdb.selectFrom(task_completions, {
        where: and(
          eq(task_completions.goal_id, goal.id),
          gte(task_completions.for_date, windowStart),
          lte(task_completions.for_date, today),
        ),
      }),
    ]);

  const intake = intakeRows[0] ?? null;
  const intensity = resolveIntensity({
    override: goal.intensity_override,
    intakeSummary: intake
      ? { confirmed_intensity: intake.confirmed_intensity }
      : null,
    userPreference: self.intensity_preference,
  });

  const tasks = taskRows.map((t) => ({
    id: t.id,
    title: t.title,
    cadence: t.cadence,
    weekday: t.weekday,
    estimated_duration_min: t.estimated_duration_min,
    active: t.active,
  }));

  try {
    const diff = await generateReplan({
      goal: {
        title: goal.title,
        description: goal.description,
        target_date: goal.target_date,
      },
      intakeSummary: intake ? projectIntakeSummary(intake) : null,
      recurringTasks: tasks,
      milestones: milestoneRows.map((m) => ({
        id: m.id,
        title: m.title,
        target_date: m.target_date,
        position: m.position,
        completed: m.completed_at !== null,
      })),
      equipment: equipmentRows.map((e) => ({
        id: e.id,
        title: e.title,
        cost_usd: e.cost_usd,
        milestone_id: e.milestone_id,
        standalone_deadline: e.standalone_deadline,
        purchased: e.purchased_at !== null,
      })),
      adherence: aggregateAdherence({
        tasks,
        completions: completionRows,
        today,
      }),
      trigger,
      intensity,
      today,
    });

    // Persist ONLY after a valid diff exists (AC: a failed generation never
    // corrupts the proposal — the pending row keeps its prior diff and the
    // create path writes nothing), and ONLY inside one transaction serialized
    // by the per-user "replan" advisory lock. Generation deliberately ran
    // OUTSIDE the lock: it is a multi-second model call, and holding the lock
    // across it would serialize the parallel multi-goal fan-out Slice 3
    // builds on. The price is that the pre-generation reads are stale by
    // model-latency, so the fill-vs-create target is re-resolved
    // authoritatively HERE, under the lock.
    type PersistOutcome =
      | { kind: "ok"; proposalId: string }
      | { kind: "decided" };
    const outcome = await sdb.transaction(
      async (tx): Promise<PersistOutcome> => {
        await tx.lockScope("replan");

        if (checkInId !== null) {
          // weekly_check_in: re-select the (goal, check-in) proposal under
          // the lock — it may have been created or decided mid-generation.
          const currentRows = await tx.selectFrom(replan_proposals, {
            where: and(
              eq(replan_proposals.goal_id, goal.id),
              eq(replan_proposals.weekly_check_in_id, checkInId),
            ),
          });
          const current = currentRows[0];
          if (current) {
            if (current.status !== "pending") return { kind: "decided" };
            // Belt-and-braces: the WHERE also pins status='pending', so a
            // decision committed between the read above and this statement
            // (READ COMMITTED sees it) updates ZERO rows instead of
            // overwriting a decided row.
            const updated = await tx.update(replan_proposals, {
              set: { proposed_changes: diff, updated_at: new Date() },
              where: and(
                eq(replan_proposals.id, current.id),
                eq(replan_proposals.status, "pending"),
              ),
            });
            // Zero rows ⇔ no longer a pending row (decided, or deleted with
            // its goal) — nothing was written; the decided contract answer
            // (409, row untouched) covers both honestly.
            if (updated.length === 0) return { kind: "decided" };
            return { kind: "ok", proposalId: current.id };
          }
        }

        // First proposal for this trigger (weekly with no row yet, or
        // structural_edit which ALWAYS creates) — the held lock closes the
        // duplicate-insert window: replan_proposals has no unique index on
        // (goal_id, weekly_check_in_id), so concurrent first-time POSTs
        // queue here instead of double-inserting.
        const inserted = await tx.insert(replan_proposals, {
          goal_id: goal.id,
          user_id: userId,
          trigger: body.trigger,
          weekly_check_in_id: checkInId,
          proposed_changes: diff,
          status: "pending",
        });
        return { kind: "ok", proposalId: inserted[0]!.id };
      },
    );

    if (outcome.kind === "decided") {
      return new Response(ERR_DECIDED, { status: 409 });
    }
    return Response.json({ ok: true, proposal_id: outcome.proposalId });
  } catch (err) {
    if (err instanceof ReplanUnavailableError) {
      return new Response(ERR_UNAVAILABLE, { status: 503 });
    }
    // Keep the raw provider/validation error (which carries the raw model
    // response for ReplanValidationError) on the server; the client only
    // ever sees a constant message.
    logAiError("replan", err);
    return new Response(ERR_FAILED, { status: 502 });
  }
}
