/**
 * Equipment deadline derivation — both branches (phase-1-golden-path
 * "Equipment deadline derivation" + its automated-verification bullet).
 */
import { describe, expect, it } from "vitest";

import { equipmentDeadline } from "./equipment-deadline";

describe("equipmentDeadline", () => {
  it("milestone-linked: returns the milestone's target_date", () => {
    expect(
      equipmentDeadline(
        { milestone_id: "ms-1", standalone_deadline: null },
        { target_date: "2026-09-20" },
      ),
    ).toBe("2026-09-20");
  });

  it("standalone: returns standalone_deadline", () => {
    expect(
      equipmentDeadline({ milestone_id: null, standalone_deadline: "2026-07-30" }),
    ).toBe("2026-07-30");
  });

  it("milestone-linked without the milestone row throws (must exist)", () => {
    expect(() =>
      equipmentDeadline({ milestone_id: "ms-1", standalone_deadline: null }),
    ).toThrow(/milestone/i);
  });
});
