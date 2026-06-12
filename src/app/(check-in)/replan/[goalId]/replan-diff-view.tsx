"use client";

/**
 * ReplanDiffView — the replan diff review surface (phase-2-close-the-loop
 * "Replan diff UI"). A client component fed by the pure replan-model; the
 * product page passes the real decideReplan server action, the playground
 * harness deterministic stubs. The AI proposes; the user approves — nothing
 * here applies silently (SPEC §8).
 *
 * Anatomy (DESIGN.md register: calm documentary, not a code-review tool):
 *   - One h1; sections per change type; each change is a bordered card with
 *     a left accent + a TEXT kind label (color never the sole signal):
 *     additions in the lichen-green treatment, removals struck-through gray,
 *     modifications as side-by-side before → after lines.
 *   - Per-change ✓ Accept / ✎ Edit / ✕ Reject (44px targets, aria-pressed,
 *     focus-visible) plus a quiet "Accept all". Editing adjusts the proposed
 *     change's own fields and marks the change accepted — the edited value
 *     is what applies, echoed under the proposal as "Your version". Escape
 *     anywhere inside the editor cancels it (the Cancel button's behavior);
 *     a failed save marks each invalid field (aria-invalid + aria-describedby)
 *     with a visible message naming the rule.
 *   - A quiet commit bar: "X accepted · Y rejected[ · Z to review]" with
 *     Apply enabled once every change is decided.
 *   - A pending proposal still holding the placeholder diff renders a
 *     Generate action (POST /api/ai/replan; repeat-while-pending
 *     regenerates), never an empty diff. A decided proposal renders a
 *     read-only summary. Stale diffs (a target row vanished) disable Apply
 *     honestly and offer regeneration.
 */
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GoalChip } from "@/components/goal-chip";
import { cn } from "@/lib/utils";
import {
  requestReplanGeneration,
  GENERATE_FALLBACK_ERROR,
} from "../generate-replan-client";
import {
  ANCHOR_DATE,
  buildEditedRecord,
  initialEditorValues,
  weekdayName,
  type ChangeDecision,
  type ChangeRowModel,
  type DecideReplanHandler,
  type DecisionMap,
  type EditableInput,
  type EditorFieldErrors,
  type EditorValues,
  type GenerateReplanHandler,
  type ReplanPageModel,
  type ReplanSectionModel,
} from "./replan-model";

const ERR_FALLBACK = "That didn't save. Try once more.";
const ERR_EDIT_INVALID = "Some details need attention before saving.";

const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const KIND_LABELS = { add: "Added", modify: "Changed", remove: "Removed" } as const;

/** Left-accent + label-dot color per change kind — paired with the text
 *  label above, never meaning on its own. */
const KIND_ACCENTS = {
  add: "var(--goal-color-2)", // lichen green — the addition treatment
  modify: "var(--primary)",
  remove: "var(--muted-foreground)",
} as const;

type RowState = { decision: ChangeDecision | null; edited: Record<string, unknown> | null };

interface ReplanDiffViewProps {
  model: ReplanPageModel;
  onDecide: DecideReplanHandler;
  /** Playground override; the real page lets the view POST /api/ai/replan. */
  onGenerate?: GenerateReplanHandler;
  /** Playground-only: mount the generate surface with a failure already
   *  shown (the post-failure retry state). */
  initialGenerateError?: string;
}

export function ReplanDiffView({
  model,
  onDecide,
  onGenerate,
  initialGenerateError,
}: ReplanDiffViewProps) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:gap-7 sm:p-6">
      <header className="flex flex-col gap-1.5">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Plan adjustment
        </h1>
        <GoalChip
          colorIndex={(model.goal.colorIndex as 0 | 1 | 2 | 3 | 4) ?? 0}
          name={model.goal.title}
          className="text-sm text-foreground"
        />
        <p className="text-sm text-muted-foreground">
          The AI proposes; you approve. Nothing changes until you say so.
        </p>
      </header>

      {model.mode === "none" && <NoProposal goalId={model.goal.id} />}
      {model.mode === "generate" && (
        <GenerateSurface
          canGenerate={model.generate !== null}
          onGenerate={
            onGenerate ??
            (() =>
              model.generate
                ? requestReplanGeneration(model.generate)
                : Promise.resolve({
                    ok: false as const,
                    error: GENERATE_FALLBACK_ERROR,
                  }))
          }
          initialError={initialGenerateError}
        />
      )}
      {model.mode === "decided" && <DecidedSummary model={model} />}
      {model.mode === "review" && (
        <ReviewSurface
          model={model}
          onDecide={onDecide}
          onGenerate={
            onGenerate ??
            (() =>
              model.generate
                ? requestReplanGeneration(model.generate)
                : Promise.resolve({
                    ok: false as const,
                    error: GENERATE_FALLBACK_ERROR,
                  }))
          }
        />
      )}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Review — the decidable diff
