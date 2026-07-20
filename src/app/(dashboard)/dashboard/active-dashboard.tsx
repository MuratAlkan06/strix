"use client";

/**
 * ActiveDashboard — the active-state dashboard surface (phase-1-golden-path
 * "Dashboard (active state)"): the playground DAWN composition GRADUATED.
 * HorizonHeader (dawn) + hero CountdownStat + the three sections — Today /
 * This week / Upcoming — fed by the pure dashboard-model. The product page
 * passes the real completeTask server action; the playground harness a local
 * no-op.
 *
 * Graduation discipline (DESIGN.md §11): every interactive target clears
 * 44×44px effective (size-5 checkbox glyph + extended after:* hit area — the
 * playground's 16px control is NOT copied; min-h-11 expand buttons and
 * goal-name links). One h1 per page (the HorizonHeader greeting). Color is
 * never the sole signal (GoalChip pairs dot + name). tabular-nums on every
 * count and date. Task rows are clean chrome — text + GoalChip + checkbox,
 * no illustration (§6).
 *
 * Row anatomy (CS-11): a COLLAPSED task row is the goal-color dot + activity
 * title + a compact cadence label (weekday / "Daily") + the expand chevron —
 * the goal attribution and cadence·duration stay hidden. Tapping the row body
 * expands it, revealing the goal-attribution line (dot + NAME, the deep link
 * to /goals/[id]) and the cadence·duration detail. The color dot rides beside
 * the title collapsed and drops to the goal line expanded, so every row stays
 * goal-distinguishable in both states — and the collapsed dot is sr-only-paired
 * with the goal name so color is never the sole signal (§11). Checkbox is Today
 * tasks only (Phase 1 is check-only, no un-check). Completed-today tasks stay
 * visible, struck and checked. Overdue due-rows carry the amber icon-paired
 * "was due" note (§8 — warning is amber, never red).
 *
 * Phase 2 surfaces (slice 6+7):
 *   - Check-in prompt — a quiet banner under the header on Friday/Saturday
 *     until the week's check-in row exists (an invitation, not a nag; the
 *     whole banner links /check-in).
 *   - Accomplished — completed/archived goals as small quiet cards below the
 *     section grid (SPEC §6 retention surface): goal dot + title + honest
 *     date line, the whole card deep-linking to the read-only goal detail.
 *     No scene tiles — the working surface stays crisp chrome (§4.5/§6).
 *
 * Check-off is optimistic: strike immediately, insert via the server action,
 * roll back with a calm constant line on failure. An already-done result
 * (unique-constraint no-op) keeps the row checked.
 *
 * Offline (phase 2.5 slice S6, planning doc "Offline dashboard shell"): the
 * service worker serves this surface from the strix-dashboard-* SWR cache,
 * so it must stay honest without a network. useOnline drives two changes —
 * a quiet "Offline" line under the header, and the check-off control
 * rendered visibly disabled (aria-disabled, dimmed, tooltip "Reconnects
 * when you're online."). No queued mutations in MVP: offline check-off is
 * simply not offered. ONLINE rendering is byte-identical to pre-S6 — the
 * verify:ui baselines must not shift.
 */
import { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Package,
  WifiOff,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { CountdownStat } from "@/components/countdown-stat";
import { GoalChip } from "@/components/goal-chip";
import { HorizonHeader } from "@/components/horizon-header";
import {
  InstallBanner,
  InstallBannerView,
  INSTALL_DISMISS_FOCUS_ID,
} from "@/components/install-banner";
import type { InstallVariant } from "@/lib/install-platform";
import { formatDate } from "@/lib/format";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";
import {
  dayUnit,
  goalHref,
  type AccomplishedCardModel,
  type CompleteTaskHandler,
  type CompleteTaskResult,
  type DashboardModel,
  type DashboardRowModel,
  type DueRowModel,
  type TaskRowModel,
} from "./dashboard-model";

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ERR_FALLBACK = "That didn't save. Try once more.";

/** Goal-name deep link — the ≥44px target wraps the chip (equipment posture). */
function GoalNameLink({ row }: { row: { goalId: string; goalTitle: string; goalColorIndex: number } }) {
  return (
    <Link
      href={goalHref(row.goalId)}
      className="-my-3 inline-flex min-h-11 min-w-11 cursor-pointer items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <GoalChip
        colorIndex={row.goalColorIndex as 0 | 1 | 2 | 3 | 4}
        name={row.goalTitle}
        className="transition-colors hover:text-foreground"
      />
    </Link>
  );
}

/** Expanded details: cadence + duration, plain and declarative. Indented to
 *  sit under the title (past the checkbox lane on checkable rows). */
function TaskDetails({
  row,
  checkable,
}: {
  row: TaskRowModel;
  checkable: boolean;
}) {
  const cadence =
    row.cadence === "daily"
      ? "Every day"
      : row.weekday !== null
        ? `Every ${WEEKDAY_SHORT[row.weekday]}`
        : "Weekly";
  return (
    <p
      className={cn(
        "pb-2 pr-2 text-xs text-muted-foreground",
        checkable ? "pl-10" : "pl-2",
      )}
    >
      {cadence}
      {row.durationMin !== null && (
        <>
          {" · "}
          <span className="tabular-nums">{row.durationMin} min</span>
        </>
      )}
    </p>
  );
}

function TaskRow({
  row,
  checkable,
  checked,
  offline,
  onCheck,
}: {
  row: TaskRowModel;
  /** Only TODAY tasks are checkable — a future weekly session is not. */
  checkable: boolean;
  checked: boolean;
  /** Offline (S6): check-off is visibly disabled, with the tooltip below. */
  offline: boolean;
  onCheck: (row: TaskRowModel) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = `task-details-${row.id}`;
  const offlineHintId = `offline-hint-${row.id}`;
  // The compact cadence indicator that rides on the right in BOTH states — the
  // weekday for a weekly session, "Daily" for a daily task — so the schedule
  // reads at a glance without expanding. ("Weekly" is defensive: the model
  // filters malformed weekly rows out before they reach here.)
  const cadenceLabel =
    row.cadence === "daily"
      ? "Daily"
      : row.weekday !== null
        ? WEEKDAY_SHORT[row.weekday]
        : "Weekly";
  return (
    <li className="flex flex-col">
      <div className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5">
        {checkable &&
          (offline ? (
            // Offline: same glyph, visibly disabled. aria-disabled — NOT the
            // native disabled attribute — keeps the control hoverable and
            // focusable so the tooltip can explain itself. The visible Base UI
            // tooltip only renders on hover/focus from a portal, so it can't be
            // a reliable accessible description; instead the control carries
            // aria-describedby pointing at an always-present sr-only node with
            // the same copy, so AT users hear both the state and the
            // description regardless of tooltip open-state. It stays inert
            // because the checkbox is controlled and no onCheckedChange is
            // wired.
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Checkbox
                      checked={checked}
                      aria-disabled
                      aria-label={`Mark done: ${row.title}`}
                      aria-describedby={offlineHintId}
                      className="size-5 cursor-not-allowed opacity-50 after:-inset-3 [&_svg]:size-4"
                    />
                  }
                />
                <span id={offlineHintId} className="sr-only">
                  Reconnects when you&rsquo;re online.
                </span>
                <TooltipContent>
                  Reconnects when you&rsquo;re online.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : (
            // size-5 glyph; the after:* hit area extends it to a 44×44
            // effective target (20px + 2×12px). Checked = glyph +
            // strikethrough, never color alone. Phase 1 is check-only:
            // un-check attempts are no-ops.
            <Checkbox
              checked={checked}
              onCheckedChange={(v) => {
                if (v === true && !checked) onCheck(row);
              }}
              aria-label={`Mark done: ${row.title}`}
              className="size-5 cursor-pointer after:-inset-3 [&_svg]:size-4"
            />
          ))}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-controls={detailsId}
          className="-my-1 flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {/* Collapsed: the parent-goal color dot rides beside the title so
              multi-goal schedules stay distinguishable at a glance; expanded,
              the dot drops to the goal-attribution line below — but its slot
              HERE is kept (visibility:hidden, not unmounted), reserving the
              exact horizontal box so the title's x-position is identical in
              both states: no left-teleport on toggle (§7 — nothing jumps; the
              drop reads clean, CS-11 motion fix). The dot is aria-hidden (same
              as GoalChip's), so the goal name is carried for AT by the sr-only
              pairing after the title — color is never the sole signal (§11). */}
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full ring-1 ring-foreground/10",
              expanded && "invisible",
            )}
            style={{
              backgroundColor: `var(--goal-color-${row.goalColorIndex})`,
            }}
          />
          <span
            className={cn(
              "min-w-0 flex-1 text-sm leading-snug transition-colors",
              checked ? "text-muted-foreground line-through" : "text-foreground",
            )}
          >
            {row.title}
          </span>
          {!expanded && <span className="sr-only">{row.goalTitle}</span>}
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {cadenceLabel}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
      </div>
      {/* Disclosure (aria-controls target): the goal attribution (dot + NAME —
          the deep link) over the cadence·duration detail. Always mounted so the
          reveal/retract is a real height transition — the grid-rows 0fr↔1fr
          idiom, ≤200ms ease-out (enter easing, §7) — rather than an instant
          pop; the id target is therefore always present, so aria-controls never
          dangles. Collapsed, the content is visibility-hidden (invisible):
          dropped from the a11y tree AND the tab order (no focusable ghost link),
          and clipped to zero height by the overflow-hidden grid item — so the
          collapsed layout, its a11y tree, and the verify:ui baselines are all
          unchanged. motion-reduce turns the transition off (instant reveal —
          the §7 reduced-motion map). */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className={cn("overflow-hidden", !expanded && "invisible")}>
          <div id={detailsId}>
            <div className={cn("flex items-center px-2", checkable && "pl-10")}>
              <GoalNameLink row={row} />
            </div>
            <TaskDetails row={row} checkable={checkable} />
          </div>
        </div>
      </div>
    </li>
  );
}

function DueRow({ row, today }: { row: DueRowModel; today: string }) {
  const Icon = row.kind === "milestone" ? Calendar : Package;
  return (
    <li className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-1.5">
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm leading-snug text-foreground">
          {row.title}
          <span className="sr-only">
            {row.kind === "equipment" ? " (equipment)" : " (milestone)"}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-x-3">
          <GoalNameLink row={row} />
          {row.overdue ? (
            // §8: overdue is an amber icon-paired note — plain, never red.
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="tabular-nums">
                Was due {formatDate(row.deadline)}
              </span>
            </span>
          ) : (
            <span className="text-xs tabular-nums text-muted-foreground">
              {row.deadline === today ? "Today" : `By ${formatDate(row.deadline)}`}
            </span>
          )}
        </span>
      </span>
    </li>
  );
}

/**
 * The Friday/Saturday check-in invitation (phase 2 slice 7) — one quiet
 * card-toned row, the WHOLE banner a single ≥44px link to /check-in. In
 * register: declarative and calm, never a nag; it disappears the moment the
 * week's row (submitted or skipped) exists, so there is no dismiss chrome.
 */
function CheckInPromptBanner() {
  return (
    <Link
      href="/check-in"
      className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3 outline-none transition-colors hover:bg-accent/20 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex min-w-0 flex-col">
        <span className="text-sm font-medium leading-snug text-foreground">
          How did this week feel?
        </span>
        <span className="text-xs text-muted-foreground">
          Take a minute to check in.
        </span>
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
}

/** "Completed Jun 5, 2026" / "Archived May 8, 2026" — or null (no fake date). */
function accomplishedDateLine(card: AccomplishedCardModel): string | null {
  if (card.dateIso === null) return null;
  const verb = card.dateKind === "archived" ? "Archived" : "Completed";
  return `${verb} ${formatDate(card.dateIso)}`;
}

/**
 * Accomplished (phase 2 slice 6; SPEC §6) — small quiet cards for finished
 * goals: goal dot + title (the GoalChip convention — color never the sole
 * signal) over the honest date line. Each card is one link into the
 * read-only goal detail. No scene art: the §4.5 brand moments stay where
 * they are; this list is working chrome.
 */
function AccomplishedSection({
  cards,
}: {
  cards: readonly AccomplishedCardModel[];
}) {
  return (
    <Card>
      <CardHeader>
        <h2
          data-slot="card-title"
          className="font-heading text-base font-medium leading-snug"
        >
          Accomplished
        </h2>
      </CardHeader>
      <CardContent>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const dateLine = accomplishedDateLine(card);
            return (
              <li key={card.goalId}>
                <Link
                  href={goalHref(card.goalId)}
                  className="flex min-h-11 flex-col gap-0.5 rounded-lg border border-border p-3 outline-none transition-colors hover:bg-accent/20 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <GoalChip
                    colorIndex={card.colorIndex as 0 | 1 | 2 | 3 | 4}
                    name={card.title}
                    className="text-sm font-medium text-foreground"
                  />
                  {dateLine && (
                    <span className="pl-3.5 text-xs tabular-nums text-muted-foreground">
                      {dateLine}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

function SectionCard({
  title,
  description,
  emptyLine,
  children,
  isEmpty,
}: {
  title: string;
  description?: string;
  emptyLine: string;
  isEmpty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        {/* Real h2 (section landmark for AT), styled as the card title — the
            page's single h1 is the HorizonHeader greeting. */}
        <h2
          data-slot="card-title"
          className="font-heading text-base font-medium leading-snug"
        >
          {title}
        </h2>
        {description && (
          <CardDescription className="tabular-nums">
            {description}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          // Honest empty line, in register — never a fake row.
          <p className="px-2 text-sm text-muted-foreground">{emptyLine}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">{children}</ul>
        )}
      </CardContent>
    </Card>
  );
}

export interface ActiveDashboardProps {
  greeting: string;
  dateLabel: string;
  /** YYYY-MM-DD on the user's calendar — labels "Today" vs dated deadlines. */
  today: string;
  model: DashboardModel;
  /** Completed/archived goals (buildAccomplishedCards) — empty hides the
   *  section; once ≥1 exists it renders below the grid and never hides. */
  accomplished: readonly AccomplishedCardModel[];
  /** shouldShowCheckInPrompt(today, this week's rows) — the Fri/Sat banner. */
  showCheckInPrompt: boolean;
  /** Server-known half of the S8 install-banner gate: ≥1 active goal. The
   *  session-count half + platform branch are resolved client-side. */
  hasActiveGoal: boolean;
  /** HARNESS-ONLY: render the eligible InstallBannerView in context, bypassing
   *  the Clerk/localStorage gates the playground can't satisfy, so the in-place
   *  placement is reviewable on a live render. Undefined in production — the
   *  real gated <InstallBanner /> renders and this never fires. Never wire it
   *  from the product page. */
  installBannerPreview?: InstallVariant;
  onComplete: CompleteTaskHandler;
}

export function ActiveDashboard({
  greeting,
  dateLabel,
  today,
  model,
  accomplished,
  showCheckInPrompt,
  hasActiveGoal,
  installBannerPreview,
  onComplete,
}: ActiveDashboardProps) {
  // Optimistic check state layered over the server-derived completed flags;
  // rolled back on a failed action. Keyed by recurring task id.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  // HARNESS-ONLY local dismissal so the in-context preview's dismiss button is
  // exercisable in a real browser (verify:ui). No-op in production.
  const [previewDismissed, setPreviewDismissed] = useState(false);
  // Offline state (S6): SSR-safe, flips with the window online/offline
  // events — e.g. the moment airplane mode toggles on a cached render.
  const online = useOnline();

  const isChecked = (row: TaskRowModel) =>
    overrides[row.id] ?? row.completedToday;

  async function handleCheck(row: TaskRowModel) {
    // Offline rows never wire onCheck, but belt-and-braces: a check-off
    // attempted without a network would only fail slower.
    if (!online) return;
    setError(null);
    setOverrides((o) => ({ ...o, [row.id]: true }));
    let result: CompleteTaskResult;
    try {
      result = await onComplete({ taskId: row.id });
    } catch {
      result = { ok: false, error: ERR_FALLBACK };
    }
    if (!result.ok) {
      // Roll the strike back; the line is calm and constant (§8 — not a red
      // screen, not a toast storm).
      setOverrides((o) => ({ ...o, [row.id]: row.completedToday }));
      setError(result.error);
    }
    // ok:true with alreadyDone keeps the row checked — the calm no-op.
  }

  const doneCount =
    model.todayDoneCount +
    model.today.filter(
      (r) => r.kind === "task" && !r.completedToday && overrides[r.id],
    ).length;

  const renderRow = (row: DashboardRowModel, checkable: boolean) =>
    row.kind === "task" ? (
      <TaskRow
        key={row.id}
        row={row}
        checkable={checkable}
        checked={isChecked(row)}
        offline={!online}
        onCheck={handleCheck}
      />
    ) : (
      <DueRow key={`${row.kind}-${row.id}`} row={row} today={today} />
    );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-5 sm:p-5">
      <HorizonHeader greeting={greeting} date={dateLabel} state="dawn" />

      {/* Offline (S6): one quiet, factual line at the top of content — muted,
          icon-paired, never amber (§8 reserves the warning tone for cap hit /
          overdue; being offline is a state, not a fault). The element is
          PERSISTENT (like the error status line below) so the live region
          reliably announces the transition; online it is sr-only and empty —
          sr-only is absolutely positioned, so the online layout (and the
          verify:ui baselines) are untouched. */}
      <p
        role="status"
        className={cn(
          "flex items-center gap-1.5 text-xs text-muted-foreground",
          online && "sr-only",
        )}
      >
        {!online && (
          <>
            <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
            Offline
          </>
        )}
      </p>

      {/* Friday/Saturday check-in invitation — gone once the week has a row. */}
      {showCheckInPrompt && <CheckInPromptBanner />}

      {/* Install affordance (S8): self-hides unless eligible (active goal +
          3+ sessions), not already installed, and not previously dismissed.
          Renders nothing on the server / first paint, so it never shifts the
          dashboard baselines. The harness passes installBannerPreview to mount
          the eligible view IN CONTEXT (bypassing gates it can't satisfy) so the
          in-place placement/hierarchy is reviewable; production never sets it. */}
      {installBannerPreview !== undefined ? (
        previewDismissed ? null : (
          <InstallBannerView
            variant={installBannerPreview}
            onInstall={
              installBannerPreview === "chrome" ? () => {} : undefined
            }
            onDismiss={() => setPreviewDismissed(true)}
          />
        )
      ) : (
        <InstallBanner hasActiveGoal={hasActiveGoal} />
      )}

      {/* Calm, constant error line — announced politely, visible in register. */}
      <p aria-live="polite" role="status" className="sr-only">
        {error ?? ""}
      </p>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}

      {/* Hero countdown — the next milestone on the horizon (tabular). It is
          also the install banner's dismiss-focus neighbor: when the banner is
          dismissed its <section> unmounts, so focus is moved here (id +
          tabIndex=-1) rather than dropping to <body> — keeping keyboard order
          intact. No role/aria-label is added (a roleless labeled div trips
          aria-prohibited-attr); focus simply lands here and SR reads the
          countdown content the Card already exposes. */}
      {model.nextMilestone && (
        <Card
          id={INSTALL_DISMISS_FOCUS_ID}
          tabIndex={-1}
          className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <CountdownStat
              value={model.nextMilestone.daysUntil}
              label={`${dayUnit(model.nextMilestone.daysUntil)} to ${model.nextMilestone.title}`}
              sublabel={`Target: ${formatDate(model.nextMilestone.date)}`}
              size="lg"
            />
            <GoalNameLink row={model.nextMilestone} />
          </CardContent>
        </Card>
      )}

      {/* Mobile: the three sections stack vertically. lg: Today leads a 2-col
          grid with This week / Upcoming in the rail (the graduated playground
          arrangement). */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4 sm:gap-5">
          <SectionCard
            title="Today"
            description={
              model.todayTaskCount > 0
                ? `${doneCount} of ${model.todayTaskCount} done`
                : undefined
            }
            emptyLine="Nothing scheduled today. Rest is part of the plan."
            isEmpty={model.today.length === 0}
          >
            {model.today.map((row) => renderRow(row, true))}
          </SectionCard>
        </div>

        <div className="flex flex-col gap-4 sm:gap-5">
          <SectionCard
            title="This week"
            emptyLine="The rest of this week is clear."
            isEmpty={model.thisWeek.length === 0}
          >
            {model.thisWeek.map((row) => renderRow(row, false))}
          </SectionCard>

          <SectionCard
            title="Upcoming"
            emptyLine="Nothing due in the next two weeks."
            isEmpty={model.upcoming.length === 0}
          >
            {model.upcoming.map((row) => (
              <DueRow key={`${row.kind}-${row.id}`} row={row} today={today} />
            ))}
          </SectionCard>
        </div>
      </div>

      {/* Accomplished — below the section grid; absent until the first win,
          persistent after it (the retention surface, never re-hidden). */}
      {accomplished.length > 0 && <AccomplishedSection cards={accomplished} />}
    </main>
  );
}
