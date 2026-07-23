/**
 * assertInngestDevAbsentOnVercel — the runtime half of ADR-0002 Decision 6 / B1.
 *
 * The invariant: INNGEST_DEV must be ABSENT in every Vercel scope, because a
 * truthy value disables /api/inngest signature verification (world-callable
 * cron). The guard is deliberately strict — ANY set value on Vercel throws,
 * including a falsy "0"/"false", because B1 requires absence, not falsiness.
 */
import { describe, expect, it } from "vitest";
import { assertInngestDevAbsentOnVercel } from "./env-guard";

describe("assertInngestDevAbsentOnVercel", () => {
  it("throws when VERCEL is set and INNGEST_DEV is truthy", () => {
    expect(() =>
      assertInngestDevAbsentOnVercel({ VERCEL: "1", INNGEST_DEV: "1" }),
    ).toThrow(/INNGEST_DEV/);
  });

  it('throws when VERCEL is set and INNGEST_DEV is a falsy-but-present "0" (absence rule)', () => {
    expect(() =>
      assertInngestDevAbsentOnVercel({ VERCEL: "1", INNGEST_DEV: "0" }),
    ).toThrow(/INNGEST_DEV/);
  });

  it("passes when VERCEL is set and INNGEST_DEV is unset", () => {
    expect(() =>
      assertInngestDevAbsentOnVercel({ VERCEL: "1" }),
    ).not.toThrow();
  });

  it("passes when VERCEL is unset and INNGEST_DEV is truthy (local dev)", () => {
    expect(() =>
      assertInngestDevAbsentOnVercel({ INNGEST_DEV: "1" }),
    ).not.toThrow();
  });

  it("passes when both are unset", () => {
    expect(() => assertInngestDevAbsentOnVercel({})).not.toThrow();
  });
});
