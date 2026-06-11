/**
 * goal-progress tests — progress computation (incl. the 0-milestone honest
 * state) and next-milestone selection (earliest incomplete by position).
 */
import { describe, expect, it } from "vitest";

import { milestoneProgress, nextMilestone } from "./goal-progress";

const ms = (
  title: string,
  position: number,
  completed_at: string | null = null,
) => ({ title, position, completed_at });

describe("milestoneProgress", () => {
  it("zero milestones → total 0, completed 0, percent null (no fake 0% bar)", () => {
    expect(milestoneProgress([])).toEqual({
      total: 0,
      completed: 0,
      percent: null,
    });
  });

  it("counts completed_at-set milestones only", () => {
    const result = milestoneProgress([
      ms("a", 0, "2026-05-01T00:00:00.000Z"),
      ms("b", 1),
      ms("c", 2),
    ]);
    expect(result).toEqual({ total: 3, completed: 1, percent: 33 });
  });

  it("all complete → 100", () => {
    const result = milestoneProgress([
      ms("a", 0, "2026-05-01T00:00:00.000Z"),
      ms("b", 1, "2026-05-02T00:00:00.000Z"),
    ]);
    expect(result).toEqual({ total: 2, completed: 2, percent: 100 });
  });

  it("none complete with milestones present → an honest 0 (not null)", () => {
    expect(milestoneProgress([ms("a", 0)]).percent).toBe(0);
  });

  it("accepts Date instances for completed_at", () => {
    expect(
      milestoneProgress([{ completed_at: new Date("2026-05-01") }]).completed,
    ).toBe(1);
  });
});

describe("nextMilestone", () => {
  it("picks the earliest INCOMPLETE milestone by position", () => {
    const next = nextMilestone([
      ms("third", 2),
      ms("first-done", 0, "2026-05-01T00:00:00.000Z"),
      ms("second", 1),
    ]);
    expect(next?.title).toBe("second");
  });

  it("skips completed milestones even at lower positions", () => {
    const next = nextMilestone([
      ms("done-0", 0, "2026-05-01T00:00:00.000Z"),
      ms("done-1", 1, "2026-05-02T00:00:00.000Z"),
      ms("open-2", 2),
    ]);
    expect(next?.title).toBe("open-2");
  });

  it("null when every milestone is complete", () => {
    expect(
      nextMilestone([ms("a", 0, "2026-05-01T00:00:00.000Z")]),
    ).toBeNull();
  });

  it("null when there are no milestones", () => {
    expect(nextMilestone([])).toBeNull();
  });

  it("position ties break by input order", () => {
    const next = nextMilestone([ms("first-seen", 1), ms("second-seen", 1)]);
    expect(next?.title).toBe("first-seen");
  });
});
