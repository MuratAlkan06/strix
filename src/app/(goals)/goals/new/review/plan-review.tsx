/**
 * plan-review.tsx — the editable draft-plan review surface
 * (phase-1-golden-path "Draft-plan review/edit UI"; DESIGN.md §8 quiet
 * chrome, §11 ≥44px targets).
 *
 * Four sections (daily habits, weekly sessions, milestones, equipment), each
 * with inline per-item editing, add/remove, and — for milestones — explicit
 * reorder controls. Reordering is move-up/move-down buttons rather than
 * pointer drag: a deliberate Phase 1 cut (recorded in the slice report) — the
 * buttons are keyboard-accessible, deterministic at 375px, and honor §7's "no
 * list layout animations on reorder" without a drag dependency.
 *
 * All edit state is client-side (the reducer in review-plan.ts, which also
 * tracks edits_count for plan_accepted). NOTHING saves silently: navigating
 * away discards nothing and commits nothing — the draft persists server-side
 * until "Save goal" runs the transactional server action passed via onSave
 * (prop-driven so the /playground/plan-review harness can render this exact
 * component with a deterministic no-op, the IntensityConfirmCard pattern).
 *
 * Validation problems render as §8 warning notes (primary-toned, icon+text,
 * never red); the save error line is a calm constant, in register.
 */
"use client";

import { useReducer, useState } from "react";
import { ChevronDown, ChevronUp, CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PlanDraft } from "@/lib/ai/plan-schema";
import {
  planEditReducer,
  serializeEditablePlan,
  toEditablePlan,
  validateEditablePlan,
  WEEKDAY_LABELS,
  type EditableDaily,
  type EditableEquipment,
  type EditableMilestone,
  type EditableWeekly,
  type PlanSection,
  type PlanValidationIssue,
} from "./review-plan";
import type { SaveGoalInput, SaveGoalResult } from "./save-goal";

interface PlanReviewProps {
  /** The validated plan draft (goal_drafts.plan_draft). */
  plan: PlanDraft;
  /**
   * Persist the goal (the saveGoal server action in the live flow; a
   * deterministic no-op in the design-review harness). A successful live
   * save redirects, so the promise may resolve undefined mid-navigation.
   */
  onSave: (input: SaveGoalInput) => Promise<SaveGoalResult | undefined | void>;
}

const SELECT_CLASS =
  "h-11 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-transparent px-2.5 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function formatDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${iso}T00:00:00`));
}

