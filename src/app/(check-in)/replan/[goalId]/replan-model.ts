/**
 * replan-model.ts — the pure layer behind the replan diff UI
 * (phase-2-close-the-loop "Replan diff UI"). No DB, no React: the
 * /replan/[goalId] page feeds it scopedDb rows; /playground/replan-diff
 * feeds it fixtures; the decision action's application planner
 * (apply-plan.ts) shares the SAME change enumeration so the keys the form
 * submits are exactly the keys the server re-derives from the stored diff.
 *
 * Decisions encoded here:
 *   - STABLE CHANGE KEYS: every change in a ReplanDiff gets a deterministic
 *     identifier — `<section>:modify:<rowId>` / `<section>:remove:<rowId>`
 *     for entries that target an existing row (the row id IS the stable
 *     handle), `<section>:add:<index>` for additions (no row exists yet; the
 *     array index inside the STORED diff is stable because proposed_changes
 *     is immutable while pending — regeneration replaces it wholesale and the
 *     client refetches).
 *   - PLACEHOLDER DETECTION: a pending proposal still holding
 *     EMPTY_REPLAN_DIFF (all six add/modify/remove arrays empty) means
 *     "requested, not yet generated" — the page renders a Generate action,
 *     never an empty diff.
 *   - BEFORE/AFTER PAIRS: modify entries carry ONLY the fields that change;
 *     the view joins them against the goal's CURRENT rows to render
 *     side-by-side before/after. A target row that no longer exists renders
 *     honestly as unresolvable (and the commit will refuse the whole
 *     proposal — regeneration is the way out of a stale diff).
 *   - DECISION ⇒ STATUS mapping (frozen): all accepted → 'accepted', none →
 *     'rejected', some → 'partially_accepted'.
 *
 * Pure and client-safe.
 */
import type { ReplanDiff } from "@/lib/ai/replan-diff";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Sections + change keys
// ---------------------------------------------------------------------------

export const DIFF_SECTIONS = [
  "recurring_tasks",
  "milestones",
  "equipment",
] as const;
export type DiffSection = (typeof DIFF_SECTIONS)[number];

export type ChangeKind = "add" | "modify" | "remove";

/** `<section>:add:<index>` | `<section>:modify:<id>` | `<section>:remove:<id>` */
export type ChangeKey = string;

export function changeKey(
  section: DiffSection,
  kind: ChangeKind,
  handle: number | string,
): ChangeKey {
  return `${section}:${kind}:${handle}`;
}

// ---------------------------------------------------------------------------
// Enumerated changes — one flat list over the diff's six arrays
// ---------------------------------------------------------------------------

export type RecurringTaskAdd = ReplanDiff["recurring_tasks"]["add"][number];
export type RecurringTaskChanges =
  ReplanDiff["recurring_tasks"]["modify"][number]["changes"];
export type MilestoneAdd = ReplanDiff["milestones"]["add"][number];
export type MilestoneChanges =
  ReplanDiff["milestones"]["modify"][number]["changes"];
export type EquipmentAdd = ReplanDiff["equipment"]["add"][number];
export type EquipmentChanges =
  ReplanDiff["equipment"]["modify"][number]["changes"];

export type EnumeratedChange =
  | { key: ChangeKey; section: "recurring_tasks"; kind: "add"; add: RecurringTaskAdd }
  | { key: ChangeKey; section: "recurring_tasks"; kind: "modify"; id: string; changes: RecurringTaskChanges }
  | { key: ChangeKey; section: "recurring_tasks"; kind: "remove"; id: string }
  | { key: ChangeKey; section: "milestones"; kind: "add"; add: MilestoneAdd }
  | { key: ChangeKey; section: "milestones"; kind: "modify"; id: string; changes: MilestoneChanges }
  | { key: ChangeKey; section: "milestones"; kind: "remove"; id: string }
  | { key: ChangeKey; section: "equipment"; kind: "add"; add: EquipmentAdd }
  | { key: ChangeKey; section: "equipment"; kind: "modify"; id: string; changes: EquipmentChanges }
  | { key: ChangeKey; section: "equipment"; kind: "remove"; id: string };

