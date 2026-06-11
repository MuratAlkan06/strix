/**
 * equipment-urgency tests — the grouping boundaries the contract pins:
 * exactly 7d, 8d, 30d, 31d, overdue, no-date — plus the user-timezone
 * "today" derivation.
 */
import { describe, expect, it } from "vitest";

import {
  daysUntil,
  equipmentUrgency,
  isOverdue,
  todayInTimeZone,
  URGENCY_ORDER,
} from "./equipment-urgency";

const TODAY = "2026-06-10";

describe("equipmentUrgency boundaries (today = 2026-06-10)", () => {
  it("today itself → this_week", () => {
    expect(equipmentUrgency("2026-06-10", TODAY)).toBe("this_week");
  });

  it("exactly 7 days out → this_week (inclusive)", () => {
    expect(equipmentUrgency("2026-06-17", TODAY)).toBe("this_week");
  });

  it("8 days out → this_month", () => {
    expect(equipmentUrgency("2026-06-18", TODAY)).toBe("this_month");
  });

  it("exactly 30 days out → this_month (inclusive)", () => {
    expect(equipmentUrgency("2026-07-10", TODAY)).toBe("this_month");
  });

  it("31 days out → later", () => {
    expect(equipmentUrgency("2026-07-11", TODAY)).toBe("later");
  });

  it("overdue (yesterday) → this_week, flagged overdue", () => {
    expect(equipmentUrgency("2026-06-09", TODAY)).toBe("this_week");
    expect(isOverdue("2026-06-09", TODAY)).toBe(true);
  });

  it("far overdue stays in this_week (most urgent, never hidden)", () => {
    expect(equipmentUrgency("2026-01-01", TODAY)).toBe("this_week");
  });

  it("null deadline → no_date", () => {
    expect(equipmentUrgency(null, TODAY)).toBe("no_date");
  });

  it("today and future deadlines are NOT overdue", () => {
    expect(isOverdue("2026-06-10", TODAY)).toBe(false);
    expect(isOverdue("2026-06-11", TODAY)).toBe(false);
    expect(isOverdue(null, TODAY)).toBe(false);
  });

  it("group display order is week, month, later, no-date", () => {
    expect(URGENCY_ORDER).toEqual([
      "this_week",
      "this_month",
      "later",
      "no_date",
    ]);
  });
});

describe("daysUntil", () => {
  it("counts calendar days, signed", () => {
    expect(daysUntil("2026-06-17", TODAY)).toBe(7);
    expect(daysUntil("2026-06-03", TODAY)).toBe(-7);
    expect(daysUntil(TODAY, TODAY)).toBe(0);
  });

  it("is immune to DST transitions (pure UTC date math)", () => {
    // US DST started 2026-03-08; the span crosses it.
    expect(daysUntil("2026-03-10", "2026-03-05")).toBe(5);
  });

  it("rejects non-ISO input loudly", () => {
    expect(() => daysUntil("06/17/2026", TODAY)).toThrow(/YYYY-MM-DD/);
  });
});

describe("todayInTimeZone", () => {
  // 2026-06-10T23:30Z: already June 11 east of UTC+1, still June 10 in UTC.
  const now = new Date("2026-06-10T23:30:00.000Z");

  it("derives the user's calendar day, not the server's", () => {
    expect(todayInTimeZone("Pacific/Auckland", now)).toBe("2026-06-11");
    expect(todayInTimeZone("America/Los_Angeles", now)).toBe("2026-06-10");
  });

  it("falls back to UTC for missing or invalid timezones", () => {
    expect(todayInTimeZone(null, now)).toBe("2026-06-10");
    expect(todayInTimeZone(undefined, now)).toBe("2026-06-10");
    expect(todayInTimeZone("Not/AZone", now)).toBe("2026-06-10");
  });
});
