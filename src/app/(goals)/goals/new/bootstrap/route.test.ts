/**
 * GET /goals/new/bootstrap tests (no DB, node env — repo posture; Clerk + the
 * scoped DB mocked, NextRequest/NextResponse real).
 *
 * Pins the first-landing draft-creation contract that replaced the render-time
 * cookies().set() (which Next.js forbids in Server Components — the cause of
 * the first-landing 500):
 *   1. row-iff-cookie: a successful call inserts exactly one goal_drafts row
 *      AND sets the session-token cookie carrying that row's token on the
 *      same redirect response; a failed insert issues NO cookie.
 *   2. one-row-per-cookie: a repeat call with a cookie that resolves to an
 *      owned row inserts NOTHING (idempotent — no orphan rows on repeat).
 *   3. guards: unauthenticated → sign-in redirect; invalid seed → 400 with
 *      zero writes (mirrors the edge gate); stale cookie (row swept) → a
 *      fresh row + fresh cookie.
 *   4. single-flight wiring: the mint runs inside a transaction that takes
 *      the per-user advisory lock FIRST, and a concurrent sibling's fresh
 *      same-seed row is reused (its token on the cookie, zero inserts)
 *      instead of double-inserted. The full reuse matrix lives in
 *      ./single-flight.test.ts; the real lock contention proof lives in the
 *      env-gated src/db/scoped.integration.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";

let mockUserId: string | null = "user_test_1";
const redirectToSignIn = vi.fn(() =>
  NextResponse.redirect("https://clerk.example.com/sign-in", 307),
);
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: mockUserId, redirectToSignIn })),
}));

let draftRows: Array<Record<string, unknown>> = []; // cookie-resolution rows
let candidateRows: Array<Record<string, unknown>> = []; // in-window rows seen under the lock
const insertCalls: Array<Record<string, unknown>> = [];
const lockCalls: string[] = [];
let insertShouldThrow = false;
vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn((userId: string) => ({
    userId,
    selectFrom: vi.fn(async () => draftRows),
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        userId,
        lockScope: vi.fn(async (namespace: string) => {
          lockCalls.push(namespace);
        }),
        selectFrom: vi.fn(async () => candidateRows),
        insert: vi.fn(
          async (_table: unknown, values: Record<string, unknown>) => {
            if (insertShouldThrow) throw new Error("insert rejected");
            if (lockCalls.length === 0) {
              throw new Error("insert issued before the advisory lock");
            }
            insertCalls.push(values);
            return [{ id: "draft_new", ...values }];
          },
        ),
      }),
    ),
  })),
}));

import { GET } from "./route";

function request(path: string, cookieToken?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookieToken
      ? { cookie: `${DRAFT_COOKIE_NAME}=${cookieToken}` }
      : undefined,
  });
}

beforeEach(() => {
  mockUserId = "user_test_1";
  draftRows = [];
  candidateRows = [];
  insertCalls.length = 0;
  lockCalls.length = 0;
  insertShouldThrow = false;
  redirectToSignIn.mockClear();
});

/** A sibling row fresh enough (and untouched enough) to be reused. */
function freshSiblingDraft(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: "draft_sibling",
    session_token: "tok_sibling",
    seed: null,
    raw_transcript: [],
    expires_at: new Date(Date.now() + 60_000),
    created_at: new Date(),
    ...over,
  };
}

describe("GET /goals/new/bootstrap — guards", () => {
  it("redirects unauthenticated requests to sign-in with zero writes", async () => {
    mockUserId = null;
    const res = await GET(request("/goals/new/bootstrap"));
    expect(redirectToSignIn).toHaveBeenCalledOnce();
    expect(res.status).toBe(307);
    expect(insertCalls).toHaveLength(0);
  });

  it("rejects a non-whitelisted seed with 400 and zero writes", async () => {
    const res = await GET(request("/goals/new/bootstrap?seed=evil_payload"));
    expect(res.status).toBe(400);
    expect(insertCalls).toHaveLength(0);
  });
});

