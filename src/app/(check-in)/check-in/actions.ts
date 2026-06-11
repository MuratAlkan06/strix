/**
 * actions.ts — the weekly check-in write surface (phase-2-close-the-loop
 * "Weekly check-in UI"). Both actions hold the full guard line, all
 * zero-write on failure:
 *
 *   - Clerk auth before any DB access.
 *   - zod input validation FIRST (feeling ∈ too_easy|right|too_hard —
 *     'skipped' is NOT submittable here, it belongs to skipCheckIn; notes
 *     trimmed, ≤2000, empty→null; selectedGoalIds are uuids) before any DB
 *     access.
 *   - Ownership via scopedDb throughout; replan_proposals inserts ride the
 *     atomic transitive ownership proof.
 *
 * UPSERT WITHOUT ON CONFLICT: scopedDb deliberately has no onConflict
 * surface, so the upsert is a check-then-write INSIDE one transaction
 * serialized by tx.lockScope("weekly-check-in") — the per-user advisory
 * lock makes concurrent submits/skips queue rather than race the unique
 * (user_id, week_start_date) index. Updates set updated_at (repo precedent).
 *
 * FREE CAP RE-CHECK (SPEC §10): the client disables checkboxes beyond the
 * remaining quota, but the server re-derives remaining from the current
 * month's usage_counters inside the same transaction and refuses the whole
 * submission when newly-selected exceeds it — no silent skip, no partial
 * write. Already-proposed goals (a proposal linked to THIS week's check-in)
 * cost nothing; zero selections is a valid check-in (SPEC §10: check-ins
 * always work).
 *
 * PROPOSALS: one replan_proposals row per NEWLY-selected goal, status
 * 'pending', proposed_changes = EMPTY_REPLAN_DIFF — the placeholder until
 * the replan-consumer slice generates real diffs. Re-submission triggers
 * proposals only for goals not already proposed this week.
 *
 * PostHog: first_weekly_check_in_completed fires on the user's first
 * NON-SKIPPED check-in — gated on the PRE-write count of non-skipped rows
 * (read inside the same transaction), so upserts can never re-fire it. This
 * differs from check-task's first_task_checked (count == 1 AFTER insert)
 * because an UPDATE doesn't change the count: the pre-write read is the only
 * exact gate for an upsert. A skip never fires analytics.
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { revalidatePath } from "next/cache";
import { eq, ne } from "drizzle-orm";
import { z } from "zod";

import { scopedDb, type ScopedTx } from "@/db/scoped";
import {
  goals,
  replan_proposals,
  usage_counters,
  weekly_check_ins,
} from "@/db/schema";
import { capture } from "@/lib/analytics/server";
import { EMPTY_REPLAN_DIFF } from "@/lib/ai/replan-diff";
import {
  CHECK_IN_FEELINGS,
  capMessage,
  isFirstCheckInEvent,
  monthStartFor,
  newlySelectedGoalIds,
  remainingReplans,
  weekStartFor,
  type CheckInActionResult,
  type WeeklyFeeling,
} from "./check-in-model";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERR_SESSION = "Your session expired. Sign in to continue.";
const ERR_INVALID = "Some details need attention before saving.";
const ERR_NOT_FOUND = "We couldn't find one of those goals.";
const ERR_SAVE = "That didn't save. Try once more.";

const submitSchema = z.object({
  feeling: z.enum(CHECK_IN_FEELINGS),
  notes: z.string().trim().max(2000).nullish(),
  selectedGoalIds: z.array(z.string().regex(UUID_RE)),
});

/**
 * Shared upsert: insert this week's row or update the existing one (the
 * advisory lock the caller holds makes the check-then-write race-free).
 * Returns the row id. Runs INSIDE the caller's transaction binding.
 */
async function upsertWeekRow(
  tx: ScopedTx,
  userId: string,
  weekStart: string,
  feeling: WeeklyFeeling,
  notes: string | null,
): Promise<string> {
  const existingRows = await tx.selectFrom(weekly_check_ins, {
    where: eq(weekly_check_ins.week_start_date, weekStart),
  });
  const existing = existingRows[0] ?? null;
  if (existing) {
    const updated = await tx.update(weekly_check_ins, {
      set: { feeling, notes, updated_at: new Date() },
      where: eq(weekly_check_ins.id, existing.id),
    });
    if (updated.length === 0) {
      // Vanished mid-transaction — roll everything back.
      throw new Error("check-in row no longer exists — write aborted");
    }
    return existing.id;
  }
  const inserted = await tx.insert(weekly_check_ins, {
    user_id: userId,
    week_start_date: weekStart,
    feeling,
    notes,
  });
  return inserted[0]!.id;
}

