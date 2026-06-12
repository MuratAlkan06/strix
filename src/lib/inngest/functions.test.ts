/**
 * Registry pin: /api/inngest serves exactly the three Phase ≤2 functions
 * (the route passes this array to serve() verbatim — Slice 5 acceptance
 * "serve() exposes 3 functions total").
 */
import { describe, expect, it } from "vitest";
import { inngestFunctions } from "./functions";

describe("inngestFunctions registry", () => {
  it("serves exactly three functions with the contract ids", () => {
    expect(inngestFunctions.map((fn) => fn.id())).toEqual([
      "sweep-expired-goal-drafts",
      "archive-completed-goals",
      "reset-monthly-usage-counters",
    ]);
  });
});
