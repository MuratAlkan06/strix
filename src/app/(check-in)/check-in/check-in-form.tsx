"use client";

/**
 * CheckInForm — the weekly check-in surface (phase-2-close-the-loop "Weekly
 * check-in UI"). A client component fed by the pure check-in-model; the
 * product page passes the real submit/skip server actions, the playground
 * harness local no-ops.
 *
 * Anatomy (DESIGN.md discipline throughout — one h1, ≥44px effective
 * targets, color never the sole signal, calm constant error lines):
 *   - Feeling: hand-rolled radio cards (fieldset + native radios + Tailwind
 *     selected/focus states — the intensity-confirm-card pattern).
 *   - Notes: a raw <textarea> in the intake-chat chrome. Optional.
 *   - Goals: checkbox rows (GoalChip carries dot + name). Three row states:
 *       enabled        — checkbox + chip; toggling is free under the cap;
 *       already-proposed — checked + disabled, "Replan already requested"
 *                        (this week's proposal exists; costs nothing more);
 *       capacity-disabled — the DYNAMIC count cap (Free): once the newly-
 *                        selected count reaches the remaining monthly quota,
 *                        still-unchecked rows render as a tooltip'd button
 *                        that opens the upgrade modal. Unchecking re-enables.
 *   - Submit + "Skip this week" (skip hidden once a real check-in exists —
 *     replacing a real answer with a skip is not a flow we offer).
 *   - Success is a quiet confirmation section in place of the form — no
 *     confetti, no redirect.
 *
 * Zero selections is a valid submit (SPEC §10: check-ins always work; the
 * cap limits replans, never the check-in).
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { GoalChip } from "@/components/goal-chip";
import { UpgradeModal } from "@/components/upgrade-modal";
import { cn } from "@/lib/utils";
import { requestReplanGeneration } from "../replan/generate-replan-client";
import {
  CHECK_IN_FEELINGS,
  FEELING_LABELS,
  capMessage,
  capacityDisabledIds,
  newlySelectedGoalIds,
  type CheckInActionResult,
  type CheckInFeeling,
  type CheckInGoalRowModel,
  type CheckInModel,
  type CreatedReplanProposal,
  type SkipCheckInHandler,
  type SubmitCheckInHandler,
} from "./check-in-model";

const ERR_FALLBACK = "That didn't save. Try once more.";

type Pending = "submit" | "skip" | null;
type Done =
  | {
      kind: "submitted";
      newCount: number;
      createdProposals: CreatedReplanProposal[];
    }
  | { kind: "skipped" }
  | null;

export interface CheckInFormProps {
  model: CheckInModel;
  onSubmit: SubmitCheckInHandler;
  onSkip: SkipCheckInHandler;
}

export function CheckInForm({ model, onSubmit, onSkip }: CheckInFormProps) {
  const [feeling, setFeeling] = useState<CheckInFeeling | null>(
    model.initialFeeling,
  );
  const [notes, setNotes] = useState(model.initialNotes);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(model.defaultSelectedIds),
  );
  const [pending, setPending] = useState<Pending>(null);
  const [done, setDone] = useState<Done>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const proposedIds = model.goalRows
    .filter((r) => r.alreadyProposed)
    .map((r) => r.id);
  const capacityDisabled = capacityDisabledIds(
    model.goalRows,
    [...selected],
    model.remaining,
  );

  function toggle(id: string, next: boolean) {
    setSelected((prev) => {
      const out = new Set(prev);
      if (next) out.add(id);
      else out.delete(id);
      return out;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending !== null || feeling === null) return;
    setPending("submit");
    setError(null);
    let result: CheckInActionResult;
    try {
      result = await onSubmit({
        feeling,
        notes,
        selectedGoalIds: [...selected],
      });
    } catch {
      result = { ok: false, error: ERR_FALLBACK };
    }
    setPending(null);
    if (result.ok) {
      setDone({
        kind: "submitted",
        newCount: newlySelectedGoalIds([...selected], proposedIds).length,
        createdProposals: result.createdProposals ?? [],
      });
    } else {
      setError(result.error);
    }
  }

  async function handleSkip() {
    if (pending !== null) return;
    setPending("skip");
    setError(null);
    let result: CheckInActionResult;
    try {
      result = await onSkip();
    } catch {
      result = { ok: false, error: ERR_FALLBACK };
    }
    setPending(null);
    if (result.ok) {
      setDone({ kind: "skipped" });
    } else {
      setError(result.error);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 sm:gap-7 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Weekly check-in
        </h1>
        <p className="text-sm text-muted-foreground">
          How this week felt shapes what your plans ask of you next.
        </p>
      </header>

      {model.goalRows.length === 0 ? (
        <EmptyCheckIn />
      ) : done ? (
        <Confirmation done={done} goalRows={model.goalRows} />
      ) : (
        <form
          className="flex flex-col gap-6 sm:gap-7"
          onSubmit={handleSubmit}
          noValidate
        >
          {model.hasRealCheckIn && (
            <p className="border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
              You checked in this week already. Saving again updates it.
            </p>
          )}
          {model.hasSkippedCheckIn && (
            <p className="border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
              You skipped this week. There&apos;s still time to check in before
              it ends.
            </p>
          )}

          <fieldset>
            <legend className="font-heading text-base font-medium text-foreground">
              How did this week feel?
            </legend>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {CHECK_IN_FEELINGS.map((level) => {
                const isSelected = feeling === level;
                return (
                  <label
                    key={level}
                    className={cn(
                      // Keyboard focus renders as the brand ring on the whole
                      // card (the intensity-confirm pattern) — the input's
                      // outline-none is safe only because of this visible
                      // replacement. Selection = border + fill + filled
                      // glyph, never color alone.
                      // Base gap/padding sit a notch tighter than sm: so the
                      // longest label ("About right", ~70px at 14px Hanken)
                      // holds one line in the ~109px card at 375.
                      "flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-1.5 py-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50 sm:gap-2 sm:px-2",
                      isSelected
                        ? "border-ring bg-accent/40"
                        : "border-border hover:bg-accent/20",
                    )}
                  >
                    <input
                      type="radio"
                      name="feeling"
                      value={level}
                      checked={isSelected}
                      onChange={() => setFeeling(level)}
                      disabled={pending !== null}
                      className="size-4 shrink-0 cursor-pointer outline-none accent-primary"
                    />
                    <span className="text-sm font-medium text-foreground">
                      {FEELING_LABELS[level]}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* min-w-0 neutralizes the fieldset's browser-default
              min-width: min-content — without it a long nowrap goal title
              becomes the fieldset's intrinsic width and drags <main> past the
              375px viewport; with it, the rows' min-w-0/truncate chain clamps
              the title to an ellipsis. */}
          <fieldset className="min-w-0">
            <legend className="font-heading text-base font-medium text-foreground">
              Replan which goals?
            </legend>
            <p className="mt-1 text-sm text-muted-foreground">
              Selected goals get an adjustment proposed from this check-in.
              None selected is fine — the week still counts.
            </p>
            <TooltipProvider>
              <ul className="mt-3 flex flex-col gap-0.5">
                {model.goalRows.map((row) => (
                  <GoalRow
                    key={row.id}
                    row={row}
                    checked={selected.has(row.id)}
                    capacityDisabled={capacityDisabled.has(row.id)}
                    capHint={capMessage(model.replansUsed)}
                    pending={pending !== null}
                    onToggle={toggle}
                    onCapTap={() => setModalOpen(true)}
                  />
                ))}
              </ul>
            </TooltipProvider>
          </fieldset>

          <div className="flex flex-col gap-2">
            <label
              htmlFor="check-in-notes"
              className="font-heading text-base font-medium text-foreground"
            >
              Anything to tell your plan?
            </label>
            <textarea
              id="check-in-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={pending !== null}
              rows={3}
              maxLength={2000}
              placeholder="Optional. Constraints, setbacks, anything next week should respect."
              className="min-h-11 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2.5 text-base leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
            />
          </div>

          {/* Calm, constant error line — announced politely, visible in register. */}
          <p aria-live="polite" role="status" className="sr-only">
            {error ?? ""}
          </p>
          {error && <p className="text-sm text-muted-foreground">{error}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button
              type="submit"
              size="lg"
              disabled={pending !== null || feeling === null}
              className="h-11 min-h-11 px-5"
            >
              {pending === "submit" ? "Saving" : "Save check-in"}
            </Button>
            {!model.hasRealCheckIn && (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={handleSkip}
                disabled={pending !== null}
                className="h-11 min-h-11 px-5"
              >
                {pending === "skip" ? "Saving" : "Skip this week"}
              </Button>
            )}
          </div>
        </form>
      )}

      <UpgradeModal open={modalOpen} onOpenChange={setModalOpen} />
    </main>
  );
}

