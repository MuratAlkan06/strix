/**
 * Replan decision-action tests (no DB, node env — the check-in actions
 * mocking posture). The slice's write surface: the atomic decision commit.
 *
 * Pins:
 *   - guards (no auth, malformed input, unknown proposal, already-decided,
 *     placeholder diff, goal no longer active) reject with ZERO live-table
 *     writes and ZERO status writes;
 *   - the commit runs INSIDE one transaction holding lockScope("replan") —
 *     the generation endpoint's namespace, so decision and regeneration
 *     serialize;
 *   - SECURITY: a foreign/unknown id anywhere in the diff (incl. a
 *     cross-goal equipment milestone link) refuses the whole commit with the
 *     calm stale line and zero writes;
 *   - the accepted subset lands with the exact payloads (cost_usd
 *     stringified for the numeric column; updated_at on updates; goal_id
 *     pinned in every write);
 *   - status mapping all/some/none → accepted / partially_accepted /
 *     rejected, decided_at always set;
 *   - PostHog (planning doc verbatim): first_replan_accepted fires ONCE ever
 *     (pre-write count gate; a first-ever partial fires it too; rejections
 *     never), replan_rejected, replan_partially_accepted with exact
 *     payloads;
 *   - revalidatePath: goal detail + dashboard + this diff page, only after
 *     a successful commit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- mocks ---------------------------------------------------------------

let mockUserId: string | null = "user_test_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockUserId })),
}));

const revalidated: string[] = [];
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn((path: string) => {
    revalidated.push(path);
  }),
}));

const captured: Array<{
  distinctId: string;
  event: string;
  properties: Record<string, unknown>;
}> = [];
vi.mock("@/lib/analytics/server", () => ({
  capture: vi.fn(
    async (
      distinctId: string,
      event: string,
      properties: Record<string, unknown>,
    ) => {
      captured.push({ distinctId, event, properties });
    },
  ),
}));

// Table-routed scopedDb mock: selectFrom answers per table; writes are
// recorded for assertion. count answers the first-event pre-write gate.
let proposalRows: Array<Record<string, unknown>> = [];
let goalActiveRows: Array<Record<string, unknown>> = [];
let taskRows: Array<Record<string, unknown>> = [];
let milestoneRows: Array<Record<string, unknown>> = [];
let equipmentRows: Array<Record<string, unknown>> = [];
let priorAcceptedCount = 0;

const lockScopes: string[] = [];
const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
const updates: Array<{ table: unknown; set: Record<string, unknown> }> = [];
const deletes: Array<{ table: unknown }> = [];

vi.mock("@/db/scoped", async () => {
  const schema = await import("@/db/schema");
  const tx = {
    lockScope: vi.fn(async (ns: string) => {
      lockScopes.push(ns);
    }),
    selectFrom: vi.fn(async (table: unknown) => {
      if (table === schema.replan_proposals) return proposalRows;
      if (table === schema.goals) return goalActiveRows;
      if (table === schema.recurring_tasks) return taskRows;
      if (table === schema.milestones) return milestoneRows;
      if (table === schema.equipment) return equipmentRows;
      throw new Error("unexpected table in selectFrom mock");
    }),
    count: vi.fn(async () => priorAcceptedCount),
    insert: vi.fn(async (table: unknown, values: Record<string, unknown>) => {
      inserts.push({ table, values });
      return [{ id: "new-row-id", ...values }];
    }),
    update: vi.fn(
      async (table: unknown, opts: { set: Record<string, unknown> }) => {
        updates.push({ table, set: opts.set });
        return [{ id: "updated-row-id" }];
      },
    ),
    delete: vi.fn(async (table: unknown) => {
      deletes.push({ table });
      return [{ id: "deleted-row-id" }];
    }),
  };
  return {
    scopedDb: vi.fn((userId: string) => ({
      userId,
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    })),
  };
});

// --- import under test (after mocks) ------------------------------------

import {
  equipment,
  milestones,
  recurring_tasks,
  replan_proposals,
} from "@/db/schema";
import { EMPTY_REPLAN_DIFF, type ReplanDiff } from "@/lib/ai/replan-diff";
import { decideReplan } from "./actions";
import { enumerateChanges, type DecisionMap } from "./replan-model";

const PROPOSAL_ID = "99999999-9999-4999-8999-999999999999";
const GOAL_ID = "11111111-1111-4111-8111-111111111111";
const T1 = "aaaaaaa1-0000-4000-8000-000000000001";
const M1 = "bbbbbbb1-0000-4000-8000-000000000001";
const E1 = "ccccccc1-0000-4000-8000-000000000001";
const FOREIGN = "ffffffff-ffff-4fff-8fff-ffffffffffff";

/** Four changes: a task add + modify, an equipment add + modify. */
function diff(): ReplanDiff {
  return {
    recurring_tasks: {
      add: [
        { title: "Evening stretch", cadence: "daily", weekday: null, estimated_duration_min: 10 },
      ],
      modify: [{ id: T1, changes: { estimated_duration_min: 45 } }],
      remove: [],
    },
    milestones: { add: [], modify: [], remove: [] },
    equipment: {
      add: [
        { title: "Climbing helmet", cost_usd: 90, milestone_id: M1, standalone_deadline: null },
      ],
      modify: [{ id: E1, changes: { cost_usd: 220 } }],
      remove: [],
    },
  };
}

