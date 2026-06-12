/**
 * detail-model.ts — pure, side-effect-free logic for the goal-detail surface
 * (phase-1-golden-path "Goal detail"). No DB, no React: the /goals/[id] page
 * feeds it scopedDb rows; /playground/goal-detail feeds it fixtures (the
 * list-model / review-plan pattern).
 *
 * Decisions encoded here:
 *   - EFFECTIVE INTENSITY chain: goals.intensity_override →
 *     intake_summaries.confirmed_intensity (this goal's summary) →
 *     users.intensity_preference. The source rides along so the control can
 *     state honestly what the selection follows — "Follows your intake
 *     intensity" when the override is unset (the chain prefers the intake
 *     pick, NOT the account preference).
 *   - 404 NEVER LEAKS EXISTENCE: resolveGoalRow collapses "malformed id",
 *     "no such goal", and "someone else's goal" (scopedDb returns zero rows)
 *     into the same null — the page renders one indistinguishable notFound().
 *   - REPLAN BANNER GATE: shouldShowReplanBanner is true only when
 *     NEXT_PUBLIC_REPLAN_ENABLED === "true" AND a structural edit landed.
 *     Phase 1 shipped with the flag absent/false; Phase 2 slice 4 flips the
 *     env var and TIGHTENS "structural" to the trigger set classified by
 *     structuralEditFor (milestone add/remove, recurring-task add/remove,
 *     milestone target-date shift — equipment changes, renames, weekday/
 *     duration tweaks, reorders, and intensity never trigger).
 *   - Removed tasks (recurring_tasks.active = false) are excluded from the
 *     model — remove is a soft deactivation that preserves task_completions
 *     history, never a hard delete.
 */
import { INTENSITY_LEVELS } from "@/lib/ai/intake-schema";
import {
  sceneVariantForActivity,
  type GoalSceneVariant,
} from "@/lib/goal-scene";

export type Intensity = (typeof INTENSITY_LEVELS)[number];

// ---------------------------------------------------------------------------
// Id guard (shared by the page's 404 path and the server actions)
// ---------------------------------------------------------------------------

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Collapse the page's goal lookup into found-or-null: a malformed id never
 * reaches the DB, and an unknown OR foreign id (scopedDb's ownership filter
 * returns zero rows for both) resolves to the same null — the caller 404s
 * without revealing whether the goal exists for someone else.
 */
export function resolveGoalRow<T>(
  idParam: string,
  rows: readonly T[],
): T | null {
  if (!isUuid(idParam)) return null;
  return rows[0] ?? null;
}

// ---------------------------------------------------------------------------
// Effective intensity
// ---------------------------------------------------------------------------

export type IntensitySource = "override" | "intake" | "account" | "none";

export interface EffectiveIntensity {
  value: Intensity | null;
  source: IntensitySource;
}

/**
 * The intensity chain (phase doc "Goal detail" + PLAN.md §5 flags #2/#6):
 * goals.intensity_override ?? intake confirmed_intensity ?? account
 * preference. "none" is the degenerate all-null case (cannot occur via the
 * golden path — every saved goal carries a confirmed intake — but the model
 * stays honest rather than inventing a default).
 */
export function effectiveIntensity(input: {
  override: Intensity | null;
  intakeConfirmed: Intensity | null;
  accountPreference: Intensity | null;
}): EffectiveIntensity {
  if (input.override !== null) {
    return { value: input.override, source: "override" };
  }
  if (input.intakeConfirmed !== null) {
    return { value: input.intakeConfirmed, source: "intake" };
  }
  if (input.accountPreference !== null) {
    return { value: input.accountPreference, source: "account" };
  }
  return { value: null, source: "none" };
}

/**
 * The line under the intensity control. The phase doc's exact copy for the
 * unset-override case is "Follows your intake intensity" — NOT "account
 * preference", because the chain prefers the intake pick.
 */
export function intensitySupportCopy(source: IntensitySource): string {
  switch (source) {
    case "override":
      return "Set for this goal.";
    case "intake":
      return "Follows your intake intensity";
    case "account":
      return "Follows your account preference.";
    case "none":
      return "Not set yet. Pick one to set it for this goal.";
  }
}

