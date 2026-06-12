/**
 * replan-model tests — the pure layer behind the replan diff UI.
 *
 * Pins:
 *   - stable change keys: row ids for modify/remove, stored-array index for
 *     adds; enumeration order is per-section add → modify → remove (the key
 *     set is the form ↔ server contract);
 *   - placeholder detection: EMPTY_REPLAN_DIFF (and only an all-empty diff)
 *     means "requested, not yet generated";
 *   - the frozen status mapping (all/some/none);
 *   - selectDisplayProposal: most recent PENDING, else most recent decided;
 *   - buildReplanPageModel modes: generate (placeholder or unparseable
 *     pending), review (real pending diff; goalActive + unresolved
 *     surfaced), decided (read-only summary), none;
 *   - before/after pairs join modify entries against the CURRENT rows, and
 *     a vanished target renders unresolved instead of inventing values.
 */
import { describe, expect, it } from "vitest";

import { EMPTY_REPLAN_DIFF, type ReplanDiff } from "@/lib/ai/replan-diff";
import {
  buildReplanPageModel,
  buildReplanSections,
  decisionStatus,
  enumerateChanges,
  isPlaceholderDiff,
  selectDisplayProposal,
  type CurrentEquipmentLike,
  type CurrentMilestoneLike,
  type CurrentTaskLike,
  type ProposalRowLike,
} from "./replan-model";

const T1 = "aaaaaaa1-0000-4000-8000-000000000001";
const M1 = "bbbbbbb1-0000-4000-8000-000000000001";
const E1 = "ccccccc1-0000-4000-8000-000000000001";

function diff(): ReplanDiff {
  return {
    recurring_tasks: {
      add: [
        { title: "Evening stretch", cadence: "daily", weekday: null, estimated_duration_min: 10 },
      ],
      modify: [{ id: T1, changes: { weekday: 0 } }],
      remove: [{ id: T1 }],
    },
    milestones: {
      add: [],
      modify: [{ id: M1, changes: { target_date: "2026-08-27" } }],
      remove: [],
    },
    equipment: {
      add: [],
      modify: [],
      remove: [{ id: E1 }],
    },
  };
}

const TASKS: CurrentTaskLike[] = [
  { id: T1, title: "Long hike", cadence: "weekly", weekday: 6, estimated_duration_min: 180, active: true },
];
const MILESTONES: CurrentMilestoneLike[] = [
  { id: M1, title: "Glacier course", target_date: "2026-07-15", position: 0 },
];
const EQUIPMENT: CurrentEquipmentLike[] = [
  { id: E1, title: "Crampons", cost_usd: "180.00", milestone_id: M1, standalone_deadline: null },
];

describe("enumerateChanges — stable keys, stable order", () => {
  it("keys: section:add:index / section:modify:id / section:remove:id", () => {
    expect(enumerateChanges(diff()).map((c) => c.key)).toEqual([
      "recurring_tasks:add:0",
      `recurring_tasks:modify:${T1}`,
      `recurring_tasks:remove:${T1}`,
      `milestones:modify:${M1}`,
      `equipment:remove:${E1}`,
    ]);
  });
});

describe("isPlaceholderDiff", () => {
  it("EMPTY_REPLAN_DIFF is the placeholder", () => {
    expect(isPlaceholderDiff(EMPTY_REPLAN_DIFF)).toBe(true);
  });

  it("a single change anywhere makes it real", () => {
    const d = structuredClone(EMPTY_REPLAN_DIFF);
    d.equipment.remove.push({ id: E1 });
    expect(isPlaceholderDiff(d)).toBe(false);
  });
});

describe("decisionStatus — the frozen mapping", () => {
  it.each([
    [5, 5, "accepted"],
    [1, 5, "partially_accepted"],
    [4, 5, "partially_accepted"],
    [0, 5, "rejected"],
  ] as const)("%d of %d accepted → %s", (accepted, total, expected) => {
    expect(decisionStatus(accepted, total)).toBe(expected);
  });
});

describe("selectDisplayProposal", () => {
  function row(over: Partial<ProposalRowLike>): ProposalRowLike {
    return {
      id: "p",
      status: "pending",
      trigger: "weekly_check_in",
      weekly_check_in_id: null,
      proposed_changes: EMPTY_REPLAN_DIFF,
      created_at: "2026-06-01T00:00:00.000Z",
      decided_at: null,
      ...over,
    };
  }

  it("the most recent PENDING wins over anything decided", () => {
    const picked = selectDisplayProposal([
      row({ id: "old-pending", created_at: "2026-06-01T00:00:00.000Z" }),
      row({ id: "new-pending", created_at: "2026-06-08T00:00:00.000Z" }),
      row({
        id: "decided",
        status: "accepted",
        created_at: "2026-06-09T00:00:00.000Z",
        decided_at: "2026-06-09T00:00:00.000Z",
      }),
    ]);
    expect(picked?.id).toBe("new-pending");
  });

  it("with no pending, the most recently DECIDED wins", () => {
    const picked = selectDisplayProposal([
      row({
        id: "older",
        status: "rejected",
        decided_at: "2026-06-02T00:00:00.000Z",
      }),
      row({
        id: "newer",
        status: "partially_accepted",
        decided_at: "2026-06-05T00:00:00.000Z",
      }),
    ]);
    expect(picked?.id).toBe("newer");
  });

  it("no proposals → null", () => {
    expect(selectDisplayProposal([])).toBeNull();
  });
});