// ---------------------------------------------------------------------------

function ReviewSurface({
  model,
  onDecide,
  onGenerate,
}: {
  model: Extract<ReplanPageModel, { mode: "review" }>;
  onDecide: DecideReplanHandler;
  onGenerate: GenerateReplanHandler;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const allKeys = useMemo(
    () => model.sections.flatMap((s) => s.rows.map((r) => r.key)),
    [model.sections],
  );
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      allKeys.map((k) => [k, { decision: null, edited: null }]),
    ),
  );
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const acceptedCount = allKeys.filter(
    (k) => rows[k]?.decision === "accept",
  ).length;
  const rejectedCount = allKeys.filter(
    (k) => rows[k]?.decision === "reject",
  ).length;
  const undecided = allKeys.length - acceptedCount - rejectedCount;

  const interactive = model.goalActive && !model.hasUnresolved && !applied;

  function setDecision(key: string, decision: ChangeDecision) {
    setRows((prev) => ({
      ...prev,
      [key]: { decision, edited: prev[key]?.edited ?? null },
    }));
  }

  function saveEdit(key: string, edited: Record<string, unknown> | null) {
    setRows((prev) => ({ ...prev, [key]: { decision: "accept", edited } }));
    setEditingKey(null);
  }

  function acceptAll() {
    setRows((prev) =>
      Object.fromEntries(
        allKeys.map((k) => [
          k,
          { decision: "accept" as const, edited: prev[k]?.edited ?? null },
        ]),
      ),
    );
  }

  async function apply() {
    if (pending || undecided > 0) return;
    setPending(true);
    setError(null);
    const decisions: DecisionMap = Object.fromEntries(
      allKeys.map((k) => {
        const state = rows[k]!;
        return [
          k,
          {
            decision: state.decision!,
            // Edits ride only on accepted changes — a rejected change
            // applies nothing, edited or not.
            ...(state.decision === "accept" && state.edited
              ? { edited: state.edited }
              : {}),
          },
        ];
      }),
    );
    let result: Awaited<ReturnType<DecideReplanHandler>>;
    try {
      result = await onDecide({ proposalId: model.proposalId, decisions });
    } catch {
      result = { ok: false, error: ERR_FALLBACK };
    }
    setPending(false);
    if (result.ok) {
      setApplied(true);
      // The server revalidated this path — refresh swaps in the decided
      // summary.
      startTransition(() => router.refresh());
    } else {
      setError(result.error);
    }
  }

  async function regenerate() {
    if (regenerating) return;
    setRegenerating(true);
    setError(null);
    const result = await onGenerate();
    if (result.ok) {
      startTransition(() => router.refresh());
    } else {
      setError(result.error);
      setRegenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!model.goalActive && (
        <p
          role="status"
          className="border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground"
        >
          This goal is no longer active, so its plan can&apos;t change. The
          proposal below is read-only.
        </p>
      )}
      {model.goalActive && model.hasUnresolved && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
          <p role="status" className="text-sm leading-relaxed text-foreground">
            Parts of this proposal no longer match your plan — some items it
            referenced have changed since it was generated.
          </p>
          <div>
            <Button
              type="button"
              size="lg"
              onClick={() => void regenerate()}
              disabled={regenerating}
              className="h-11 min-h-11 px-5"
            >
              {regenerating ? "Generating" : "Generate a fresh proposal"}
            </Button>
          </div>
        </div>
      )}

      {interactive && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {model.changeCount}{" "}
            {model.changeCount === 1 ? "proposed change" : "proposed changes"}
          </p>
          <Button
            type="button"
            variant="outline"
            size="lg"
            onClick={acceptAll}
            disabled={pending}
            className="h-11 min-h-11 px-4"
          >
            Accept all
          </Button>
        </div>
      )}

      {model.sections.map((section) => (
        <DiffSection key={section.section} section={section}>
          {section.rows.map((row) => (
            <ChangeCard
              key={row.key}
              row={row}
              state={rows[row.key] ?? { decision: null, edited: null }}
              interactive={interactive && !pending}
              editing={editingKey === row.key}
              milestoneOptions={model.milestoneOptions}
              onAccept={() => setDecision(row.key, "accept")}
              onReject={() => {
                setDecision(row.key, "reject");
                if (editingKey === row.key) setEditingKey(null);
              }}
              onEditOpen={() => setEditingKey(row.key)}
              onEditCancel={() => setEditingKey(null)}
              onEditSave={(edited) => saveEdit(row.key, edited)}
            />
          ))}
        </DiffSection>
      ))}

      {/* Calm, constant error line — announced politely. */}
      <p aria-live="polite" role="status" className="sr-only">
        {error ?? ""}
      </p>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}

      {applied ? (
        <section
          aria-labelledby="replan-applied-heading"
          className="rounded-xl border border-border bg-card p-5"
        >
          <h2
            id="replan-applied-heading"
            className="font-heading text-xl font-medium tracking-tight text-foreground"
          >
            Decision saved.
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {acceptedCount > 0
              ? "The accepted changes are now part of your plan."
              : "Your plan is unchanged."}
          </p>
        </section>
      ) : (
        interactive && (
          <div className="sticky bottom-0 -mx-4 border-t border-border bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
            <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-3">
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {acceptedCount} accepted · {rejectedCount} rejected
                {undecided > 0 && ` · ${undecided} to review`}
              </p>
              <Button
                type="button"
                size="lg"
                onClick={() => void apply()}
                disabled={pending || undecided > 0}
                className="h-11 min-h-11 px-6"
              >
                {pending ? "Applying" : "Apply"}
              </Button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sections + change cards (shared by review and the decided summary)
// ---------------------------------------------------------------------------

function DiffSection({
  section,
  children,
}: {
  section: ReplanSectionModel;
  children: React.ReactNode;
}) {
  const headingId = `replan-section-${section.section}`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2
        id={headingId}
        className="font-heading text-base font-medium text-foreground"
      >
        {section.heading}
      </h2>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function KindLabel({ kind }: { kind: ChangeRowModel["kind"] }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full ring-1 ring-foreground/10"
        style={{ backgroundColor: KIND_ACCENTS[kind] }}
      />
      {KIND_LABELS[kind]}
    </span>
  );
}

/** The proposal body of one change — also the decided summary's row body. */
function ChangeBody({ row }: { row: ChangeRowModel }) {
  if (row.kind === "add") {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-base font-medium text-foreground">{row.title}</p>
        <p className="text-sm text-muted-foreground">
          {row.details.map((d) => `${d.label}: ${d.value}`).join(" · ")}
        </p>
      </div>
    );
  }
  if (row.kind === "remove") {
    return (
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-base font-medium text-muted-foreground line-through">
          <span className="sr-only">Removed: </span>
          {row.title}
        </p>
        {row.unresolved && <UnresolvedNote />}
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-base font-medium text-foreground">{row.title}</p>
      <ul className="flex flex-col gap-1.5">
        {row.deltas.map((d) => (
          <li
            key={d.field}
            className="flex flex-col gap-0.5 sm:grid sm:grid-cols-[7rem_1fr_1rem_1fr] sm:items-baseline sm:gap-x-3"
          >
            <span className="text-xs text-muted-foreground">{d.label}</span>
            <span className="flex flex-wrap items-baseline gap-x-2 sm:contents">
              {/* Right-aligned toward the arrow at ≥sm so the before → after
                  pair reads as one unit instead of leaving a dead gap. */}
              <span className="text-sm text-muted-foreground line-through sm:text-right">
                <span className="sr-only">was </span>
                {d.before}
              </span>
              <span
                aria-hidden="true"
                className="text-sm text-muted-foreground"
              >
                →
              </span>
              <span className="text-sm text-foreground">
                <span className="sr-only">now </span>
                {d.after}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {row.unresolved && <UnresolvedNote />}
    </div>
  );
}

function UnresolvedNote() {
  return (
    <p className="text-xs text-muted-foreground">
      This item is no longer in the plan.
    </p>
  );
}

function ChangeCard({
  row,
  state,
  interactive,
  editing,
  milestoneOptions,
  onAccept,
  onReject,
  onEditOpen,
  onEditCancel,
  onEditSave,
}: {
  row: ChangeRowModel;
  state: RowState;
  interactive: boolean;
  editing: boolean;
  milestoneOptions: Array<{ id: string; title: string }>;
  onAccept: () => void;
  onReject: () => void;
  onEditOpen: () => void;
  onEditCancel: () => void;
  onEditSave: (edited: Record<string, unknown> | null) => void;
}) {
  const editable = row.kind === "remove" ? [] : row.editable;
  return (
    // scroll-mb keeps the card (and its focused controls) clear of the
    // sticky commit bar when scrolled or tabbed into view.
    <li
      className="flex scroll-mb-24 flex-col gap-3 rounded-xl border border-border border-l-2 bg-card p-4"
      style={{ borderLeftColor: KIND_ACCENTS[row.kind] }}
    >
      <KindLabel kind={row.kind} />
      <ChangeBody row={row} />

      {state.edited && !editing && (
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-medium">Your version</span>
          <span className="text-muted-foreground">
            {" "}
            — {formatEditedSummary(state.edited, milestoneOptions)}
          </span>
        </p>
      )}

      {interactive && editing && (
        <ChangeEditor
          row={row}
          fields={editable}
          initial={state.edited ?? {}}
          milestoneOptions={milestoneOptions}
          onCancel={onEditCancel}
          onSave={onEditSave}
        />
      )}

      {interactive && !editing && (
        <div className="flex flex-wrap items-center gap-2">
          <DecisionToggle
            pressed={state.decision === "accept"}
            label={`Accept: ${row.title}`}
            onClick={onAccept}
          >
            <Check aria-hidden="true" className="size-4" />
            Accept
          </DecisionToggle>
          {editable.length > 0 && (
            <button
              type="button"
              aria-label={`Edit: ${row.title}`}
              onClick={onEditOpen}
              className="inline-flex h-11 min-h-11 scroll-mb-24 cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 text-sm font-medium text-foreground transition-colors outline-none hover:bg-accent/20 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <Pencil aria-hidden="true" className="size-4" />
              Edit
            </button>
          )}
          <DecisionToggle
            pressed={state.decision === "reject"}
            label={`Reject: ${row.title}`}
            onClick={onReject}
          >
            <X aria-hidden="true" className="size-4" />
            Reject
          </DecisionToggle>
        </div>
      )}
    </li>
  );
}

function DecisionToggle({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-11 min-h-11 scroll-mb-24 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm font-medium transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        pressed
          ? "border-ring bg-accent/40 text-foreground"
          : "border-border text-foreground hover:bg-accent/20",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// The inline ✎ editor — the proposed change's own fields, nothing else
// ---------------------------------------------------------------------------

const SELECT_CLASS =
  "h-11 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-transparent px-2.5 text-base text-foreground transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

function ChangeEditor({
  row,
  fields,
  initial,
  milestoneOptions,
  onCancel,
  onSave,
}: {
  row: ChangeRowModel;
  fields: EditableInput[];
  initial: Record<string, unknown>;
  milestoneOptions: Array<{ id: string; title: string }>;
  onCancel: () => void;
  onSave: (edited: Record<string, unknown> | null) => void;
}) {
  const [values, setValues] = useState<EditorValues>(() =>
    initialEditorValues(fields, initial),
  );
  const [fieldErrors, setFieldErrors] = useState<EditorFieldErrors>({});
  const hasErrors = Object.keys(fieldErrors).length > 0;
  const idBase = `edit-${row.key.replace(/[^a-zA-Z0-9-]/g, "-")}`;

  function set(field: string, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }));
    // A field's error retires as soon as the field changes (switching the
    // anchor away from "by a date" retires its date error too).
    setFieldErrors((prev) => {
      const stale =
        field === "anchor-choice" ? [field, "anchor-date"] : [field];
      if (!stale.some((k) => k in prev)) return prev;
      const next = { ...prev };
      for (const k of stale) delete next[k];
      return next;
    });
  }

  function save() {
    const result = buildEditedRecord(fields, values);
    if (result.ok) {
      onSave(result.edited);
    } else {
      setFieldErrors(result.errors);
    }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3"
      onKeyDown={(e) => {
        // Escape = the Cancel button, from anywhere inside the editor.
        // defaultPrevented respects a native popup (an open select dropdown
        // or date picker) consuming Escape first — don't fight the platform.
        if (
          e.key !== "Escape" ||
          e.defaultPrevented ||
          e.nativeEvent.isComposing
        ) {
          return;
        }
        e.preventDefault();
        onCancel();
      }}
    >
      {fields.map((f) => {
        const inputId = `${idBase}-${f.field}`;
        if (f.kind === "anchor") {
          const choice = values["anchor-choice"] ?? ANCHOR_DATE;
          const dateError = fieldErrors["anchor-date"];
          const dateErrorId = `${inputId}-date-error`;
          return (
            <div key={f.field} className="flex flex-col gap-2">
              <label
                htmlFor={inputId}
                className="text-xs font-medium text-muted-foreground"
              >
                {f.label}
              </label>
              <select
                id={inputId}
                value={choice}
                onChange={(e) => set("anchor-choice", e.target.value)}
                className={SELECT_CLASS}
              >
                {milestoneOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    Before “{m.title}”
                  </option>
                ))}
                <option value={ANCHOR_DATE}>By a date</option>
              </select>
              {choice === ANCHOR_DATE && (
                <>
                  <label htmlFor={`${inputId}-date`} className="sr-only">
                    Needed by date
                  </label>
                  <Input
                    id={`${inputId}-date`}
                    type="date"
                    value={values["anchor-date"] ?? ""}
                    onChange={(e) => set("anchor-date", e.target.value)}
                    aria-invalid={dateError ? true : undefined}
                    aria-describedby={dateError ? dateErrorId : undefined}
                    className="h-11"
                  />
                  {dateError && (
                    <p
                      id={dateErrorId}
                      className="text-sm text-muted-foreground"
                    >
                      {dateError}
                    </p>
                  )}
                </>
              )}
            </div>
          );
        }
        const error = fieldErrors[f.field];
        const errorId = `${inputId}-error`;
        return (
          <div key={f.field} className="flex flex-col gap-1.5">
            <label
              htmlFor={inputId}
              className="text-xs font-medium text-muted-foreground"
            >
              {f.label}
            </label>
            {f.kind === "weekday" ? (
              <select
                id={inputId}
                value={values[f.field] ?? "1"}
                onChange={(e) => set(f.field, e.target.value)}
                className={SELECT_CLASS}
              >
                {WEEKDAY_LABELS.map((label, i) => (
                  <option key={label} value={i}>
                    {label}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id={inputId}
                type={
                  f.kind === "date"
                    ? "date"
                    : f.kind === "text"
                      ? "text"
                      : "number"
                }
                inputMode={f.kind === "text" ? undefined : "numeric"}
                min={f.kind === "number" ? (f.field === "position" ? 1 : f.min) : undefined}
                step={f.kind === "cost" ? "0.01" : undefined}
                value={values[f.field] ?? ""}
                onChange={(e) => set(f.field, e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className="h-11"
              />
            )}
            {error && (
              <p id={errorId} className="text-sm text-muted-foreground">
                {error}
              </p>
            )}
          </div>
        );
      })}

      <p aria-live="polite" role="status" className="sr-only">
        {hasErrors ? ERR_EDIT_INVALID : ""}
      </p>
      {hasErrors && (
        <p className="text-sm text-muted-foreground">{ERR_EDIT_INVALID}</p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="lg"
          onClick={save}
          className="h-11 min-h-11 px-4"
        >
          Save edit
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="lg"
          onClick={onCancel}
          className="h-11 min-h-11 px-4"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function formatEditedSummary(
  edited: Record<string, unknown>,
  milestoneOptions: Array<{ id: string; title: string }>,
): string {
  const parts: string[] = [];
  if (typeof edited.title === "string") parts.push(`Title: ${edited.title}`);
  if ("weekday" in edited) {
    parts.push(`Weekday: ${weekdayName(edited.weekday as number | null)}`);
  }
  if (typeof edited.estimated_duration_min === "number") {
    parts.push(`Duration: ${edited.estimated_duration_min} min`);
  }
  if (typeof edited.target_date === "string") {
    parts.push(`Target date: ${edited.target_date}`);
  }
  if (typeof edited.position === "number") {
    parts.push(`Position: ${edited.position + 1}`);
  }
  if ("cost_usd" in edited) {
    const cost = edited.cost_usd as number | null;
    parts.push(`Cost: ${cost === null ? "—" : `$${cost}`}`);
  }
  if ("milestone_id" in edited || "standalone_deadline" in edited) {
    const milestoneId = (edited.milestone_id as string | null) ?? null;
    const standalone = (edited.standalone_deadline as string | null) ?? null;
    const title = milestoneOptions.find((m) => m.id === milestoneId)?.title;
    parts.push(
      milestoneId !== null
        ? `Needed: Before “${title ?? "milestone"}”`
        : `Needed: By ${standalone ?? "—"}`,
    );
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Generate — a pending proposal still holding the placeholder diff
// ---------------------------------------------------------------------------

function GenerateSurface({
  canGenerate,
  onGenerate,
  initialError,
}: {
  canGenerate: boolean;
  onGenerate: GenerateReplanHandler;
  initialError?: string;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function generate() {
    if (generating) return;
    setGenerating(true);
    setError(null);
    let result: Awaited<ReturnType<GenerateReplanHandler>>;
    try {
      result = await onGenerate();
    } catch {
      result = { ok: false, error: GENERATE_FALLBACK_ERROR };
    }
    if (result.ok) {
      // The diff now exists server-side — refresh swaps in the review
      // surface. Keep the working state until it lands.
      startTransition(() => router.refresh());
    } else {
      setError(result.error);
      setGenerating(false);
    }
  }

  return (
    <section
      aria-labelledby="replan-generate-heading"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id="replan-generate-heading"
        className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
      >
        An adjustment was requested for this goal.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {canGenerate
          ? "Your check-in queued it. Generating takes a moment, and nothing changes until you review and approve the proposal."
          : "Its check-in is gone, so this proposal can't be generated anymore."}
      </p>

      <p aria-live="polite" role="status" className="sr-only">
        {generating ? "Generating the proposal." : (error ?? "")}
      </p>
      {error && (
        <p className="mt-3 text-sm text-muted-foreground">{error}</p>
      )}

      {canGenerate && (
        <Button
          type="button"
          size="lg"
          onClick={() => void generate()}
          disabled={generating}
          className="mt-5 h-11 min-h-11 px-5"
        >
          {generating
            ? "Generating"
            : error
              ? "Try again"
              : "Generate the proposal"}
        </Button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Decided — the read-only summary
// ---------------------------------------------------------------------------

const DECIDED_HEADINGS = {
  accepted: "Plan updated.",
  partially_accepted: "Plan partially updated.",
  rejected: "Proposal declined.",
} as const;

function decidedDetail(
  status: keyof typeof DECIDED_HEADINGS,
  changeCount: number,
): string {
  const noun = changeCount === 1 ? "proposed change" : "proposed changes";
  if (status === "accepted") {
    return `All ${changeCount} ${noun} were applied to the plan.`;
  }
  if (status === "partially_accepted") {
    return `Some of the ${changeCount} ${noun} were applied to the plan.`;
  }
  return "None of the proposed changes were applied. The plan is unchanged.";
}

function DecidedSummary({
  model,
}: {
  model: Extract<ReplanPageModel, { mode: "decided" }>;
}) {
  return (
    <div className="flex flex-col gap-6">
      <section
        aria-labelledby="replan-decided-heading"
        className="rounded-xl border border-border bg-card p-5 sm:p-6"
      >
        <h2
          id="replan-decided-heading"
          className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
        >
          {DECIDED_HEADINGS[model.status]}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {decidedDetail(model.status, model.changeCount)}
          {model.decidedAtLabel && ` Decided ${model.decidedAtLabel}.`}
        </p>
        <Link
          href={`/goals/${model.goal.id}`}
          className={cn(
            buttonVariants({ variant: "link" }),
            "mt-4 h-11 min-h-11 px-0",
          )}
        >
          View the goal
        </Link>
      </section>

      {model.sections.length > 0 && (
        <div className="flex flex-col gap-6">
          {model.sections.map((section) => (
            <DiffSection key={section.section} section={section}>
              {section.rows.map((row) => (
                <li
                  key={row.key}
                  className="flex flex-col gap-3 rounded-xl border border-border border-l-2 bg-card p-4"
                  style={{ borderLeftColor: KIND_ACCENTS[row.kind] }}
                >
                  <KindLabel kind={row.kind} />
                  <ChangeBody row={row} />
                </li>
              ))}
            </DiffSection>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// No proposal at all
// ---------------------------------------------------------------------------

function NoProposal({ goalId }: { goalId: string }) {
  return (
    <section
      aria-labelledby="replan-none-heading"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id="replan-none-heading"
        className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
      >
        No plan adjustment here yet.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        Adjustments are proposed when you ask for them in a weekly check-in.
      </p>
      <Link
        href={`/goals/${goalId}`}
        className={cn(
          buttonVariants({ variant: "link" }),
          "mt-4 h-11 min-h-11 px-0",
        )}
      >
        View the goal
      </Link>
    </section>
  );
}
