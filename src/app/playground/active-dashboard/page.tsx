/**
 * /playground/active-dashboard — auth-exempt, deterministic harness for the
 * Slice 10 ACTIVE dashboard (kept SEPARATE from /playground/dashboard so that
 * surface's verify:ui baselines stay byte-identical). No DB: fixture rows run
 * through the REAL buildDashboardModel (with a PINNED `today`, 2026-06-10 — a
 * Wednesday, weekday 3 — so bucketing never shifts as wall-clock time passes)
 * into the REAL <ActiveDashboard /> behind a local no-op complete handler.
 *
 * The populated state covers every section and edge:
 *   Today     — two daily tasks (one COMPLETED today: struck, checked, still
 *               visible) + the Wednesday weekly task + a milestone due today
 *               + an OVERDUE milestone (amber note, riding in the nearest
 *               bucket)
 *   This week — Thu + Sat weekly sessions + a Saturday milestone + equipment
 *               due Friday
 *   Upcoming  — a milestone at the exactly-today+14 boundary + its linked
 *               equipment + standalone equipment in between
 *   Excluded  — a past-weekday weekly task, an inactive task, a purchased
 *               equipment row, a completed milestone, a completed goal's task,
 *               a dangling milestone link (all invisible by construction)
 *
 * ?state=empty-sections renders three honest empty lines (two active goals
 * whose items are all out of range — the dashboard stays coherent with zero
 * due items; the far milestone still feeds the hero countdown).
 *
 * Phase 2 slice 6+7 states (ADDITIVE — the two states above and their
 * baselines are untouched; they pass accomplished=[] and a Wednesday date):
 *   ?state=accomplished — the populated dashboard plus the Accomplished
 *     section: one completed goal, one archived goal whose completed_at
 *     SURVIVED auto-archive, and one archived with NULL completed_at (the
 *     honest archived_at fallback label).
 *   ?state=friday-prompt — the populated fixtures re-bucketed on a PINNED
 *     Friday (2026-06-12, weekday 5) with no check-in row, so the REAL
 *     shouldShowCheckInPrompt predicate opens the banner.
 *   ?state=accomplished-no-active — zero active goals, ≥1 accomplished: the
 *     coherent "all wins, nothing scheduled" dashboard (honest empty lines
 *     above the Accomplished section, never the pre-dawn empty state).
 *
 * Phase 2.5 slice S8 in-context preview states (ADDITIVE — the populated
 * fixtures and their baselines are untouched; these only INJECT the install
 * banner the gated container can't surface here):
 *   ?state=install-chrome — the populated dashboard with the eligible Chrome
 *     install banner rendered IN PLACE (between the check-in prompt and the
 *     hero countdown). Reviewable on a live render; the real eligibility logic
 *     is bypassed for the harness only (installBannerPreview), never changed.
 *   ?state=install-ios    — same, with the iOS "Add to Home Screen" variant.
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import {
  buildAccomplishedCards,
  buildDashboardModel,
  dashboardDateLabel,
  shouldShowCheckInPrompt,
  type AccomplishedGoalLike,
  type DashboardEquipmentLike,
  type DashboardGoalLike,
  type DashboardMilestoneLike,
  type DashboardTaskLike,
  type CompletionLike,
} from "../../(dashboard)/dashboard/dashboard-model";
import type { InstallVariant } from "@/lib/install-platform";
import { ActiveDashboardHarness } from "./harness";

/** ?state=install-chrome / install-ios → the in-context InstallBannerView
 *  variant the harness injects; anything else leaves the banner unrendered. */
const INSTALL_PREVIEW: Record<string, InstallVariant> = {
  "install-chrome": "chrome",
  "install-ios": "ios",
};

const TODAY = "2026-06-10"; // Wednesday → weekday 3 (0 = Sunday)
const FRIDAY = "2026-06-12"; // Friday → weekday 5 — the prompt window opens

const GOALS: DashboardGoalLike[] = [
  { id: "g-climb", title: "Climb Mont Blanc", status: "active", color_index: 0 },
  { id: "g-race", title: "Half marathon", status: "active", color_index: 1 },
  { id: "g-book", title: "Write a novel", status: "active", color_index: 4 },
  // Non-active goal — its rows must never surface.
  { id: "g-done", title: "Finished goal", status: "completed", color_index: 2 },
];

