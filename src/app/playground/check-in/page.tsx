/**
 * /playground/check-in — auth-exempt, deterministic harness for the Phase 2
 * weekly check-in (the active-dashboard harness scheme). No DB: fixture rows
 * run through the REAL buildCheckInModel into the REAL <CheckInForm /> behind
 * local no-op handlers. Nothing on this surface renders a wall-clock value —
 * the fixture week row is PINNED to week_start_date 2026-06-07 (the Sunday of
 * the repo's standard pinned week) so screenshots never shift.
 *
 * ?state= variants:
 *   default  — Free, 3 active goals, replans_used = 0: the first two are
 *              default-checked (fill to the cap of 2 in display order) and
 *              the third is capacity-disabled with the inline tooltip;
 *              tapping it opens the upgrade modal. Skip available.
 *   pro      — Pro tier: all three goals default-checked, nothing disabled.
 *   resubmit — an existing 'right' check-in with notes + one goal already
 *              proposed this week: prefilled form, "already requested" row,
 *              no Skip button, no default auto-picks beyond the proposed.
 *   skipped  — a 'skipped' row exists: fresh form + the quiet skip notice,
 *              Skip still available.
 *   empty    — no active goals: message + /goals/new link, no form.
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import {
  buildCheckInModel,
  type CheckInGoalLike,
  type CheckInRowLike,
} from "../../(check-in)/check-in/check-in-model";
import { CheckInHarness } from "./harness";

// Display order by started_at asc: climb → race → book.
const GOALS: CheckInGoalLike[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Climb Mont Blanc",
    color_index: 0,
    started_at: "2026-01-15T09:00:00.000Z",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Half marathon",
    color_index: 1,
    started_at: "2026-03-02T09:00:00.000Z",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "Write a novel",
    color_index: 4,
    started_at: "2026-05-20T09:00:00.000Z",
  },
];

// The pinned week (Sunday of the 2026-06-10 fixture week used repo-wide).
const WEEK_START = "2026-06-07";

const REAL_ROW: CheckInRowLike = {
  id: "ci-fixture-1",
  week_start_date: WEEK_START,
  feeling: "right",
  notes: "Long runs felt heavy, but the climbing sessions landed.",
};

const SKIPPED_ROW: CheckInRowLike = {
  id: "ci-fixture-2",
  week_start_date: WEEK_START,
  feeling: "skipped",
  notes: null,
};

const STATES = {
  default: {
    goals: GOALS,
    existing: null,
    alreadyProposedGoalIds: [],
    tier: "free",
    replansUsed: 0,
  },
  pro: {
    goals: GOALS,
    existing: null,
    alreadyProposedGoalIds: [],
    tier: "pro",
    replansUsed: 0,
  },
  resubmit: {
    goals: GOALS,
    existing: REAL_ROW,
    // The half-marathon replan was requested on the first submission.
    alreadyProposedGoalIds: ["22222222-2222-4222-8222-222222222222"],
    tier: "free",
    replansUsed: 0,
  },
  skipped: {
    goals: GOALS,
    existing: SKIPPED_ROW,
    alreadyProposedGoalIds: [],
    tier: "free",
    replansUsed: 0,
  },
  empty: {
    goals: [],
    existing: null,
    alreadyProposedGoalIds: [],
    tier: "free",
    replansUsed: 0,
  },
} satisfies Record<string, Parameters<typeof buildCheckInModel>[0]>;

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundCheckInPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const requested = Array.isArray(state) ? state[0] : state;
  const selected: keyof typeof STATES =
    requested && requested in STATES
      ? (requested as keyof typeof STATES)
      : "default";

  return <CheckInHarness model={buildCheckInModel(STATES[selected])} />;
}
