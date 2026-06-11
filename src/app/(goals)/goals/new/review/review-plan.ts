/**
 * review-plan.ts — pure, side-effect-free logic for the draft-plan review/edit
 * surface (phase-1-golden-path "Draft-plan review/edit UI" + "Color
 * assignment" context + "Equipment deadline derivation").
 *
 * Kept apart from the component and the server action so the rules can be
 * unit-tested with no DB, no React, and no model call (the intensity-confirm
 * pattern). Three responsibilities:
 *
 *   1. The EDITABLE MODEL + REDUCER the client UI drives. plan_draft items
 *      get stable local ids (React keys + equipment→milestone links that
 *      survive reorder/remove); every applied modification increments
 *      edits_count exactly once (the analytics payload for plan_accepted).
 *   2. SERIALIZATION + VALIDATION back to the plan-draft wire shape: weekday
 *      bounds 0–6, the equipment exactly-one invariant, required titles and
 *      dates — the client gate; the server action re-validates independently
 *      with the same zod schema the plan generator used.
 *   3. NORMALIZATION for save: milestone positions are reassigned
 *      sequentially (0..n-1, stable order) and equipment milestone_position
 *      references resolve to a milestone INDEX deterministically — first
 *      match after normalization — because draft positions may collide
 *      (Slice 6 note: the model's positions are not guaranteed unique).
 *
 * The medical-disclaimer predicate also lives here: activity_type ∈ the six
 * physical types → one factual line under the plan header. No modal, no
 * acknowledgment (phase doc).
 */
import type { PlanDraft } from "@/lib/ai/plan-schema";

// ---------------------------------------------------------------------------
// Medical disclaimer (physical/fitness goals only)
// ---------------------------------------------------------------------------

/** The activity types that surface the disclaimer (phase doc's exact set). */
export const PHYSICAL_ACTIVITY_TYPES = [
  "climbing",
  "mountaineering",
  "running",
  "cycling",
  "swimming",
  "strength",
] as const;

/** Phase-doc copy, verbatim — factual, Patagonia register, single line. */
export const MEDICAL_DISCLAIMER =
  "This plan is generated guidance, not medical advice. Check with a " +
  "physician before starting a demanding physical program.";

export function requiresMedicalDisclaimer(activityType: string): boolean {
  return (PHYSICAL_ACTIVITY_TYPES as readonly string[]).includes(activityType);
}

// ---------------------------------------------------------------------------
// Editable model
// ---------------------------------------------------------------------------

/** ISO 8601 calendar date — mirrors plan-schema.ts. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface EditableDaily {
  id: string;
  title: string;
  /**
   * READ-ONLY AI review context — recurring_tasks has no description column,
   * so an edit here would silently evaporate at save ("nothing silent").
   * Carried for display + wire round-trip only; the reducer strips it from
   * patches. Persisting it requires a recurring_tasks.description column
   * (product decision deferred).
   */
  description: string;
  estimated_duration_min: number | null;
}

export interface EditableWeekly {
  id: string;
  title: string;
  /** READ-ONLY AI review context — see EditableDaily.description. */
  description: string;
  weekday: number;
  estimated_duration_min: number | null;
}

export interface EditableMilestone {
  id: string;
  title: string;
  /** ISO date; "" while a freshly added item awaits one. */
  target_date: string;
}

export interface EditableEquipment {
  id: string;
  title: string;
  cost_usd: number | null;
  /** Local id of the linked milestone, or null when standalone (or unset). */
  milestoneId: string | null;
  standalone_deadline: string | null;
}

export interface EditablePlan {
  daily: EditableDaily[];
  weekly: EditableWeekly[];
  /** Order IS the milestone order; positions are assigned at serialization. */
  milestones: EditableMilestone[];
  equipment: EditableEquipment[];
  /** Number of user modifications applied so far (plan_accepted analytics). */
  editsCount: number;
  /** Monotonic counter for ids of added items (deterministic, no RNG). */
  nextId: number;
}

