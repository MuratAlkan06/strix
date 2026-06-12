/**
 * apply-plan tests — the pure application planner behind the replan
 * decision commit (no DB, node env).
 *
 * Pins:
 *   - the planning-doc test verbatim: "given a fixture diff and a partial
 *     accept-set, the resulting live-table state matches expected" — the
 *     planner emits EXACTLY the accepted operations, nothing else;
 *   - status mapping: all accepted → accepted, some → partially_accepted,
 *     none → rejected;
 *   - SECURITY: any modify/remove id that fails to resolve in the goal's
 *     current rows refuses the whole plan (per table, and EVEN ON REJECTED
 *     changes — the resolution is diff-wide); equipment milestone links
 *     (proposed, edited, in adds AND modifies) must resolve same-goal;
 *   - edited values: applied over the proposal's, validated by the
 *     ReplanDiffSchema-mirroring rules, restricted to the proposed change's
 *     own fields (anchor pair excepted), forbidden on removes;
 *   - recurring_tasks removes DEACTIVATE (history survives);
 *   - milestone removes re-home linked equipment to the milestone's
 *     target_date (folding into an accepted update when one exists); a
 *     dateless milestone with surviving linked equipment blocks; anchoring
 *     equipment to a milestone the same commit removes is refused;
 *   - the equipment exactly-one invariant holds on the accepted subset's
 *     final state;
 *   - decisions must cover the change set exactly (no missing, no unknown).
 */
import { describe, expect, it } from "vitest";

import type { ReplanDiff } from "@/lib/ai/replan-diff";
import { planApplication } from "./apply-plan";
import {
  enumerateChanges,
  type CurrentEquipmentLike,
  type CurrentMilestoneLike,
  type CurrentTaskLike,
  type DecisionMap,
} from "./replan-model";

// --- the fixture plan ------------------------------------------------------

const T_DAILY = "aaaaaaa1-0000-4000-8000-000000000001";
const T_HIKE = "aaaaaaa1-0000-4000-8000-000000000002";
const T_HANG = "aaaaaaa1-0000-4000-8000-000000000003";
const M_ASSESS = "bbbbbbb1-0000-4000-8000-000000000001";
const M_GLACIER = "bbbbbbb1-0000-4000-8000-000000000002";
const M_SUMMIT = "bbbbbbb1-0000-4000-8000-000000000003";
const E_BOOTS = "ccccccc1-0000-4000-8000-000000000001";
const E_CRAMPONS = "ccccccc1-0000-4000-8000-000000000002";
const E_BANDS = "ccccccc1-0000-4000-8000-000000000003";
const FOREIGN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

function tasks(): CurrentTaskLike[] {
  return [
    { id: T_DAILY, title: "Morning mobility routine", cadence: "daily", weekday: null, estimated_duration_min: 15, active: true },
    { id: T_HIKE, title: "Long endurance hike", cadence: "weekly", weekday: 6, estimated_duration_min: 180, active: true },
    { id: T_HANG, title: "Hangboard session", cadence: "weekly", weekday: 2, estimated_duration_min: 30, active: true },
  ];
}

function milestones(): CurrentMilestoneLike[] {
  return [
    { id: M_ASSESS, title: "Indoor climbing assessment", target_date: "2026-06-20", position: 0 },
    { id: M_GLACIER, title: "Complete a glacier skills course", target_date: "2026-07-15", position: 1 },
    { id: M_SUMMIT, title: "Summit a 4000m peak", target_date: "2026-08-20", position: 2 },
  ];
}

function equipment(): CurrentEquipmentLike[] {
  return [
    { id: E_BOOTS, title: "Mountaineering boots (B2/B3)", cost_usd: "450.00", milestone_id: M_GLACIER, standalone_deadline: null },
    { id: E_CRAMPONS, title: "Crampons", cost_usd: "180.00", milestone_id: M_GLACIER, standalone_deadline: null },
    { id: E_BANDS, title: "Resistance bands", cost_usd: "25.00", milestone_id: null, standalone_deadline: "2026-07-01" },
  ];
}

/** The full fixture diff: every section carries an add, a modify, a remove. */
function fullDiff(): ReplanDiff {
  return {
    recurring_tasks: {
      add: [
        { title: "Weighted pack carries", cadence: "weekly", weekday: 3, estimated_duration_min: 60 },
      ],
      modify: [
        { id: T_HIKE, changes: { weekday: 0, estimated_duration_min: 240 } },
      ],
      remove: [{ id: T_HANG }],
    },
    milestones: {
      add: [
        { title: "Acclimatization weekend at altitude", target_date: "2026-08-29", position: 3 },
      ],
      modify: [{ id: M_SUMMIT, changes: { target_date: "2026-08-27" } }],
      remove: [{ id: M_ASSESS }],
    },
    equipment: {
      add: [
        { title: "Climbing helmet", cost_usd: 90, milestone_id: M_GLACIER, standalone_deadline: null },
      ],
      modify: [
        { id: E_CRAMPONS, changes: { title: "Technical crampons (C2)", cost_usd: 220 } },
      ],
      remove: [{ id: E_BANDS }],
    },
  };
}

