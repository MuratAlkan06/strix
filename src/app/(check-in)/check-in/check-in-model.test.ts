/**
 * check-in-model tests — capacity math, default selection, already-proposed
 * exclusion, week/month boundary helpers, and the first-event gate
 * (phase-2-close-the-loop "Weekly check-in UI").
 *
 * Pins:
 *   - remaining: Free max(0, 2 − used); Pro/Max Infinity;
 *   - default selection fills to the cap in display order (started_at asc),
 *     Pro/Max select all; a real-row revisit defaults to already-proposed
 *     ONLY (no surprise replans on a notes-edit resubmit);
 *   - already-proposed goals are excluded from capacity math and from
 *     newlySelected; resubmit-after-skip → every selection is new;
 *   - week/month starts are judged on the USER's calendar (timezone), with
 *     UTC fallback on invalid IANA names;
 *   - first-event gate: first real fires; skip never; resubmit after a real
 *     never; a real after only-skips fires;
 *   - zero selection is valid (an empty selection stays empty — the cap
 *     never forces one).
 */
import { describe, expect, it } from "vitest";

import {
  buildCheckInModel,
  capMessage,
  capacityDisabledIds,
  isFirstCheckInEvent,
  monthStartFor,
  newlySelectedGoalIds,
  remainingReplans,
  weekStartFor,
  type CheckInGoalLike,
  type CheckInRowLike,
} from "./check-in-model";

// Display order by started_at asc: g-climb (oldest) → g-race → g-book.
const GOALS: CheckInGoalLike[] = [
  {
    id: "g-race",
    title: "Half marathon",
    color_index: 1,
    started_at: "2026-03-02T09:00:00.000Z",
  },
  {
    id: "g-climb",
    title: "Climb Mont Blanc",
    color_index: 0,
    started_at: "2026-01-15T09:00:00.000Z",
  },
  {
    id: "g-book",
    title: "Write a novel",
    color_index: 4,
    started_at: "2026-05-20T09:00:00.000Z",
  },
];

function realRow(over?: Partial<CheckInRowLike>): CheckInRowLike {
  return {
    id: "ci-1",
    week_start_date: "2026-06-07",
    feeling: "right",
    notes: "Long runs felt heavy.",
    ...over,
  };
}

function build(over?: Partial<Parameters<typeof buildCheckInModel>[0]>) {
  return buildCheckInModel({
    goals: GOALS,
    existing: null,
    alreadyProposedGoalIds: [],
    tier: "free",
    replansUsed: 0,
    ...over,
  });
}

// ---------------------------------------------------------------------------
// Week/month boundary helpers
// ---------------------------------------------------------------------------

describe("weekStartFor — Sunday of the USER's current week", () => {
  // 2026-06-07T02:00Z is Sunday 02:00 UTC but still Saturday 06-06 in New
  // York (UTC−4) — the user's week is the PREVIOUS one.
  const boundary = new Date("2026-06-07T02:00:00.000Z");

  it("UTC: already Sunday → week starts today", () => {
    expect(weekStartFor("UTC", boundary)).toBe("2026-06-07");
  });

  it("America/New_York: still Saturday → week starts the previous Sunday", () => {
    expect(weekStartFor("America/New_York", boundary)).toBe("2026-05-31");
  });

  it("mid-week is the containing week's Sunday", () => {
    expect(weekStartFor("UTC", new Date("2026-06-10T12:00:00.000Z"))).toBe(
      "2026-06-07",
    );
  });

  it("invalid IANA name falls back to UTC", () => {
    expect(weekStartFor("Not/AZone", boundary)).toBe("2026-06-07");
    expect(weekStartFor(null, boundary)).toBe("2026-06-07");
  });
});

describe("monthStartFor — calendar 1st of the USER's current month", () => {
  // 2026-07-01T03:00Z is July in UTC but still June 30 in New York.
  const boundary = new Date("2026-07-01T03:00:00.000Z");

  it("UTC: July 1st", () => {
    expect(monthStartFor("UTC", boundary)).toBe("2026-07-01");
  });

  it("America/New_York: still June → June 1st", () => {
    expect(monthStartFor("America/New_York", boundary)).toBe("2026-06-01");
  });

  it("invalid IANA name falls back to UTC", () => {
    expect(monthStartFor("Not/AZone", boundary)).toBe("2026-07-01");
    expect(monthStartFor(undefined, boundary)).toBe("2026-07-01");
  });
});

// ---------------------------------------------------------------------------
// Capacity math
// ---------------------------------------------------------------------------

describe("remainingReplans — SPEC §10", () => {
  it("free: 2 − used, clamped at 0", () => {
    expect(remainingReplans("free", 0)).toBe(2);
    expect(remainingReplans("free", 1)).toBe(1);
    expect(remainingReplans("free", 2)).toBe(0);
    expect(remainingReplans("free", 5)).toBe(0);
  });

  it("pro and max are uncapped", () => {
    expect(remainingReplans("pro", 0)).toBe(Infinity);
    expect(remainingReplans("pro", 99)).toBe(Infinity);
    expect(remainingReplans("max", 2)).toBe(Infinity);
  });
});

describe("capMessage — X = replans_used", () => {
  it("renders the used count against the limit", () => {
    expect(capMessage(0)).toBe(
      "You've used 0 of 2 replans this month. Upgrade for unlimited.",
    );
    expect(capMessage(2)).toBe(
      "You've used 2 of 2 replans this month. Upgrade for unlimited.",
    );
  });
});

