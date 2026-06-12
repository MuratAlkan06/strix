/**
 * check-in-model.ts — the pure view-model behind the weekly check-in
 * (phase-2-close-the-loop "Weekly check-in UI"). No DB, no React: the
 * /check-in page feeds it scopedDb rows; /playground/check-in feeds it
 * fixtures.
 *
 * Decisions encoded here:
 *   - WEEK/MONTH boundaries are the USER's calendar (users.timezone, UTC
 *     fallback): week_start_date is the Sunday of the user's current week
 *     (the dashboard's weekStartOf convention, 0 = Sunday); the usage period
 *     is the calendar 1st of the user's current month (SPEC §10 reset
 *     semantics, usage_counters.period_start).
 *   - FREE CAP (SPEC §10): Free gets FREE_MONTHLY_REPLAN_LIMIT (2) replans a
 *     month; remaining = max(0, limit − replans_used). Pro/Max → Infinity.
 *     The cap limits how many goals may trigger a NEW replan proposal — the
 *     check-in itself always works, and ZERO selections is a valid submit.
 *   - DYNAMIC COUNT CAP: every goal stays selectable until the count of
 *     newly-selected goals reaches `remaining`; from there the still-
 *     unchecked rows are capacity-disabled (tooltip + upgrade modal on tap).
 *     Unchecking re-enables them — the cap is on the count, not on specific
 *     rows.
 *   - ALREADY-PROPOSED goals (a replan_proposals row linked to THIS week's
 *     check-in) render checked + disabled ("Replan already requested") and
 *     are EXCLUDED from capacity math; newlySelected = selected − proposed.
 *   - DEFAULT SELECTION fills to the cap in display order (Free) / selects
 *     all (Pro/Max) — but only while no REAL (non-skipped) check-in exists
 *     this week. On a revisit of a real check-in, only the already-proposed
 *     goals stay checked: re-submitting an edited note must never silently
 *     queue replans the user didn't pick this time.
 *   - SKIPS are not sentiment: a 'skipped' row never prefills the feeling,
 *     never hides the Skip button, and never counts toward the first-event
 *     analytics gate.
 *   - Display order: started_at ascending (the goals-list convention).
 *
 * Pure and client-safe.
 */
import { todayInTimeZone } from "@/lib/equipment-urgency";
import { FREE_MONTHLY_REPLAN_LIMIT } from "@/lib/limits";
import { weekStartOf } from "../../(dashboard)/dashboard/dashboard-model";

// ---------------------------------------------------------------------------
// Feelings — what a real submission may carry. 'skipped' is written ONLY by
// the skip action and is deliberately NOT submittable here.
// ---------------------------------------------------------------------------

export const CHECK_IN_FEELINGS = ["too_easy", "right", "too_hard"] as const;
export type CheckInFeeling = (typeof CHECK_IN_FEELINGS)[number];
export type WeeklyFeeling = CheckInFeeling | "skipped";

export const FEELING_LABELS: Record<CheckInFeeling, string> = {
  too_easy: "Too easy",
  right: "About right",
  too_hard: "Too hard",
};

// ---------------------------------------------------------------------------
// Input row shapes (structural subsets of the drizzle rows)
// ---------------------------------------------------------------------------

export interface CheckInGoalLike {
  id: string;
  title: string;
  color_index: number;
  started_at?: Date | string | null;
}

export interface CheckInRowLike {
  id: string;
  /** YYYY-MM-DD (drizzle date columns come back as strings). */
  week_start_date: string;
  feeling: WeeklyFeeling;
  notes: string | null;
}

export type UserTier = "free" | "pro" | "max";

// ---------------------------------------------------------------------------
// Date helpers — the user's week and usage month
// ---------------------------------------------------------------------------

/** Sunday (YYYY-MM-DD) of the user's current week in their timezone. */
export function weekStartFor(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  return weekStartOf(todayInTimeZone(timeZone, now));
}

/**
 * Calendar-1st (YYYY-MM-01) of the user's current month in their timezone —
 * the usage_counters.period_start key (SPEC §10: calendar-1st reset in the
 * user's timezone). UTC fallback for a missing/invalid timezone rides on
 * todayInTimeZone.
 */
export function monthStartFor(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): string {
  return `${todayInTimeZone(timeZone, now).slice(0, 7)}-01`;
}

// ---------------------------------------------------------------------------
// Capacity math (SPEC §10)
// ---------------------------------------------------------------------------

/** Replans still available this month: Infinity for Pro/Max, clamped ≥ 0. */
export function remainingReplans(tier: UserTier, replansUsed: number): number {
  if (tier !== "free") return Infinity;
  return Math.max(0, FREE_MONTHLY_REPLAN_LIMIT - replansUsed);
}

/** The capacity-disabled tooltip / server cap-refusal line (X = replans_used). */
export function capMessage(replansUsed: number): string {
  return `You've used ${replansUsed} of ${FREE_MONTHLY_REPLAN_LIMIT} replans this month. Upgrade for unlimited.`;
}

/**
 * The goals a submission would trigger NEW proposals for: selected minus
 * already-proposed, deduplicated, in input order.
 */
export function newlySelectedGoalIds(
  selectedIds: readonly string[],
  alreadyProposedIds: readonly string[],
): string[] {
  const proposed = new Set(alreadyProposedIds);
  return [...new Set(selectedIds)].filter((id) => !proposed.has(id));
}

/**
 * Ids whose checkbox is capacity-disabled under the CURRENT selection: not
 * already proposed, not selected, and the newly-selected count has reached
 * `remaining`. Already-proposed rows are excluded from the count (they cost
 * nothing new) and from the result (they are disabled by their own rule).
 */
