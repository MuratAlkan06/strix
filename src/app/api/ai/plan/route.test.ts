/**
 * POST /api/ai/plan guard tests (headless; Clerk/cookies/DB/AI all mocked).
 *
 * Pins the route's write-discipline: every rejection path (no auth, no
 * cookie, no draft, incomplete intake, draft-id mismatch, concurrent call)
 * exits with ZERO model calls and ZERO writes; the happy path writes the
 * validated plan to plan_draft, captures plan_generated, and returns the
 * plan; failures map to constant client-facing strings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let authedUserId: string | null = "user_1";
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: authedUserId })),
}));

let cookieToken: string | undefined = "tok_live";
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: (name: string) =>
      cookieToken && name === "strix_goal_draft"
        ? { value: cookieToken }
        : undefined,
  })),
}));

let draftRows: Array<Record<string, unknown>> = [];
const updateCalls: Array<Record<string, unknown>> = [];
vi.mock("@/db/scoped", () => ({
  scopedDb: vi.fn(() => ({
    selectFrom: vi.fn(async () => draftRows),
    update: vi.fn(
      async (_table: unknown, opts: { set: Record<string, unknown> }) => {
        updateCalls.push(opts.set);
        return [{}];
      },
    ),
  })),
}));

const generatePlanMock = vi.fn();
vi.mock("@/lib/ai/plan", () => {
  class PlanUnavailableError extends Error {}
  class PlanValidationError extends Error {}
  return {
    generatePlan: (...args: unknown[]) => generatePlanMock(...args),
    PlanUnavailableError,
    PlanValidationError,
  };
});

// The metered wrapper's quota gate is stubbed here — checkAndIncrement's real
// atomic UPDATE is proven in usage.test.ts / usage.integration.test.ts. This
// lets the route tests drive the meter (ok / cap) and assert refund-on-failure.
let capResult:
  | { ok: true; periodStart: string }
  | { ok: false; cap: number; used: number } = {
  ok: true,
  periodStart: "2026-07-01",
};
const refundUsageMock = vi.fn<
  (...args: unknown[]) => Promise<{ refunded: boolean }>
>(async () => ({ refunded: true }));
vi.mock("@/lib/billing/usage", () => ({
  checkAndIncrement: vi.fn(async () => capResult),
  refundUsage: (...args: unknown[]) => refundUsageMock(...args),
  NoLiveUserError: class NoLiveUserError extends Error {},
  CAP_KIND_LABEL: { plan: "plan_generations", replan: "replans" },
}));

const loggedErrors: unknown[] = [];
vi.mock("@/lib/ai/log", () => ({
  logAiError: vi.fn((_op: string, err: unknown) => {
    loggedErrors.push(err);
  }),
}));

const capturedEvents: Array<{
  distinctId: string;
  event: string;
  props: Record<string, unknown>;
}> = [];
vi.mock("@/lib/analytics/server", () => ({
  capture: vi.fn(
    async (
      distinctId: string,
      event: string,
      props: Record<string, unknown> = {},
    ) => {
      capturedEvents.push({ distinctId, event, props });
    },
  ),
}));

const COMPLETED_SUMMARY = {
  one_sentence_goal: "Finish a 10k race in October.",
  starting_point: "Walks regularly, no running base.",
  activity_type: "running",
  suggested_intensity: "comfortable",
  suggested_intensity_reasoning: "Plenty of runway from a walking base.",
  confirmed_intensity: "challenging",
  safety_flags: [],
};

const PLAN = {
  daily: [],
  weekly: [],
  milestones: [
    { title: "Run 5k without stopping", target_date: "2026-08-15", position: 0 },
  ],
  equipment: [],
};

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft_1",
    user_id: "user_1",
    session_token: "tok_live",
    intake_summary_draft: COMPLETED_SUMMARY,
    plan_draft: null,
    ...overrides,
  };
}

async function post(body?: unknown): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/ai/plan", {
      method: "POST",
      ...(body !== undefined
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    }),
  );
}

beforeEach(() => {
  authedUserId = "user_1";
  cookieToken = "tok_live";
  draftRows = [draftRow()];
  updateCalls.length = 0;
  capturedEvents.length = 0;
  loggedErrors.length = 0;
  generatePlanMock.mockReset();
  generatePlanMock.mockResolvedValue(PLAN);
  capResult = { ok: true, periodStart: "2026-07-01" };
  refundUsageMock.mockClear();
});

describe("POST /api/ai/plan — guards (zero writes on every rejection)", () => {
  it("401s without auth", async () => {
    authedUserId = null;
    const res = await post();
    expect(res.status).toBe(401);
    expect(generatePlanMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("400s without a draft cookie", async () => {
    cookieToken = undefined;
    const res = await post();
    expect(res.status).toBe(400);
    expect(generatePlanMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("404s when the token resolves no owned draft", async () => {
    draftRows = [];
    const res = await post();
    expect(res.status).toBe(404);
    expect(generatePlanMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("404s when the body's goal_draft_id disagrees with the cookie's draft", async () => {
    const res = await post({ goal_draft_id: "someone_elses_draft" });
    expect(res.status).toBe(404);
    expect(generatePlanMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("409s when intake has produced no summary", async () => {
    draftRows = [draftRow({ intake_summary_draft: null })];
    const res = await post();
    expect(res.status).toBe(409);
    expect(generatePlanMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("409s when the summary lacks a confirmed intensity", async () => {
    const unconfirmed: Record<string, unknown> = { ...COMPLETED_SUMMARY };
    delete unconfirmed.confirmed_intensity;
    draftRows = [draftRow({ intake_summary_draft: unconfirmed })];
    const res = await post();
    expect(res.status).toBe(409);
    expect(generatePlanMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
  });

  it("409s a concurrent call for the same draft (double-charge guard)", async () => {
    let release!: (value: typeof PLAN) => void;
    generatePlanMock.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const first = post();
    // Let the first request reach the model call and register in-flight.
    await vi.waitFor(() => expect(generatePlanMock).toHaveBeenCalledTimes(1));
    const second = await post();
    expect(second.status).toBe(409);
    release(PLAN);
    expect((await first).status).toBe(200);
    expect(generatePlanMock).toHaveBeenCalledTimes(1);
    expect(updateCalls).toHaveLength(1);
  });
});

describe("POST /api/ai/plan — happy path and failure mapping", () => {
  it("writes the plan to plan_draft, captures plan_generated, returns the plan", async () => {
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plan: PLAN });

    // Called with the intake summary + the wrapper's outer abort signal.
    expect(generatePlanMock).toHaveBeenCalledWith(
      { intakeSummary: COMPLETED_SUMMARY },
      expect.any(AbortSignal),
    );
    expect(updateCalls).toEqual([{ plan_draft: PLAN }]);
    expect(capturedEvents).toEqual([
      {
        distinctId: "user_1",
        event: "plan_generated",
        props: { goal_draft_id: "draft_1" },
      },
    ]);
  });

  it("regenerates (overwrites) when a plan_draft already exists", async () => {
    draftRows = [draftRow({ plan_draft: { daily: [], weekly: [], milestones: [], equipment: [] } })];
    const res = await post();
    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([{ plan_draft: PLAN }]);
  });

  it("503s with a constant string when no AI client is configured (C1)", async () => {
    const { PlanUnavailableError } = await import("@/lib/ai/plan");
    generatePlanMock.mockRejectedValueOnce(new PlanUnavailableError());
    const res = await post();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe("AI service unavailable.");
    expect(updateCalls).toHaveLength(0);
    // Refund is unconditional for a non-validation failure.
    expect(refundUsageMock).toHaveBeenCalledWith(
      "user_1",
      "plan",
      "2026-07-01",
      "unconditional",
    );
  });

  it("502 output_invalid on a Zod validation failure, refunds rate-limited (C7)", async () => {
    const { PlanValidationError } = await import("@/lib/ai/plan");
    generatePlanMock.mockRejectedValueOnce(new PlanValidationError("bad shape"));
    const res = await post();
    expect(res.status).toBe(502);
    expect(await res.text()).toBe("Plan generation failed.");
    expect(updateCalls).toHaveLength(0);
    expect(capturedEvents).toHaveLength(0);
    expect(loggedErrors).toHaveLength(1);
    // C7 is the ONLY validation_limited refund.
    expect(refundUsageMock).toHaveBeenCalledWith(
      "user_1",
      "plan",
      "2026-07-01",
      "validation_limited",
    );
  });

  it("500 internal on any other model error (C9), refunds unconditionally", async () => {
    generatePlanMock.mockRejectedValueOnce(
      new Error("rate limited; request-id req_abc123"),
    );
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("Plan generation failed.");
    expect(updateCalls).toHaveLength(0);
    expect(loggedErrors).toHaveLength(1);
    expect(refundUsageMock).toHaveBeenCalledWith(
      "user_1",
      "plan",
      "2026-07-01",
      "unconditional",
    );
  });

  it("402 cap_hit JSON when the meter is exhausted — no model call, no refund", async () => {
    capResult = { ok: false, cap: 3, used: 3 };
    const res = await post();
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: "cap_hit",
      cap: 3,
      used: 3,
      kind: "plan_generations",
    });
    expect(generatePlanMock).not.toHaveBeenCalled();
    expect(updateCalls).toHaveLength(0);
    expect(refundUsageMock).not.toHaveBeenCalled();
  });
});