/** Decide every change `decision`, with per-key overrides. */
function decideAll(
  diff: ReplanDiff,
  decision: "accept" | "reject",
  overrides: DecisionMap = {},
): DecisionMap {
  return {
    ...Object.fromEntries(
      enumerateChanges(diff).map((c) => [c.key, { decision }]),
    ),
    ...overrides,
  };
}

function plan(over?: {
  diff?: ReplanDiff;
  decisions?: DecisionMap;
  tasks?: CurrentTaskLike[];
  milestones?: CurrentMilestoneLike[];
  equipment?: CurrentEquipmentLike[];
}) {
  const diff = over?.diff ?? fullDiff();
  return planApplication({
    diff,
    decisions: over?.decisions ?? decideAll(diff, "accept"),
    tasks: over?.tasks ?? tasks(),
    milestones: over?.milestones ?? milestones(),
    equipment: over?.equipment ?? equipment(),
  });
}

// --- the planning-doc fixture test ------------------------------------------

describe("planApplication — fixture diff ⇒ exact live-table operations", () => {
  it("all accepted: every operation, status 'accepted'", () => {
    const result = plan();
    expect(result).toEqual({
      ok: true,
      taskInserts: [
        { title: "Weighted pack carries", cadence: "weekly", weekday: 3, estimated_duration_min: 60 },
      ],
      taskUpdates: [
        { id: T_HIKE, set: { weekday: 0, estimated_duration_min: 240 } },
      ],
      taskDeactivates: [T_HANG],
      milestoneInserts: [
        { title: "Acclimatization weekend at altitude", target_date: "2026-08-29", position: 3 },
      ],
      milestoneUpdates: [{ id: M_SUMMIT, set: { target_date: "2026-08-27" } }],
      milestoneRemoves: [M_ASSESS],
      equipmentInserts: [
        { title: "Climbing helmet", cost_usd: 90, milestone_id: M_GLACIER, standalone_deadline: null },
      ],
      equipmentUpdates: [
        { id: E_CRAMPONS, set: { title: "Technical crampons (C2)", cost_usd: 220 } },
      ],
      equipmentRemoves: [E_BANDS],
      equipmentRehomes: [],
      acceptCount: 9,
      rejectCount: 0,
      status: "accepted",
    });
  });

  it("partial accept-set: EXACTLY the accepted changes, status 'partially_accepted'", () => {
    // Accept the task add, the milestone date shift, and the equipment
    // removal; reject everything else (the planning-doc scenario).
    const result = plan({
      decisions: decideAll(fullDiff(), "reject", {
        "recurring_tasks:add:0": { decision: "accept" },
        [`milestones:modify:${M_SUMMIT}`]: { decision: "accept" },
        [`equipment:remove:${E_BANDS}`]: { decision: "accept" },
      }),
    });
    expect(result).toEqual({
      ok: true,
      taskInserts: [
        { title: "Weighted pack carries", cadence: "weekly", weekday: 3, estimated_duration_min: 60 },
      ],
      taskUpdates: [],
      taskDeactivates: [],
      milestoneInserts: [],
      milestoneUpdates: [{ id: M_SUMMIT, set: { target_date: "2026-08-27" } }],
      milestoneRemoves: [],
      equipmentInserts: [],
      equipmentUpdates: [],
      equipmentRemoves: [E_BANDS],
      equipmentRehomes: [],
      acceptCount: 3,
      rejectCount: 6,
      status: "partially_accepted",
    });
  });

  it("none accepted: zero operations, status 'rejected'", () => {
    const result = plan({ decisions: decideAll(fullDiff(), "reject") });
    expect(result).toMatchObject({
      ok: true,
      taskInserts: [],
      taskUpdates: [],
      taskDeactivates: [],
      milestoneInserts: [],
      milestoneUpdates: [],
      milestoneRemoves: [],
      equipmentInserts: [],
      equipmentUpdates: [],
      equipmentRemoves: [],
      equipmentRehomes: [],
      acceptCount: 0,
      rejectCount: 9,
      status: "rejected",
    });
  });

  it("recurring_tasks removes DEACTIVATE — no task delete operation exists", () => {
    const result = plan();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taskDeactivates).toEqual([T_HANG]);
    expect(Object.keys(result)).not.toContain("taskRemoves");
  });
});