/**
 * Deterministic milestone ordering shared by the client model and the save
 * normalization: stable sort by draft position (original array order breaks
 * ties). Returns the original items in normalized order.
 */
function milestonesInOrder(plan: PlanDraft): PlanDraft["milestones"] {
  return plan.milestones
    .map((m, i) => ({ m, i }))
    .sort((a, b) => a.m.position - b.m.position || a.i - b.i)
    .map(({ m }) => m);
}

/**
 * Resolve an equipment item's milestone_position to an INDEX into the
 * normalized milestone order — deterministically, by FIRST match (positions
 * in a draft may collide; the zod gate guarantees at least one match).
 */
function resolveMilestoneIndex(
  ordered: PlanDraft["milestones"],
  milestonePosition: number,
): number | null {
  const idx = ordered.findIndex((m) => m.position === milestonePosition);
  return idx === -1 ? null : idx;
}

/** Build the client editable model from a validated plan draft. */
export function toEditablePlan(plan: PlanDraft): EditablePlan {
  const ordered = milestonesInOrder(plan);
  const milestones: EditableMilestone[] = ordered.map((m, i) => ({
    id: `m${i}`,
    title: m.title,
    target_date: m.target_date,
  }));
  return {
    daily: plan.daily.map((d, i) => ({
      id: `d${i}`,
      title: d.title,
      description: d.description ?? "",
      estimated_duration_min: d.estimated_duration_min,
    })),
    weekly: plan.weekly.map((w, i) => ({
      id: `w${i}`,
      title: w.title,
      description: w.description ?? "",
      weekday: w.weekday,
      estimated_duration_min: w.estimated_duration_min,
    })),
    milestones,
    equipment: plan.equipment.map((e, i) => {
      const linkedIndex =
        e.milestone_position !== null
          ? resolveMilestoneIndex(ordered, e.milestone_position)
          : null;
      return {
        id: `e${i}`,
        title: e.title,
        cost_usd: e.cost_usd,
        milestoneId: linkedIndex !== null ? milestones[linkedIndex]!.id : null,
        standalone_deadline: e.standalone_deadline,
      };
    }),
    editsCount: 0,
    nextId: 0,
  };
}

// ---------------------------------------------------------------------------
// Reducer — every APPLIED modification counts exactly one edit
// ---------------------------------------------------------------------------

export type PlanSection = "daily" | "weekly" | "milestones" | "equipment";

export type PlanEditAction =
  // daily/weekly descriptions are read-only (no recurring_tasks.description
  // column) — excluded from the patch type AND stripped at runtime below.
  | { type: "update"; section: "daily"; id: string; patch: Partial<Omit<EditableDaily, "id" | "description">> }
  | { type: "update"; section: "weekly"; id: string; patch: Partial<Omit<EditableWeekly, "id" | "description">> }
  | { type: "update"; section: "milestones"; id: string; patch: Partial<Omit<EditableMilestone, "id">> }
  | { type: "update"; section: "equipment"; id: string; patch: Partial<Omit<EditableEquipment, "id">> }
  | { type: "add"; section: PlanSection }
  | { type: "remove"; section: PlanSection; id: string }
  | { type: "moveMilestone"; id: string; direction: "up" | "down" };

function isValidWeekday(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6;
}

function patchItem<T extends { id: string }>(
  items: T[],
  id: string,
  patch: Partial<Omit<T, "id">>,
): T[] | null {
  const index = items.findIndex((item) => item.id === id);
  if (index === -1) return null;
  const current = items[index]!;
  const changed = (Object.keys(patch) as Array<keyof typeof patch>).some(
    (key) => patch[key] !== undefined && patch[key] !== current[key as keyof T],
  );
  if (!changed) return null;
  const next = items.slice();
  next[index] = { ...current, ...patch };
  return next;
}

const ADD_DEFAULTS = {
  daily: { title: "", description: "", estimated_duration_min: null },
  weekly: { title: "", description: "", weekday: 1, estimated_duration_min: null },
  milestones: { title: "", target_date: "" },
  equipment: { title: "", cost_usd: null, milestoneId: null, standalone_deadline: null },
} as const;