const TASKS: DashboardTaskLike[] = [
  // Today — daily across goals; t-words is completed today (struck, visible).
  {
    id: "11111111-1111-4111-8111-111111111111",
    goal_id: "g-climb",
    title: "Stair intervals",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 30,
    active: true,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    goal_id: "g-book",
    title: "Write 500 words",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 45,
    active: true,
  },
  // Today — weekly session whose weekday matches Wednesday.
  {
    id: "33333333-3333-4333-8333-333333333333",
    goal_id: "g-race",
    title: "Zone-2 run",
    cadence: "weekly",
    weekday: 3,
    estimated_duration_min: 40,
    active: true,
  },
  // This week — Thursday and Saturday sessions still ahead.
  {
    id: "44444444-4444-4444-8444-444444444444",
    goal_id: "g-climb",
    title: "Hill repeats with pack",
    cadence: "weekly",
    weekday: 4,
    estimated_duration_min: 60,
    active: true,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    goal_id: "g-race",
    title: "Long run 16 km",
    cadence: "weekly",
    weekday: 6,
    estimated_duration_min: 90,
    active: true,
  },
  // Excluded: Monday already passed this week.
  {
    id: "66666666-6666-4666-8666-666666666666",
    goal_id: "g-book",
    title: "Reading circle",
    cadence: "weekly",
    weekday: 1,
    estimated_duration_min: null,
    active: true,
  },
  // Excluded: deactivated task.
  {
    id: "77777777-7777-4777-8777-777777777777",
    goal_id: "g-climb",
    title: "Old drill",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 20,
    active: false,
  },
  // Excluded: belongs to a completed goal.
  {
    id: "88888888-8888-4888-8888-888888888888",
    goal_id: "g-done",
    title: "Ghost task",
    cadence: "daily",
    weekday: null,
    estimated_duration_min: 10,
    active: true,
  },
];

const MILESTONES: DashboardMilestoneLike[] = [
  // Today: due exactly today.
  {
    id: "ms-chapter",
    goal_id: "g-book",
    title: "Submit chapter 3",
    target_date: "2026-06-10",
    completed_at: null,
  },
  // Today: OVERDUE — rides in the nearest bucket with the amber note.
  {
    id: "ms-boots",
    goal_id: "g-climb",
    title: "Pick up rental boots",
    target_date: "2026-06-08",
    completed_at: null,
  },
  // This week: Saturday.
  {
    id: "ms-tt",
    goal_id: "g-race",
    title: "10k time-trial",
    target_date: "2026-06-13",
    completed_at: null,
  },
  // Upcoming: the exactly-today+14 boundary day (inclusive).
  {
    id: "ms-buet",
    goal_id: "g-climb",
    title: "Mont Buet acclimatization climb",
    target_date: "2026-06-24",
    completed_at: null,
  },
  // Excluded: already completed.
  {
    id: "ms-done",
    goal_id: "g-race",
    title: "First 5k",
    target_date: "2026-06-12",
    completed_at: "2026-06-01T09:00:00.000Z",
  },
];

const EQUIPMENT: DashboardEquipmentLike[] = [
  // This week: standalone Friday deadline.
  {
    id: "eq-crampons",
    goal_id: "g-climb",
    title: "Crampons",
    milestone_id: null,
    standalone_deadline: "2026-06-12",
    purchased_at: null,
  },
  // Upcoming: standalone, 10 days out.
  {
    id: "eq-vest",
    goal_id: "g-race",
    title: "Hydration vest",
    milestone_id: null,
    standalone_deadline: "2026-06-20",
    purchased_at: null,
  },
  // Upcoming: milestone-linked — deadline derived from ms-buet (06-24).
  {
    id: "eq-glasses",
    goal_id: "g-climb",
    title: "Glacier glasses",
    milestone_id: "ms-buet",
    standalone_deadline: null,
    purchased_at: null,
  },
  // Excluded: already purchased.
  {
    id: "eq-shoes",
    goal_id: "g-race",
    title: "Trail running shoes",
    milestone_id: null,
    standalone_deadline: "2026-06-11",
    purchased_at: "2026-06-05T09:00:00.000Z",
  },
  // Excluded: dangling milestone link degrades to no derivable date.
  {
    id: "eq-dangling",
    goal_id: "g-book",
    title: "Reference book",
    milestone_id: "ms-vanished",
    standalone_deadline: null,
    purchased_at: null,
  },
];