function parseOptionalInt(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseOptionalNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function PlanReview({ plan, onSave }: PlanReviewProps) {
  const [state, dispatch] = useReducer(planEditReducer, plan, toEditablePlan);
  const [editing, setEditing] = useState<{
    section: PlanSection;
    id: string;
  } | null>(null);
  const [issues, setIssues] = useState<PlanValidationIssue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);

  function isEditing(section: PlanSection, id: string) {
    return editing?.section === section && editing.id === id;
  }

  function issueFor(section: PlanSection, id: string) {
    return issues.find((i) => i.section === section && i.id === id) ?? null;
  }

  function addItem(section: PlanSection) {
    // The reducer assigns `n${nextId}` — known before dispatch, so the new
    // item opens directly in its edit form.
    const newId = `n${state.nextId}`;
    dispatch({ type: "add", section });
    setEditing({ section, id: newId });
  }

  async function handleSave() {
    if (pending || saved) return;
    setEditing(null);
    const found = validateEditablePlan(state);
    setIssues(found);
    if (found.length > 0) {
      setError("A few items need attention before saving.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const result = await onSave({
        plan: serializeEditablePlan(state),
        editsCount: state.editsCount,
      });
      if (!result) return; // success — the action is redirecting.
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
        setPending(false);
      }
    } catch {
      setError("That didn't save. Try once more.");
      setPending(false);
    }
  }

  if (saved) {
    // Live saves redirect before this renders — it is the harness's terminal
    // state (the IntensityInterim pattern), never a dead end in product.
    return (
      <section
        aria-labelledby="plan-saved-heading"
        className="rounded-xl border border-border bg-card p-5 sm:p-6"
      >
        <h2
          id="plan-saved-heading"
          className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
        >
          Your goal is set.
        </h2>
        <p className="mt-2 text-base leading-relaxed text-foreground">
          The plan is saved. The work starts now.
        </p>
      </section>
    );
  }

  const milestoneTitleById = new Map(
    state.milestones.map((m) => [m.id, m.title]),
  );
  const milestoneDateById = new Map(
    state.milestones.map((m) => [m.id, m.target_date]),
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Daily habits ----------------------------------------------------- */}
      <Section title="Daily habits">
        <ul className="flex flex-col gap-2">
          {state.daily.map((item) => (
            <li key={item.id}>
              {isEditing("daily", item.id) ? (
                <DailyEditor
                  item={item}
                  onDone={(patch) => {
                    dispatch({ type: "update", section: "daily", id: item.id, patch });
                    setEditing(null);
                  }}
                  onRemove={() => {
                    dispatch({ type: "remove", section: "daily", id: item.id });
                    setEditing(null);
                  }}
                />
              ) : (
                <ItemRow
                  title={item.title}
                  meta={[
                    item.estimated_duration_min !== null
                      ? `${item.estimated_duration_min} min`
                      : null,
                  ]}
                  secondary={item.description || null}
                  issue={issueFor("daily", item.id)}
                  onEdit={() => setEditing({ section: "daily", id: item.id })}
                />
              )}
            </li>
          ))}
        </ul>
        <AddButton label="Add a habit" onClick={() => addItem("daily")} />
      </Section>

      {/* Weekly sessions -------------------------------------------------- */}
      <Section title="Weekly sessions">
        <ul className="flex flex-col gap-2">
          {state.weekly.map((item) => (
            <li key={item.id}>
              {isEditing("weekly", item.id) ? (
                <WeeklyEditor
                  item={item}
                  onDone={(patch) => {
                    dispatch({ type: "update", section: "weekly", id: item.id, patch });
                    setEditing(null);
                  }}
                  onRemove={() => {
                    dispatch({ type: "remove", section: "weekly", id: item.id });
                    setEditing(null);
                  }}
                />
              ) : (
                <ItemRow
                  title={item.title}
                  meta={[
                    WEEKDAY_LABELS[item.weekday] ?? null,
                    item.estimated_duration_min !== null
                      ? `${item.estimated_duration_min} min`
                      : null,
                  ]}
                  secondary={item.description || null}
                  issue={issueFor("weekly", item.id)}
                  onEdit={() => setEditing({ section: "weekly", id: item.id })}
                />
              )}
            </li>
          ))}
        </ul>
        <AddButton label="Add a session" onClick={() => addItem("weekly")} />
      </Section>

      {/* Milestones (ordered; explicit reorder controls) ------------------ */}
      <Section title="Milestones">
        <ol className="flex flex-col gap-2">
          {state.milestones.map((item, index) => (
            <li key={item.id}>
              {isEditing("milestones", item.id) ? (
                <MilestoneEditor
                  item={item}
                  onDone={(patch) => {
                    dispatch({ type: "update", section: "milestones", id: item.id, patch });
                    setEditing(null);
                  }}
                  onRemove={() => {
                    dispatch({ type: "remove", section: "milestones", id: item.id });
                    setEditing(null);
                  }}
                />
              ) : (
                <ItemRow
                  title={item.title}
                  meta={[item.target_date ? formatDate(item.target_date) : null]}
                  secondary={null}
                  issue={issueFor("milestones", item.id)}
                  onEdit={() => setEditing({ section: "milestones", id: item.id })}
                  reorder={{
                    upDisabled: index === 0,
                    downDisabled: index === state.milestones.length - 1,
                    onUp: () =>
                      dispatch({ type: "moveMilestone", id: item.id, direction: "up" }),
                    onDown: () =>
                      dispatch({ type: "moveMilestone", id: item.id, direction: "down" }),
                  }}
                />
              )}
            </li>
          ))}
        </ol>
        <AddButton label="Add a milestone" onClick={() => addItem("milestones")} />
      </Section>

      {/* Equipment --------------------------------------------------------- */}
      <Section title="Equipment">
        <ul className="flex flex-col gap-2">
          {state.equipment.map((item) => {
            const linkedTitle =
              item.milestoneId !== null
                ? milestoneTitleById.get(item.milestoneId) || "a milestone"
                : null;
            const linkedDate =
              item.milestoneId !== null
                ? milestoneDateById.get(item.milestoneId) || null
                : item.standalone_deadline;
            return (
              <li key={item.id}>
                {isEditing("equipment", item.id) ? (
                  <EquipmentEditor
                    item={item}
                    milestones={state.milestones}
                    onDone={(patch) => {
                      dispatch({ type: "update", section: "equipment", id: item.id, patch });
                      setEditing(null);
                    }}
                    onRemove={() => {
                      dispatch({ type: "remove", section: "equipment", id: item.id });
                      setEditing(null);
                    }}
                  />
                ) : (
                  <ItemRow
                    title={item.title}
                    meta={[
                      linkedDate ? `By ${formatDate(linkedDate)}` : null,
                      linkedTitle ? `For ${linkedTitle}` : null,
                      item.cost_usd !== null ? `$${item.cost_usd}` : null,
                    ]}
                    secondary={null}
                    issue={issueFor("equipment", item.id)}
                    onEdit={() => setEditing({ section: "equipment", id: item.id })}
                  />
                )}
              </li>
            );
          })}
        </ul>
        <AddButton label="Add an item" onClick={() => addItem("equipment")} />
      </Section>

      {/* Save -------------------------------------------------------------- */}
      <div className="flex flex-col gap-3 pb-6">
        {error && (
          <p
            role="status"
            className="flex items-start gap-2 text-sm leading-relaxed text-primary"
          >
            <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}
        <Button
          type="button"
          size="lg"
          onClick={() => void handleSave()}
          disabled={pending}
          className="h-11 min-h-11 w-full px-5 sm:w-auto"
        >
          {pending ? "Saving" : "Save goal"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Nothing is saved until you save the goal. Leaving keeps the draft.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared chrome
// ---------------------------------------------------------------------------

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <h2 className="font-heading text-lg font-medium tracking-tight text-foreground sm:text-xl">
        {title}
      </h2>
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="h-11 min-h-11 w-full justify-center sm:w-auto sm:self-start sm:px-4"
    >
      {label}
    </Button>
  );
}