/**
 * Apply one user action. Returns the SAME state object when the action is a
 * no-op (unknown id, unchanged values, out-of-bounds weekday or move), so
 * edits_count only counts modifications that actually landed.
 */
export function planEditReducer(
  state: EditablePlan,
  action: PlanEditAction,
): EditablePlan {
  switch (action.type) {
    case "update": {
      // Weekday bounds 0–6 are enforced at the model level, not just the UI:
      // an out-of-bounds weekday never enters the state.
      if (
        action.section === "weekly" &&
        action.patch.weekday !== undefined &&
        !isValidWeekday(action.patch.weekday)
      ) {
        return state;
      }
      // Equipment exactly-one: linking to a milestone clears the standalone
      // date and vice versa — the two are one control, never both set.
      if (action.section === "equipment") {
        const patch = { ...action.patch };
        if (patch.milestoneId != null) patch.standalone_deadline = null;
        else if (patch.standalone_deadline != null) patch.milestoneId = null;
        const next = patchItem(state.equipment, action.id, patch);
        if (!next) return state;
        return { ...state, equipment: next, editsCount: state.editsCount + 1 };
      }
      const section = action.section;
      // Defense in depth for the type-level exclusion above: a stray runtime
      // description patch on daily/weekly never lands and never counts toward
      // edits_count (it has nowhere to persist).
      const patch = { ...action.patch } as Partial<Record<string, unknown>>;
      if (section === "daily" || section === "weekly") {
        delete patch.description;
      }
      const next = patchItem(
        state[section] as Array<{ id: string }>,
        action.id,
        patch,
      );
      if (!next) return state;
      return {
        ...state,
        [section]: next,
        editsCount: state.editsCount + 1,
      } as EditablePlan;
    }

    case "add": {
      const id = `n${state.nextId}`;
      const item = { id, ...ADD_DEFAULTS[action.section] };
      return {
        ...state,
        [action.section]: [...state[action.section], item],
        editsCount: state.editsCount + 1,
        nextId: state.nextId + 1,
      } as EditablePlan;
    }

    case "remove": {
      const items = state[action.section] as Array<{ id: string }>;
      if (!items.some((item) => item.id === action.id)) return state;
      const next = {
        ...state,
        [action.section]: items.filter((item) => item.id !== action.id),
        editsCount: state.editsCount + 1,
      } as EditablePlan;
      // Removing a milestone orphans equipment linked to it: the link is
      // cleared (the item turns invalid until the user picks a new milestone
      // or a standalone date — validation holds the save). One user action,
      // one edit.
      if (action.section === "milestones") {
        next.equipment = next.equipment.map((e) =>
          e.milestoneId === action.id ? { ...e, milestoneId: null } : e,
        );
      }
      return next;
    }

    case "moveMilestone": {
      const index = state.milestones.findIndex((m) => m.id === action.id);
      if (index === -1) return state;
      const target = action.direction === "up" ? index - 1 : index + 1;
      if (target < 0 || target >= state.milestones.length) return state;
      const milestones = state.milestones.slice();
      [milestones[index], milestones[target]] = [
        milestones[target]!,
        milestones[index]!,
      ];
      return { ...state, milestones, editsCount: state.editsCount + 1 };
    }
  }
}

// ---------------------------------------------------------------------------
// Validation (client gate; the server re-validates with the zod schema)
// ---------------------------------------------------------------------------

export interface PlanValidationIssue {
  section: PlanSection;
  id: string;
  message: string;
}