const COMPLETIONS: CompletionLike[] = [
  // "Write 500 words" was checked earlier today — struck, checked, visible.
  {
    recurring_task_id: "22222222-2222-4222-8222-222222222222",
    for_date: "2026-06-10",
  },
];

// --- empty-sections state: two active goals, zero due items in range --------

const EMPTY_GOALS: DashboardGoalLike[] = [
  { id: "g-climb", title: "Climb Mont Blanc", status: "active", color_index: 0 },
  { id: "g-book", title: "Write a novel", status: "active", color_index: 4 },
];

const EMPTY_TASKS: DashboardTaskLike[] = [
  // Monday has passed — this week holds nothing more for it.
  {
    id: "99999999-9999-4999-8999-999999999999",
    goal_id: "g-book",
    title: "Reading circle",
    cadence: "weekly",
    weekday: 1,
    estimated_duration_min: null,
    active: true,
  },
];

const EMPTY_MILESTONES: DashboardMilestoneLike[] = [
  // Beyond the 14-day horizon — feeds only the hero countdown.
  {
    id: "ms-summit",
    goal_id: "g-climb",
    title: "Summit day",
    target_date: "2026-09-20",
    completed_at: null,
  },
];

// --- accomplished states: the three card archetypes -------------------------

const ACCOMPLISHED_GOALS: AccomplishedGoalLike[] = [
  // Completed, not yet auto-archived — "Completed Jun 5, 2026".
  {
    id: "g-done",
    title: "Finished goal",
    status: "completed",
    color_index: 2,
    completed_at: "2026-06-05T09:00:00.000Z",
    archived_at: null,
  },
  // Archived a week after completion — completed_at SURVIVES auto-archive,
  // so the card still says "Completed Apr 18, 2026".
  {
    id: "g-couch5k",
    title: "Couch to 5k",
    status: "archived",
    color_index: 1,
    completed_at: "2026-04-18T09:00:00.000Z",
    archived_at: "2026-04-25T03:00:00.000Z",
  },
  // Archived with NULL completed_at (a future archive path) — the honest
  // fallback label "Archived Mar 2, 2026".
  {
    id: "g-sketch",
    title: "Thirty days of sketching",
    status: "archived",
    color_index: 3,
    completed_at: null,
    archived_at: "2026-03-02T03:00:00.000Z",
  },
];

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundActiveDashboardPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const selected = Array.isArray(state) ? state[0] : state;
  const empty = selected === "empty-sections";
  const noActive = selected === "accomplished-no-active";
  const withAccomplished = selected === "accomplished" || noActive;
  // S8 in-context preview: install-* states reuse the populated fixtures (which
  // carry a milestone due today → the hero countdown, the banner's dismiss-focus
  // neighbor, is present) and inject the eligible banner via installBannerPreview.
  const installBannerPreview = selected ? INSTALL_PREVIEW[selected] : undefined;
  // Every state pins its date: the Friday state re-buckets the SAME populated
  // fixtures two days later, so the banner is judged by the real predicate.
  const today = selected === "friday-prompt" ? FRIDAY : TODAY;

  const model = buildDashboardModel(
    empty
      ? {
          goals: EMPTY_GOALS,
          tasks: EMPTY_TASKS,
          milestones: EMPTY_MILESTONES,
          equipment: [],
          completions: [],
          today,
        }
      : noActive
        ? {
            goals: [],
            tasks: [],
            milestones: [],
            equipment: [],
            completions: [],
            today,
          }
        : {
            goals: GOALS,
            tasks: TASKS,
            milestones: MILESTONES,
            equipment: EQUIPMENT,
            completions: COMPLETIONS,
            today,
          },
  );

  return (
    <ActiveDashboardHarness
      greeting="Good morning."
      dateLabel={dashboardDateLabel(today)}
      today={today}
      model={model}
      accomplished={
        withAccomplished ? buildAccomplishedCards(ACCOMPLISHED_GOALS) : []
      }
      // The REAL predicate over the pinned date — no check-in row in any state.
      showCheckInPrompt={shouldShowCheckInPrompt(today, [])}
      installBannerPreview={installBannerPreview}
    />
  );
}