// ---------------------------------------------------------------------------
// Intensity keyboard (APG radiogroup pattern)
// ---------------------------------------------------------------------------

/**
 * Arrow-key movement for the intensity radiogroup (APG pattern: arrows move
 * focus AND selection). Down/Right advance with wrap, Up/Left retreat with
 * wrap; any other key returns null so the browser keeps its default (Tab
 * leaves the group; Space/Enter select via the native button click).
 * `current` is the focused option — null means nothing is selected yet, in
 * which case the first option holds the roving tab stop and is the base.
 */
export function nextIntensityOnKey(
  current: Intensity | null,
  key: string,
): Intensity | null {
  const forward = key === "ArrowDown" || key === "ArrowRight";
  const backward = key === "ArrowUp" || key === "ArrowLeft";
  if (!forward && !backward) return null;
  const count = INTENSITY_LEVELS.length;
  const base = current === null ? 0 : INTENSITY_LEVELS.indexOf(current);
  const index = base === -1 ? 0 : base;
  return INTENSITY_LEVELS[(index + (forward ? 1 : -1) + count) % count]!;
}

// ---------------------------------------------------------------------------
// Read-only gate (phase-2-close-the-loop "Accomplished section": tap →
// read-only goal detail)
// ---------------------------------------------------------------------------

/**
 * Non-active goals render read-only: NO edit affordances anywhere — no
 * Edit/Add/Remove, no milestone reorder, no intensity radios, no Mark
 * complete, no Adjust plan, no replan banner. The view keys this off its
 * LOCAL status state, so a goal completed in-session settles into the same
 * read-only treatment a reload would show. Active goals are untouched.
 */
export function isReadOnlyGoalStatus(
  status: "active" | "completed" | "archived",
): boolean {
  return status !== "active";
}

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

export interface TaskItemModel {
  id: string;
  title: string;
  /** 0–6, weekly tasks only; null for daily. */
  weekday: number | null;
  estimatedDurationMin: number | null;
}

export interface MilestoneItemModel {
  id: string;
  title: string;
  /** ISO date or null (legacy rows; the editor requires one). */
  targetDate: string | null;
  /** ISO date when completed (display only in Phase 1). */
  completedOn: string | null;
}

export interface EquipmentItemModel {
  id: string;
  title: string;
  /** numeric comes back from drizzle as a string. */
  costUsd: string | null;
  /** Exactly one of milestoneId / standaloneDeadline is set (invariant). */
  milestoneId: string | null;
  standaloneDeadline: string | null;
  purchased: boolean;
}

export interface GoalDetailModel {
  id: string;
  title: string;
  status: "active" | "completed" | "archived";
  colorIndex: number;
  targetDate: string | null;
  /** The goal's Scene variant (intake activity_type → goal-scene mapping);
   *  drives the CompletionScene sunrise on Mark complete. */
  sceneVariant: GoalSceneVariant;
  intensity: EffectiveIntensity;
  daily: TaskItemModel[];
  weekly: TaskItemModel[];
  /** Position-ordered (the timeline order). */
  milestones: MilestoneItemModel[];
  equipment: EquipmentItemModel[];
}

// Row shapes — structural subsets of the drizzle rows so fixtures stay light.
export interface GoalRowLike {
  id: string;
  title: string;
  status: "active" | "completed" | "archived";
  color_index: number;
  intensity_override: Intensity | null;
  target_date: string | null;
}

export interface TaskRowLike {
  id: string;
  title: string;
  cadence: "daily" | "weekly";
  weekday: number | null;
  estimated_duration_min: number | null;
  active: boolean;
  created_at?: Date | string;
}

export interface MilestoneRowLike {
  id: string;
  title: string;
  target_date: string | null;
  completed_at: Date | string | null;
  position: number;
  created_at?: Date | string;
}

export interface EquipmentRowLike {
  id: string;
  title: string;
  cost_usd: string | null;
  milestone_id: string | null;
  standalone_deadline: string | null;
  purchased_at: Date | string | null;
  created_at?: Date | string;
}

