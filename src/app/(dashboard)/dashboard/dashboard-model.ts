/**
 * dashboard-model.ts — the pure view-model behind the ACTIVE dashboard
 * (phase-1-golden-path "Dashboard (active state)"). No DB, no React: the
 * /dashboard page feeds it scopedDb rows; /playground/active-dashboard feeds
 * it fixtures with a pinned `today`.
 *
 * Bucketing (all date math on the user's calendar day — `today` is computed
 * upstream via todayInTimeZone(users.timezone)):
 *
 *   TODAY     — daily tasks across all active goals; weekly tasks whose
 *               weekday matches today; milestones/equipment whose deadline is
 *               today. Overdue milestones/equipment ALSO ride here with an
 *               `overdue` flag (the equipment-urgency precedent: the most
 *               urgent item belongs in the nearest bucket with an honest
 *               amber note, never hidden).
 *   THIS WEEK — weekly tasks of the current week whose weekday is still
 *               AHEAD of today (today's weekly task belongs to TODAY; a past
 *               weekday is gone for this week) and not already completed this
 *               week; milestones/equipment due after today through the end of
 *               the week.
 *   UPCOMING  — milestones/equipment due after the current week through
 *               today + 14 days (inclusive boundary, matching the inclusive
 *               7/30-day convention in equipment-urgency.ts).
 *
 * Two further dashboard concerns live here (phase-2-close-the-loop):
 *   ACCOMPLISHED — completed/archived goals as small quiet cards
 *                  (buildAccomplishedCards), the SPEC §6 retention surface.
 *   CHECK-IN PROMPT — the Friday/Saturday banner predicate
 *                  (shouldShowCheckInPrompt).
 *
 * Week convention: weekday 0–6 with 0 = Sunday (the schema/review-UI
 * convention — WEEKDAY_LABELS in review-plan.ts, plan-schema.ts). The week
 * therefore runs Sunday → Saturday containing `today`.
 *
 * Exclusions (honest, not silent): inactive tasks, non-active goals,
 * completed milestones, purchased equipment, equipment with no derivable
 * deadline (the /equipment page owns the "no date yet" story), and items
 * beyond the 14-day horizon.
 *
 * Pure and client-safe.
 */
import { equipmentDeadline } from "@/lib/equipment-deadline";
import { daysUntil } from "@/lib/equipment-urgency";

// ---------------------------------------------------------------------------
// Input row shapes (structural subsets of the drizzle rows)
// ---------------------------------------------------------------------------

export interface DashboardGoalLike {
  id: string;
  title: string;
  status: "active" | "completed" | "archived";
  color_index: number;
}

export interface DashboardTaskLike {
  id: string;
  goal_id: string;
  title: string;
  cadence: "daily" | "weekly";
  weekday: number | null;
  estimated_duration_min: number | null;
  active: boolean;
}

export interface DashboardMilestoneLike {
  id: string;
  goal_id: string;
  title: string;
  target_date: string | null;
  completed_at: Date | string | null;
}

export interface DashboardEquipmentLike {
  id: string;
  goal_id: string;
  title: string;
  milestone_id: string | null;
  standalone_deadline: string | null;
  purchased_at: Date | string | null;
}

export interface CompletionLike {
  recurring_task_id: string;
  /** YYYY-MM-DD (drizzle date columns come back as strings). */
  for_date: string;
}

export interface AccomplishedGoalLike {
  id: string;
  title: string;
  status: "active" | "completed" | "archived";
  color_index: number;
  /** Set by Mark complete; SURVIVES auto-archive (Slice 5 writes only
   *  status + archived_at), so an archived goal usually still carries it. */
  completed_at: Date | string | null;
  archived_at: Date | string | null;
}

// ---------------------------------------------------------------------------
// Output row models
// ---------------------------------------------------------------------------

export interface TaskRowModel {
  kind: "task";
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  goalColorIndex: number;
  cadence: "daily" | "weekly";
  /** 0–6 (0 = Sunday) for weekly tasks; null for daily. */
  weekday: number | null;
  durationMin: number | null;
  /** True when a completion row exists for (task, today) — struck + checked. */
  completedToday: boolean;
}

export interface DueRowModel {
  kind: "milestone" | "equipment";
  id: string;
  title: string;
  goalId: string;
  goalTitle: string;
  goalColorIndex: number;
  /** YYYY-MM-DD derived deadline (milestone target_date / equipment derivation). */
  deadline: string;
  /** Strictly before today — rendered as the amber "was due" note. */
  overdue: boolean;
}

export type DashboardRowModel = TaskRowModel | DueRowModel;