// --- the security precondition -----------------------------------------------

describe("planApplication — foreign/unknown ids refuse the whole plan", () => {
  const cases: Array<[string, (d: ReplanDiff) => void]> = [
    ["recurring_tasks modify", (d) => void (d.recurring_tasks.modify[0]!.id = FOREIGN)],
    ["recurring_tasks remove", (d) => void (d.recurring_tasks.remove[0]!.id = FOREIGN)],
    ["milestones modify", (d) => void (d.milestones.modify[0]!.id = FOREIGN)],
    ["milestones remove", (d) => void (d.milestones.remove[0]!.id = FOREIGN)],
    ["equipment modify", (d) => void (d.equipment.modify[0]!.id = FOREIGN)],
    ["equipment remove", (d) => void (d.equipment.remove[0]!.id = FOREIGN)],
  ];

  it.each(cases)("%s id not in the goal's rows → unresolved_id", (_label, mutate) => {
    const diff = fullDiff();
    mutate(diff);
    expect(plan({ diff })).toEqual({ ok: false, kind: "unresolved_id" });
  });

  it("a foreign id on a REJECTED change still refuses (resolution is diff-wide)", () => {
    const diff = fullDiff();
    diff.equipment.remove[0]!.id = FOREIGN;
    const decisions = decideAll(diff, "accept", {
      [`equipment:remove:${FOREIGN}`]: { decision: "reject" },
    });
    expect(plan({ diff, decisions })).toEqual({
      ok: false,
      kind: "unresolved_id",
    });
  });

  it("a non-uuid garbage id never resolves", () => {
    const diff = fullDiff();
    diff.milestones.remove[0]!.id = "'; DROP TABLE milestones; --";
    expect(plan({ diff })).toEqual({ ok: false, kind: "unresolved_id" });
  });

  it("equipment ADD with a cross-goal milestone_id → unresolved_id", () => {
    const diff = fullDiff();
    diff.equipment.add[0]!.milestone_id = FOREIGN;
    expect(plan({ diff })).toEqual({ ok: false, kind: "unresolved_id" });
  });

  it("equipment MODIFY proposing a cross-goal milestone_id → unresolved_id", () => {
    const diff = fullDiff();
    diff.equipment.modify[0]!.changes = { milestone_id: FOREIGN };
    expect(plan({ diff })).toEqual({ ok: false, kind: "unresolved_id" });
  });

  it("an EDITED cross-goal milestone link → unresolved_id", () => {
    const decisions = decideAll(fullDiff(), "accept", {
      "equipment:add:0": {
        decision: "accept",
        edited: { milestone_id: FOREIGN, standalone_deadline: null },
      },
    });
    expect(plan({ decisions })).toEqual({ ok: false, kind: "unresolved_id" });
  });
});

// --- decisions coverage --------------------------------------------------------

describe("planApplication — decisions must cover the change set exactly", () => {
  it("a missing decision → decisions_mismatch", () => {
    const decisions = decideAll(fullDiff(), "accept");
    delete decisions["recurring_tasks:add:0"];
    expect(plan({ decisions })).toEqual({
      ok: false,
      kind: "decisions_mismatch",
    });
  });

  it("an unknown decision key → decisions_mismatch", () => {
    const decisions = decideAll(fullDiff(), "accept", {
      "equipment:remove:not-a-real-change": { decision: "accept" },
    });
    delete decisions[`equipment:remove:${E_BANDS}`];
    expect(plan({ decisions })).toEqual({
      ok: false,
      kind: "decisions_mismatch",
    });
  });

  it("an empty diff is never decidable", () => {
    const empty: ReplanDiff = {
      recurring_tasks: { add: [], modify: [], remove: [] },
      milestones: { add: [], modify: [], remove: [] },
      equipment: { add: [], modify: [], remove: [] },
    };
    expect(plan({ diff: empty, decisions: {} })).toEqual({
      ok: false,
      kind: "decisions_mismatch",
    });
  });
});

// --- edits -----------------------------------------------------------------------

