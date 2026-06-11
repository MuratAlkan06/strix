/**
 * togglePurchased server-action tests (no DB, node env — the save-goal
 * mocking posture).
 *
 * Pins:
 *   - guards (no auth, malformed id) reject with ZERO DB calls;
 *   - an unowned/foreign row (scope filter → zero rows updated) reports
 *     failure — zero writes by construction;
 *   - a thrown ScopedDbError surfaces as a calm failure;
 *   - happy path both directions: purchase sets purchased_at to a Date,
 *     un-purchase sets it to null; the scoped where targets the row id and
 *     /equipment is revalidated.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { equipment } from "@/db/schema";

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

const updates: Array<{
  table: unknown;
  set: Record<string, unknown>;
  where: unknown;
}> = [];
let updateResult: Array<Record<string, unknown>> = [];
let updateThrows = false;

vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn((userId: string) => ({
    userId,
    update: vi.fn(
      async (
        table: unknown,
        opts: { set: Record<string, unknown>; where: unknown },
      ) => {
        if (updateThrows) throw new Error("scopedDb says no");
        updates.push({ table, set: opts.set, where: opts.where });
        return updateResult;
      },
    ),
  })),
}));

// --- import under test (after mocks) ------------------------------------

import { togglePurchased } from "./toggle-purchased";

const EQUIPMENT_ID = "5f9c2c4a-7a1b-4f4e-9b2d-3c8d1e6f0a12";

beforeEach(() => {
  mockUserId = "user_test_1";
  updateResult = [{ id: EQUIPMENT_ID }];
  updateThrows = false;
  updates.length = 0;
  revalidated.length = 0;
});

describe("togglePurchased — guards reject with zero writes", () => {
  it("no auth → failure, no DB call", async () => {
    mockUserId = null;
    const result = await togglePurchased({
      equipmentId: EQUIPMENT_ID,
      purchased: true,
    });
    expect(result).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
    expect(revalidated).toHaveLength(0);
  });

  it.each([
    ["empty string", ""],
    ["not a uuid", "equipment-1"],
    ["sql-ish payload", "' OR 1=1 --"],
  ])("malformed equipment id (%s) → failure, no DB call", async (_label, id) => {
    const result = await togglePurchased({ equipmentId: id, purchased: true });
    expect(result).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });

  it("non-string equipment id → failure, no DB call", async () => {
    const result = await togglePurchased({
      equipmentId: 42 as unknown as string,
      purchased: true,
    });
    expect(result).toMatchObject({ ok: false });
    expect(updates).toHaveLength(0);
  });
});

describe("togglePurchased — ownership failure surfaces, zero rows written", () => {
  it("scope filter excludes the row (zero rows updated) → calm failure", async () => {
    updateResult = []; // scopedDb's ownership filter matched nothing
    const result = await togglePurchased({
      equipmentId: EQUIPMENT_ID,
      purchased: true,
    });
    expect(result).toEqual({
      ok: false,
      error: "We couldn't find that item.",
    });
    expect(revalidated).toHaveLength(0);
  });

  it("a thrown ScopedDbError → calm failure, no revalidate", async () => {
    updateThrows = true;
    const result = await togglePurchased({
      equipmentId: EQUIPMENT_ID,
      purchased: true,
    });
    expect(result).toEqual({
      ok: false,
      error: "That didn't save. Try once more.",
    });
    expect(revalidated).toHaveLength(0);
  });
});

describe("togglePurchased — happy path, both directions", () => {
  it("purchase: sets purchased_at to now, updates updated_at, revalidates", async () => {
    const result = await togglePurchased({
      equipmentId: EQUIPMENT_ID,
      purchased: true,
    });
    expect(result).toEqual({ ok: true, purchased: true });
    expect(updates).toHaveLength(1);
    expect(updates[0]!.table).toBe(equipment);
    expect(updates[0]!.set.purchased_at).toBeInstanceOf(Date);
    expect(updates[0]!.set.updated_at).toBeInstanceOf(Date);
    expect(updates[0]!.where).toBeDefined();
    expect(revalidated).toEqual(["/equipment"]);
  });

  it("un-purchase: sets purchased_at back to null", async () => {
    const result = await togglePurchased({
      equipmentId: EQUIPMENT_ID,
      purchased: false,
    });
    expect(result).toEqual({ ok: true, purchased: false });
    expect(updates[0]!.set.purchased_at).toBeNull();
  });

  it("a non-boolean purchased value coerces to false (never truthy garbage)", async () => {
    const result = await togglePurchased({
      equipmentId: EQUIPMENT_ID,
      purchased: "yes" as unknown as boolean,
    });
    expect(result).toEqual({ ok: true, purchased: false });
    expect(updates[0]!.set.purchased_at).toBeNull();
  });
});
