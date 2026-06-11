/**
 * today.ts tests (no DB, node env — repo posture). Pins the ISO shape and the
 * local-date semantics of the per-request date anchor.
 */
import { describe, expect, it } from "vitest";
import { todayIso } from "./today";

describe("todayIso", () => {
  it("formats as YYYY-MM-DD with zero padding", () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(todayIso(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  it("uses the local calendar date of the provided instant", () => {
    const noonLocal = new Date(2026, 5, 10, 12, 0, 0);
    expect(todayIso(noonLocal)).toBe("2026-06-10");
  });

  it("defaults to now and matches the ISO date regex", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