export interface NextMilestoneModel {
  title: string;
  /** YYYY-MM-DD. */
  date: string;
  daysUntil: number;
  goalId: string;
  goalTitle: string;
  goalColorIndex: number;
}

export interface DashboardModel {
  today: DashboardRowModel[];
  /** Checkable task rows in TODAY (the "N of M done" line). */
  todayTaskCount: number;
  todayDoneCount: number;
  thisWeek: DashboardRowModel[];
  upcoming: DueRowModel[];
  /** The hero countdown — earliest incomplete dated milestone STRICTLY ahead
   *  of today (a milestone due today already leads the TODAY section). */
  nextMilestone: NextMilestoneModel | null;
}

// ---------------------------------------------------------------------------
// Date helpers — calendar-date arithmetic in UTC on YYYY-MM-DD strings (the
// equipment-urgency posture: no DST or wall-clock drift).
// ---------------------------------------------------------------------------

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function parseIsoUtc(iso: string): number {
  if (!ISO_DATE_RE.test(iso)) {
    throw new Error(`dashboard-model: expected YYYY-MM-DD, got "${iso}"`);
  }
  return Date.parse(`${iso}T00:00:00Z`);
}

/** Weekday of an ISO date, 0–6 with 0 = Sunday (the schema convention). */
export function weekdayOfIso(iso: string): number {
  return new Date(parseIsoUtc(iso)).getUTCDay();
}

/** ISO date n days from `iso` (n may be negative). */
export function addDays(iso: string, n: number): string {
  return new Date(parseIsoUtc(iso) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Sunday of the week containing `today`. */
export function weekStartOf(today: string): string {
  return addDays(today, -weekdayOfIso(today));
}

/** Saturday of the week containing `today`. */
export function weekEndOf(today: string): string {
  return addDays(today, 6 - weekdayOfIso(today));
}

/** The goal-detail deep link a goal name navigates to. */
export function goalHref(goalId: string): string {
  return `/goals/${goalId}`;
}

// ---------------------------------------------------------------------------
// Display helpers (pure — pinned to en-US/UTC so output never depends on the
// server environment; the playground harness stays deterministic).
// ---------------------------------------------------------------------------

/** "2026-06-10" → "Wednesday, June 10". */
export function dashboardDateLabel(todayIso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(parseIsoUtc(todayIso)));
}

/** Greeting for an hour-of-day (0–23) in the USER's timezone. */
export function greetingForHour(
  hour: number,
  displayName?: string | null,
): string {
  const base =
    hour >= 5 && hour < 12
      ? "Good morning"
      : hour >= 12 && hour < 18
        ? "Good afternoon"
        : "Good evening";
  const name = displayName?.trim();
  return name ? `${base}, ${name}.` : `${base}.`;
}

/** Hour of day (0–23) in an IANA timezone; UTC fallback on bad input. */
export function hourInTimeZone(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): number {
  if (timeZone) {
    try {
      return Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone,
          hour: "numeric",
          hourCycle: "h23",
        }).format(now),
      );
    } catch {
      // Invalid IANA name — fall through to UTC.
    }
  }
  return now.getUTCHours();
}

// ---------------------------------------------------------------------------
// Check-off handler contract (the real server action in product, a local
// no-op in the playground harness — the equipment-model posture).
// ---------------------------------------------------------------------------

export type CompleteTaskResult =
  | { ok: true; alreadyDone: boolean }
  | { ok: false; error: string };

export type CompleteTaskHandler = (input: {
  taskId: string;
}) => Promise<CompleteTaskResult>;

// ---------------------------------------------------------------------------
// The model
// ---------------------------------------------------------------------------

const KIND_ORDER = { task: "0", milestone: "1", equipment: "2" } as const;

/**
 * TODAY ordering: the checkable list stays contiguous (daily tasks, then
 * today's weekly tasks, title-sorted), followed by due rows by deadline —
 * which puts overdue (earlier deadline) ahead of due-today, the most urgent
 * first within the dues.
 */
function todaySortKey(row: DashboardRowModel): string {
  if (row.kind === "task") {
    const cadence = row.cadence === "daily" ? "0" : "1";
    return `0|${cadence}|${row.title}`;
  }
  return `1|${row.deadline}|${KIND_ORDER[row.kind]}|${row.title}`;
}

/**
 * THIS WEEK ordering: chronological — a weekly task sits at its weekday's
 * date, dues at their deadline — so the section reads as a timeline.
 */
function weekSortKey(row: DashboardRowModel, weekStart: string): string {
  const date =
    row.kind === "task"
      ? addDays(weekStart, row.weekday ?? 0)
      : row.deadline;
  return `${date}|${KIND_ORDER[row.kind]}|${row.title}`;
}