function createdAtMs(row: { created_at?: Date | string }): number {
  if (row.created_at == null) return 0;
  const ms = new Date(row.created_at).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** Stable creation order: created_at ascending, id as the tiebreak. */
function byCreation(
  a: { id: string; created_at?: Date | string },
  b: { id: string; created_at?: Date | string },
): number {
  return createdAtMs(a) - createdAtMs(b) || a.id.localeCompare(b.id);
}

/** Timestamp → ISO calendar date for display ("2026-03-03"). */
function toIsoDate(value: Date | string | null): string | null {
  if (value == null) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function buildGoalDetailModel(input: {
  goal: GoalRowLike;
  /** This goal's intake confirmed_intensity (null when no summary exists). */
  intakeConfirmed: Intensity | null;
  /** users.intensity_preference — the chain's final fallback. */
  accountPreference: Intensity | null;
  /** This goal's intake activity_type (null when no summary exists) — picks
   *  the Scene variant for the completion moment. */
  activityType: string | null;
  tasks: readonly TaskRowLike[];
  milestones: readonly MilestoneRowLike[];
  equipment: readonly EquipmentRowLike[];
}): GoalDetailModel {
  const activeTasks = input.tasks.filter((t) => t.active).sort(byCreation);
  const toTask = (t: TaskRowLike): TaskItemModel => ({
    id: t.id,
    title: t.title,
    weekday: t.cadence === "weekly" ? t.weekday : null,
    estimatedDurationMin: t.estimated_duration_min,
  });

  const milestones = [...input.milestones]
    .sort((a, b) => a.position - b.position || byCreation(a, b))
    .map(
      (m): MilestoneItemModel => ({
        id: m.id,
        title: m.title,
        targetDate: m.target_date,
        completedOn: toIsoDate(m.completed_at),
      }),
    );

  const equipment = [...input.equipment].sort(byCreation).map(
    (e): EquipmentItemModel => ({
      id: e.id,
      title: e.title,
      costUsd: e.cost_usd,
      milestoneId: e.milestone_id,
      standaloneDeadline: e.standalone_deadline,
      purchased: e.purchased_at != null,
    }),
  );

  return {
    id: input.goal.id,
    title: input.goal.title,
    status: input.goal.status,
    colorIndex: input.goal.color_index,
    targetDate: input.goal.target_date,
    sceneVariant: sceneVariantForActivity(input.activityType),
    intensity: effectiveIntensity({
      override: input.goal.intensity_override,
      intakeConfirmed: input.intakeConfirmed,
      accountPreference: input.accountPreference,
    }),
    daily: activeTasks.filter((t) => t.cadence === "daily").map(toTask),
    weekly: activeTasks.filter((t) => t.cadence === "weekly").map(toTask),
    milestones,
    equipment,
  };
}

// ---------------------------------------------------------------------------
// Replan banner gate + structural-edit classification (Phase 2 slice 4)
// ---------------------------------------------------------------------------

/** Phase doc's exact banner line — rendered only when the gate opens. */
export const REPLAN_BANNER_COPY = "Want me to update the rest of your plan?";

/** The banner's idle action — answers the banner question directly. */
export const REPLAN_BANNER_ACTION_COPY = "Yes, update it";

/**
 * The gate Phase 2 flipped on: the banner renders ONLY when the env flag is
 * the literal string "true" AND a structural edit landed this session
 * (slice 4: one of structuralEditFor's trigger kinds with a non-empty net
 * summary). Absent, empty, "false", or any other value → no banner anywhere.
 */
export function shouldShowReplanBanner(
  flag: string | undefined,
  structuralEditOccurred: boolean,
): boolean {
  return flag === "true" && structuralEditOccurred;
}

/**
 * Every edit the goal-detail surface can land, as the view's action handlers
 * see it. The view reports each confirmed write here; structuralEditFor
 * decides which ones are "structural" (SPEC §6 + phase-2 doc trigger set).
 * Non-trigger kinds carry no payload — the classifier never reads it.
 */
export type GoalDetailEdit =
  | { kind: "task_added"; cadence: "daily" | "weekly"; title: string }
  /** Rename / weekday / duration tweaks — never structural. */
  | { kind: "task_updated" }
  | { kind: "task_removed"; cadence: "daily" | "weekly"; title: string }
  | { kind: "milestone_added"; title: string; targetDate: string }
  | {
      kind: "milestone_updated";
      milestoneId: string;
      title: string;
      /** The date before the edit (null on legacy date-less rows). */
      prevTargetDate: string | null;
      targetDate: string;
    }
  | { kind: "milestone_removed"; title: string }
  | { kind: "milestone_moved" }
  | { kind: "equipment_added" }
  | { kind: "equipment_updated" }
  | { kind: "equipment_removed" }
  | { kind: "intensity_changed" };

/** One recorded trigger-set edit — the session log the summary is built from. */
export type StructuralEdit =
  | { kind: "task_added"; cadence: "daily" | "weekly"; title: string }
  | { kind: "task_removed"; cadence: "daily" | "weekly"; title: string }
  | { kind: "milestone_added"; title: string; targetDate: string }
  | { kind: "milestone_removed"; title: string }
  | {
      kind: "target_date_shifted";
      milestoneId: string;
      title: string;
      from: string | null;
      to: string;
    };

/**
 * THE trigger-set predicate (phase-2 doc "Structural-edit replan banner" +
 * SPEC §6): milestone added/removed, recurring task added/removed, and a
 * milestone target-date shift are structural; equipment changes (any),
 * renames, weekday/duration tweaks, milestone reorders, and intensity
 * changes are NOT. Returns the structural record to accumulate, or null
 * when the edit must not arm the banner. A milestone update is structural
 * only when its date actually moved — a pure rename returns null.
 */
export function structuralEditFor(edit: GoalDetailEdit): StructuralEdit | null {
  switch (edit.kind) {
    case "task_added":
    case "task_removed":
      return { kind: edit.kind, cadence: edit.cadence, title: edit.title };
    case "milestone_added":
      return { kind: edit.kind, title: edit.title, targetDate: edit.targetDate };
    case "milestone_removed":
      return { kind: edit.kind, title: edit.title };
    case "milestone_updated":
      if (edit.targetDate === edit.prevTargetDate) return null; // rename only
      return {
        kind: "target_date_shifted",
        milestoneId: edit.milestoneId,
        title: edit.title,
        from: edit.prevTargetDate,
        to: edit.targetDate,
      };
    case "task_updated":
    case "milestone_moved":
    case "equipment_added":
    case "equipment_updated":
    case "equipment_removed":
    case "intensity_changed":
      return null;
  }
}

/**
 * The banner's interaction state: idle (the offer) → generating (quiet,
 * button disabled) → either a client route to /replan/<goalId> or error
 * (calm inline line + Try again, no navigation). Plain data so the
 * playground can mount mid-flight states directly.
 */
export type ReplanBannerState =
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "error"; error: string };

/** The endpoint's structural_change.summary cap (route Zod: 1..500). */
export const STRUCTURAL_SUMMARY_MAX = 500;

function untitled(title: string): string {
  return title.trim() === "" ? "Untitled" : title.trim();
}

function structuralSentence(edit: StructuralEdit): string {
  const taskNoun = (cadence: "daily" | "weekly") =>
    cadence === "daily" ? "daily habit" : "weekly session";
  switch (edit.kind) {
    case "task_added":
      return `Added ${taskNoun(edit.cadence)} "${untitled(edit.title)}".`;
    case "task_removed":
      return `Removed ${taskNoun(edit.cadence)} "${untitled(edit.title)}".`;
    case "milestone_added":
      return `Added milestone "${untitled(edit.title)}" (target ${edit.targetDate}).`;
    case "milestone_removed":
      return `Removed milestone "${untitled(edit.title)}".`;
    case "target_date_shifted":
      return edit.from === null
        ? `Set milestone "${untitled(edit.title)}" target date to ${edit.to}.`
        : `Moved milestone "${untitled(edit.title)}" target date from ${edit.from} to ${edit.to}.`;
  }
}

/**
 * The truthful session summary POSTed as structural_change.summary. Plain
 * sentences in edit order. Two honesty rules:
 *   - DEDUPE: repeated date shifts of the SAME milestone collapse into the
 *     net movement (first `from` → last `to`), placed at the latest edit's
 *     position; a shift that lands back where it started nets out and drops
 *     entirely (the plan ended where it began — nothing to report).
 *   - CAP: the endpoint takes at most STRUCTURAL_SUMMARY_MAX chars; longer
 *     accumulations truncate with a visible ellipsis, never silently.
 * Returns "" when nothing net-structural remains — the banner stays down.
 */
export function buildStructuralChangeSummary(
  edits: readonly StructuralEdit[],
): string {
  const net: StructuralEdit[] = [];
  for (const edit of edits) {
    if (edit.kind === "target_date_shifted") {
      const i = net.findIndex(
        (e) =>
          e.kind === "target_date_shifted" &&
          e.milestoneId === edit.milestoneId,
      );
      if (i !== -1) {
        const [prior] = net.splice(i, 1) as [
          Extract<StructuralEdit, { kind: "target_date_shifted" }>,
        ];
        if (prior.from === edit.to) continue; // shifted back — nets out
        net.push({ ...edit, from: prior.from });
        continue;
      }
    }
    net.push(edit);
  }
  const text = net.map(structuralSentence).join(" ");
  return text.length > STRUCTURAL_SUMMARY_MAX
    ? `${text.slice(0, STRUCTURAL_SUMMARY_MAX - 1)}…`
    : text;
}

// ---------------------------------------------------------------------------
// "Adjust plan" placeholder copy (Phase 2 wires the real replan flow)
// ---------------------------------------------------------------------------

export const ADJUST_PLAN_SUPPORT_COPY =
  "Plan adjustments arrive with weekly check-ins.";

// ---------------------------------------------------------------------------
// Action surface (implemented by actions.ts; the playground passes no-ops)
// ---------------------------------------------------------------------------

export type ActionResult = { ok: true } | { ok: false; error: string };
export type CreateResult = { ok: true; id: string } | { ok: false; error: string };

export interface GoalDetailActions {
  setIntensity(input: {
    goalId: string;
    intensity: Intensity;
  }): Promise<ActionResult>;
  /** Active → completed transition; non-active goals fail calmly (the
   *  idempotent guard) and the row is untouched. */
  completeGoal(input: { goalId: string }): Promise<ActionResult>;
  addTask(input: {
    goalId: string;
    cadence: "daily" | "weekly";
    title: string;
    weekday: number | null;
    estimatedDurationMin: number | null;
  }): Promise<CreateResult>;
  updateTask(input: {
    goalId: string;
    taskId: string;
    title: string;
    weekday?: number;
    estimatedDurationMin: number | null;
  }): Promise<ActionResult>;
  removeTask(input: { goalId: string; taskId: string }): Promise<ActionResult>;
  addMilestone(input: {
    goalId: string;
    title: string;
    targetDate: string;
  }): Promise<CreateResult>;
  updateMilestone(input: {
    goalId: string;
    milestoneId: string;
    title: string;
    targetDate: string;
  }): Promise<ActionResult>;
  removeMilestone(input: {
    goalId: string;
    milestoneId: string;
  }): Promise<ActionResult>;
  moveMilestone(input: {
    goalId: string;
    milestoneId: string;
    direction: "up" | "down";
  }): Promise<ActionResult>;
  addEquipment(input: {
    goalId: string;
    title: string;
    costUsd: number | null;
    milestoneId: string | null;
    standaloneDeadline: string | null;
  }): Promise<CreateResult>;
  updateEquipment(input: {
    goalId: string;
    equipmentId: string;
    title: string;
    costUsd: number | null;
    milestoneId: string | null;
    standaloneDeadline: string | null;
  }): Promise<ActionResult>;
  removeEquipment(input: {
    goalId: string;
    equipmentId: string;
  }): Promise<ActionResult>;
}