function decideAll(
  d: ReplanDiff,
  decision: "accept" | "reject",
  overrides: DecisionMap = {},
): DecisionMap {
  return {
    ...Object.fromEntries(enumerateChanges(d).map((c) => [c.key, { decision }])),
    ...overrides,
  };
}

function proposalRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: PROPOSAL_ID,
    goal_id: GOAL_ID,
    user_id: "user_test_1",
    trigger: "weekly_check_in",
    weekly_check_in_id: "44444444-4444-4444-8444-444444444444",
    proposed_changes: diff(),
    status: "pending",
    decided_at: null,
    ...over,
  };
}

function decide(over?: {
  proposalId?: string;
  decisions?: DecisionMap;
}) {
  return decideReplan({
    proposalId: over?.proposalId ?? PROPOSAL_ID,
    decisions: over?.decisions ?? decideAll(diff(), "accept"),
  });
}

function liveTableWrites() {
  const live = [recurring_tasks, milestones, equipment] as unknown[];
  return [
    ...inserts.filter((i) => live.includes(i.table)),
    ...updates.filter((u) => live.includes(u.table)),
    ...deletes.filter((d) => live.includes(d.table)),
  ];
}

function statusWrites() {
  return updates.filter((u) => u.table === replan_proposals);
}

beforeEach(() => {
  mockUserId = "user_test_1";
  proposalRows = [proposalRow()];
  goalActiveRows = [{ id: GOAL_ID, status: "active" }];
  taskRows = [
    { id: T1, title: "Long hike", cadence: "weekly", weekday: 6, estimated_duration_min: 180, active: true },
  ];
  milestoneRows = [
    { id: M1, title: "Glacier course", target_date: "2026-07-15", position: 0 },
  ];
  equipmentRows = [
    { id: E1, title: "Crampons", cost_usd: "180.00", milestone_id: M1, standalone_deadline: null },
  ];
  priorAcceptedCount = 0;
  lockScopes.length = 0;
  inserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  revalidated.length = 0;
  captured.length = 0;
});