function GoalRow({
  row,
  checked,
  capacityDisabled,
  capHint,
  pending,
  onToggle,
  onCapTap,
}: {
  row: CheckInGoalRowModel;
  checked: boolean;
  capacityDisabled: boolean;
  capHint: string;
  pending: boolean;
  onToggle: (id: string, next: boolean) => void;
  onCapTap: () => void;
}) {
  const colorIndex = row.colorIndex as 0 | 1 | 2 | 3 | 4;

  if (row.alreadyProposed) {
    return (
      <li className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5">
        <Checkbox
          checked
          disabled
          aria-label={`${row.title} — replan already requested`}
          className="size-5 after:-inset-3 [&_svg]:size-4"
        />
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          {/* min-w-0 (not flex-1: the note should sit inline after short
              titles) lets a long title shrink-and-truncate instead of
              overflowing the 375px viewport. */}
          <GoalChip
            colorIndex={colorIndex}
            name={row.title}
            className="min-w-0 text-sm text-foreground"
          />
          <span className="text-xs text-muted-foreground">
            Replan already requested
          </span>
        </span>
      </li>
    );
  }

  if (capacityDisabled) {
    // Not a real (nested) checkbox: the whole row is a button that opens the
    // upgrade modal (phase doc: tapping a disabled goal opens the modal),
    // with the inline tooltip on hover/focus. The box is decorative; the
    // title keeps AA contrast via the muted token, never opacity tricks.
    return (
      <li className="flex flex-col">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                onClick={onCapTap}
                className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-colors hover:bg-accent/20 focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            }
          >
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 rounded-[4px] border border-input opacity-50"
            />
            <GoalChip
              colorIndex={colorIndex}
              name={row.title}
              className="min-w-0 flex-1 text-sm"
            />
            <span className="sr-only">— monthly replan limit reached</span>
          </TooltipTrigger>
          <TooltipContent>{capHint}</TooltipContent>
        </Tooltip>
      </li>
    );
  }

  return (
    <li className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5">
      {/* size-5 glyph; the after:* hit area extends it to a 44×44 effective
          target (the active-dashboard posture). */}
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onToggle(row.id, v === true)}
        disabled={pending}
        aria-label={`Replan ${row.title}`}
        className="size-5 cursor-pointer after:-inset-3 [&_svg]:size-4"
      />
      <GoalChip
        colorIndex={colorIndex}
        name={row.title}
        className="min-w-0 flex-1 text-sm text-foreground"
      />
    </li>
  );
}

