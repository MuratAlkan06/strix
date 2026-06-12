/**
 * resetMonthlyUsageCounters Phase-2 shell tests: the body returns
 * immediately with a zero result and accepts no DB surface at all — a
 * Phase 2 run provably cannot write. Phase 3 replaces the body (and these
 * pins) with the real local-midnight-window reset.
 */
import { describe, expect, it } from "vitest";
import {
  resetDueMonthlyUsageCounters,
  resetMonthlyUsageCounters,
} from "./reset-monthly-usage-counters";

describe("resetDueMonthlyUsageCounters (Phase 2 no-op shell)", () => {
  it("returns immediately with resetCount 0 and the honest no-op note", async () => {
    await expect(resetDueMonthlyUsageCounters()).resolves.toEqual({
      resetCount: 0,
      note: "phase-2 no-op — Phase 3 adds the local-midnight-window reset",
    });
  });

  it("accepts no arguments — there is no client to write through", () => {
    expect(resetDueMonthlyUsageCounters.length).toBe(0);
  });

  it("is registered under the contract id", () => {
    expect(resetMonthlyUsageCounters.id()).toBe(
      "reset-monthly-usage-counters",
    );
  });
});
