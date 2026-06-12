/**
 * log tests (no DB, node env).
 *
 * logAiError is the server-side counterpart to the SSE error event: the raw
 * provider error string stays here, and the client only ever receives a
 * constant message (see src/app/api/ai/intake/route.ts). These tests pin the
 * structured shape and the op tag so the security posture is observable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { logAiError, logAiUsage, toUsageLog } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logAiUsage / toUsageLog", () => {
  it("emits one ai_usage JSON line whose shape includes duration_ms and stays PII-free", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    logAiUsage(
      toUsageLog(
        "plan",
        "claude-sonnet-4-6",
        {
          input_tokens: 12,
          output_tokens: 34,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 1500,
        },
        2317,
      ),
    );

    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0]?.[0] as string);
    // Exact shape: op/model/token counts/duration only — never transcript
    // content, user IDs, or goal text (the no-PII property).
    expect(parsed).toEqual({
      event: "ai_usage",
      op: "plan",
      model: "claude-sonnet-4-6",
      input_tokens: 12,
      output_tokens: 34,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 1500,
      duration_ms: 2317,
    });
  });

  it("clamps duration_ms to a non-negative integer and zero-fills missing usage", () => {
    expect(toUsageLog("intake", "claude-sonnet-4-6", null, 1234.6)).toEqual({
      op: "intake",
      model: "claude-sonnet-4-6",
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      duration_ms: 1235,
    });
    expect(
      toUsageLog("intake", "claude-sonnet-4-6", undefined, -5).duration_ms,
    ).toBe(0);
  });
});

describe("logAiError", () => {
  it("emits a single structured JSON line on console.error", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logAiError("intake", new Error("rate limit (request id: req_abc123)"));

    expect(spy).toHaveBeenCalledTimes(1);
    const line = spy.mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(line)).not.toThrow();
    const parsed = JSON.parse(line);
    expect(parsed).toEqual({
      event: "ai_error",
      op: "intake",
      name: "Error",
      message: "rate limit (request id: req_abc123)",
    });
  });

  it("falls back to UnknownError + stringified value for non-Error throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    logAiError("intake", "boom");

    const parsed = JSON.parse(spy.mock.calls[0]?.[0] as string);
    expect(parsed.name).toBe("UnknownError");
    expect(parsed.message).toBe("boom");
    expect(parsed.op).toBe("intake");
  });
});