describe("GET /goals/new/bootstrap — first landing (row-iff-cookie)", () => {
  it("inserts one row and sets the cookie to that row's token on the redirect", async () => {
    const res = await GET(request("/goals/new/bootstrap?seed=climb"));

    expect(insertCalls).toHaveLength(1);
    const inserted = insertCalls[0]!;
    expect(inserted.user_id).toBe("user_test_1");
    expect(inserted.seed).toBe("climb");
    expect(typeof inserted.session_token).toBe("string");

    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/goals/new");
    expect(new URL(res.headers.get("location")!).searchParams.get("seed")).toBe(
      "climb",
    );
    expect(new URL(res.headers.get("location")!).searchParams.get("boot")).toBe(
      "1",
    );

    const cookie = (res as NextResponse).cookies.get(DRAFT_COOKIE_NAME);
    expect(cookie?.value).toBe(inserted.session_token);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("lax");
    expect(cookie?.path).toBe("/");
  });

  it("opens neutrally with no seed (seed null, no seed param on the redirect)", async () => {
    const res = await GET(request("/goals/new/bootstrap"));
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.seed).toBeNull();
    expect(
      new URL(res.headers.get("location")!).searchParams.get("seed"),
    ).toBeNull();
  });

  it("issues NO cookie when the insert fails (no orphan, no false session)", async () => {
    insertShouldThrow = true;
    await expect(GET(request("/goals/new/bootstrap"))).rejects.toThrow(
      "insert rejected",
    );
    expect(insertCalls).toHaveLength(0);
  });
});

describe("GET /goals/new/bootstrap — idempotency (one row per cookie)", () => {
  it("a cookie resolving to an owned row redirects back with zero writes", async () => {
    draftRows = [{ id: "draft_1", session_token: "tok_live" }];
    const res = await GET(request("/goals/new/bootstrap", "tok_live"));

    expect(insertCalls).toHaveLength(0);
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/goals/new");
    expect(
      (res as NextResponse).cookies.get(DRAFT_COOKIE_NAME),
    ).toBeUndefined();
  });

  it("repeat calls with the issued cookie never mint extra rows", async () => {
    const first = await GET(request("/goals/new/bootstrap"));
    const token = (first as NextResponse).cookies.get(DRAFT_COOKIE_NAME)!.value;
    expect(insertCalls).toHaveLength(1);

    // The row now exists for that token; the next call resolves it.
    draftRows = [{ id: "draft_new", session_token: token }];
    await GET(request("/goals/new/bootstrap", token));
    await GET(request("/goals/new/bootstrap", token));
    expect(insertCalls).toHaveLength(1);
  });

  it("a stale cookie (row swept) mints a fresh row and a fresh cookie", async () => {
    draftRows = []; // token no longer resolves
    const res = await GET(request("/goals/new/bootstrap", "tok_stale"));

    expect(insertCalls).toHaveLength(1);
    const cookie = (res as NextResponse).cookies.get(DRAFT_COOKIE_NAME);
    expect(cookie?.value).toBe(insertCalls[0]!.session_token);
    expect(cookie?.value).not.toBe("tok_stale");
  });
});

describe("GET /goals/new/bootstrap — single-flight (concurrent first landing)", () => {
  it("acquires the per-user advisory lock before minting", async () => {
    await GET(request("/goals/new/bootstrap?seed=climb"));
    expect(lockCalls).toEqual(["goal_drafts:bootstrap"]);
    expect(insertCalls).toHaveLength(1);
  });

  it("reuses a concurrent sibling's fresh same-seed row: zero inserts, the sibling's token on the cookie", async () => {
    candidateRows = [freshSiblingDraft({ seed: "climb" })];
    const res = await GET(request("/goals/new/bootstrap?seed=climb"));

    expect(insertCalls).toHaveLength(0);
    expect(
      (res as NextResponse).cookies.get(DRAFT_COOKIE_NAME)?.value,
    ).toBe("tok_sibling");
    expect(res.status).toBe(303);
  });

  it("a different-seed sibling is NOT reused — a fresh row is minted", async () => {
    candidateRows = [freshSiblingDraft({ seed: "language" })];
    const res = await GET(request("/goals/new/bootstrap?seed=climb"));

    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]!.seed).toBe("climb");
    expect(
      (res as NextResponse).cookies.get(DRAFT_COOKIE_NAME)?.value,
    ).toBe(insertCalls[0]!.session_token);
  });

  it("a sibling row with chat activity is NOT reused — a fresh row is minted", async () => {
    candidateRows = [
      freshSiblingDraft({
        seed: "climb",
        raw_transcript: [{ role: "user", content: "hi" }],
      }),
    ];
    await GET(request("/goals/new/bootstrap?seed=climb"));
    expect(insertCalls).toHaveLength(1);
  });
});