interface ReorderControls {
  upDisabled: boolean;
  downDisabled: boolean;
  onUp: () => void;
  onDown: () => void;
}

function ItemRow({
  title,
  meta,
  secondary,
  issue,
  onEdit,
  reorder,
}: {
  title: string;
  meta: Array<string | null>;
  secondary: string | null;
  issue: PlanValidationIssue | null;
  onEdit: () => void;
  reorder?: ReorderControls;
}) {
  const displayTitle = title.trim() === "" ? "Untitled" : title;
  const metaLine = meta.filter(Boolean).join(" · ");
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-medium text-foreground">{displayTitle}</p>
          {metaLine && (
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
              {metaLine}
            </p>
          )}
          {secondary && (
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {secondary}
            </p>
          )}
        </div>
        {reorder && (
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              variant="ghost"
              aria-label={`Move ${displayTitle} up`}
              disabled={reorder.upDisabled}
              onClick={reorder.onUp}
              className="size-11"
            >
              <ChevronUp aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Move ${displayTitle} down`}
              disabled={reorder.downDisabled}
              onClick={reorder.onDown}
              className="size-11"
            >
              <ChevronDown aria-hidden="true" />
            </Button>
          </div>
        )}
        <Button
          type="button"
          variant="ghost"
          onClick={onEdit}
          aria-label={`Edit ${displayTitle}`}
          className="h-11 min-h-11 shrink-0 px-3"
        >
          Edit
        </Button>
      </div>
      {issue && (
        <p className="mt-2 flex items-start gap-2 text-sm text-primary">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {issue.message}
        </p>
      )}
    </div>
  );
}

function EditorFrame({
  children,
  onDone,
  onRemove,
}: {
  children: React.ReactNode;
  onDone: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-ring bg-accent/20 p-3">
      <div className="flex flex-col gap-3">{children}</div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          onClick={onRemove}
          className="h-11 min-h-11 px-3 text-muted-foreground"
        >
          Remove
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onDone}
          className="h-11 min-h-11 px-4"
        >
          Done
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-section editors (local field state; one committed update per Done)
// ---------------------------------------------------------------------------

function DailyEditor({
  item,
  onDone,
  onRemove,
}: {
  item: EditableDaily;
  onDone: (patch: Partial<Omit<EditableDaily, "id" | "description">>) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [duration, setDuration] = useState(
    item.estimated_duration_min?.toString() ?? "",
  );
  return (
    <EditorFrame
      onRemove={onRemove}
      onDone={() =>
        onDone({
          title,
          estimated_duration_min: parseOptionalInt(duration),
        })
      }
    >
      <Field label="Title" htmlFor={`${item.id}-title`}>
        <Input
          id={`${item.id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </Field>
      {/* Description is AI review-context only — read-only here, no edit
          affordance: recurring_tasks has no description column, so an edit
          would silently evaporate at save. Persisting it requires a
          recurring_tasks.description column (product decision deferred). */}
      {item.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      )}
      <Field label="Minutes" htmlFor={`${item.id}-min`}>
        <Input
          id={`${item.id}-min`}
          type="number"
          inputMode="numeric"
          min={1}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="h-11"
        />
      </Field>
    </EditorFrame>
  );
}

function WeeklyEditor({
  item,
  onDone,
  onRemove,
}: {
  item: EditableWeekly;
  onDone: (patch: Partial<Omit<EditableWeekly, "id" | "description">>) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [weekday, setWeekday] = useState(item.weekday);
  const [duration, setDuration] = useState(
    item.estimated_duration_min?.toString() ?? "",
  );
  return (
    <EditorFrame
      onRemove={onRemove}
      onDone={() =>
        onDone({
          title,
          weekday,
          estimated_duration_min: parseOptionalInt(duration),
        })
      }
    >
      <Field label="Title" htmlFor={`${item.id}-title`}>
        <Input
          id={`${item.id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </Field>
      {/* Read-only AI review context — see DailyEditor's note. */}
      {item.description && (
        <p className="text-sm leading-relaxed text-muted-foreground">
          {item.description}
        </p>
      )}
      <Field label="Weekday" htmlFor={`${item.id}-weekday`}>
        <select
          id={`${item.id}-weekday`}
          value={weekday}
          onChange={(e) => setWeekday(Number(e.target.value))}
          className={SELECT_CLASS}
        >
          {WEEKDAY_LABELS.map((label, i) => (
            <option key={label} value={i}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Minutes" htmlFor={`${item.id}-min`}>
        <Input
          id={`${item.id}-min`}
          type="number"
          inputMode="numeric"
          min={1}
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
          className="h-11"
        />
      </Field>
    </EditorFrame>
  );
}

function MilestoneEditor({
  item,
  onDone,
  onRemove,
}: {
  item: EditableMilestone;
  onDone: (patch: Partial<Omit<EditableMilestone, "id">>) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [targetDate, setTargetDate] = useState(item.target_date);
  return (
    <EditorFrame
      onRemove={onRemove}
      onDone={() => onDone({ title, target_date: targetDate })}
    >
      <Field label="Title" htmlFor={`${item.id}-title`}>
        <Input
          id={`${item.id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </Field>
      <Field label="Target date" htmlFor={`${item.id}-date`}>
        <Input
          id={`${item.id}-date`}
          type="date"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
          className="h-11"
        />
      </Field>
    </EditorFrame>
  );
}

function EquipmentEditor({
  item,
  milestones,
  onDone,
  onRemove,
}: {
  item: EditableEquipment;
  milestones: EditableMilestone[];
  onDone: (patch: Partial<Omit<EditableEquipment, "id">>) => void;
  onRemove: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [cost, setCost] = useState(item.cost_usd?.toString() ?? "");
  // "" = no linkage chosen yet (invalid until picked); "standalone" = own
  // date; otherwise a milestone id. Exactly-one is structural here: picking a
  // milestone clears the date, picking standalone requires one.
  const [linkage, setLinkage] = useState<string>(
    item.milestoneId ?? (item.standalone_deadline !== null ? "standalone" : ""),
  );
  const [deadline, setDeadline] = useState(item.standalone_deadline ?? "");

  function commit() {
    const linkedToMilestone =
      linkage !== "" && linkage !== "standalone";
    onDone({
      title,
      cost_usd: parseOptionalNumber(cost),
      milestoneId: linkedToMilestone ? linkage : null,
      standalone_deadline:
        linkage === "standalone" && deadline !== "" ? deadline : null,
    });
  }

  return (
    <EditorFrame onRemove={onRemove} onDone={commit}>
      <Field label="Item" htmlFor={`${item.id}-title`}>
        <Input
          id={`${item.id}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </Field>
      <Field label="Cost (USD)" htmlFor={`${item.id}-cost`}>
        <Input
          id={`${item.id}-cost`}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="h-11"
        />
      </Field>
      <Field label="Needed for" htmlFor={`${item.id}-linkage`}>
        <select
          id={`${item.id}-linkage`}
          value={linkage}
          onChange={(e) => setLinkage(e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="" disabled>
            Pick a milestone or a date
          </option>
          {milestones.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title.trim() === "" ? "Untitled milestone" : m.title}
            </option>
          ))}
          <option value="standalone">A date of its own</option>
        </select>
      </Field>
      {linkage === "standalone" && (
        <Field label="Needed by" htmlFor={`${item.id}-deadline`}>
          <Input
            id={`${item.id}-deadline`}
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="h-11"
          />
        </Field>
      )}
    </EditorFrame>
  );
}