/** Quiet success states — the form's job is done; no confetti (DESIGN.md §4).
 *  A submission that created proposals fires generation for each, all at
 *  once, with a per-goal status line (generating → review link / calm retry). */
function Confirmation({
  done,
  goalRows,
}: {
  done: NonNullable<Done>;
  goalRows: CheckInGoalRowModel[];
}) {
  const createdProposals =
    done.kind === "submitted" ? done.createdProposals : [];
  return (
    <section
      aria-labelledby="check-in-done-heading"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id="check-in-done-heading"
        className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
      >
        {done.kind === "submitted"
          ? "Check-in saved."
          : "This week is logged as skipped."}
      </h2>
      <p className="mt-2 text-base leading-relaxed text-foreground">
        {done.kind === "skipped"
          ? "No replans were requested. You can come back and check in before the week ends."
          : done.newCount > 0
            ? `Replan proposals are queued for ${done.newCount} ${
                done.newCount === 1 ? "goal" : "goals"
              }.`
            : "No replans this time. Your plans hold steady."}
      </p>
      {createdProposals.length > 0 && (
        <ReplanGenerationList
          proposals={createdProposals}
          goalRows={goalRows}
        />
      )}
      <Link
        href="/dashboard"
        className={cn(
          buttonVariants({ variant: "link" }),
          "mt-4 h-11 min-h-11 px-0",
        )}
      >
        Back to the dashboard
      </Link>
    </section>
  );
}