/**
 * Flatten a diff into its individually decidable changes, in stable render
 * order (per section: adds, then modifies, then removes). The decision form
 * and the server-side application planner BOTH run this — the key set is the
 * shared contract between them.
 */
export function enumerateChanges(diff: ReplanDiff): EnumeratedChange[] {
  const out: EnumeratedChange[] = [];
  for (const section of DIFF_SECTIONS) {
    const block = diff[section];
    block.add.forEach((add, index) => {
      out.push({
        key: changeKey(section, "add", index),
        section,
        kind: "add",
        add,
      } as EnumeratedChange);
    });
    for (const m of block.modify) {
      out.push({
        key: changeKey(section, "modify", m.id),
        section,
        kind: "modify",
        id: m.id,
        changes: m.changes,
      } as EnumeratedChange);
    }
    for (const r of block.remove) {
      out.push({
        key: changeKey(section, "remove", r.id),
        section,
        kind: "remove",
        id: r.id,
      });
    }
  }
  return out;
}

/** All six arrays empty — the Slice-1 placeholder, "requested, not yet
 *  generated". The page renders a Generate action for this, never an empty
 *  diff. */
export function isPlaceholderDiff(diff: ReplanDiff): boolean {
  return enumerateChanges(diff).length === 0;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export type ChangeDecision = "accept" | "reject";

/** What the form submits per change: the verdict, plus (adds/modifies only)
 *  the user's field adjustments. `edited` keys are limited server-side to the
 *  proposed change's own fields — ids are never editable. */
export interface DecisionEntry {
  decision: ChangeDecision;
  edited?: Record<string, unknown>;
}

export type DecisionMap = Record<ChangeKey, DecisionEntry>;

export type DecidedStatus = "accepted" | "partially_accepted" | "rejected";

/** The frozen status mapping: all → accepted, none → rejected, some →
 *  partially_accepted. `total` must be ≥ 1 (an empty diff is never decidable). */
export function decisionStatus(
  acceptCount: number,
  total: number,
): DecidedStatus {
  if (acceptCount <= 0) return "rejected";
  if (acceptCount >= total) return "accepted";
  return "partially_accepted";
}

// ---------------------------------------------------------------------------
// Current-row shapes (structural subsets of the drizzle rows)
// ---------------------------------------------------------------------------

export interface CurrentTaskLike {
  id: string;
  title: string;
  cadence: "daily" | "weekly";
  weekday: number | null;
  estimated_duration_min: number | null;
  active: boolean;
}

export interface CurrentMilestoneLike {
  id: string;
  title: string;
  /** YYYY-MM-DD (drizzle date columns come back as strings). */
  target_date: string | null;
  position: number;
}

export interface CurrentEquipmentLike {
  id: string;
  title: string;
  /** numeric(10,2) comes back as a string. */
  cost_usd: string | null;
  milestone_id: string | null;
  standalone_deadline: string | null;
}

// ---------------------------------------------------------------------------
// View model — what the client component renders
// ---------------------------------------------------------------------------

/** One displayable field delta inside a modify row. */
export interface FieldDelta {
  field: string;
  label: string;
  before: string;
  after: string;
}

/**
 * One ✎-editable field, carrying the RAW proposed value the edit form
 * prefills with. Only the frozen edit scope appears here (title, weekday,
 * duration, dates, cost, position, milestone link) — `active` and ids never
 * do. Equipment's milestone link + standalone date collapse into ONE
 * `anchor` control (they are one exactly-one fact, not two fields) whenever
 * both are in scope.
 */
export type EditableInput =
  | { field: "title"; kind: "text"; label: string; value: string }
  | { field: "weekday"; kind: "weekday"; label: string; value: number | null }
  | {
      field: "estimated_duration_min";
      kind: "number";
      label: string;
      value: number;
      min: number;
    }
  | { field: "target_date"; kind: "date"; label: string; value: string }
  | { field: "position"; kind: "number"; label: string; value: number; min: number }
  | { field: "cost_usd"; kind: "cost"; label: string; value: number | null }
  | {
      field: "anchor";
      kind: "anchor";
      label: string;
      milestoneId: string | null;
      standaloneDeadline: string | null;
    };

export type ChangeRowModel =
  | {
      key: ChangeKey;
      section: DiffSection;
      kind: "add";
      title: string;
      /** label/value detail lines under the title (duration, date, cost…). */
      details: Array<{ label: string; value: string }>;
      editable: EditableInput[];
    }
  | {
      key: ChangeKey;
      section: DiffSection;
      kind: "modify";
      /** Current row title (or the diff's, when the title itself changes). */
      title: string;
      deltas: FieldDelta[];
      editable: EditableInput[];
      /** Target row vanished since generation — rendered honestly; the
       *  commit refuses the whole proposal until regenerated. */
      unresolved: boolean;
    }
  | {
      key: ChangeKey;
      section: DiffSection;
      kind: "remove";
      title: string;
      unresolved: boolean;
    };

export interface ReplanSectionModel {
  section: DiffSection;
  heading: string;
  rows: ChangeRowModel[];
}

export const SECTION_HEADINGS: Record<DiffSection, string> = {
  recurring_tasks: "Recurring work",
  milestones: "Milestones",
  equipment: "Equipment",
};

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export function weekdayName(weekday: number | null): string {
  if (weekday === null) return "—";
  return WEEKDAY_NAMES[weekday] ?? String(weekday);
}

function fmtDuration(min: number | null): string {
  return min === null ? "—" : `${min} min`;
}

function fmtDate(date: string | null): string {
  return date === null ? "—" : date;
}

function fmtCost(cost: number | string | null): string {
  if (cost === null) return "—";
  const n = typeof cost === "string" ? Number(cost) : cost;
  if (!Number.isFinite(n)) return String(cost);
  return `$${n.toFixed(2).replace(/\.00$/, "")}`;
}

function fmtActive(active: boolean): string {
  return active ? "Active" : "Paused";
}

/** Equipment milestone link / standalone deadline, named for humans. */
function fmtEquipmentAnchor(
  milestoneId: string | null,
  standalone: string | null,
  milestoneTitleById: ReadonlyMap<string, string>,
): string {
  if (milestoneId !== null) {
    const title = milestoneTitleById.get(milestoneId);
    return title ? `Before “${title}”` : "Linked milestone not found";
  }
  if (standalone !== null) return `By ${standalone}`;
  return "—";
}

const MISSING_ROW_TITLE = "No longer in the plan";

/**
 * Build the renderable section models for a (non-placeholder) diff against
 * the goal's CURRENT rows. Pure: page passes scopedDb rows, playground
 * passes fixtures.
 */
export function buildReplanSections(input: {
  diff: ReplanDiff;
  tasks: readonly CurrentTaskLike[];
  milestones: readonly CurrentMilestoneLike[];
  equipment: readonly CurrentEquipmentLike[];
}): ReplanSectionModel[] {
  const tasksById = new Map(input.tasks.map((t) => [t.id, t]));
  const milestonesById = new Map(input.milestones.map((m) => [m.id, m]));
  const equipmentById = new Map(input.equipment.map((e) => [e.id, e]));
  const milestoneTitleById = new Map(
    input.milestones.map((m) => [m.id, m.title]),
  );

  const rowsBySection: Record<DiffSection, ChangeRowModel[]> = {
    recurring_tasks: [],
    milestones: [],
    equipment: [],
  };

  for (const change of enumerateChanges(input.diff)) {
    if (change.section === "recurring_tasks") {
      if (change.kind === "add") {
        const editable: EditableInput[] = [
          { field: "title", kind: "text", label: "Title", value: change.add.title },
        ];
        if (change.add.cadence === "weekly") {
          editable.push({
            field: "weekday",
            kind: "weekday",
            label: "Weekday",
            value: change.add.weekday,
          });
        }
        editable.push({
          field: "estimated_duration_min",
          kind: "number",
          label: "Duration (minutes)",
          value: change.add.estimated_duration_min,
          min: 1,
        });
        rowsBySection.recurring_tasks.push({
          key: change.key,
          section: change.section,
          kind: "add",
          title: change.add.title,
          details: [
            {
              label: "Cadence",
              value:
                change.add.cadence === "daily"
                  ? "Daily"
                  : `Weekly · ${weekdayName(change.add.weekday)}`,
            },
            {
              label: "Duration",
              value: fmtDuration(change.add.estimated_duration_min),
            },
          ],
          editable,
        });
      } else if (change.kind === "modify") {
        const current = tasksById.get(change.id) ?? null;
        const deltas: FieldDelta[] = [];
        const editable: EditableInput[] = [];
        const c = change.changes;
        if (c.title !== undefined) {
          deltas.push({
            field: "title",
            label: "Title",
            before: current?.title ?? "—",
            after: c.title,
          });
          editable.push({
            field: "title",
            kind: "text",
            label: "Title",
            value: c.title,
          });
        }
        if (c.weekday !== undefined) {
          deltas.push({
            field: "weekday",
            label: "Weekday",
            before: current ? weekdayName(current.weekday) : "—",
            after: weekdayName(c.weekday),
          });
          editable.push({
            field: "weekday",
            kind: "weekday",
            label: "Weekday",
            value: c.weekday,
          });
        }
        if (c.estimated_duration_min !== undefined) {
          deltas.push({
            field: "estimated_duration_min",
            label: "Duration",
            before: current ? fmtDuration(current.estimated_duration_min) : "—",
            after: fmtDuration(c.estimated_duration_min),
          });
          editable.push({
            field: "estimated_duration_min",
            kind: "number",
            label: "Duration (minutes)",
            value: c.estimated_duration_min,
            min: 1,
          });
        }
        if (c.active !== undefined) {
          // Not editable — a pause/reactivate proposal is accepted or
          // rejected as-is (the frozen edit scope).
          deltas.push({
            field: "active",
            label: "Status",
            before: current ? fmtActive(current.active) : "—",
            after: fmtActive(c.active),
          });
        }
        rowsBySection.recurring_tasks.push({
          key: change.key,
          section: change.section,
          kind: "modify",
          title: current?.title ?? c.title ?? MISSING_ROW_TITLE,
          deltas,
          editable,
          unresolved: current === null,
        });
      } else {
        const current = tasksById.get(change.id) ?? null;
        rowsBySection.recurring_tasks.push({
          key: change.key,
          section: change.section,
          kind: "remove",
          title: current?.title ?? MISSING_ROW_TITLE,
          unresolved: current === null,
        });
      }
      continue;
    }

    if (change.section === "milestones") {
      if (change.kind === "add") {
        rowsBySection.milestones.push({
          key: change.key,
          section: change.section,
          kind: "add",
          title: change.add.title,
          details: [
            { label: "Target date", value: fmtDate(change.add.target_date) },
            { label: "Position", value: String(change.add.position + 1) },
          ],
          editable: [
            { field: "title", kind: "text", label: "Title", value: change.add.title },
            {
              field: "target_date",
              kind: "date",
              label: "Target date",
              value: change.add.target_date,
            },
            {
              field: "position",
              kind: "number",
              label: "Position",
              value: change.add.position,
              min: 0,
            },
          ],
        });
      } else if (change.kind === "modify") {
        const current = milestonesById.get(change.id) ?? null;
        const deltas: FieldDelta[] = [];
        const editable: EditableInput[] = [];
        const c = change.changes;
        if (c.title !== undefined) {
          deltas.push({
            field: "title",
            label: "Title",
            before: current?.title ?? "—",
            after: c.title,
          });
          editable.push({
            field: "title",
            kind: "text",
            label: "Title",
            value: c.title,
          });
        }
        if (c.target_date !== undefined) {
          deltas.push({
            field: "target_date",
            label: "Target date",
            before: current ? fmtDate(current.target_date) : "—",
            after: fmtDate(c.target_date),
          });
          editable.push({
            field: "target_date",
            kind: "date",
            label: "Target date",
            value: c.target_date,
          });
        }
        if (c.position !== undefined) {
          deltas.push({
            field: "position",
            label: "Position",
            before: current ? String(current.position + 1) : "—",
            after: String(c.position + 1),
          });
          editable.push({
            field: "position",
            kind: "number",
            label: "Position",
            value: c.position,
            min: 0,
          });
        }
        rowsBySection.milestones.push({
          key: change.key,
          section: change.section,
          kind: "modify",
          title: current?.title ?? c.title ?? MISSING_ROW_TITLE,
          deltas,
          editable,
          unresolved: current === null,
        });
      } else {
        const current = milestonesById.get(change.id) ?? null;
        rowsBySection.milestones.push({
          key: change.key,
          section: change.section,
          kind: "remove",
          title: current?.title ?? MISSING_ROW_TITLE,
          unresolved: current === null,
        });
      }
      continue;
    }

    // equipment
    if (change.kind === "add") {
      rowsBySection.equipment.push({
        key: change.key,
        section: change.section,
        kind: "add",
        title: change.add.title,
        details: [
          { label: "Cost", value: fmtCost(change.add.cost_usd) },
          {
            label: "Needed",
            value: fmtEquipmentAnchor(
              change.add.milestone_id,
              change.add.standalone_deadline,
              milestoneTitleById,
            ),
          },
        ],
        editable: [
          { field: "title", kind: "text", label: "Title", value: change.add.title },
          { field: "cost_usd", kind: "cost", label: "Cost (USD)", value: change.add.cost_usd },
          {
            field: "anchor",
            kind: "anchor",
            label: "Needed",
            milestoneId: change.add.milestone_id,
            standaloneDeadline: change.add.standalone_deadline,
          },
        ],
      });
    } else if (change.kind === "modify") {
      const current = equipmentById.get(change.id) ?? null;
      const deltas: FieldDelta[] = [];
      const editable: EditableInput[] = [];
      const c = change.changes;
      if (c.title !== undefined) {
        deltas.push({
          field: "title",
          label: "Title",
          before: current?.title ?? "—",
          after: c.title,
        });
        editable.push({
          field: "title",
          kind: "text",
          label: "Title",
          value: c.title,
        });
      }
      if (c.cost_usd !== undefined) {
        deltas.push({
          field: "cost_usd",
          label: "Cost",
          before: current ? fmtCost(current.cost_usd) : "—",
          after: fmtCost(c.cost_usd),
        });
        editable.push({
          field: "cost_usd",
          kind: "cost",
          label: "Cost (USD)",
          value: c.cost_usd,
        });
      }
      if (c.milestone_id !== undefined || c.standalone_deadline !== undefined) {
        const afterMilestone =
          c.milestone_id !== undefined
            ? c.milestone_id
            : (current?.milestone_id ?? null);
        const afterStandalone =
          c.standalone_deadline !== undefined
            ? c.standalone_deadline
            : (current?.standalone_deadline ?? null);
        deltas.push({
          field: "anchor",
          label: "Needed",
          before: current
            ? fmtEquipmentAnchor(
                current.milestone_id,
                current.standalone_deadline,
                milestoneTitleById,
              )
            : "—",
          after: fmtEquipmentAnchor(
            afterMilestone,
            afterStandalone,
            milestoneTitleById,
          ),
        });
        // The link + the standalone date are ONE exactly-one anchor — the
        // edit control adjusts both halves together (and the planner allows
        // the pair whenever the proposal touches either half).
        editable.push({
          field: "anchor",
          kind: "anchor",
          label: "Needed",
          milestoneId: afterMilestone,
          standaloneDeadline: afterStandalone,
        });
      }
      rowsBySection.equipment.push({
        key: change.key,
        section: change.section,
        kind: "modify",
        title: current?.title ?? c.title ?? MISSING_ROW_TITLE,
        deltas,
        editable,
        unresolved: current === null,
      });
    } else {
      const current = equipmentById.get(change.id) ?? null;
      rowsBySection.equipment.push({
        key: change.key,
        section: change.section,
        kind: "remove",
        title: current?.title ?? MISSING_ROW_TITLE,
        unresolved: current === null,
      });
    }
  }

  return DIFF_SECTIONS.filter((s) => rowsBySection[s].length > 0).map(
    (section) => ({
      section,
      heading: SECTION_HEADINGS[section],
      rows: rowsBySection[section],
    }),
  );
}

// ---------------------------------------------------------------------------
// The page model — which proposal to show, in which mode
// ---------------------------------------------------------------------------

export interface ReplanGoalHeader {
  id: string;
  title: string;
  colorIndex: number;
}

export interface ProposalRowLike {
  id: string;
  status: "pending" | "accepted" | "partially_accepted" | "rejected";
  trigger: "weekly_check_in" | "structural_edit";
  weekly_check_in_id: string | null;
  proposed_changes: unknown;
  created_at: Date | string;
  decided_at: Date | string | null;
}

function toMs(value: Date | string | null | undefined): number {
  if (value == null) return 0;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/**
 * The route contract: the goal's most recent PENDING proposal, else the most
 * recent DECIDED one (for the read-only summary), else null.
 */
export function selectDisplayProposal<T extends ProposalRowLike>(
  proposals: readonly T[],
): T | null {
  const pending = proposals
    .filter((p) => p.status === "pending")
    .sort((a, b) => toMs(b.created_at) - toMs(a.created_at));
  if (pending[0]) return pending[0];
  const decided = proposals
    .filter((p) => p.status !== "pending")
    .sort((a, b) => toMs(b.decided_at) - toMs(a.decided_at));
  return decided[0] ?? null;
}

/** Deterministic date line for the decided summary (fixture-stable). */
export function decidedAtLabel(value: Date | string | null): string | null {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  }).format(date);
}