describe("planApplication — edited values", () => {
  it("an edited add: the edited value is what's applied", () => {
    const decisions = decideAll(fullDiff(), "accept", {
      "recurring_tasks:add:0": {
        decision: "accept",
        edited: { title: "Weighted pack carries (steep trail)", estimated_duration_min: 90 },
      },
    });
    const result = plan({ decisions });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taskInserts).toEqual([
      {
        title: "Weighted pack carries (steep trail)",
        cadence: "weekly",
        weekday: 3,
        estimated_duration_min: 90,
      },
    ]);
  });

  it("an edited modify: edited-or-proposed per field", () => {
    const decisions = decideAll(fullDiff(), "accept", {
      [`recurring_tasks:modify:${T_HIKE}`]: {
        decision: "accept",
        edited: { estimated_duration_min: 300 },
      },
    });
    const result = plan({ decisions });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.taskUpdates).toEqual([
      { id: T_HIKE, set: { weekday: 0, estimated_duration_min: 300 } },
    ]);
  });

  it.each([
    ["weekday out of 0–6", { weekday: 9 }],
    ["non-positive duration", { estimated_duration_min: 0 }],
    ["blank title", { title: "   " }],
  ])("invalid edited value (%s) → invalid_edit", (_label, edited) => {
    const decisions = decideAll(fullDiff(), "accept", {
      "recurring_tasks:add:0": { decision: "accept", edited },
    });
    expect(plan({ decisions })).toEqual({ ok: false, kind: "invalid_edit" });
  });

  it("a malformed edited date → invalid_edit", () => {
    const decisions = decideAll(fullDiff(), "accept", {
      "milestones:add:0": {
        decision: "accept",
        edited: { target_date: "Aug 29" },
      },
    });
    expect(plan({ decisions })).toEqual({ ok: false, kind: "invalid_edit" });
  });

  it("editing a field the modify does not propose → invalid_edit", () => {
    // The fixture's task modify changes weekday + duration; title is not on
    // the table.
    const decisions = decideAll(fullDiff(), "accept", {
      [`recurring_tasks:modify:${T_HIKE}`]: {
        decision: "accept",
        edited: { title: "Renamed" },
      },
    });
    expect(plan({ decisions })).toEqual({ ok: false, kind: "invalid_edit" });
  });

  it("`active` is never editable", () => {
    const diff = fullDiff();
    diff.recurring_tasks.modify[0]!.changes = { active: false };
    const decisions = decideAll(diff, "accept", {
      [`recurring_tasks:modify:${T_HIKE}`]: {
        decision: "accept",
        edited: { active: true },
      },
    });
    expect(plan({ diff, decisions })).toEqual({
      ok: false,
      kind: "invalid_edit",
    });
  });

  it("an edit on a remove → invalid_edit", () => {
    const decisions = decideAll(fullDiff(), "accept", {
      [`equipment:remove:${E_BANDS}`]: {
        decision: "accept",
        edited: { title: "x" },
      },
    });
    expect(plan({ decisions })).toEqual({ ok: false, kind: "invalid_edit" });
  });

  it("ids are not editable (unknown key in the edit shape)", () => {
    const decisions = decideAll(fullDiff(), "accept", {
      [`milestones:modify:${M_SUMMIT}`]: {
        decision: "accept",
        edited: { id: FOREIGN, target_date: "2026-08-27" },
      },
    });
    expect(plan({ decisions })).toEqual({ ok: false, kind: "invalid_edit" });
  });
});

// --- the equipment exactly-one invariant ----------------------------------------

describe("planApplication — equipment anchors (exactly-one, final state)", () => {
  it("an accepted add with neither anchor → equipment_anchor", () => {
    const diff = fullDiff();
    diff.equipment.add[0]!.milestone_id = null;
    diff.equipment.add[0]!.standalone_deadline = null;
    expect(plan({ diff })).toEqual({ ok: false, kind: "equipment_anchor" });
  });

  it("an accepted add with both anchors → equipment_anchor", () => {
    const diff = fullDiff();
    diff.equipment.add[0]!.standalone_deadline = "2026-07-01";
    expect(plan({ diff })).toEqual({ ok: false, kind: "equipment_anchor" });
  });

  it("an accepted modify whose FINAL state breaks exactly-one → equipment_anchor", () => {
    // E_BANDS is standalone; proposing a milestone link without clearing the
    // date would leave both set.
    const diff = fullDiff();
    diff.equipment.modify.push({
      id: E_BANDS,
      changes: { milestone_id: M_GLACIER },
    });
    diff.equipment.remove = [];
    expect(plan({ diff })).toEqual({ ok: false, kind: "equipment_anchor" });
  });

  it("rejecting that modify lets the rest of the plan through", () => {
    const diff = fullDiff();
    diff.equipment.modify.push({
      id: E_BANDS,
      changes: { milestone_id: M_GLACIER },
    });
    diff.equipment.remove = [];
    const decisions = decideAll(diff, "accept", {
      [`equipment:modify:${E_BANDS}`]: { decision: "reject" },
    });
    const result = plan({ diff, decisions });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe("partially_accepted");
  });

  it("the anchor pair edits together even when only one half was proposed", () => {
    // The proposal re-dates E_BOOTS standalone; the user re-anchors it to a
    // milestone instead — milestone_id rides along (one exactly-one fact).
    const diff = fullDiff();
    diff.equipment.modify = [
      { id: E_BOOTS, changes: { milestone_id: null, standalone_deadline: "2026-07-10" } },
    ];
    diff.equipment.remove = [];
    const decisions = decideAll(diff, "accept", {
      [`equipment:modify:${E_BOOTS}`]: {
        decision: "accept",
        edited: { milestone_id: M_SUMMIT, standalone_deadline: null },
      },
    });
    const result = plan({ diff, decisions });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equipmentUpdates).toEqual([
      { id: E_BOOTS, set: { milestone_id: M_SUMMIT, standalone_deadline: null } },
    ]);
  });
});

