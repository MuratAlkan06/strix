/**
 * POST /api/ai/intake — termination-parser tests (headless; Clerk/cookies/DB/
 * model stream all mocked, schema + transcript + flag-merge logic REAL).
 *
 * Pins the phase-1-golden-path "Automated (Vitest)" item: given a fixture
 * transcript with all required fields elicited (including
 * suggested_intensity), the parser produces a valid intake_summary payload —
 * i.e. the route's submit_intake handling (zod parse → flag merge → summary
 * composition with canonicalizer fallback) writes a payload that
 * submitIntakeSchema accepts, and an invalid tool input writes NO summary.
 *
 * The Anthropic stream is a stub (no API); intake-schema.test.ts covers the
 * schema in isolation — this file covers the end-to-end parse from a fixture
 * transcript through the route's termination branch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitIntakeSchema } from "@/lib/ai/intake-schema";

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

// The model stream is a stub: one prose delta, then a finalMessage whose
// content the test controls (the termination tool_use lives there).
const streamIntakeMock = vi.fn();
vi.mock("@/lib/ai/intake", () => ({
  streamIntake: (...args: unknown[]) => streamIntakeMock(...args),
}));

// No Haiku in tests: canonicalize rejects, exercising the route's documented
// fallback to the Sonnet-emitted values.
vi.mock("@/lib/ai/canonicalize", () => ({
  canonicalize: vi.fn(async () => {
    throw new Error("no canonicalizer in tests");
  }),
}));

vi.mock("@/lib/ai/log", () => ({
  logAiError: vi.fn(),
  logAiUsage: vi.fn(),
  toUsageLog: vi.fn(() => ({})),
}));

function fakeStream(content: unknown[]) {
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text") cb("Here's everything pulled together. ");
      return this;
    },
    finalMessage: async () => ({
      content,
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  };
}

// Fixture transcript: 4 user turns eliciting every required field — goal,
// starting point, location, cadence/session/budget — before termination.
const PRIOR_TRANSCRIPT = [
  { role: "user", content: "I want to run a race." },
  { role: "assistant", content: "Which distance, and when?" },
  {
    role: "user",
    content: "A 10k at the end of October. I'm in Lisbon, Portugal.",
  },
  { role: "assistant", content: "Where are you starting from, fitness-wise?" },
  {
    role: "user",
    content:
      "I walk daily but haven't run since school. I can do three mornings a week, about 45 minutes.",
  },
  { role: "assistant", content: "Any budget for shoes and the race entry?" },
];

const FINAL_USER_MESSAGE =
  "Maybe $150 all in. That's everything — put the plan together.";

// The submit_intake input the model derives from that transcript.
const TOOL_INPUT = {
  one_sentence_goal: "Finish a 10k race at the end of October.",
  starting_point: "Walks daily; hasn't run since school.",
  prior_experience: null,
  days_per_week: 3,
  time_per_session_min: 45,
  budget_usd: 150,
  target_date: "2026-10-31",
  location_city: "Lisbon",
  location_region: null,
  location_country: "Portugal",
  activity_type: "running",
  activity_type_other_label: null,
  suggested_intensity: "comfortable",
  suggested_intensity_reasoning:
    "Five months of runway from a daily-walking base supports comfortable progression.",
  safety_flags: [],
};

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "draft_1",
    user_id: "user_1",
    session_token: "tok_live",
    seed: "race",
    raw_transcript: PRIOR_TRANSCRIPT,
    intake_summary_draft: null,
    ...overrides,
  };
}

async function post(message: string): Promise<Response> {
  const { POST } = await import("./route");
  return POST(
    new Request("http://localhost/api/ai/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    }),
  );
}

beforeEach(() => {
  authedUserId = "user_1";
  cookieToken = "tok_live";
  draftRows = [draftRow()];
  updateCalls.length = 0;
  streamIntakeMock.mockReset();
});

describe("POST /api/ai/intake — termination parse (fixture transcript → valid summary)", () => {
  it("a complete submit_intake over the fixture transcript writes a schema-valid intake_summary payload", async () => {
    streamIntakeMock.mockReturnValue(
      fakeStream([
        { type: "text", text: "Here's everything pulled together. " },
        { type: "tool_use", id: "tu_1", name: "submit_intake", input: TOOL_INPUT },
      ]),
    );

    const res = await post(FINAL_USER_MESSAGE);
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain("event: complete");

    // The model saw the fixture transcript plus the terminating user turn.
    const { messages } = streamIntakeMock.mock.calls[0]![0] as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(messages).toHaveLength(PRIOR_TRANSCRIPT.length + 1);
    expect(messages.at(-1)).toEqual({
      role: "user",
      content: FINAL_USER_MESSAGE,
    });

    // Two writes: the user turn (pre-stream), then transcript + summary.
    expect(updateCalls).toHaveLength(2);
    const final = updateCalls[1]!;
    const summary = final.intake_summary_draft as Record<string, unknown>;
    expect(summary).toBeDefined();

    // THE phase-doc assertion: the written payload is a valid intake_summary.
    const parsed = submitIntakeSchema.safeParse(summary);
    expect(parsed.success).toBe(true);
    expect(summary.suggested_intensity).toBe("comfortable");
    expect(summary.suggested_intensity_reasoning).toBe(
      TOOL_INPUT.suggested_intensity_reasoning,
    );
    // Canonicalizer failed (mocked) → Sonnet-emitted values survive.
    expect(summary.location_city).toBe("Lisbon");
    expect(summary.activity_type).toBe("running");
    expect(summary.safety_flags).toEqual([]);

    // The persisted transcript carries the full conversation.
    const transcript = final.raw_transcript as Array<{ role: string }>;
    expect(transcript).toHaveLength(PRIOR_TRANSCRIPT.length + 2);

    // The SSE complete event carries the same summary the DB got.
    const completeData = sse
      .split("event: complete\n")[1]!
      .split("\n")[0]!
      .replace(/^data: /, "");
    expect(JSON.parse(completeData)).toEqual({ summary });
  });

  it("an incomplete tool input (missing suggested_intensity) writes NO summary and reports the error", async () => {
    const incomplete: Record<string, unknown> = { ...TOOL_INPUT };
    delete incomplete.suggested_intensity;
    streamIntakeMock.mockReturnValue(
      fakeStream([
        { type: "tool_use", id: "tu_1", name: "submit_intake", input: incomplete },
      ]),
    );

    const res = await post(FINAL_USER_MESSAGE);
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain("Intake summary was incomplete.");
    expect(sse).not.toContain("event: complete");

    // The transcript is still persisted; the summary is not.
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1]!.raw_transcript).toBeDefined();
    expect(updateCalls[1]).not.toHaveProperty("intake_summary_draft");
  });
});
