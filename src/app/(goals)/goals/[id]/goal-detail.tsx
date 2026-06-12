"use client";

/**
 * goal-detail.tsx — the editable goal-detail surface (phase-1-golden-path
 * "Goal detail"; DESIGN.md §8 quiet chrome, §11 ≥44px targets, one h1).
 *
 * Prop-driven actions (the EquipmentList/PlanReview pattern): the /goals/[id]
 * page passes the real server actions; /playground/goal-detail passes
 * deterministic no-ops. This surface writes LIVE — unlike plan review there is
 * no client-side draft: each Done/Remove/Add commits through a guarded server
 * action, with the local list state updated only on a successful result
 * (intensity and reorder toggle optimistically and revert on failure, the
 * purchased-checkbox posture).
 *
 * Composition notes:
 *   - Header: h1 title, GoalChip color attribution paired with the palette
 *     name (color never the sole signal), target date, intensity control.
 *     No static scene tile — but completing the goal mounts the ONE animated
 *     moment (CompletionScene, DESIGN.md §4.3) in the header's scene area:
 *     "Mark complete" (active goals only) uses a two-tap inline confirm (the
 *     EditorFrame Cancel/primary chrome — completion is not reversible
 *     in-product), then the sunrise plays over the goal's scene variant and
 *     the header flips to the existing non-active status treatment. No
 *     confetti, no redirect mid-animation; on the next load the page renders
 *     the settled completed state without the scene.
 *   - Intensity control: three explicit options; the effective intensity is
 *     the active selection; the support line states what it follows. A click
 *     is an explicit override write — including picking the value already
 *     shown as effective while the override is unset (onClick, not onChange,
 *     so re-picking the checked option still pins it). Keyboard follows the
 *     APG radiogroup pattern: roving tabindex (one tab stop), arrows move
 *     focus + selection with wrap, Space/Enter select the focused option.
 *   - Section editors mirror plan-review's (inline edit, add/remove,
 *     milestone move up/down — keyboard-accessible buttons, no drag).
 *   - "Adjust plan": visibly disabled with in-register support text — the
 *     replan flow is Phase 2; no dead-looking active button.
 *   - Replan banner: rendered ONLY when NEXT_PUBLIC_REPLAN_ENABLED === "true"
 *     AND a structural edit landed (shouldShowReplanBanner). Phase 1 ships
 *     flag-off: edits save normally, no banner anywhere.
 *   - READ-ONLY GATE (phase 2 slice 6): non-active goals render with zero
 *     edit affordances — no Edit/Add/Remove, no milestone reorder, no
 *     intensity radios (the effective value shows as plain text), no Adjust
 *     plan, no replan banner; Mark complete was already active-only. Keyed
 *     off the LOCAL status (isReadOnlyGoalStatus), so completing a goal
 *     in-session settles into the same read-only treatment a reload shows.
 *     The status badge + quiet header treatment are unchanged.
 */
import { useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, CircleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CompletionScene } from "@/components/completion-scene";
import { GoalChip } from "@/components/goal-chip";
import { GOAL_COLOR_NAMES } from "@/lib/goal-colors";
import { formatDate, formatUsd } from "@/lib/format";
import { INTENSITY_LEVELS } from "@/lib/ai/intake-schema";
import { intensityLabel } from "../new/intensity-confirm";
import { WEEKDAY_LABELS } from "../new/review/review-plan";
import {
  ADJUST_PLAN_SUPPORT_COPY,
  REPLAN_BANNER_COPY,
  intensitySupportCopy,
  isReadOnlyGoalStatus,
  nextIntensityOnKey,
  shouldShowReplanBanner,
  type EffectiveIntensity,
  type EquipmentItemModel,
  type GoalDetailActions,
  type GoalDetailModel,
  type Intensity,
  type MilestoneItemModel,
  type TaskItemModel,
} from "./detail-model";

const SELECT_CLASS =
  "h-11 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-transparent px-2.5 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

const ERR_FALLBACK = "That didn't save. Try once more.";

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

type Section = "daily" | "weekly" | "milestones" | "equipment";

/** The open editor: an existing item's id, or null for the create form. */
type Editing = { section: Section; id: string | null } | null;