describe("buildReplanSections — before/after joins the current rows", () => {
  it("a modify renders current → proposed", () => {
    const sections = buildReplanSections({
      diff: diff(),
      tasks: TASKS,
      milestones: MILESTONES,
      equipment: EQUIPMENT,
    });
    const taskSection = sections.find((s) => s.section === "recurring_tasks")!;
    const modify = taskSection.rows.find((r) => r.kind === "modify")!;
    expect(modify).toMatchObject({
      title: "Long hike",
      unresolved: false,
      deltas: [
        { field: "weekday", label: "Weekday", before: "Saturday", after: "Sunday" },
      ],
    });
  });

  it("a vanished target renders unresolved — never invented values", () => {
    const sections = buildReplanSections({
      diff: diff(),
      tasks: [],
      milestones: MILESTONES,
      equipment: EQUIPMENT,
    });
    const taskSection = sections.find((s) => s.section === "recurring_tasks")!;
    const modify = taskSection.rows.find((r) => r.kind === "modify")!;
    const remove = taskSection.rows.find((r) => r.kind === "remove")!;
    expect(modify).toMatchObject({ unresolved: true });
    expect(remove).toMatchObject({
      unresolved: true,
      title: "No longer in the plan",
    });
  });

  it("sections with no changes do not render", () => {
    const d = diff();
    d.milestones.modify = [];
    d.equipment.remove = [];
    const sections = buildReplanSections({
      diff: d,
      tasks: TASKS,
      milestones: MILESTONES,
      equipment: EQUIPMENT,
    });
    expect(sections.map((s) => s.section)).toEqual(["recurring_tasks"]);
  });
});

describe("buildReplanPageModel — modes", () => {
  const goal = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Climb Mont Blanc",
    color_index: 0,
    status: "active" as const,
  };

  function proposal(over: Partial<ProposalRowLike> = {}): ProposalRowLike {
    return {
      id: "99999999-9999-4999-8999-999999999999",
      status: "pending",
      trigger: "weekly_check_in",
      weekly_check_in_id: "44444444-4444-4444-8444-444444444444",
      proposed_changes: diff(),
      created_at: "2026-06-08T09:00:00.000Z",
      decided_at: null,
      ...over,
    };
  }

  function build(over?: {
    proposal?: ProposalRowLike | null;
    diff?: ReplanDiff | null;
    status?: "active" | "completed" | "archived";
  }) {
    return buildReplanPageModel({
      goal: { ...goal, status: over?.status ?? "active" },
      proposal: over?.proposal === undefined ? proposal() : over.proposal,
      diff: over?.diff === undefined ? diff() : over.diff,
      tasks: TASKS,
      milestones: MILESTONES,
      equipment: EQUIPMENT,
    });
  }

  it("no proposal → none", () => {
    expect(build({ proposal: null, diff: null })).toMatchObject({
      mode: "none",
    });
  });

  it("a pending placeholder → generate (never an empty diff), with the POST payload", () => {
    expect(
      build({
        proposal: proposal({ proposed_changes: EMPTY_REPLAN_DIFF }),
        diff: EMPTY_REPLAN_DIFF,
      }),
    ).toMatchObject({
      mode: "generate",
      generate: {
        goalId: goal.id,
        weeklyCheckInId: "44444444-4444-4444-8444-444444444444",
      },
    });
  });

  it("an unparseable pending diff also falls back to generate", () => {
    expect(build({ diff: null })).toMatchObject({ mode: "generate" });
  });

  it("a pending placeholder whose check-in is gone cannot regenerate", () => {
    expect(
      build({
        proposal: proposal({
          proposed_changes: EMPTY_REPLAN_DIFF,
          weekly_check_in_id: null,
        }),
        diff: EMPTY_REPLAN_DIFF,
      }),
    ).toMatchObject({ mode: "generate", generate: null });
  });

  it("a real pending diff → review with counts + milestone options", () => {
    const model = build();
    expect(model).toMatchObject({
      mode: "review",
      goalActive: true,
      proposalId: "99999999-9999-4999-8999-999999999999",
      changeCount: 5,
      hasUnresolved: false,
      milestoneOptions: [{ id: M1, title: "Glacier course" }],
    });
  });

  it("review flags unresolved targets and an inactive goal", () => {
    const model = buildReplanPageModel({
      goal: { ...goal, status: "completed" },
      proposal: proposal(),
      diff: diff(),
      tasks: [],
      milestones: MILESTONES,
      equipment: EQUIPMENT,
    });
    expect(model).toMatchObject({
      mode: "review",
      goalActive: false,
      hasUnresolved: true,
    });
  });

  it("a decided proposal → the read-only summary with a deterministic date line", () => {
    const model = build({
      proposal: proposal({
        status: "partially_accepted",
        decided_at: "2026-06-09T18:30:00.000Z",
      }),
    });
    expect(model).toMatchObject({
      mode: "decided",
      status: "partially_accepted",
      decidedAtLabel: "June 9, 2026",
      changeCount: 5,
    });
  });
});