export type ReplanPageModel =
  | {
      mode: "review";
      goal: ReplanGoalHeader;
      /** Review controls render only while the goal is still active. */
      goalActive: boolean;
      proposalId: string;
      sections: ReplanSectionModel[];
      changeCount: number;
      /** Any modify/remove target vanished since generation — the commit
       *  would refuse the whole proposal; offer regeneration instead. */
      hasUnresolved: boolean;
      milestoneOptions: Array<{ id: string; title: string }>;
      generate: { goalId: string; weeklyCheckInId: string } | null;
    }
  | {
      mode: "generate";
      goal: ReplanGoalHeader;
      /** null when regeneration is impossible (check-in row gone). */
      generate: { goalId: string; weeklyCheckInId: string } | null;
    }
  | {
      mode: "decided";
      goal: ReplanGoalHeader;
      status: DecidedStatus;
      decidedAtLabel: string | null;
      changeCount: number;
      sections: ReplanSectionModel[];
    }
  | { mode: "none"; goal: ReplanGoalHeader };

/**
 * Assemble the whole page model from scoped rows (or fixtures). Pure — the
 * single composition point the page, the playground, and the tests share.
 */
export function buildReplanPageModel(input: {
  goal: {
    id: string;
    title: string;
    color_index: number;
    status: "active" | "completed" | "archived";
  };
  proposal: ProposalRowLike | null;
  /** ReplanDiffSchema-parsed proposed_changes, or null when unparseable. */
  diff: import("@/lib/ai/replan-diff").ReplanDiff | null;
  tasks: readonly CurrentTaskLike[];
  milestones: readonly CurrentMilestoneLike[];
  equipment: readonly CurrentEquipmentLike[];
}): ReplanPageModel {
  const goal: ReplanGoalHeader = {
    id: input.goal.id,
    title: input.goal.title,
    colorIndex: input.goal.color_index,
  };
  const proposal = input.proposal;
  // No proposal → the retry-friendly empty state. This ALSO covers the
  // "generation failed" path (S1): the metered wrapper's onFailure deletes the
  // stranded weekly-fill placeholder, so a failed generation lands here rather
  // than on a dangling pending row — the user re-selects the goal in their
  // check-in, which re-POSTs and recreates the placeholder.
  if (!proposal) return { mode: "none", goal };

  const generate =
    proposal.trigger === "weekly_check_in" && proposal.weekly_check_in_id
      ? { goalId: goal.id, weeklyCheckInId: proposal.weekly_check_in_id }
      : null;

  // A pending proposal whose diff is missing/unparseable or still the
  // Slice-1 placeholder offers Generate — never an empty diff.
  if (proposal.status === "pending") {
    if (input.diff === null || isPlaceholderDiff(input.diff)) {
      return { mode: "generate", goal, generate };
    }
    const sections = buildReplanSections({
      diff: input.diff,
      tasks: input.tasks,
      milestones: input.milestones,
      equipment: input.equipment,
    });
    const rows = sections.flatMap((s) => s.rows);
    return {
      mode: "review",
      goal,
      goalActive: input.goal.status === "active",
      proposalId: proposal.id,
      sections,
      changeCount: rows.length,
      hasUnresolved: rows.some((r) => r.kind !== "add" && r.unresolved),
      milestoneOptions: input.milestones.map((m) => ({
        id: m.id,
        title: m.title,
      })),
      generate,
    };
  }

  const sections = input.diff
    ? buildReplanSections({
        diff: input.diff,
        tasks: input.tasks,
        milestones: input.milestones,
        equipment: input.equipment,
      })
    : [];
  return {
    mode: "decided",
    goal,
    status: proposal.status,
    decidedAtLabel: decidedAtLabel(proposal.decided_at),
    changeCount: sections.reduce((n, s) => n + s.rows.length, 0),
    sections,
  };
}

