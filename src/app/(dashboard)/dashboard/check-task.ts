/**
 * check-task.ts — the dashboard check-off write (phase-1-golden-path
 * "Dashboard (active state)" task check-off). The most security-sensitive
 * write of the phase, so the full guard line, all zero-write on failure:
 *
 *   - Clerk auth before any DB access.
 *   - Malformed (non-uuid) task id rejected before any DB access.
 *   - Ownership: the insert goes through scopedDb's task_completions path —
 *     the EXISTING single atomic INSERT … SELECT (src/db/scoped.ts) whose
 *     SELECT proves, in the same statement, that the recurring task belongs
 *     to a goal owned by the requesting LIVE user, and derives goal_id
 *     server-side from the task's parent. A forged or foreign id produces
 *     zero rows and throws ScopedDbError — nothing written. NOT reimplemented
 *     here; this action only supplies { recurring_task_id, for_date }.
 *   - for_date is today on the USER's calendar (users.timezone, UTC
 *     fallback) — never the server's day.
 *
 * Double-completion: the unique (recurring_task_id, for_date) index rejects a
 * second insert with a Postgres 23505. That conflict can ONLY fire for a row
 * the ownership proof admitted (a foreign id dies as zero-rows BEFORE any
 * conflict is possible), so it is safe to surface as a calm already-done
 * no-op rather than an error.
 *
 * Un-check: the phase doc specifies no un-completion path — Phase 1 is
 * check-only; there is deliberately no delete here.
 *
 * PostHog: first_task_checked { task_id, goal_id } ONLY when this insert is
 * the user's first-ever task_completions row — count == 1 read inside the
 * SAME transaction as the insert, so the gate is exact.
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";

import { scopedDb } from "@/db/scoped";
import { task_completions } from "@/db/schema";
import { todayInTimeZone } from "@/lib/equipment-urgency";
import { capture } from "@/lib/analytics/server";
import type { CompleteTaskResult } from "./dashboard-model";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERR_SESSION = "Your session expired. Sign in to continue.";
const ERR_NOT_FOUND = "We couldn't find that task.";
const ERR_SAVE = "That didn't save. Try once more.";

/**
 * True for a Postgres unique-constraint violation (23505), wherever the
 * driver/ORM left the code — on the error itself or nested in `cause`.
 */
function isUniqueViolation(err: unknown, depth = 0): boolean {
  if (depth > 3 || typeof err !== "object" || err === null) return false;
  const e = err as { code?: unknown; cause?: unknown; message?: unknown };
  if (e.code === "23505") return true;
  if (
    typeof e.message === "string" &&
    e.message.includes("task_completions_task_for_date_uniq")
  ) {
    return true;
  }
  return isUniqueViolation(e.cause, depth + 1);
}

export async function completeTask(input: {
  taskId: string;
}): Promise<CompleteTaskResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const taskId = typeof input?.taskId === "string" ? input.taskId : "";
  if (!UUID_RE.test(taskId)) return { ok: false, error: ERR_NOT_FOUND };

  const sdb = scopedDb(userId);
  let goalId: string;
  let isFirstEver: boolean;
  try {
    // The user's calendar day — a check at 23:30 in Lisbon must not land on
    // tomorrow's date because the server runs in UTC.
    const self = await sdb.getSelf();
    const forDate = todayInTimeZone(self?.timezone);

    // Insert + first-ever count in ONE transaction so the analytics gate is
    // exact (count == 1 ⇔ the row just inserted is the user's first ever).
    const outcome = await sdb.transaction(async (tx) => {
      // goal_id and user_id are deliberately NOT supplied: scopedDb's
      // task_completions path derives goal_id from the task's parent goal
      // inside the atomic ownership proof and pins user_id to the scoped
      // user — the cast only relaxes the $inferInsert requirement for the
      // two columns that path owns.
      const inserted = await tx.insert(task_completions, {
        recurring_task_id: taskId,
        for_date: forDate,
      } as typeof task_completions.$inferInsert);
      const total = await tx.count(task_completions);
      return { goalId: inserted[0]!.goal_id, isFirstEver: total === 1 };
    });
    goalId = outcome.goalId;
    isFirstEver = outcome.isFirstEver;
  } catch (err) {
    if (isUniqueViolation(err)) {
      // Already checked for this date (double-tap, second tab). The conflict
      // can only fire for an OWNED task — a forged id fails the ownership
      // proof as zero rows before any conflict exists. Calm no-op.
      revalidatePath("/dashboard");
      return { ok: true, alreadyDone: true };
    }
    // ScopedDbError (forged/foreign id, soft-deleted user) or transport
    // failure — nothing was written. Foreign and nonexistent ids are
    // indistinguishable by design.
    return { ok: false, error: ERR_SAVE };
  }

  if (isFirstEver) {
    await capture(userId, "first_task_checked", {
      task_id: taskId,
      goal_id: goalId,
    });
  }

  revalidatePath("/dashboard");
  return { ok: true, alreadyDone: false };
}