type GenerationState =
  | { kind: "generating" }
  | { kind: "ready" }
  | { kind: "failed"; error: string };

/**
 * The per-goal generation fan-out: one POST /api/ai/replan per created
 * proposal, fired CONCURRENTLY on mount (never sequential — N goals must
 * not take N× a model call), each line tracking its own
 * generating / ready (→ the diff page) / failed (calm retry) state.
 */
function ReplanGenerationList({
  proposals,
  goalRows,
}: {
  proposals: CreatedReplanProposal[];
  goalRows: CheckInGoalRowModel[];
}) {
  const [states, setStates] = useState<Record<string, GenerationState>>(() =>
    Object.fromEntries(
      proposals.map((p) => [p.proposalId, { kind: "generating" as const }]),
    ),
  );
  const firedRef = useRef(false);

  async function fire(p: CreatedReplanProposal) {
    setStates((prev) => ({
      ...prev,
      [p.proposalId]: { kind: "generating" },
    }));
    const result = await requestReplanGeneration({
      goalId: p.goalId,
      weeklyCheckInId: p.weeklyCheckInId,
    });
    setStates((prev) => ({
      ...prev,
      [p.proposalId]: result.ok
        ? { kind: "ready" }
        : { kind: "failed", error: result.error },
    }));
  }

  useEffect(() => {
    // Once per confirmation — strict-mode double-mount must not double-POST
    // (a second POST while pending would regenerate, wasting a model call).
    if (firedRef.current) return;
    firedRef.current = true;
    void Promise.allSettled(proposals.map((p) => fire(p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const titlesById = new Map(goalRows.map((r) => [r.id, r]));

  return (
    <ul aria-live="polite" className="mt-4 flex flex-col gap-0.5">
      {proposals.map((p) => {
        const goal = titlesById.get(p.goalId);
        const state = states[p.proposalId] ?? { kind: "generating" as const };
        return (
          <li
            key={p.proposalId}
            className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 rounded-lg px-2 py-1.5"
          >
            <GoalChip
              colorIndex={(goal?.colorIndex ?? 0) as 0 | 1 | 2 | 3 | 4}
              name={goal?.title ?? "Goal"}
              className="min-w-0 text-sm text-foreground"
            />
            {state.kind === "generating" && (
              <span className="text-xs text-muted-foreground">
                Generating the proposal…
              </span>
            )}
            {state.kind === "ready" && (
              <Link
                href={`/replan/${p.goalId}`}
                className={cn(
                  buttonVariants({ variant: "link" }),
                  "h-11 min-h-11 px-0 text-sm",
                )}
              >
                Review the proposal
              </Link>
            )}
            {state.kind === "failed" && (
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-xs text-muted-foreground">
                  {state.error}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  onClick={() => void fire(p)}
                  className="h-11 min-h-11 px-3 text-sm"
                >
                  Try again
                </Button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** Honest empty state — no form without active goals, never a dead control. */
function EmptyCheckIn() {
  return (
    <section
      aria-labelledby="check-in-empty-heading"
      className="rounded-xl border border-border bg-card p-5 sm:p-6"
    >
      <h2
        id="check-in-empty-heading"
        className="font-heading text-xl font-medium tracking-tight text-foreground sm:text-[22px]"
      >
        No active goals to check in on.
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        When a goal is underway, this is where you tell it how the week went.
      </p>
      <Link
        href="/goals/new"
        className={cn(buttonVariants({ size: "lg" }), "mt-5 h-11 min-h-11 px-5")}
      >
        Start a goal
      </Link>
    </section>
  );
}