export function validateEditablePlan(plan: EditablePlan): PlanValidationIssue[] {
  const issues: PlanValidationIssue[] = [];
  const milestoneIds = new Set(plan.milestones.map((m) => m.id));

  for (const d of plan.daily) {
    if (d.title.trim().length === 0) {
      issues.push({ section: "daily", id: d.id, message: "Give this habit a title." });
    }
  }
  for (const w of plan.weekly) {
    if (w.title.trim().length === 0) {
      issues.push({ section: "weekly", id: w.id, message: "Give this session a title." });
    }
    if (!isValidWeekday(w.weekday)) {
      issues.push({ section: "weekly", id: w.id, message: "Pick a weekday." });
    }
  }
  for (const m of plan.milestones) {
    if (m.title.trim().length === 0) {
      issues.push({ section: "milestones", id: m.id, message: "Give this milestone a title." });
    }
    if (!ISO_DATE_RE.test(m.target_date)) {
      issues.push({ section: "milestones", id: m.id, message: "Set a target date." });
    }
  }
  for (const e of plan.equipment) {
    if (e.title.trim().length === 0) {
      issues.push({ section: "equipment", id: e.id, message: "Name this item." });
    }
    const linked = e.milestoneId !== null && milestoneIds.has(e.milestoneId);
    const standalone = e.standalone_deadline !== null && ISO_DATE_RE.test(e.standalone_deadline);
    if (linked === standalone) {
      issues.push({
        section: "equipment",
        id: e.id,
        message: "Tie this to a milestone or set a date — one or the other.",
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Serialization back to the plan-draft wire shape (what Save submits)
// ---------------------------------------------------------------------------

/** Serialize the edited model to the plan-draft shape the server validates
 *  with planDraftSchema. Milestone positions are sequential by order;
 *  equipment links carry the linked milestone's (now-unique) position. */
export function serializeEditablePlan(plan: EditablePlan): PlanDraft {
  const indexById = new Map(plan.milestones.map((m, i) => [m.id, i]));
  return {
    daily: plan.daily.map((d) => ({
      title: d.title.trim(),
      description: d.description.trim() === "" ? null : d.description.trim(),
      estimated_duration_min: d.estimated_duration_min,
    })),
    weekly: plan.weekly.map((w) => ({
      title: w.title.trim(),
      description: w.description.trim() === "" ? null : w.description.trim(),
      weekday: w.weekday,
      estimated_duration_min: w.estimated_duration_min,
    })),
    milestones: plan.milestones.map((m, i) => ({
      title: m.title.trim(),
      target_date: m.target_date,
      position: i,
    })),
    equipment: plan.equipment.map((e) => {
      const linkedIndex =
        e.milestoneId !== null ? (indexById.get(e.milestoneId) ?? null) : null;
      return {
        title: e.title.trim(),
        cost_usd: e.cost_usd,
        milestone_position: linkedIndex,
        standalone_deadline: linkedIndex === null ? e.standalone_deadline : null,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Save-path normalization (server side, after zod re-validation)
// ---------------------------------------------------------------------------

export interface NormalizedPlan {
  daily: PlanDraft["daily"];
  weekly: PlanDraft["weekly"];
  /** Positions reassigned sequentially: 0..n-1 in normalized (stable) order. */
  milestones: Array<{ title: string; target_date: string; position: number }>;
  /** milestoneIndex points into `milestones` above (resolved deterministically
   *  by first match), ready to map onto inserted milestone row ids. */
  equipment: Array<{
    title: string;
    cost_usd: number | null;
    milestoneIndex: number | null;
    standalone_deadline: string | null;
  }>;
}

/**
 * Normalize a validated plan draft for materialization: milestone positions
 * become sequential (stable order — collisions keep draft order), and each
 * equipment milestone_position resolves to the FIRST milestone matching that
 * original position. Deterministic by construction.
 */
export function normalizePlanForSave(plan: PlanDraft): NormalizedPlan {
  const ordered = milestonesInOrder(plan);
  return {
    daily: plan.daily,
    weekly: plan.weekly,
    milestones: ordered.map((m, i) => ({
      title: m.title,
      target_date: m.target_date,
      position: i,
    })),
    equipment: plan.equipment.map((e) => ({
      title: e.title,
      cost_usd: e.cost_usd,
      milestoneIndex:
        e.milestone_position !== null
          ? resolveMilestoneIndex(ordered, e.milestone_position)
          : null,
      standalone_deadline: e.standalone_deadline,
    })),
  };
}
