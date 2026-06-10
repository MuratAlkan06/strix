/**
 * log tests (no DB, node env).
 *
 * logAiError is the server-side counterpart to the SSE error event: the raw
 * provider error string stays here, and the client only ever receives a
 * constant message (see src/app/api/ai/intake/route.ts). These tests pin the
 * structured shape and the op tag so the security posture is observable.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { logAiError } from "./log";

afterEach(() => {
  vi.restoreAllMocks();
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