export function buildDashboardModel(input: {
  goals: readonly DashboardGoalLike[];
  tasks: readonly DashboardTaskLike[];
  milestones: readonly DashboardMilestoneLike[];
  equipment: readonly DashboardEquipmentLike[];
  /** Completion rows for the CURRENT week (weekStart … today). */
  completions: readonly CompletionLike[];
  /** YYYY-MM-DD in the user's timezone. */
  today: string;
}): DashboardModel {
  const { today } = input;
  const todayWeekday = weekdayOfIso(today);
  const weekStart = weekStartOf(today);
  const weekEnd = weekEndOf(today);
  const horizon = addDays(today, 14);

  const activeGoals = new Map(
    input.goals.filter((g) => g.status === "active").map((g) => [g.id, g]),
  );

  const completedToday = new Set(
    input.completions
      .filter((c) => c.for_date === today)
      .map((c) => c.recurring_task_id),
  );
  // Defensive: completions only ever carry for_date = today-at-check-time, so
  // a FUTURE weekday of this week cannot normally be completed — but if data
  // ever holds one, the row is done, not "remaining".
  const completedThisWeek = new Set(
    input.completions
      .filter((c) => c.for_date >= weekStart && c.for_date <= weekEnd)
      .map((c) => c.recurring_task_id),
  );

  const todayRows: DashboardRowModel[] = [];
  const weekRows: DashboardRowModel[] = [];
  const upcomingRows: DueRowModel[] = [];

  // --- recurring tasks ------------------------------------------------------
  for (const t of input.tasks) {
    const goal = activeGoals.get(t.goal_id);
    if (!goal || !t.active) continue;

    const row: TaskRowModel = {
      kind: "task",
      id: t.id,
      title: t.title,
      goalId: goal.id,
      goalTitle: goal.title,
      goalColorIndex: goal.color_index,
      cadence: t.cadence,
      weekday: t.cadence === "weekly" ? t.weekday : null,
      durationMin: t.estimated_duration_min,
      completedToday: completedToday.has(t.id),
    };

    if (t.cadence === "daily") {
      todayRows.push(row);
      continue;
    }
    if (t.weekday === null) continue; // malformed weekly — never bucketable
    if (t.weekday === todayWeekday) {
      todayRows.push(row);
    } else if (t.weekday > todayWeekday && !completedThisWeek.has(t.id)) {
      weekRows.push(row);
    }
    // weekday < today: that session's day has passed this week — not shown.
  }

  // --- milestones + equipment (due rows) -------------------------------------
  const milestoneById = new Map(input.milestones.map((m) => [m.id, m]));

  const placeDue = (row: DueRowModel) => {
    if (row.deadline <= today) {
      todayRows.push(row); // today, or overdue riding in the nearest bucket
    } else if (row.deadline <= weekEnd) {
      weekRows.push(row);
    } else if (row.deadline <= horizon) {
      upcomingRows.push(row);
    }
    // beyond the 14-day horizon: not a dashboard concern yet.
  };

  for (const m of input.milestones) {
    const goal = activeGoals.get(m.goal_id);
    if (!goal || m.completed_at != null || m.target_date === null) continue;
    placeDue({
      kind: "milestone",
      id: m.id,
      title: m.title,
      goalId: goal.id,
      goalTitle: goal.title,
      goalColorIndex: goal.color_index,
      deadline: m.target_date,
      overdue: m.target_date < today,
    });
  }

  for (const e of input.equipment) {
    const goal = activeGoals.get(e.goal_id);
    if (!goal || e.purchased_at != null) continue;
    // Derive the deadline; a dangling milestone reference degrades to "no
    // derivable date" (the /equipment page owns that honest story) instead of
    // throwing the dashboard over.
    const milestone =
      e.milestone_id !== null
        ? (milestoneById.get(e.milestone_id) ?? null)
        : null;
    const deadline =
      e.milestone_id !== null && milestone === null
        ? null
        : equipmentDeadline(e, milestone);
    if (deadline === null) continue;
    placeDue({
      kind: "equipment",
      id: e.id,
      title: e.title,
      goalId: goal.id,
      goalTitle: goal.title,
      goalColorIndex: goal.color_index,
      deadline,
      overdue: deadline < today,
    });
  }

  // --- hero countdown ---------------------------------------------------------
  let nextMilestone: NextMilestoneModel | null = null;
  for (const m of input.milestones) {
    const goal = activeGoals.get(m.goal_id);
    if (!goal || m.completed_at != null || m.target_date === null) continue;
    if (m.target_date <= today) continue; // today's milestone leads TODAY
    if (
      nextMilestone === null ||
      m.target_date < nextMilestone.date ||
      (m.target_date === nextMilestone.date && m.title < nextMilestone.title)
    ) {
      nextMilestone = {
        title: m.title,
        date: m.target_date,
        daysUntil: daysUntil(m.target_date, today),
        goalId: goal.id,
        goalTitle: goal.title,
        goalColorIndex: goal.color_index,
      };
    }
  }

  const sortedToday = todayRows.sort((a, b) =>
    todaySortKey(a).localeCompare(todaySortKey(b)),
  );
  const todayTasks = sortedToday.filter((r) => r.kind === "task");

  return {
    today: sortedToday,
    todayTaskCount: todayTasks.length,
    todayDoneCount: todayTasks.filter(
      (r) => r.kind === "task" && r.completedToday,
    ).length,
    thisWeek: weekRows.sort((a, b) =>
      weekSortKey(a, weekStart).localeCompare(weekSortKey(b, weekStart)),
    ),
    upcoming: upcomingRows.sort((a, b) =>
      `${a.deadline}|${a.kind}|${a.title}`.localeCompare(
        `${b.deadline}|${b.kind}|${b.title}`,
      ),
    ),
    nextMilestone,
  };
}