// ---------------------------------------------------------------------------
// Action handler contracts (real server action / endpoint fetch in product,
// deterministic stubs in the playground harness)
// ---------------------------------------------------------------------------

export type ReplanActionResult = { ok: true } | { ok: false; error: string };

export type DecideReplanHandler = (input: {
  proposalId: string;
  decisions: DecisionMap;
}) => Promise<ReplanActionResult>;

export type GenerateReplanHandler = () => Promise<ReplanActionResult>;

// ---------------------------------------------------------------------------
// Inline ✎ editor — draft values + per-field validation (pure)
// ---------------------------------------------------------------------------

/** The anchor select's "by a date" sentinel (milestone ids are UUIDs, so it
 *  can never collide). */
export const ANCHOR_DATE = "__date";

/** The editor's draft — input-shaped strings keyed by field name. The anchor
 *  control splits into "anchor-choice" + "anchor-date". */
export type EditorValues = Record<string, string>;

export function initialEditorValues(
  fields: EditableInput[],
  initial: Record<string, unknown>,
): EditorValues {
  const values: EditorValues = {};
  for (const f of fields) {
    if (f.kind === "anchor") {
      const milestoneId =
        "milestone_id" in initial
          ? (initial.milestone_id as string | null)
          : f.milestoneId;
      const standalone =
        "standalone_deadline" in initial
          ? (initial.standalone_deadline as string | null)
          : f.standaloneDeadline;
      values["anchor-choice"] = milestoneId ?? ANCHOR_DATE;
      values["anchor-date"] = standalone ?? "";
      continue;
    }
    const raw = f.field in initial ? initial[f.field] : f.value;
    if (f.field === "position") {
      values[f.field] = String((raw as number) + 1);
    } else if (f.kind === "cost") {
      values[f.field] = raw === null ? "" : String(raw);
    } else if (f.kind === "weekday") {
      values[f.field] = raw === null ? "1" : String(raw);
    } else {
      values[f.field] = raw === null ? "" : String(raw);
    }
  }
  return values;
}