// --- milestone removal fallout ----------------------------------------------------

describe("planApplication — milestone removes re-home linked equipment", () => {
  /** A minimal diff that only removes the glacier milestone (E_BOOTS and
   *  E_CRAMPONS hang off it). */
  function removeGlacierDiff(): ReplanDiff {
    return {
      recurring_tasks: { add: [], modify: [], remove: [] },
      milestones: { add: [], modify: [], remove: [{ id: M_GLACIER }] },
      equipment: { add: [], modify: [], remove: [] },
    };
  }

  it("linked equipment inherits the milestone's target_date as a standalone deadline", () => {
    const diff = removeGlacierDiff();
    const result = plan({ diff, decisions: decideAll(diff, "accept") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.milestoneRemoves).toEqual([M_GLACIER]);
    expect(result.equipmentRehomes).toEqual([
      { id: E_BOOTS, standalone_deadline: "2026-07-15" },
      { id: E_CRAMPONS, standalone_deadline: "2026-07-15" },
    ]);
  });

  it("the re-home folds into an accepted update for the same row", () => {
    const diff = removeGlacierDiff();
    diff.equipment.modify = [{ id: E_CRAMPONS, changes: { cost_usd: 220 } }];
    const result = plan({ diff, decisions: decideAll(diff, "accept") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equipmentUpdates).toEqual([
      {
        id: E_CRAMPONS,
        set: { cost_usd: 220, milestone_id: null, standalone_deadline: "2026-07-15" },
      },
    ]);
    expect(result.equipmentRehomes).toEqual([
      { id: E_BOOTS, standalone_deadline: "2026-07-15" },
    ]);
  });

  it("equipment removed in the same commit is not re-homed", () => {
    const diff = removeGlacierDiff();
    diff.equipment.remove = [{ id: E_BOOTS }];
    const result = plan({ diff, decisions: decideAll(diff, "accept") });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.equipmentRemoves).toEqual([E_BOOTS]);
    expect(result.equipmentRehomes).toEqual([
      { id: E_CRAMPONS, standalone_deadline: "2026-07-15" },
    ]);
  });

  it("a DATELESS removed milestone with linked equipment blocks the commit", () => {
    const diff = removeGlacierDiff();
    const dateless = milestones().map((m) =>
      m.id === M_GLACIER ? { ...m, target_date: null } : m,
    );
    expect(
      plan({ diff, decisions: decideAll(diff, "accept"), milestones: dateless }),
    ).toEqual({ ok: false, kind: "milestone_blocked" });
  });

  it("REJECTING the milestone remove leaves linked equipment untouched", () => {
    const diff = removeGlacierDiff();
    const result = plan({
      diff,
      decisions: decideAll(diff, "reject"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.milestoneRemoves).toEqual([]);
    expect(result.equipmentRehomes).toEqual([]);
  });

  it("anchoring a NEW item to a milestone this commit removes → equipment_anchor", () => {
    const diff = removeGlacierDiff();
    diff.equipment.add = [
      { title: "Gaiters", cost_usd: 60, milestone_id: M_GLACIER, standalone_deadline: null },
    ];
    expect(plan({ diff, decisions: decideAll(diff, "accept") })).toEqual({
      ok: false,
      kind: "equipment_anchor",
    });
  });

  it("re-anchoring an EXISTING item onto a removed milestone → equipment_anchor", () => {
    const diff = removeGlacierDiff();
    diff.equipment.modify = [
      { id: E_BANDS, changes: { milestone_id: M_GLACIER, standalone_deadline: null } },
    ];
    expect(plan({ diff, decisions: decideAll(diff, "accept") })).toEqual({
      ok: false,
      kind: "equipment_anchor",
    });
  });
});
