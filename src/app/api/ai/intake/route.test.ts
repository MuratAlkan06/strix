/**
 * POST /api/ai/intake — termination-parser + duplicate-flag-suppression tests
 * (headless; Clerk/cookies/DB/model stream all mocked, schema + transcript +
 * flag-merge logic REAL).
 *
 * Pins the phase-1-golden-path "Automated (Vitest)" item: given a fixture
 * transcript with all required fields elicited (including
 * suggested_intensity), the parser produces a valid intake_summary payload —
 * i.e. the route's submit_intake handling (zod parse → flag merge → summary
 * composition with canonicalizer fallback) writes a payload that
 * submitIntakeSchema accepts, and an invalid tool input writes NO summary.
 *
 * Also pins the safety-flow route enforcement:
 *   - a flag_safety call re-raising an already-staged concern (decided OR
 *     staged moments ago in the same response) is suppressed — no duplicate
 *     staging, no safety_flag SSE — and answered in-protocol via a
 *     tool_result continuation within the same POST;
 *   - the continuation's text streams on to the client, and a continuation
 *     may terminate intake via submit_intake;
 *   - the empty-prose guard: a flag-only response still leaves the user
 *     prose (a synthesized line when the model gave none).
 *
 * The Anthropic stream is a stub (no API); intake-schema.test.ts covers the
 * schema in isolation — this file covers the end-to-end parse from a fixture
 * transcript through the route's termination branch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { submitIntakeSchema } from "@/lib/ai/intake-schema";
import { stagedFlags, type IntakeEvent } from "@/lib/ai/safety-flags";

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
  return fakeStreamWith("Here's everything pulled together. ", content);
}

/** A stub stream with controllable prose (null = flag/tool-only response). */
function fakeStreamWith(text: string | null, content: unknown[]) {
  return {
    on(event: string, cb: (delta: string) => void) {
      if (event === "text" && text !== null) cb(text);
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

// ---------------------------------------------------------------------------
// Safety-flow route enforcement (duplicate suppression + continuation +
// empty-prose guard)
// ---------------------------------------------------------------------------

const DECIDED_FLAG = {
  type: "safety_flag",
  concern: "the 20-pound target in two weeks",
  alternative: "4-6 lbs in 2 weeks plus a continuing habit",
  reasoning: "Most of it would be water weight, and the rebound is rough.",
  user_overrode: true,
  decided_at: "2026-06-09T12:00:00.000Z",
};

// A transcript where the user already overrode the flagged concern.
const DECIDED_TRANSCRIPT = [
  { role: "user", content: "I want to lose 20 pounds in 2 weeks." },
  {
    role: "assistant",
    content: "Twenty pounds in two weeks isn't safe to target.",
  },
  DECIDED_FLAG,
  {
    role: "user",
    kind: "decision",
    content:
      "Decision: proceed with the original plan despite the concern " +
      "(the 20-pound target in two weeks). The original goal stands.",
  },
];

/** A duplicate flag_safety tool_use re-raising the decided concern, rephrased. */
function duplicateFlagBlock(id: string) {
  return {
    type: "tool_use",
    id,
    name: "flag_safety",
    input: {
      concern: "losing 20 pounds in 2 weeks",
      alternative: "a slower 1-2 lbs per week pace",
      reasoning: "Rapid loss at that rate is mostly water and rebounds.",
    },
  };
}

interface CapturedMessage {
  role: string;
  content:
    | string
    | Array<{
        type: string;
        id?: string;
        tool_use_id?: string;
        content?: string;
        text?: string;
      }>;
}

function messagesOfCall(callIndex: number): CapturedMessage[] {
  const args = streamIntakeMock.mock.calls[callIndex]![0] as {
    messages: CapturedMessage[];
  };
  return args.messages;
}

describe("POST /api/ai/intake — duplicate-flag suppression + tool_result continuation", () => {
  beforeEach(() => {
    draftRows = [draftRow({ raw_transcript: DECIDED_TRANSCRIPT })];
  });

  it("suppresses a re-raised (decided) concern, continues in-protocol, and streams the continuation", async () => {
    streamIntakeMock
      .mockReturnValueOnce(
        fakeStreamWith("That timeline is still aggressive. ", [
          { type: "text", text: "That timeline is still aggressive. " },
          duplicateFlagBlock("tu_dup1"),
        ]),
      )
      .mockReturnValueOnce(
        fakeStreamWith("Understood. How many days a week can you commit?", [
          {
            type: "text",
            text: "Understood. How many days a week can you commit?",
          },
        ]),
      );

    const res = await post("I'm sure about the two weeks.");
    expect(res.status).toBe(200);
    const sse = await res.text();

    // No duplicate card, no re-staging — and the conversation continued.
    expect(sse).not.toContain("event: safety_flag");
    expect(sse).toContain("That timeline is still aggressive.");
    expect(sse).toContain("How many days a week can you commit?");
    expect(sse).toContain("event: done");

    // The continuation request carried the assistant tool_use and a matching
    // tool_result naming the user's decision.
    expect(streamIntakeMock).toHaveBeenCalledTimes(2);
    const continuation = messagesOfCall(1);
    const first = messagesOfCall(0);
    expect(continuation).toHaveLength(first.length + 2);
    const assistantMsg = continuation.at(-2)!;
    expect(assistantMsg.role).toBe("assistant");
    expect(
      (assistantMsg.content as Array<{ type: string; id?: string }>).some(
        (b) => b.type === "tool_use" && b.id === "tu_dup1",
      ),
    ).toBe(true);
    const toolResultMsg = continuation.at(-1)!;
    expect(toolResultMsg.role).toBe("user");
    const result = (
      toolResultMsg.content as Array<{
        type: string;
        tool_use_id?: string;
        content?: string;
      }>
    )[0]!;
    expect(result.type).toBe("tool_result");
    expect(result.tool_use_id).toBe("tu_dup1");
    expect(result.content).toContain("proceed with the original goal");

    // Persisted: still exactly ONE staged flag (the decided one), and the
    // combined prose landed as a single assistant turn.
    const log = updateCalls[1]!.raw_transcript as IntakeEvent[];
    expect(stagedFlags(log)).toHaveLength(1);
    expect(stagedFlags(log)[0]!.user_overrode).toBe(true);
    const last = log.at(-1) as { role: string; content: string };
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("That timeline is still aggressive.");
    expect(last.content).toContain("How many days a week can you commit?");
  });

  it("a continuation may terminate via submit_intake (decision survives into safety_flags)", async () => {
    streamIntakeMock
      .mockReturnValueOnce(fakeStreamWith(null, [duplicateFlagBlock("tu_dup2")]))
      .mockReturnValueOnce(
        fakeStream([
          { type: "text", text: "Here's everything pulled together. " },
          {
            type: "tool_use",
            id: "tu_submit",
            name: "submit_intake",
            input: TOOL_INPUT,
          },
        ]),
      );

    const res = await post("That's everything — put the plan together.");
    const sse = await res.text();
    expect(sse).toContain("event: complete");
    expect(sse).not.toContain("event: safety_flag");

    const summary = updateCalls[1]!.intake_summary_draft as {
      safety_flags: Array<{ user_overrode: boolean | null }>;
    };
    // The staged decision is the record; the model's empty list is merged in.
    expect(summary.safety_flags).toHaveLength(1);
    expect(summary.safety_flags[0]!.user_overrode).toBe(true);
  });

  it("bounds continuations and still leaves prose (decision-stands line) when the model keeps re-flagging", async () => {
    streamIntakeMock.mockReturnValue(
      fakeStreamWith(null, [duplicateFlagBlock("tu_dup3")]),
    );

    const res = await post("Two weeks. Final answer.");
    const sse = await res.text();

    // 1 initial round + 2 bounded continuations, then the guard line.
    expect(streamIntakeMock).toHaveBeenCalledTimes(3);
    expect(sse).not.toContain("event: safety_flag");
    expect(sse).toContain("your decision stands");
    expect(sse).toContain("event: done");

    const log = updateCalls[1]!.raw_transcript as IntakeEvent[];
    expect(stagedFlags(log)).toHaveLength(1); // no duplicate staged
    const last = log.at(-1) as { role: string; content: string };
    expect(last.role).toBe("assistant");
    expect(last.content).toContain("your decision stands");
  });
});

describe("POST /api/ai/intake — same-response double flag + empty-prose guard", () => {
  it("stages a same-response duplicate concern only once (one card, one SSE event)", async () => {
    streamIntakeMock.mockReturnValue(
      fakeStreamWith("Six weeks to a marathon from a 5k base is steep. ", [
        {
          type: "text",
          text: "Six weeks to a marathon from a 5k base is steep. ",
        },
        {
          type: "tool_use",
          id: "tu_f1",
          name: "flag_safety",
          input: {
            concern: "the six-week runway to a full marathon from a 5k base",
            alternative: "target a half in 6 weeks, full next cycle",
            reasoning: "The mileage ramp is too steep to absorb.",
          },
        },
        {
          type: "tool_use",
          id: "tu_f2",
          name: "flag_safety",
          input: {
            concern: "a six week runway to a marathon from a 5k base",
            alternative: "target a half in 6 weeks, full next cycle",
            reasoning: "The mileage ramp is too steep to absorb.",
          },
        },
      ]),
    );

    const res = await post("A marathon in six weeks. I've run a 5k.");
    const sse = await res.text();

    expect(sse.split("event: safety_flag").length - 1).toBe(1);
    expect(streamIntakeMock).toHaveBeenCalledTimes(1); // card holds; no continuation

    const log = updateCalls[1]!.raw_transcript as IntakeEvent[];
    const staged = stagedFlags(log);
    expect(staged).toHaveLength(1);
    expect(staged[0]!.user_overrode).toBeNull(); // undecided — composer holds
  });

  it("synthesizes a lead-in line when a NEW flag arrives with no prose", async () => {
    streamIntakeMock.mockReturnValue(
      fakeStreamWith(null, [
        {
          type: "tool_use",
          id: "tu_f3",
          name: "flag_safety",
          input: {
            concern: "the six-week runway to a full marathon from a 5k base",
            alternative: "target a half in 6 weeks, full next cycle",
            reasoning: "The mileage ramp is too steep to absorb.",
          },
        },
      ]),
    );

    const res = await post("A marathon in six weeks. I've run a 5k.");
    const sse = await res.text();

    // The user still gets prose AND the card.
    expect(sse).toContain("a concern to settle");
    expect(sse.split("event: safety_flag").length - 1).toBe(1);

    const log = updateCalls[1]!.raw_transcript as IntakeEvent[];
    const last = log.at(-1)!;
    expect(stagedFlags([last]).length).toBe(1); // pending flag stays last
    const assistant = log.at(-2) as { role: string; content: string };
    expect(assistant.role).toBe("assistant");
    expect(assistant.content.length).toBeGreaterThan(0);
  });
});