/** Per-field validation messages, keyed by the SAME field names the editor's
 *  inputs use ("anchor-date" for the anchor's date input). Each message names
 *  the violated rule — never only a generic "needs attention" line. */
export type EditorFieldErrors = Record<string, string>;

export type EditedRecordResult =
  | { ok: true; edited: Record<string, unknown> | null }
  | { ok: false; errors: EditorFieldErrors };

const NUMBER_RULES: Record<
  "estimated_duration_min" | "position",
  { whole: string; min: string }
> = {
  estimated_duration_min: {
    whole: "Duration must be a whole number of minutes.",
    min: "Duration must be at least 1 minute.",
  },
  position: {
    whole: "Position must be a whole number.",
    min: "Position must be 1 or higher.",
  },
};

/** values → the edited record, including ONLY fields that differ from the
 *  proposal. `edited: null` = no effective edits. Invalid values come back as
 *  per-field messages (ALL invalid fields, not just the first). */
export function buildEditedRecord(
  fields: EditableInput[],
  values: EditorValues,
): EditedRecordResult {
  const edited: Record<string, unknown> = {};
  const errors: EditorFieldErrors = {};
  for (const f of fields) {
    if (f.kind === "anchor") {
      const choice = values["anchor-choice"] ?? ANCHOR_DATE;
      const milestoneId = choice === ANCHOR_DATE ? null : choice;
      const standalone =
        choice === ANCHOR_DATE ? (values["anchor-date"] ?? "").trim() : "";
      if (choice === ANCHOR_DATE && standalone === "") {
        errors["anchor-date"] = "Pick a date this is needed by.";
        continue;
      }
      const standaloneValue = choice === ANCHOR_DATE ? standalone : null;
      if (
        milestoneId !== f.milestoneId ||
        standaloneValue !== f.standaloneDeadline
      ) {
        edited.milestone_id = milestoneId;
        edited.standalone_deadline = standaloneValue;
      }
      continue;
    }
    const raw = (values[f.field] ?? "").trim();
    if (f.kind === "text") {
      if (raw === "") {
        errors[f.field] = "Title can't be empty.";
      } else if (raw !== f.value) {
        edited[f.field] = raw;
      }
    } else if (f.kind === "weekday") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 0 || n > 6) {
        // Unreachable through the weekday select — defensive.
        errors[f.field] = "Weekday must be a day of the week.";
      } else if (n !== f.value) {
        edited[f.field] = n;
      }
    } else if (f.kind === "number") {
      const rules = NUMBER_RULES[f.field];
      const n = Number(raw);
      if (!Number.isInteger(n)) {
        errors[f.field] = rules.whole;
      } else {
        // Position is 1-based in the editor; the record stays 0-based.
        const value = f.field === "position" ? n - 1 : n;
        if (value < f.min) {
          errors[f.field] = rules.min;
        } else if (value !== f.value) {
          edited[f.field] = value;
        }
      }
    } else if (f.kind === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        errors[f.field] =
          raw === ""
            ? "Target date can't be empty."
            : "Target date must be a full date.";
      } else if (raw !== f.value) {
        edited[f.field] = raw;
      }
    } else if (f.kind === "cost") {
      const value = raw === "" ? null : Number(raw);
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        errors[f.field] = "Cost must be 0 or more.";
      } else if (value !== f.value) {
        edited[f.field] = value;
      }
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, edited: Object.keys(edited).length > 0 ? edited : null };
}