describe("newlySelectedGoalIds — selected minus already-proposed", () => {
  it("subtracts proposed ids and deduplicates", () => {
    expect(
      newlySelectedGoalIds(["a", "b", "b", "c"], ["b"]),
    ).toEqual(["a", "c"]);
  });

  it("resubmit-after-skip: nothing proposed → ALL selections are new", () => {
    expect(newlySelectedGoalIds(["a", "b"], [])).toEqual(["a", "b"]);
  });

  it("zero selection stays empty (a valid submit)", () => {
    expect(newlySelectedGoalIds([], ["a"])).toEqual([]);
  });
});

describe("capacityDisabledIds — the dynamic count cap", () => {
  const rows = build().goalRows; // climb, race, book — none proposed

  it("below the cap nothing is disabled", () => {
    expect(capacityDisabledIds(rows, ["g-climb"], 2).size).toBe(0);
  });

  it("at the cap every still-unchecked row is disabled", () => {
    const disabled = capacityDisabledIds(rows, ["g-climb", "g-race"], 2);
    expect(disabled).toEqual(new Set(["g-book"]));
  });

  it("unchecking re-enables (cap is on the count, not specific rows)", () => {
    expect(capacityDisabledIds(rows, ["g-climb"], 2).has("g-book")).toBe(false);
  });

  it("already-proposed selections cost nothing toward the cap", () => {
    const withProposed = build({
      alreadyProposedGoalIds: ["g-climb"],
    }).goalRows;
    // climb is proposed (free) — race + book selected reach the cap of 2.
    const disabled = capacityDisabledIds(
      withProposed,
      ["g-climb", "g-race", "g-book"],
      2,
    );
    expect(disabled.size).toBe(0);
    // With only race newly selected, one slot remains — nothing disabled.
    expect(
      capacityDisabledIds(withProposed, ["g-climb", "g-race"], 2).size,
    ).toBe(0);
  });

  it("remaining 0 disables every unchecked, unproposed row immediately", () => {
    const disabled = capacityDisabledIds(rows, [], 0);
    expect(disabled).toEqual(new Set(["g-climb", "g-race", "g-book"]));
  });

  it("Infinity (Pro/Max) never disables", () => {
    expect(
      capacityDisabledIds(rows, ["g-climb", "g-race", "g-book"], Infinity).size,
    ).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// buildCheckInModel — default selection + prefill semantics
// ---------------------------------------------------------------------------

describe("buildCheckInModel — display order and default selection", () => {
  it("orders goals by started_at ascending", () => {
    expect(build().goalRows.map((r) => r.id)).toEqual([
      "g-climb",
      "g-race",
      "g-book",
    ]);
  });

  it("free, used 0: default fills to the cap (2) in display order", () => {
    expect(build().defaultSelectedIds).toEqual(["g-climb", "g-race"]);
  });

  it("free, used 1: default fills one", () => {
    expect(build({ replansUsed: 1 }).defaultSelectedIds).toEqual(["g-climb"]);
  });

  it("free, used 2: nothing default-selected", () => {
    expect(build({ replansUsed: 2 }).defaultSelectedIds).toEqual([]);
  });

  it("pro: all goals default-selected", () => {
    expect(build({ tier: "pro" }).defaultSelectedIds).toEqual([
      "g-climb",
      "g-race",
      "g-book",
    ]);
  });

  it("a skip-only week still default-fills (the form is fresh)", () => {
    const model = build({ existing: realRow({ feeling: "skipped", notes: null }) });
    expect(model.defaultSelectedIds).toEqual(["g-climb", "g-race"]);
    expect(model.hasSkippedCheckIn).toBe(true);
    expect(model.hasRealCheckIn).toBe(false);
  });

  it("a real-row revisit defaults to already-proposed only — no new auto-picks", () => {
    const model = build({
      existing: realRow(),
      alreadyProposedGoalIds: ["g-race"],
    });
    expect(model.defaultSelectedIds).toEqual(["g-race"]);
    expect(model.goalRows.find((r) => r.id === "g-race")!.alreadyProposed).toBe(
      true,
    );
  });
});

describe("buildCheckInModel — prefill and week-state flags", () => {
  it("fresh week: no prefill, skip available", () => {
    const model = build();
    expect(model.initialFeeling).toBeNull();
    expect(model.initialNotes).toBe("");
    expect(model.hasRealCheckIn).toBe(false);
    expect(model.hasSkippedCheckIn).toBe(false);
  });

  it("real row prefills feeling + notes and flags hasRealCheckIn", () => {
    const model = build({ existing: realRow() });
    expect(model.initialFeeling).toBe("right");
    expect(model.initialNotes).toBe("Long runs felt heavy.");
    expect(model.hasRealCheckIn).toBe(true);
  });

  it("a skipped row never prefills 'skipped' as the feeling", () => {
    const model = build({ existing: realRow({ feeling: "skipped", notes: null }) });
    expect(model.initialFeeling).toBeNull();
    expect(model.initialNotes).toBe("");
  });
});

// ---------------------------------------------------------------------------
// First-event gate
// ---------------------------------------------------------------------------

describe("isFirstCheckInEvent — gated on the PRE-write non-skipped count", () => {
  it("first real check-in fires", () => {
    expect(isFirstCheckInEvent(0, "right")).toBe(true);
    expect(isFirstCheckInEvent(0, "too_hard")).toBe(true);
  });

  it("a skip never fires", () => {
    expect(isFirstCheckInEvent(0, "skipped")).toBe(false);
  });

  it("a resubmission after a real check-in never re-fires", () => {
    expect(isFirstCheckInEvent(1, "right")).toBe(false);
    expect(isFirstCheckInEvent(3, "too_easy")).toBe(false);
  });

  it("a real check-in after only-skips fires (skips don't count)", () => {
    // Three skipped weeks on record → the pre-write NON-SKIPPED count is
    // still 0, so the first real submission fires.
    expect(isFirstCheckInEvent(0, "right")).toBe(true);
  });
});