export function capacityDisabledIds(
  rows: readonly CheckInGoalRowModel[],
  selectedIds: readonly string[],
  remaining: number,
): Set<string> {
  const out = new Set<string>();
  const selected = new Set(selectedIds);
  const proposed = new Set(rows.filter((r) => r.alreadyProposed).map((r) => r.id));
  const newlySelectedCount = [...selected].filter((id) => !proposed.has(id)).length;
  if (newlySelectedCount < remaining) return out;
  for (const row of rows) {
    if (!row.alreadyProposed && !selected.has(row.id)) out.add(row.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// First-event analytics gate
// ---------------------------------------------------------------------------

/**
 * first_weekly_check_in_completed fires on the user's first NON-SKIPPED
 * check-in. Gated on the PRE-write count of non-skipped rows so an upsert
 * (re-submission) can never re-fire it: pre-count 0 + a real feeling → fire.
 * A skip never fires; a real submission after only-skips still fires
 * (skipped rows don't count).
 */
export function isFirstCheckInEvent(
  preWriteNonSkippedCount: number,
  feeling: WeeklyFeeling,
): boolean {
  return preWriteNonSkippedCount === 0 && feeling !== "skipped";
}

// ---------------------------------------------------------------------------
// The form model
// ---------------------------------------------------------------------------

export interface CheckInGoalRowModel {
  id: string;
  title: string;
  colorIndex: number;
  /** A proposal linked to THIS week's check-in already exists for this goal. */
  alreadyProposed: boolean;
}

export interface CheckInModel {
  /** Active goals in display order (started_at ascending). */
  goalRows: CheckInGoalRowModel[];
  /** Replans still available this month (Infinity for Pro/Max). */
  remaining: number;
  /** Current month's replans_used (drives the tooltip/modal copy). */
  replansUsed: number;
  /** Checked on first render: already-proposed goals plus the default fill. */
  defaultSelectedIds: string[];
  /** Prefill from this week's real row; null for fresh or skipped weeks. */
  initialFeeling: CheckInFeeling | null;
  /** Prefill from this week's real row; empty for fresh or skipped weeks. */
  initialNotes: string;
  /** A real (non-skipped) row exists this week — hides Skip, prefills. */
  hasRealCheckIn: boolean;
  /** A 'skipped' row exists this week — the quiet "you skipped" notice. */
  hasSkippedCheckIn: boolean;
}

function startedAtMs(g: CheckInGoalLike): number {
  if (g.started_at == null) return Number.MAX_SAFE_INTEGER;
  const ms = new Date(g.started_at).getTime();
  return Number.isNaN(ms) ? Number.MAX_SAFE_INTEGER : ms;
}

export function buildCheckInModel(input: {
  /** ACTIVE goals only (the page filters by status). */
  goals: readonly CheckInGoalLike[];
  /** This week's weekly_check_ins row, or null. */
  existing: CheckInRowLike | null;
  /** goal_ids of replan_proposals linked to this week's check-in. */
  alreadyProposedGoalIds: readonly string[];
  tier: UserTier;
  /** Current month's usage_counters.replans_used (0 when no row). */
  replansUsed: number;
}): CheckInModel {
  const proposed = new Set(input.alreadyProposedGoalIds);
  const goalRows = [...input.goals]
    .sort((a, b) => startedAtMs(a) - startedAtMs(b))
    .map(
      (g): CheckInGoalRowModel => ({
        id: g.id,
        title: g.title,
        colorIndex: g.color_index,
        alreadyProposed: proposed.has(g.id),
      }),
    );

  const hasRealCheckIn =
    input.existing !== null && input.existing.feeling !== "skipped";
  const hasSkippedCheckIn = input.existing?.feeling === "skipped";

  const remaining = remainingReplans(input.tier, input.replansUsed);

  // Already-proposed goals are always checked (and disabled in the view).
  // The default FILL — cap-bounded in display order — applies only while no
  // real check-in exists this week (fresh week or skip-only); a resubmission
  // starts from exactly what was already requested.
  const defaultSelectedIds = goalRows
    .filter((r) => r.alreadyProposed)
    .map((r) => r.id);
  if (!hasRealCheckIn) {
    let fillBudget = remaining;
    for (const row of goalRows) {
      if (row.alreadyProposed || fillBudget <= 0) continue;
      defaultSelectedIds.push(row.id);
      fillBudget -= 1;
    }
  }

  return {
    goalRows,
    remaining,
    replansUsed: input.replansUsed,
    defaultSelectedIds,
    initialFeeling: hasRealCheckIn
      ? (input.existing!.feeling as CheckInFeeling)
      : null,
    initialNotes: hasRealCheckIn ? (input.existing!.notes ?? "") : "",
    hasRealCheckIn,
    hasSkippedCheckIn,
  };
}

// ---------------------------------------------------------------------------
// Action handler contracts (the real server actions in product, local no-ops
// in the playground harness — the dashboard-model posture).
// ---------------------------------------------------------------------------

/** One replan_proposals row a submission just created — what the
 *  confirmation needs to fire POST /api/ai/replan per goal and link each
 *  diff page (/replan/<goalId>). */
export interface CreatedReplanProposal {
  proposalId: string;
  goalId: string;
  weeklyCheckInId: string;
}

/** `createdProposals` rides only on submitCheckIn (skip never creates any);
 *  absent means none were created this submission. */
export type CheckInActionResult =
  | { ok: true; createdProposals?: CreatedReplanProposal[] }
  | { ok: false; error: string };

export type SubmitCheckInHandler = (input: {
  feeling: CheckInFeeling;
  notes: string;
  selectedGoalIds: string[];
}) => Promise<CheckInActionResult>;

export type SkipCheckInHandler = () => Promise<CheckInActionResult>;
