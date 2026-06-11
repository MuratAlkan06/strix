/**
 * format tests — USD cost formatting (the contract's "cost formatting" pin)
 * and the shared date label.
 */
import { describe, expect, it } from "vitest";

import { formatDate, formatUsd } from "./format";

describe("formatUsd", () => {
  it("formats whole-dollar numeric strings without cents", () => {
    expect(formatUsd("450.00")).toBe("$450");
    expect(formatUsd("90")).toBe("$90");
  });

  it("keeps two decimals for fractional amounts", () => {
    expect(formatUsd("120.50")).toBe("$120.50");
    expect(formatUsd(95.5)).toBe("$95.50");
  });

  it("groups thousands", () => {
    expect(formatUsd("2400.00")).toBe("$2,400");
  });

  it("null and unparseable input → null (render nothing, never $NaN)", () => {
    expect(formatUsd(null)).toBeNull();
    expect(formatUsd("not-a-number")).toBeNull();
  });
});

describe("formatDate", () => {
  it("formats ISO dates as Mon D, YYYY", () => {
    expect(formatDate("2026-08-15")).toBe("Aug 15, 2026");
    expect(formatDate("2026-06-07")).toBe("Jun 7, 2026");
  });

  it("returns non-ISO input untouched", () => {
    expect(formatDate("soon")).toBe("soon");
  });
});
