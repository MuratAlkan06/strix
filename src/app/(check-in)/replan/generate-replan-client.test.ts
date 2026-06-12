/**
 * generate-replan-client tests — the POST /api/ai/replan callers against a
 * mocked fetch (no server): the slice-2 frozen body shapes for BOTH triggers,
 * the endpoint's constant failure lines surfacing verbatim (502/503), and
 * transport failures collapsing into the one calm fallback. The banner's
 * success path (ok → client route to /replan/<goalId>) hangs off the
 * { ok: true } outcome pinned here; goal-detail owns the one-line router.push.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GENERATE_FALLBACK_ERROR,
  requestReplanGeneration,
  requestStructuralReplanGeneration,
} from "./generate-replan-client";

function mockFetch(response: Response | Error) {
  const fn = vi.fn(() =>
    response instanceof Error
      ? Promise.reject(response)
      : Promise.resolve(response),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestStructuralReplanGeneration — the slice-4 banner caller", () => {
  it("POSTs the frozen structural_edit shape and returns ok on 200", async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ ok: true, proposal_id: "p-1" }), {
        status: 200,
      }),
    );

    const outcome = await requestStructuralReplanGeneration({
      goalId: "g-1",
      summary: 'Removed weekly session "Long run".',
    });

    expect(outcome).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/ai/replan");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({
      goal_id: "g-1",
      trigger: "structural_edit",
      structural_change: { summary: 'Removed weekly session "Long run".' },
    });
  });

  it("502 → the endpoint's constant line verbatim (retry-able error)", async () => {
    mockFetch(new Response("Replan generation failed.", { status: 502 }));
    expect(
      await requestStructuralReplanGeneration({ goalId: "g-1", summary: "x" }),
    ).toEqual({ ok: false, error: "Replan generation failed." });
  });

  it("503 → the endpoint's constant line verbatim", async () => {
    mockFetch(new Response("AI service unavailable.", { status: 503 }));
    expect(
      await requestStructuralReplanGeneration({ goalId: "g-1", summary: "x" }),
    ).toEqual({ ok: false, error: "AI service unavailable." });
  });

  it("a failure with an empty body still reads calmly (fallback line)", async () => {
    mockFetch(new Response("", { status: 500 }));
    expect(
      await requestStructuralReplanGeneration({ goalId: "g-1", summary: "x" }),
    ).toEqual({ ok: false, error: GENERATE_FALLBACK_ERROR });
  });

  it("a transport failure collapses into the calm fallback, never a throw", async () => {
    mockFetch(new TypeError("fetch failed"));
    expect(
      await requestStructuralReplanGeneration({ goalId: "g-1", summary: "x" }),
    ).toEqual({ ok: false, error: GENERATE_FALLBACK_ERROR });
  });
});

describe("requestReplanGeneration — the weekly caller's frozen shape holds", () => {
  it("POSTs trigger=weekly_check_in with the parent check-in id", async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify({ ok: true, proposal_id: "p-2" }), {
        status: 200,
      }),
    );

    const outcome = await requestReplanGeneration({
      goalId: "g-1",
      weeklyCheckInId: "wci-1",
    });

    expect(outcome).toEqual({ ok: true });
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string)).toEqual({
      goal_id: "g-1",
      trigger: "weekly_check_in",
      weekly_check_in_id: "wci-1",
    });
  });
});