export async function submitCheckIn(input: {
  feeling: string;
  notes: string;
  selectedGoalIds: string[];
}): Promise<CheckInActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const parsed = submitSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: ERR_INVALID };
  const feeling = parsed.data.feeling;
  const notes = parsed.data.notes ? parsed.data.notes : null;
  // Deduplicate defensively — a doubled id must not insert two proposals.
  const selectedIds = [...new Set(parsed.data.selectedGoalIds)];

  const sdb = scopedDb(userId);
  type Outcome =
    | { kind: "ok"; fireFirstEvent: boolean }
    | { kind: "not_found" }
    | { kind: "cap"; replansUsed: number };
  let outcome: Outcome;
  try {
    // Week + usage month on the USER's calendar (users.timezone, UTC
    // fallback) — a Friday-night submit east of UTC must not land on next
    // week because the server runs in UTC.
    const self = await sdb.getSelf();
    if (!self) return { ok: false, error: ERR_SESSION };
    const weekStart = weekStartFor(self.timezone);
    const monthStart = monthStartFor(self.timezone);

    outcome = await sdb.transaction(async (tx): Promise<Outcome> => {
      // Serialize concurrent same-user submits/skips: the unique
      // (user_id, week_start_date) index stays conflict-free because every
      // check-then-write for this user queues behind this lock.
      await tx.lockScope("weekly-check-in");

      // Selected goals must be the user's ACTIVE goals — a foreign id is
      // already unreachable through scopedDb, but an archived/completed own
      // goal must not silently re-enter the replan loop either.
      const activeGoals = await tx.selectFrom(goals, {
        where: eq(goals.status, "active"),
      });
      const activeIds = new Set(activeGoals.map((g) => g.id));
      if (!selectedIds.every((id) => activeIds.has(id))) {
        return { kind: "not_found" };
      }

      const existingRows = await tx.selectFrom(weekly_check_ins, {
        where: eq(weekly_check_ins.week_start_date, weekStart),
      });
      const existing = existingRows[0] ?? null;
      const proposed = existing
        ? await tx.selectFrom(replan_proposals, {
            where: eq(replan_proposals.weekly_check_in_id, existing.id),
          })
        : [];
      const newIds = newlySelectedGoalIds(
        selectedIds,
        proposed.map((p) => p.goal_id),
      );

      // Server-side cap re-check (Free): refuse the WHOLE submission when
      // newly-selected exceeds the remaining monthly quota — never a silent
      // partial write. Pro/Max are uncapped (no counters read needed).
      if (self.tier === "free" && newIds.length > 0) {
        const counters = await tx.selectFrom(usage_counters, {
          where: eq(usage_counters.period_start, monthStart),
        });
        const replansUsed = counters[0]?.replans_used ?? 0;
        if (newIds.length > remainingReplans(self.tier, replansUsed)) {
          return { kind: "cap", replansUsed };
        }
      }

      // First-event gate on the PRE-write count (see header).
      const preNonSkipped = await tx.count(weekly_check_ins, {
        where: ne(weekly_check_ins.feeling, "skipped"),
      });

      const checkInId = await upsertWeekRow(
        tx,
        userId,
        weekStart,
        feeling,
        notes,
      );

      for (const goalId of newIds) {
        await tx.insert(replan_proposals, {
          goal_id: goalId,
          user_id: userId,
          trigger: "weekly_check_in",
          weekly_check_in_id: checkInId,
          proposed_changes: EMPTY_REPLAN_DIFF,
          status: "pending",
        });
      }

      return {
        kind: "ok",
        fireFirstEvent: isFirstCheckInEvent(preNonSkipped, feeling),
      };
    });
  } catch {
    // ScopedDbError (soft-deleted user, foreign goal) or transport failure —
    // the transaction rolled back; nothing was written.
    return { ok: false, error: ERR_SAVE };
  }

  if (outcome.kind === "not_found") return { ok: false, error: ERR_NOT_FOUND };
  if (outcome.kind === "cap") {
    return { ok: false, error: capMessage(outcome.replansUsed) };
  }

  if (outcome.fireFirstEvent) {
    await capture(userId, "first_weekly_check_in_completed", {
      feeling,
      goals_selected_count: selectedIds.length,
    });
  }

  revalidatePath("/check-in");
  return { ok: true };
}

/**
 * "Skip this week": the same lock + upsert with { feeling: 'skipped',
 * notes: null } — the row exists so the Friday prompt knows the week is
 * handled and a later real submission upserts over it cleanly. NO replan
 * proposals, NO analytics (a skip is not funnel completion).
 */
export async function skipCheckIn(): Promise<CheckInActionResult> {
  const { userId } = await auth();
  if (!userId) return { ok: false, error: ERR_SESSION };

  const sdb = scopedDb(userId);
  try {
    const self = await sdb.getSelf();
    if (!self) return { ok: false, error: ERR_SESSION };
    const weekStart = weekStartFor(self.timezone);

    await sdb.transaction(async (tx) => {
      await tx.lockScope("weekly-check-in");
      await upsertWeekRow(tx, userId, weekStart, "skipped", null);
    });
  } catch {
    return { ok: false, error: ERR_SAVE };
  }

  revalidatePath("/check-in");
  return { ok: true };
}