describe("decideReplan — guards reject with zero writes", () => {
  it("no auth → failure, no DB call", async () => {
    mockUserId = null;
    const result = await decide();
    expect(result).toMatchObject({ ok: false });
    expect(liveTableWrites()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
    expect(captured).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it("malformed proposalId → failure, no DB call", async () => {
    const result = await decide({ proposalId: "'; DROP TABLE --" });
    expect(result).toMatchObject({ ok: false });
    expect(lockScopes).toHaveLength(0);
    expect(liveTableWrites()).toHaveLength(0);
  });

  it("unknown/foreign proposal → calm line, zero writes", async () => {
    proposalRows = [];
    const result = await decide();
    expect(result).toEqual({
      ok: false,
      error: "We couldn't find that proposal.",
    });
    expect(liveTableWrites()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
  });

  it.each(["accepted", "partially_accepted", "rejected"] as const)(
    "an already-decided proposal (%s) → error, zero writes",
    async (status) => {
      proposalRows = [proposalRow({ status })];
      const result = await decide();
      expect(result).toEqual({
        ok: false,
        error: "This proposal was already decided.",
      });
      expect(liveTableWrites()).toHaveLength(0);
      expect(statusWrites()).toHaveLength(0);
      expect(captured).toHaveLength(0);
    },
  );

  it("a still-placeholder diff → 'not generated' line, zero writes", async () => {
    proposalRows = [proposalRow({ proposed_changes: EMPTY_REPLAN_DIFF })];
    const result = await decide({ decisions: {} });
    expect(result).toEqual({
      ok: false,
      error: "This proposal hasn't been generated yet.",
    });
    expect(liveTableWrites()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
  });

  it("a goal no longer active → calm line, zero writes", async () => {
    goalActiveRows = [];
    const result = await decide();
    expect(result).toEqual({
      ok: false,
      error: "This goal is no longer active, so its plan can't change.",
    });
    expect(liveTableWrites()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
  });

  it("an incomplete decision set → calm line, zero writes", async () => {
    const decisions = decideAll(diff(), "accept");
    delete decisions["recurring_tasks:add:0"];
    const result = await decide({ decisions });
    expect(result).toEqual({
      ok: false,
      error: "Some details need attention before saving.",
    });
    expect(liveTableWrites()).toHaveLength(0);
  });
});

describe("decideReplan — the security precondition", () => {
  it("a foreign modify id → stale line, ZERO writes (atomic abort)", async () => {
    proposalRows = [
      proposalRow({
        proposed_changes: (() => {
          const d = diff();
          d.recurring_tasks.modify[0]!.id = FOREIGN;
          return d;
        })(),
      }),
    ];
    const d = diff();
    d.recurring_tasks.modify[0]!.id = FOREIGN;
    const result = await decide({ decisions: decideAll(d, "accept") });
    expect(result).toEqual({
      ok: false,
      error:
        "Parts of this proposal no longer match your plan. Generate a fresh one.",
    });
    expect(liveTableWrites()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
    expect(captured).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it("a cross-goal equipment milestone link → stale line, zero writes", async () => {
    proposalRows = [
      proposalRow({
        proposed_changes: (() => {
          const d = diff();
          d.equipment.add[0]!.milestone_id = FOREIGN;
          return d;
        })(),
      }),
    ];
    const d = diff();
    d.equipment.add[0]!.milestone_id = FOREIGN;
    const result = await decide({ decisions: decideAll(d, "accept") });
    expect(result).toMatchObject({ ok: false });
    expect(liveTableWrites()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
  });
});

describe("decideReplan — the commit", () => {
  it("serializes under lockScope('replan') — the endpoint's namespace", async () => {
    await decide();
    expect(lockScopes).toEqual(["replan"]);
  });

  it("all accepted: exact writes land, status 'accepted' + decided_at", async () => {
    const result = await decide();
    expect(result).toEqual({ ok: true });

    const taskInserts = inserts.filter((i) => i.table === recurring_tasks);
    expect(taskInserts).toHaveLength(1);
    expect(taskInserts[0]!.values).toEqual({
      goal_id: GOAL_ID,
      title: "Evening stretch",
      cadence: "daily",
      weekday: null,
      estimated_duration_min: 10,
    });

    const taskUpdates = updates.filter((u) => u.table === recurring_tasks);
    expect(taskUpdates).toHaveLength(1);
    expect(taskUpdates[0]!.set).toMatchObject({ estimated_duration_min: 45 });
    expect(taskUpdates[0]!.set.updated_at).toBeInstanceOf(Date);

    // numeric(10,2) columns take strings — never raw numbers.
    const eqInserts = inserts.filter((i) => i.table === equipment);
    expect(eqInserts).toHaveLength(1);
    expect(eqInserts[0]!.values).toEqual({
      goal_id: GOAL_ID,
      title: "Climbing helmet",
      cost_usd: "90",
      milestone_id: M1,
      standalone_deadline: null,
    });
    const eqUpdates = updates.filter((u) => u.table === equipment);
    expect(eqUpdates).toHaveLength(1);
    expect(eqUpdates[0]!.set).toMatchObject({ cost_usd: "220" });

    const status = statusWrites();
    expect(status).toHaveLength(1);
    expect(status[0]!.set).toMatchObject({ status: "accepted" });
    expect(status[0]!.set.decided_at).toBeInstanceOf(Date);

    expect(revalidated).toEqual([
      `/goals/${GOAL_ID}`,
      "/dashboard",
      `/replan/${GOAL_ID}`,
    ]);
  });

  it("partial: only the accepted subset lands, status 'partially_accepted'", async () => {
    const result = await decide({
      decisions: decideAll(diff(), "reject", {
        "recurring_tasks:add:0": { decision: "accept" },
        [`equipment:modify:${E1}`]: { decision: "accept" },
      }),
    });
    expect(result).toEqual({ ok: true });
    expect(inserts.filter((i) => i.table === recurring_tasks)).toHaveLength(1);
    expect(updates.filter((u) => u.table === recurring_tasks)).toHaveLength(0);
    expect(inserts.filter((i) => i.table === equipment)).toHaveLength(0);
    expect(updates.filter((u) => u.table === equipment)).toHaveLength(1);
    expect(statusWrites()[0]!.set).toMatchObject({
      status: "partially_accepted",
    });
  });

  it("none accepted: zero live-table writes, status 'rejected' + decided_at", async () => {
    const result = await decide({
      decisions: decideAll(diff(), "reject"),
    });
    expect(result).toEqual({ ok: true });
    expect(liveTableWrites()).toHaveLength(0);
    const status = statusWrites();
    expect(status).toHaveLength(1);
    expect(status[0]!.set).toMatchObject({ status: "rejected" });
    expect(status[0]!.set.decided_at).toBeInstanceOf(Date);
  });

  it("an edited value is what lands", async () => {
    const result = await decide({
      decisions: decideAll(diff(), "accept", {
        [`recurring_tasks:modify:${T1}`]: {
          decision: "accept",
          edited: { estimated_duration_min: 60 },
        },
      }),
    });
    expect(result).toEqual({ ok: true });
    const taskUpdates = updates.filter((u) => u.table === recurring_tasks);
    expect(taskUpdates[0]!.set).toMatchObject({ estimated_duration_min: 60 });
  });

  it("an invalid edit refuses the whole commit", async () => {
    const result = await decide({
      decisions: decideAll(diff(), "accept", {
        [`recurring_tasks:modify:${T1}`]: {
          decision: "accept",
          edited: { estimated_duration_min: -5 },
        },
      }),
    });
    expect(result).toEqual({
      ok: false,
      error: "Some details need attention before saving.",
    });
    expect(liveTableWrites()).toHaveLength(0);
    expect(statusWrites()).toHaveLength(0);
  });
});

describe("decideReplan — PostHog events (planning doc verbatim)", () => {
  it("first-ever full accept: first_replan_accepted with exact payload, nothing else", async () => {
    priorAcceptedCount = 0;
    await decide();
    expect(captured).toEqual([
      {
        distinctId: "user_test_1",
        event: "first_replan_accepted",
        properties: { goal_id: GOAL_ID, accept_count: 4, reject_count: 0 },
      },
    ]);
  });

  it("first-ever PARTIAL gates the first event too — both events fire", async () => {
    priorAcceptedCount = 0;
    await decide({
      decisions: decideAll(diff(), "reject", {
        "recurring_tasks:add:0": { decision: "accept" },
      }),
    });
    expect(captured).toEqual([
      {
        distinctId: "user_test_1",
        event: "first_replan_accepted",
        properties: { goal_id: GOAL_ID, accept_count: 1, reject_count: 3 },
      },
      {
        distinctId: "user_test_1",
        event: "replan_partially_accepted",
        properties: { goal_id: GOAL_ID, accept_count: 1, reject_count: 3 },
      },
    ]);
  });

  it("a prior accepted/partially_accepted proposal exists → first never re-fires", async () => {
    priorAcceptedCount = 1;
    await decide();
    expect(captured).toEqual([]);
  });

  it("a rejection fires replan_rejected only — and never the first event", async () => {
    priorAcceptedCount = 0;
    await decide({ decisions: decideAll(diff(), "reject") });
    expect(captured).toEqual([
      {
        distinctId: "user_test_1",
        event: "replan_rejected",
        properties: { goal_id: GOAL_ID },
      },
    ]);
  });

  it("a non-first partial fires replan_partially_accepted only", async () => {
    priorAcceptedCount = 2;
    await decide({
      decisions: decideAll(diff(), "reject", {
        "recurring_tasks:add:0": { decision: "accept" },
      }),
    });
    expect(captured).toEqual([
      {
        distinctId: "user_test_1",
        event: "replan_partially_accepted",
        properties: { goal_id: GOAL_ID, accept_count: 1, reject_count: 3 },
      },
    ]);
  });
});
