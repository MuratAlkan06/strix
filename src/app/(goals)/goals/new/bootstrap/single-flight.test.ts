/**
 * single-flight tests (no DB, node env) — the bootstrap mint's serialize-and-
 * reuse contract from the gate re-verification fix:
 *
 *   - pickReusableDraft (pure matrix): reuse only a same-seed, unexpired,
 *     in-window, untouched row; most-recent wins among several.
 *   - mintOrReuseDraft against a fake scoped surface: the advisory lock is
 *     taken FIRST; a second call inside the window reuses (no second
 *     insert); none/expired/has-activity/different-seed all mint fresh.
 *
 * The true two-connections-contending proof (Postgres advisory xact lock
 * blocking a parallel transaction) is DB-dependent and lives in the
 * env-gated src/db/scoped.integration.test.ts.
 */
import { describe, expect, it } from "vitest";

import type { ScopedDb, ScopedTx } from "@/db/scoped";
import {
  BOOTSTRAP_LOCK_NAMESPACE,
  BOOTSTRAP_REUSE_WINDOW_MS,
  mintOrReuseDraft,
  pickReusableDraft,
  type DraftCandidate,
} from "./single-flight";

const NOW = new Date("2026-06-10T12:00:00Z");

function candidate(over: Partial<DraftCandidate> = {}): DraftCandidate {
  return {
    session_token: "tok_sibling",
    seed: "climb",
    raw_transcript: [],
    expires_at: new Date(NOW.getTime() + 60_000),
    created_at: new Date(NOW.getTime() - 1_000),
    ...over,
  };
}

describe("pickReusableDraft — pure reuse matrix", () => {
  it("reuses a fresh, same-seed, untouched, unexpired row", () => {
    const row = candidate();
    expect(pickReusableDraft([row], "climb", NOW)).toBe(row);
  });

  it("returns null when there are no candidates", () => {
    expect(pickReusableDraft([], "climb", NOW)).toBeNull();
  });

  it("rejects an expired row", () => {
    const row = candidate({ expires_at: new Date(NOW.getTime() - 1) });
    expect(pickReusableDraft([row], "climb", NOW)).toBeNull();
  });

  it("rejects a row with chat activity (raw_transcript non-empty)", () => {
    const row = candidate({
      raw_transcript: [{ role: "user", content: "hi" }],
    });
    expect(pickReusableDraft([row], "climb", NOW)).toBeNull();
  });

  it("rejects a different seed — and a null seed only matches a null seed", () => {
    expect(
      pickReusableDraft([candidate({ seed: "language" })], "climb", NOW),
    ).toBeNull();
    expect(pickReusableDraft([candidate({ seed: null })], "climb", NOW)).toBeNull();
    expect(pickReusableDraft([candidate()], null, NOW)).toBeNull();

    const neutral = candidate({ seed: null });
    expect(pickReusableDraft([neutral], null, NOW)).toBe(neutral);
  });

  it("rejects a row older than the reuse window", () => {
    const row = candidate({
      created_at: new Date(NOW.getTime() - BOOTSTRAP_REUSE_WINDOW_MS - 1),
    });
    expect(pickReusableDraft([row], "climb", NOW)).toBeNull();
  });

  it("picks the most recent among multiple eligible rows", () => {
    const older = candidate({
      session_token: "tok_older",
      created_at: new Date(NOW.getTime() - 5_000),
    });
    const newer = candidate({
      session_token: "tok_newer",
      created_at: new Date(NOW.getTime() - 500),
    });
    expect(pickReusableDraft([older, newer], "climb", NOW)).toBe(newer);
    expect(pickReusableDraft([newer, older], "climb", NOW)).toBe(newer);
  });
});

describe("mintOrReuseDraft — serialize-and-reuse against a fake scoped surface", () => {
  /** In-memory ScopedDb stand-in: transaction() hands the callback a tx whose
   *  selectFrom/insert share one row store, and every call is event-logged so
   *  ordering (lock before read/write) is assertable. */
  function fakeSdb() {
    const rows: Array<DraftCandidate & { user_id: string }> = [];
    const events: string[] = [];
    const tx = {
      async lockScope(namespace: string) {
        events.push(`lock:${namespace}`);
      },
      async selectFrom() {
        events.push("select");
        return rows.slice();
      },
      async insert(_table: unknown, values: Record<string, unknown>) {
        events.push("insert");
        const row = {
          raw_transcript: [],
          created_at: new Date(),
          ...values,
        } as DraftCandidate & { user_id: string };
        rows.push(row);
        return [row];
      },
    } as unknown as ScopedTx;
    const sdb = {
      userId: "user_test_1",
      transaction: async <T>(fn: (t: ScopedTx) => Promise<T>) => fn(tx),
    } as unknown as ScopedDb;
    return { sdb, rows, events };
  }

  it("acquires the per-user advisory lock before any read or write", async () => {
    const { sdb, events } = fakeSdb();
    await mintOrReuseDraft(sdb, null);
    expect(events[0]).toBe(`lock:${BOOTSTRAP_LOCK_NAMESPACE}`);
    expect(events).toEqual([
      `lock:${BOOTSTRAP_LOCK_NAMESPACE}`,
      "select",
      "insert",
    ]);
  });

  it("first call inserts; a second call inside the window reuses it (no second insert)", async () => {
    const { sdb, rows, events } = fakeSdb();
    const first = await mintOrReuseDraft(sdb, "climb");
    const second = await mintOrReuseDraft(sdb, "climb");

    expect(second).toBe(first);
    expect(rows).toHaveLength(1);
    expect(events.filter((e) => e === "insert")).toHaveLength(1);
    expect(rows[0]!.user_id).toBe("user_test_1");
    expect(rows[0]!.seed).toBe("climb");
  });

  it("a different seed mints a separate row", async () => {
    const { sdb, rows } = fakeSdb();
    const first = await mintOrReuseDraft(sdb, "climb");
    const second = await mintOrReuseDraft(sdb, "language");
    expect(second).not.toBe(first);
    expect(rows).toHaveLength(2);
  });

  it("a row with activity is never reused — a fresh row is minted", async () => {
    const { sdb, rows } = fakeSdb();
    const first = await mintOrReuseDraft(sdb, "climb");
    rows[0]!.raw_transcript = [{ role: "user", content: "hello" }];
    const second = await mintOrReuseDraft(sdb, "climb");
    expect(second).not.toBe(first);
    expect(rows).toHaveLength(2);
  });

  it("an expired row is never reused — a fresh row is minted", async () => {
    const { sdb, rows } = fakeSdb();
    const first = await mintOrReuseDraft(sdb, "climb");
    rows[0]!.expires_at = new Date(Date.now() - 1);
    const second = await mintOrReuseDraft(sdb, "climb");
    expect(second).not.toBe(first);
    expect(rows).toHaveLength(2);
  });

  it("an insert failure rejects (transaction surfaces it; caller issues no cookie)", async () => {
    const failing = {
      userId: "user_test_1",
      transaction: async <T>(fn: (t: ScopedTx) => Promise<T>) =>
        fn({
          async lockScope() {},
          async selectFrom() {
            return [];
          },
          async insert() {
            throw new Error("insert rejected");
          },
        } as unknown as ScopedTx),
    } as unknown as ScopedDb;
    await expect(mintOrReuseDraft(failing, "climb")).rejects.toThrow(
      "insert rejected",
    );
  });
});