interface GoalDetailProps {
  model: GoalDetailModel;
  actions: GoalDetailActions;
  /** Raw NEXT_PUBLIC_REPLAN_ENABLED value (gate opens only on "true"). */
  replanFlag: string | undefined;
  /** Playground-only: mount with the completion moment already settled (the
   *  state a user is in right after Mark complete). Real pages omit it — a
   *  reload of a completed goal renders the plain status treatment. */
  initialCelebration?: boolean;
}

export function GoalDetail({
  model,
  actions,
  replanFlag,
  initialCelebration = false,
}: GoalDetailProps) {
  const goalId = model.id;

  // Live lists — server truth at render, updated only on confirmed writes.
  const [intensity, setIntensity] = useState<EffectiveIntensity>(
    model.intensity,
  );
  // Goal status flips locally on a confirmed completeGoal write; celebrating
  // mounts the CompletionScene for THIS session only (see initialCelebration).
  const [status, setStatus] = useState(model.status);
  const [celebrating, setCelebrating] = useState(initialCelebration);
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [daily, setDaily] = useState<TaskItemModel[]>(model.daily);
  const [weekly, setWeekly] = useState<TaskItemModel[]>(model.weekly);
  const [milestones, setMilestones] = useState<MilestoneItemModel[]>(
    model.milestones,
  );
  const [equipment, setEquipment] = useState<EquipmentItemModel[]>(
    model.equipment,
  );

  const [editing, setEditing] = useState<Editing>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Structural edits (add/remove/reschedule across the four sections) arm the
  // Phase 2 replan banner; with the flag off it never renders.
  const [structuralEdited, setStructuralEdited] = useState(false);

  function isEditing(section: Section, id: string | null) {
    return editing?.section === section && editing.id === id;
  }

  /** Open/close an editor, dropping any stale error from a previous attempt. */
  function openEditor(next: Editing) {
    setError(null);
    setEditing(next);
  }

  /** Run one server write with the shared pending/error discipline. Returns
   *  the result, or a calm failure when the action throws. */
  async function run<T extends { ok: boolean }>(
    fn: () => Promise<T>,
  ): Promise<T | { ok: false; error: string }> {
    if (pending) return { ok: false, error: ERR_FALLBACK };
    setPending(true);
    setError(null);
    try {
      return await fn();
    } catch {
      return { ok: false, error: ERR_FALLBACK };
    } finally {
      setPending(false);
    }
  }

  function fail(result: { ok: false; error: string }) {
    setError(result.error);
  }

  function structural() {
    setStructuralEdited(true);
  }

  // --- intensity -----------------------------------------------------------

  // One ref per radio (INTENSITY_LEVELS order) so arrow movement can put
  // focus on the newly selected option (APG: focus follows selection).
  const intensityRefs = useRef<Array<HTMLButtonElement | null>>([]);

  async function handleIntensity(next: Intensity) {
    // Re-picking an already-pinned override is a true no-op; picking the
    // value shown as effective while the override is UNSET is an explicit
    // pin and still writes (the phase contract's rule).
    if (intensity.source === "override" && intensity.value === next) return;
    const prev = intensity;
    setIntensity({ value: next, source: "override" }); // optimistic
    const result = await run(() => actions.setIntensity({ goalId, intensity: next }));
    if (!result.ok) {
      setIntensity(prev);
      fail(result);
    }
  }

  /** APG radiogroup keyboard: arrows move focus AND selection with wrap
   *  (Space/Enter select via the native button click — onClick keeps the
   *  explicit-override write). `level` is the focused radio, the base for
   *  the move; unhandled keys fall through to the browser. */
  function handleIntensityKey(
    event: React.KeyboardEvent<HTMLButtonElement>,
    level: Intensity,
  ) {
    const next = nextIntensityOnKey(level, event.key);
    if (next === null) return;
    event.preventDefault(); // arrows must not scroll the page
    intensityRefs.current[INTENSITY_LEVELS.indexOf(next)]?.focus();
    void handleIntensity(next);
  }

  // --- completion (the one signature moment, §4.3) ---------------------------

  async function handleComplete() {
    const result = await run(() => actions.completeGoal({ goalId }));
    if (!result.ok) return fail(result);
    // The status flips first (the non-active treatment shows immediately);
    // the scene mounts with complete=true and plays the sunrise. No redirect.
    setConfirmingComplete(false);
    setStatus("completed");
    setCelebrating(true);
  }

  // --- tasks (daily + weekly) ----------------------------------------------

  function setTaskList(section: "daily" | "weekly") {
    return section === "daily" ? setDaily : setWeekly;
  }

  async function saveTask(
    section: "daily" | "weekly",
    id: string | null,
    fields: { title: string; weekday: number | null; durationMin: number | null },
  ) {
    const title = fields.title.trim();
    if (title === "") {
      setError(
        section === "daily"
          ? "Give this habit a title."
          : "Give this session a title.",
      );
      return;
    }
    if (id === null) {
      const result = await run(() =>
        actions.addTask({
          goalId,
          cadence: section,
          title,
          weekday: section === "weekly" ? fields.weekday : null,
          estimatedDurationMin: fields.durationMin,
        }),
      );
      if (!result.ok) return fail(result);
      setTaskList(section)((items) => [
        ...items,
        {
          id: result.id,
          title,
          weekday: section === "weekly" ? fields.weekday : null,
          estimatedDurationMin: fields.durationMin,
        },
      ]);
    } else {
      const result = await run(() =>
        actions.updateTask({
          goalId,
          taskId: id,
          title,
          ...(section === "weekly" && fields.weekday !== null
            ? { weekday: fields.weekday }
            : {}),
          estimatedDurationMin: fields.durationMin,
        }),
      );
      if (!result.ok) return fail(result);
      setTaskList(section)((items) =>
        items.map((t) =>
          t.id === id
            ? {
                ...t,
                title,
                weekday: section === "weekly" ? fields.weekday : null,
                estimatedDurationMin: fields.durationMin,
              }
            : t,
        ),
      );
    }
    structural();
    setEditing(null);
  }

  async function removeTask(section: "daily" | "weekly", id: string) {
    const result = await run(() => actions.removeTask({ goalId, taskId: id }));
    if (!result.ok) return fail(result);
    setTaskList(section)((items) => items.filter((t) => t.id !== id));
    structural();
    setEditing(null);
  }

  // --- milestones ----------------------------------------------------------

  async function saveMilestone(
    id: string | null,
    fields: { title: string; targetDate: string },
  ) {
    const title = fields.title.trim();
    if (title === "") {
      setError("Give this milestone a title.");
      return;
    }
    if (!ISO_DATE_RE.test(fields.targetDate)) {
      setError("Set a target date.");
      return;
    }
    if (id === null) {
      const result = await run(() =>
        actions.addMilestone({ goalId, title, targetDate: fields.targetDate }),
      );
      if (!result.ok) return fail(result);
      setMilestones((items) => [
        ...items,
        { id: result.id, title, targetDate: fields.targetDate, completedOn: null },
      ]);
    } else {
      const result = await run(() =>
        actions.updateMilestone({
          goalId,
          milestoneId: id,
          title,
          targetDate: fields.targetDate,
        }),
      );
      if (!result.ok) return fail(result);
      setMilestones((items) =>
        items.map((m) =>
          m.id === id ? { ...m, title, targetDate: fields.targetDate } : m,
        ),
      );
    }
    structural();
    setEditing(null);
  }

  async function removeMilestone(id: string) {
    const milestone = milestones.find((m) => m.id === id);
    const result = await run(() =>
      actions.removeMilestone({ goalId, milestoneId: id }),
    );
    if (!result.ok) return fail(result);
    setMilestones((items) => items.filter((m) => m.id !== id));
    // Mirror the server's re-home: linked equipment inherits the milestone's
    // date as its own deadline (the derived deadline is unchanged).
    if (milestone) {
      setEquipment((items) =>
        items.map((e) =>
          e.milestoneId === id
            ? { ...e, milestoneId: null, standaloneDeadline: milestone.targetDate }
            : e,
        ),
      );
    }
    structural();
    setEditing(null);
  }

  async function moveMilestone(id: string, direction: "up" | "down") {
    const index = milestones.findIndex((m) => m.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= milestones.length) return;
    const prev = milestones;
    const next = milestones.slice();
    [next[index], next[target]] = [next[target]!, next[index]!];
    setMilestones(next); // optimistic
    const result = await run(() =>
      actions.moveMilestone({ goalId, milestoneId: id, direction }),
    );
    if (!result.ok) {
      setMilestones(prev);
      return fail(result);
    }
    structural();
  }

  // --- equipment -----------------------------------------------------------

  async function saveEquipment(
    id: string | null,
    fields: {
      title: string;
      costUsd: number | null;
      milestoneId: string | null;
      standaloneDeadline: string | null;
    },
  ) {
    const title = fields.title.trim();
    if (title === "") {
      setError("Name this item.");
      return;
    }
    const linked =
      fields.milestoneId !== null &&
      milestones.some((m) => m.id === fields.milestoneId);
    const standalone =
      fields.standaloneDeadline !== null &&
      ISO_DATE_RE.test(fields.standaloneDeadline);
    if (linked === standalone) {
      setError("Tie this to a milestone or set a date — one or the other.");
      return;
    }
    const payload = {
      title,
      costUsd: fields.costUsd,
      milestoneId: linked ? fields.milestoneId : null,
      standaloneDeadline: linked ? null : fields.standaloneDeadline,
    };
    if (id === null) {
      const result = await run(() => actions.addEquipment({ goalId, ...payload }));
      if (!result.ok) return fail(result);
      setEquipment((items) => [
        ...items,
        {
          id: result.id,
          title,
          costUsd: payload.costUsd !== null ? String(payload.costUsd) : null,
          milestoneId: payload.milestoneId,
          standaloneDeadline: payload.standaloneDeadline,
          purchased: false,
        },
      ]);
    } else {
      const result = await run(() =>
        actions.updateEquipment({ goalId, equipmentId: id, ...payload }),
      );
      if (!result.ok) return fail(result);
      setEquipment((items) =>
        items.map((e) =>
          e.id === id
            ? {
                ...e,
                title,
                costUsd: payload.costUsd !== null ? String(payload.costUsd) : null,
                milestoneId: payload.milestoneId,
                standaloneDeadline: payload.standaloneDeadline,
              }
            : e,
        ),
      );
    }
    structural();
    setEditing(null);
  }

  async function removeEquipment(id: string) {
    const result = await run(() =>
      actions.removeEquipment({ goalId, equipmentId: id }),
    );
    if (!result.ok) return fail(result);
    setEquipment((items) => items.filter((e) => e.id !== id));
    structural();
    setEditing(null);
  }

  // --- render --------------------------------------------------------------

  const milestoneTitleById = new Map(milestones.map((m) => [m.id, m.title]));
  const milestoneDateById = new Map(milestones.map((m) => [m.id, m.targetDate]));
  // Non-active ⇒ zero edit affordances anywhere (keyed off LOCAL status so a
  // just-completed goal settles read-only in-session). The banner is gated
  // too: a finished goal has no plan left to update.
  const readOnly = isReadOnlyGoalStatus(status);
  const showBanner =
    !readOnly && shouldShowReplanBanner(replanFlag, structuralEdited);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 sm:gap-5 sm:p-6">
      {/* Header ------------------------------------------------------------ */}
      <header className="flex flex-col gap-2">
        {/* The completion moment — mounts on a confirmed Mark complete and
            plays the sunrise over the goal's scene (reserved aspect → no CLS
            while it animates). Reloads of a completed goal skip it. */}
        {celebrating && (
          <div className="aspect-[16/10] w-full overflow-hidden rounded-xl border border-border sm:aspect-[2/1]">
            <CompletionScene
              variant={model.sceneVariant}
              complete
              title={`${model.title} — sunrise on completion`}
            />
          </div>
        )}
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          {model.title}
        </h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <GoalChip
            colorIndex={model.colorIndex as 0 | 1 | 2 | 3 | 4}
            name={GOAL_COLOR_NAMES[model.colorIndex] ?? "goal color"}
          />
          {model.targetDate && (
            <span className="text-xs tabular-nums text-muted-foreground">
              Target {formatDate(model.targetDate)}
            </span>
          )}
          {status !== "active" && (
            <span className="text-xs text-muted-foreground">
              {status === "completed" ? "Completed" : "Archived"}
            </span>
          )}
        </div>

        {/* Mark complete — active goals only, two-tap inline confirm (the
            EditorFrame Cancel/primary register: completion is not reversible
            in-product, so one stray tap never completes a goal). */}
        {status === "active" && !confirmingComplete && (
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setError(null);
              setConfirmingComplete(true);
            }}
            className="mt-1 h-11 min-h-11 w-full px-4 sm:w-fit"
          >
            Mark complete
          </Button>
        )}
        {status === "active" && confirmingComplete && (
          <div className="mt-1 rounded-lg border border-ring bg-accent/20 p-3">
            <p className="text-sm leading-relaxed text-muted-foreground">
              This wraps the goal up. It moves to your archive a week later.
            </p>
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirmingComplete(false)}
                className="h-11 min-h-11 px-3 text-muted-foreground"
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() => void handleComplete()}
                className="h-11 min-h-11 px-4"
              >
                {pending ? "Saving" : "Complete goal"}
              </Button>
            </div>
          </div>
        )}
      </header>

      {/* Intensity control --------------------------------------------------*/}
      <section
        aria-labelledby="intensity-heading"
        className="rounded-xl border border-border bg-card p-4 sm:p-5"
      >
        <h2
          id="intensity-heading"
          className="font-heading text-lg font-medium tracking-tight text-foreground sm:text-xl"
        >
          Intensity
        </h2>
        {readOnly ? (
          // Read-only: the effective value as plain text — no radios, no
          // re-pick affordance on a finished goal.
          <p className="mt-3 text-sm text-foreground">
            {intensity.value !== null
              ? intensityLabel(intensity.value)
              : "Not set."}
          </p>
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Intensity"
              className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3"
            >
              {INTENSITY_LEVELS.map((level, index) => {
                const selected = intensity.value === level;
                // Roving tabindex (APG): the selected radio is the group's one
                // tab stop; with nothing selected the first option holds it.
                const tabStop =
                  intensity.value === null
                    ? index === 0
                    : selected;
                return (
                  <button
                    key={level}
                    ref={(el) => {
                      intensityRefs.current[index] = el;
                    }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={tabStop ? 0 : -1}
                    disabled={pending}
                    onClick={() => void handleIntensity(level)}
                    onKeyDown={(e) => handleIntensityKey(e, level)}
                    className={
                      "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-default disabled:opacity-50 " +
                      (selected
                        ? "border-ring bg-accent/40 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/20 hover:text-foreground")
                    }
                  >
                    {/* Selection is never color-only: the check glyph pairs the fill. */}
                    {selected && (
                      <Check aria-hidden="true" className="size-4 shrink-0" />
                    )}
                    {intensityLabel(level)}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {intensitySupportCopy(intensity.source)}
            </p>
          </>
        )}
      </section>

      {/* Error line (calm, §8) ----------------------------------------------*/}
      <p aria-live="polite" role="status" className="sr-only">
        {error ?? ""}
      </p>
      {error && (
        <p className="flex items-start gap-2 text-sm leading-relaxed text-primary">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {/* Replan banner — Phase 2 gate; never renders with the flag off ------ */}
      {showBanner && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-xl border border-border bg-card p-4 text-sm leading-relaxed text-foreground"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-primary"
          />
          {REPLAN_BANNER_COPY}
        </p>
      )}

      {/* Daily habits -------------------------------------------------------*/}
      <Section title="Daily habits">
        {daily.length === 0 && !isEditing("daily", null) && (
          <p className="text-sm text-muted-foreground">
            No daily habits in this plan.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {daily.map((item) => (
            <li key={item.id}>
              {!readOnly && isEditing("daily", item.id) ? (
                <TaskEditor
                  key={item.id}
                  section="daily"
                  initial={item}
                  pending={pending}
                  error={error}
                  onDone={(fields) => void saveTask("daily", item.id, fields)}
                  onRemove={() => void removeTask("daily", item.id)}
                />
              ) : (
                <ItemRow
                  title={item.title}
                  meta={[
                    item.estimatedDurationMin !== null
                      ? `${item.estimatedDurationMin} min`
                      : null,
                  ]}
                  onEdit={
                    readOnly
                      ? undefined
                      : () => openEditor({ section: "daily", id: item.id })
                  }
                />
              )}
            </li>
          ))}
        </ul>
        {!readOnly &&
          (isEditing("daily", null) ? (
            <TaskEditor
              section="daily"
              initial={null}
              pending={pending}
              error={error}
              onDone={(fields) => void saveTask("daily", null, fields)}
              onRemove={() => openEditor(null)}
            />
          ) : (
            <AddButton
              label="Add a habit"
              onClick={() => openEditor({ section: "daily", id: null })}
            />
          ))}
      </Section>

      {/* Weekly sessions ------------------------------------------------------*/}
      <Section title="Weekly sessions">
        {weekly.length === 0 && !isEditing("weekly", null) && (
          <p className="text-sm text-muted-foreground">
            No weekly sessions in this plan.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {weekly.map((item) => (
            <li key={item.id}>
              {!readOnly && isEditing("weekly", item.id) ? (
                <TaskEditor
                  key={item.id}
                  section="weekly"
                  initial={item}
                  pending={pending}
                  error={error}
                  onDone={(fields) => void saveTask("weekly", item.id, fields)}
                  onRemove={() => void removeTask("weekly", item.id)}
                />
              ) : (
                <ItemRow
                  title={item.title}
                  meta={[
                    item.weekday !== null
                      ? (WEEKDAY_LABELS[item.weekday] ?? null)
                      : null,
                    item.estimatedDurationMin !== null
                      ? `${item.estimatedDurationMin} min`
                      : null,
                  ]}
                  onEdit={
                    readOnly
                      ? undefined
                      : () => openEditor({ section: "weekly", id: item.id })
                  }
                />
              )}
            </li>
          ))}
        </ul>
        {!readOnly &&
          (isEditing("weekly", null) ? (
            <TaskEditor
              section="weekly"
              initial={null}
              pending={pending}
              error={error}
              onDone={(fields) => void saveTask("weekly", null, fields)}
              onRemove={() => openEditor(null)}
            />
          ) : (
            <AddButton
              label="Add a session"
              onClick={() => openEditor({ section: "weekly", id: null })}
            />
          ))}
      </Section>

      {/* Milestones (timeline) ------------------------------------------------*/}
      <Section title="Milestones">
        {milestones.length === 0 && !isEditing("milestones", null) && (
          <p className="text-sm text-muted-foreground">
            No milestones in this plan yet.
          </p>
        )}
        <ol className="flex flex-col gap-2">
          {milestones.map((item, index) => (
            <li key={item.id}>
              {!readOnly && isEditing("milestones", item.id) ? (
                <MilestoneEditor
                  key={item.id}
                  initial={item}
                  pending={pending}
                  error={error}
                  onDone={(fields) => void saveMilestone(item.id, fields)}
                  onRemove={() => void removeMilestone(item.id)}
                />
              ) : (
                <ItemRow
                  title={item.title}
                  meta={[item.targetDate ? formatDate(item.targetDate) : null]}
                  done={
                    item.completedOn
                      ? `Done ${formatDate(item.completedOn)}`
                      : null
                  }
                  onEdit={
                    readOnly
                      ? undefined
                      : () => openEditor({ section: "milestones", id: item.id })
                  }
                  reorder={
                    readOnly
                      ? undefined
                      : {
                          upDisabled: pending || index === 0,
                          downDisabled:
                            pending || index === milestones.length - 1,
                          onUp: () => void moveMilestone(item.id, "up"),
                          onDown: () => void moveMilestone(item.id, "down"),
                        }
                  }
                />
              )}
            </li>
          ))}
        </ol>
        {!readOnly &&
          (isEditing("milestones", null) ? (
            <MilestoneEditor
              initial={null}
              pending={pending}
              error={error}
              onDone={(fields) => void saveMilestone(null, fields)}
              onRemove={() => openEditor(null)}
            />
          ) : (
            <AddButton
              label="Add a milestone"
              onClick={() => openEditor({ section: "milestones", id: null })}
            />
          ))}
      </Section>

      {/* Equipment -------------------------------------------------------------*/}
      <Section title="Equipment">
        {equipment.length === 0 && !isEditing("equipment", null) && (
          <p className="text-sm text-muted-foreground">
            No equipment in this plan.
          </p>
        )}
        <ul className="flex flex-col gap-2">
          {equipment.map((item) => {
            const linkedTitle =
              item.milestoneId !== null
                ? (milestoneTitleById.get(item.milestoneId) ?? "a milestone")
                : null;
            const deadline =
              item.milestoneId !== null
                ? (milestoneDateById.get(item.milestoneId) ?? null)
                : item.standaloneDeadline;
            return (
              <li key={item.id}>
                {!readOnly && isEditing("equipment", item.id) ? (
                  <EquipmentEditor
                    key={item.id}
                    initial={item}
                    milestones={milestones}
                    pending={pending}
                    error={error}
                    onDone={(fields) => void saveEquipment(item.id, fields)}
                    onRemove={() => void removeEquipment(item.id)}
                  />
                ) : (
                  <ItemRow
                    title={item.title}
                    struck={item.purchased}
                    meta={[
                      deadline ? `By ${formatDate(deadline)}` : null,
                      linkedTitle ? `For ${linkedTitle}` : null,
                      formatUsd(item.costUsd),
                    ]}
                    done={item.purchased ? "Purchased" : null}
                    onEdit={
                      readOnly
                        ? undefined
                        : () => openEditor({ section: "equipment", id: item.id })
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
        {!readOnly &&
          (isEditing("equipment", null) ? (
            <EquipmentEditor
              initial={null}
              milestones={milestones}
              pending={pending}
              error={error}
              onDone={(fields) => void saveEquipment(null, fields)}
              onRemove={() => openEditor(null)}
            />
          ) : (
            <AddButton
              label="Add an item"
              onClick={() => openEditor({ section: "equipment", id: null })}
            />
          ))}
      </Section>

      {/* Adjust plan — honest Phase 1 placeholder; gone read-only (a finished
          goal has no plan adjustments coming) ----------------------------------*/}
      {!readOnly && (
        <div className="flex flex-col gap-1.5 pb-6">
          <Button
            type="button"
            variant="outline"
            disabled
            className="h-11 min-h-11 w-full px-5 sm:w-fit"
          >
            Adjust plan
          </Button>
          <p className="text-sm text-muted-foreground">
            {ADJUST_PLAN_SUPPORT_COPY}
          </p>
        </div>
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Shared chrome (the plan-review composition, live-write variant)
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
  done,
  struck = false,
  onEdit,
  reorder,
}: {
  title: string;
  meta: Array<string | null>;
  /** A quiet completion note ("Done Mar 3, 2026" / "Purchased"). */
  done?: string | null;
  /** Strike the title (purchased equipment stays visible, struck). */
  struck?: boolean;
  /** Absent on a read-only (non-active) goal — no Edit button renders. */
  onEdit?: () => void;
  reorder?: ReorderControls;
}) {
  const displayTitle = title.trim() === "" ? "Untitled" : title;
  const metaLine = meta.filter(Boolean).join(" · ");
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p
            className={
              struck
                ? "text-base font-medium text-muted-foreground line-through"
                : "text-base font-medium text-foreground"
            }
          >
            {displayTitle}
          </p>
          {metaLine && (
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
              {metaLine}
            </p>
          )}
          {done && (
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <Check aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="tabular-nums">{done}</span>
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
        {onEdit && (
          <Button
            type="button"
            variant="ghost"
            onClick={onEdit}
            aria-label={`Edit ${displayTitle}`}
            className="h-11 min-h-11 shrink-0 px-3"
          >
            Edit
          </Button>
        )}
      </div>
    </div>
  );
}

function EditorFrame({
  children,
  pending,
  creating,
  error,
  onDone,
  onRemove,
}: {
  children: React.ReactNode;
  pending: boolean;
  /** Create mode: the secondary affordance cancels instead of removing. */
  creating: boolean;
  /** The page-level error, repeated next to the controls that caused it so
   *  a long page never hides why Done didn't close (§8 warning note). */
  error?: string | null;
  onDone: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-lg border border-ring bg-accent/20 p-3">
      <div className="flex flex-col gap-3">{children}</div>
      {error && (
        <p className="mt-3 flex items-start gap-2 text-sm leading-relaxed text-primary">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      <div className="mt-3 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={onRemove}
          className="h-11 min-h-11 px-3 text-muted-foreground"
        >
          {creating ? "Cancel" : "Remove"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={onDone}
          className="h-11 min-h-11 px-4"
        >
          {pending ? "Saving" : "Done"}
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
      <label htmlFor={htmlFor} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-section editors (local field state; one server write per Done)
// ---------------------------------------------------------------------------

function TaskEditor({
  section,
  initial,
  pending,
  error,
  onDone,
  onRemove,
}: {
  section: "daily" | "weekly";
  initial: TaskItemModel | null;
  pending: boolean;
  error?: string | null;
  onDone: (fields: {
    title: string;
    weekday: number | null;
    durationMin: number | null;
  }) => void;
  onRemove: () => void;
}) {
  const idBase = initial?.id ?? `new-${section}`;
  const [title, setTitle] = useState(initial?.title ?? "");
  const [weekday, setWeekday] = useState<number>(initial?.weekday ?? 1);
  const [duration, setDuration] = useState(
    initial?.estimatedDurationMin?.toString() ?? "",
  );
  return (
    <EditorFrame
      pending={pending}
      creating={initial === null}
      error={error}
      onRemove={onRemove}
      onDone={() =>
        onDone({
          title,
          weekday: section === "weekly" ? weekday : null,
          durationMin: parseOptionalInt(duration),
        })
      }
    >
      <Field label="Title" htmlFor={`${idBase}-title`}>
        <Input
          id={`${idBase}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </Field>
      {section === "weekly" && (
        <Field label="Weekday" htmlFor={`${idBase}-weekday`}>
          <select
            id={`${idBase}-weekday`}
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
      )}
      <Field label="Minutes" htmlFor={`${idBase}-min`}>
        <Input
          id={`${idBase}-min`}
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
  initial,
  pending,
  error,
  onDone,
  onRemove,
}: {
  initial: MilestoneItemModel | null;
  pending: boolean;
  error?: string | null;
  onDone: (fields: { title: string; targetDate: string }) => void;
  onRemove: () => void;
}) {
  const idBase = initial?.id ?? "new-milestone";
  const [title, setTitle] = useState(initial?.title ?? "");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  return (
    <EditorFrame
      pending={pending}
      creating={initial === null}
      error={error}
      onRemove={onRemove}
      onDone={() => onDone({ title, targetDate })}
    >
      <Field label="Title" htmlFor={`${idBase}-title`}>
        <Input
          id={`${idBase}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </Field>
      <Field label="Target date" htmlFor={`${idBase}-date`}>
        <Input
          id={`${idBase}-date`}
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
  initial,
  milestones,
  pending,
  error,
  onDone,
  onRemove,
}: {
  initial: EquipmentItemModel | null;
  milestones: MilestoneItemModel[];
  pending: boolean;
  error?: string | null;
  onDone: (fields: {
    title: string;
    costUsd: number | null;
    milestoneId: string | null;
    standaloneDeadline: string | null;
  }) => void;
  onRemove: () => void;
}) {
  const idBase = initial?.id ?? "new-equipment";
  const [title, setTitle] = useState(initial?.title ?? "");
  const [cost, setCost] = useState(initial?.costUsd ?? "");
  // "" = nothing picked yet (invalid until chosen); "standalone" = own date;
  // otherwise a milestone id. Exactly-one is structural: picking a milestone
  // clears the date and vice versa.
  const [linkage, setLinkage] = useState<string>(
    initial?.milestoneId ??
      (initial?.standaloneDeadline != null ? "standalone" : ""),
  );
  const [deadline, setDeadline] = useState(initial?.standaloneDeadline ?? "");

  function commit() {
    const linkedToMilestone = linkage !== "" && linkage !== "standalone";
    onDone({
      title,
      costUsd: parseOptionalNumber(cost),
      milestoneId: linkedToMilestone ? linkage : null,
      standaloneDeadline:
        linkage === "standalone" && deadline !== "" ? deadline : null,
    });
  }

  return (
    <EditorFrame
      pending={pending}
      creating={initial === null}
      error={error}
      onRemove={onRemove}
      onDone={commit}
    >
      <Field label="Item" htmlFor={`${idBase}-title`}>
        <Input
          id={`${idBase}-title`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11"
        />
      </Field>
      <Field label="Cost (USD)" htmlFor={`${idBase}-cost`}>
        <Input
          id={`${idBase}-cost`}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          value={cost}
          onChange={(e) => setCost(e.target.value)}
          className="h-11"
        />
      </Field>
      <Field label="Needed for" htmlFor={`${idBase}-linkage`}>
        <select
          id={`${idBase}-linkage`}
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
        <Field label="Needed by" htmlFor={`${idBase}-deadline`}>
          <Input
            id={`${idBase}-deadline`}
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