// ---------------------------------------------------------------------------
// Accomplished section (phase-2-close-the-loop "Accomplished section on
// dashboard"; SPEC §6 retention surface) — completed/archived goals as small
// quiet cards below Upcoming. Renders once ≥1 exists and never hides again.
// ---------------------------------------------------------------------------

export interface AccomplishedCardModel {
  goalId: string;
  title: string;
  colorIndex: number;
  /** YYYY-MM-DD of the win — completed_at when set, else archived_at (the
   *  honest fallback: future archive paths may never complete the goal);
   *  null when neither exists (render no date, never a fake one). */
  dateIso: string | null;
  /** Which timestamp dateIso came from — drives the honest card label
   *  ("Completed …" vs "Archived …"). */
  dateKind: "completed" | "archived" | null;
}

/** Timestamp (drizzle Date | string) → YYYY-MM-DD, null on bad input. */
function timestampToIsoDate(value: Date | string | null): string | null {
  if (value == null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Completed AND archived goals as accomplished cards, most recent win first
 * (null-dated cards last; title then id tiebreak so fixtures stay stable).
 * Active goals are excluded by construction — the caller may pass any goal
 * rows. Empty result ⇒ the section does not render (the 0 → ≥1 visibility
 * predicate is `cards.length > 0`).
 */
export function buildAccomplishedCards(
  goals: readonly AccomplishedGoalLike[],
): AccomplishedCardModel[] {
  return goals
    .filter((g) => g.status === "completed" || g.status === "archived")
    .map((g): AccomplishedCardModel => {
      const completedOn = timestampToIsoDate(g.completed_at);
      const archivedOn = timestampToIsoDate(g.archived_at);
      return {
        goalId: g.id,
        title: g.title,
        colorIndex: g.color_index,
        dateIso: completedOn ?? archivedOn,
        dateKind:
          completedOn !== null
            ? "completed"
            : archivedOn !== null
              ? "archived"
              : null,
      };
    })
    .sort((a, b) => {
      // Descending by date; undated cards sort last.
      const aKey = a.dateIso ?? "";
      const bKey = b.dateIso ?? "";
      if (aKey !== bKey) return bKey.localeCompare(aKey);
      return a.title.localeCompare(b.title) || a.goalId.localeCompare(b.goalId);
    });
}

// ---------------------------------------------------------------------------
// Friday check-in prompt (phase-2-close-the-loop "Weekly check-in UI": a
// top-of-dashboard prompt until the week is handled)
// ---------------------------------------------------------------------------

/**
 * True when the quiet check-in banner should sit at the top of the dashboard:
 * the user's calendar day is Friday or Saturday (weekday 5/6 — the week runs
 * Sunday → Saturday, so the prompt covers the week's last two days) AND no
 * weekly_check_ins row exists for the CURRENT week.
 *
 * `currentWeekCheckIns` is the rows for week_start_date = weekStartOf(today) —
 * presence alone decides: a 'skipped' row counts as handled (the skip row
 * exists precisely so this prompt knows the week is dealt with), so the
 * banner disappears as soon as ANY row lands.
 */
export function shouldShowCheckInPrompt(
  todayIso: string,
  currentWeekCheckIns: readonly unknown[],
): boolean {
  if (currentWeekCheckIns.length > 0) return false;
  const weekday = weekdayOfIso(todayIso);
  return weekday === 5 || weekday === 6;
}
