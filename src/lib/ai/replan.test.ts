/**
 * replan generation tests (no DB, no live API, node env — repo posture; the
 * Anthropic client is mocked at the ./client seam).
 *
 * Pins the slice's contract:
 *   - resolveIntensity walks override → intake → user; the third branch is
 *     ONLY reachable via an ABSENT intake_summaries row (confirmed_intensity
 *     is NOT NULL), so the fixture constructs absence as `null`;
 *   - buildReplanMessages is a single user message carrying the date anchor
 *     and every per-request input (uncached side; prompts/replan.test.ts pins
 *     the cached side stays variability-free) — and it REFUSES a 'skipped'
 *     triggering check-in (the builder seam of the skip-exclusion rule);
 *   - generateReplan logs WHICH intensity source won (the
 *     replan_intensity_source line the phase verification greps for) and the
 *     "replan" usage record;
 *   - a zod-failing model output throws ReplanValidationError carrying the
 *     RAW response in its message (what logAiError puts in the server log);
 *   - a missing client throws ReplanUnavailableError (the route's 503).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_REPLAN_DIFF } from "./replan-diff";

// --- client mock -----------------------------------------------------------

const parseMock = vi.fn();
let clientOrNull: { messages: { parse: typeof parseMock } } | null = {
  messages: { parse: parseMock },
};

vi.mock("./client", () => ({
  getClient: vi.fn(() => clientOrNull),
}));

// --- import under test (after mocks) ----------------------------------------

import {
  buildReplanMessages,
  generateReplan,
  ReplanUnavailableError,
  ReplanValidationError,
  resolveIntensity,
  type GenerateReplanArgs,
} from "./replan";
import { MODEL_SONNET } from "./models";
import { REPLAN_SYSTEM_TEXT } from "./prompts/replan";

function baseArgs(over?: Partial<GenerateReplanArgs>): GenerateReplanArgs {
  return {
    goal: {
      title: "Run a 10k",
      description: null,
      target_date: "2026-10-25",
    },
    intakeSummary: { one_sentence_goal: "Finish a 10k race in October." },
    recurringTasks: [
      {
        id: "task-1",
        title: "Long run",
        cadence: "weekly",
        weekday: 6,
        estimated_duration_min: 60,
        active: true,
      },
    ],
    milestones: [
      {
        id: "ms-1",
        title: "Run 5k without stopping",
        target_date: "2026-07-15",
        position: 0,
        completed: false,
      },
    ],
    equipment: [
      {
        id: "eq-1",
        title: "Running shoes",
        cost_usd: "90.00",
        milestone_id: "ms-1",
        standalone_deadline: null,
        purchased: false,
      },
    ],
    adherence: [
      {
        recurring_task_id: "task-1",
        title: "Long run",
        cadence: "weekly",
        expected: 4,
        actual: 1,
      },
    ],
    trigger: { kind: "weekly_check_in", feeling: "too_hard", notes: "busy" },
    intensity: { intensity: "challenging", source: "intake" },
    today: "2026-06-10",
    ...over,
  };
}

beforeEach(() => {
  parseMock.mockReset();
  clientOrNull = { messages: { parse: parseMock } };
});

// ---------------------------------------------------------------------------
// resolveIntensity — the three-branch chain
// ---------------------------------------------------------------------------

describe("resolveIntensity", () => {
  it("branch 1: goals.intensity_override wins when set", () => {
    expect(
      resolveIntensity({
        override: "brutal",
        intakeSummary: { confirmed_intensity: "comfortable" },
        userPreference: "challenging",
      }),
    ).toEqual({ intensity: "brutal", source: "override" });
  });

  it("branch 2: intake confirmed_intensity wins when override is null", () => {
    expect(
      resolveIntensity({
        override: null,
        intakeSummary: { confirmed_intensity: "comfortable" },
        userPreference: "challenging",
      }),
    ).toEqual({ intensity: "comfortable", source: "intake" });
  });

  it("branch 3: users.intensity_preference wins ONLY when no intake row exists (absence, not a null column)", () => {
    expect(
      resolveIntensity({
        override: null,
        intakeSummary: null, // absent intake_summaries row — the only path here
        userPreference: "challenging",
      }),
    ).toEqual({ intensity: "challenging", source: "user" });
  });

  it("all sources unset → null intensity attributed to the last link", () => {
    expect(
      resolveIntensity({
        override: null,
        intakeSummary: null,
        userPreference: null,
      }),
    ).toEqual({ intensity: null, source: "user" });
  });
});

// ---------------------------------------------------------------------------
// buildReplanMessages — the uncached side
// ---------------------------------------------------------------------------

describe("buildReplanMessages", () => {
  it("is a single user message anchored on the user's today", () => {
    const messages = buildReplanMessages(baseArgs());
    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    const content = messages[0]!.content as string;
    expect(content).toContain("Today's date: 2026-06-10.");
    expect(content).toContain("must fall after this date");
  });

  it("carries goal, intake summary, current plan ids, adherence, and the diff instruction", () => {
    const content = buildReplanMessages(baseArgs())[0]!.content as string;
    expect(content).toContain('"title": "Run a 10k"');
    expect(content).toContain('"one_sentence_goal"');
    // Current-plan ids are what modify/remove entries must reference.
    expect(content).toContain('"task-1"');
    expect(content).toContain('"ms-1"');
    expect(content).toContain('"eq-1"');
    expect(content).toContain('"expected": 4');
    expect(content).toContain('"actual": 1');
    expect(content).toContain("Generate the replan diff.");
  });

  it("renders the weekly check-in trigger payload (feeling + notes)", () => {
    const content = buildReplanMessages(baseArgs())[0]!.content as string;
    expect(content).toContain("weekly check-in");
    expect(content).toContain('"feeling": "too_hard"');
    expect(content).toContain('"notes": "busy"');
  });

  it("renders the structural-edit trigger payload (summary)", () => {
    const content = buildReplanMessages(
      baseArgs({
        trigger: {
          kind: "structural_edit",
          summary: "Target date moved 30 days later.",
        },
      }),
    )[0]!.content as string;
    expect(content).toContain("structural edit");
    expect(content).toContain('"summary": "Target date moved 30 days later."');
    expect(content).not.toContain('"feeling"');
  });

  it("calls out the effective intensity with its winning source", () => {
    const content = buildReplanMessages(
      baseArgs({ intensity: { intensity: "brutal", source: "override" } }),
    )[0]!.content as string;
    expect(content).toContain(
      "Effective intensity: brutal (source: goals.intensity_override).",
    );
  });

  it("states 'not set' when the whole chain resolved nothing", () => {
    const content = buildReplanMessages(
      baseArgs({ intensity: { intensity: null, source: "user" } }),
    )[0]!.content as string;
    expect(content).toContain("Effective intensity: not set");
  });

  it("REFUSES a 'skipped' triggering check-in (skips never reach the feeling signal)", () => {
    const args = baseArgs();
    // The type already forbids it; the runtime guard is the defensive seam.
    (args.trigger as { feeling: string }).feeling = "skipped";
    expect(() => buildReplanMessages(args)).toThrow(/skipped/i);
  });
});

// ---------------------------------------------------------------------------
// generateReplan — client orchestration, logging, the zod gate
// ---------------------------------------------------------------------------

const VALID_DIFF = {
  ...EMPTY_REPLAN_DIFF,
  recurring_tasks: {
    add: [],
    modify: [{ id: "task-1", changes: { estimated_duration_min: 45 } }],
    remove: [],
  },
};

describe("generateReplan", () => {
  it("throws ReplanUnavailableError when no client is configured", async () => {
    clientOrNull = null;
    await expect(generateReplan(baseArgs())).rejects.toBeInstanceOf(
      ReplanUnavailableError,
    );
    expect(parseMock).not.toHaveBeenCalled();
  });

  it("sends the cached system block, the built user message, and the structured-output format", async () => {
    parseMock.mockResolvedValue({
      parsed_output: VALID_DIFF,
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const diff = await generateReplan(baseArgs());
    expect(diff).toEqual(VALID_DIFF);

    expect(parseMock).toHaveBeenCalledTimes(1);
    const req = parseMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(req.model).toBe(MODEL_SONNET);
    expect(req.max_tokens).toBe(4096);
    const system = req.system as Array<Record<string, unknown>>;
    expect(system).toHaveLength(1);
    expect(system[0]!.text).toBe(REPLAN_SYSTEM_TEXT);
    expect(system[0]!.cache_control).toEqual({ type: "ephemeral" });
    const outputConfig = req.output_config as {
      format: { type: string };
    };
    expect(outputConfig.format.type).toBe("json_schema");
    expect((req.messages as unknown[]).length).toBe(1);
  });

  it("logs the winning intensity source and the replan usage record", async () => {
    parseMock.mockResolvedValue({
      parsed_output: VALID_DIFF,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 1500,
      },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await generateReplan(
        baseArgs({ intensity: { intensity: "brutal", source: "override" } }),
      );
      const lines = info.mock.calls.map((c) => String(c[0]));
      expect(lines).toContain(
        JSON.stringify({ event: "replan_intensity_source", source: "override" }),
      );
      const usageLine = lines.find((l) => l.includes('"ai_usage"'));
      expect(usageLine).toBeDefined();
      expect(JSON.parse(usageLine!)).toMatchObject({
        event: "ai_usage",
        op: "replan",
        model: MODEL_SONNET,
        cache_read_input_tokens: 1500,
      });
    } finally {
      info.mockRestore();
    }
  });

  it("throws ReplanValidationError carrying the RAW response when the zod gate fails", async () => {
    const malformed = {
      ...EMPTY_REPLAN_DIFF,
      recurring_tasks: {
        add: [
          {
            title: "Bad task",
            cadence: "weekly",
            weekday: 9, // out of 0–6
            estimated_duration_min: 0, // not positive
          },
        ],
        modify: [],
        remove: [],
      },
    };
    parseMock.mockResolvedValue({
      parsed_output: malformed,
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const err = await generateReplan(baseArgs()).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ReplanValidationError);
      const message = (err as Error).message;
      // The raw model output is IN the error message — logAiError puts it in
      // the server log; the client never sees it.
      expect(message).toContain("Raw response:");
      expect(message).toContain('"Bad task"');
      expect(message).toContain("weekday");
    } finally {
      info.mockRestore();
    }
  });
});
