/**
 * generate-replan-client.ts — the client-side callers of POST /api/ai/replan,
 * one per trigger (phase-2-close-the-loop "Replan flow" / "Replan diff UI" /
 * "Structural-edit replan banner"):
 *   - requestReplanGeneration (weekly_check_in): the replan diff page's
 *     Generate action and the check-in confirmation's per-goal fan-out.
 *   - requestStructuralReplanGeneration (structural_edit): the goal-detail
 *     banner's click action (slice 4) — no parent check-in; the session's
 *     structural-change summary rides instead.
 *
 * The endpoint replies with constant text lines on failure (401/400/404/
 * 409/502/503 — see src/app/api/ai/replan/route.ts); those lines surface
 * verbatim. Transport failures collapse into one calm fallback. Repeating
 * the POST while the proposal is pending regenerates — retry is always safe
 * here.
 */
export const GENERATE_FALLBACK_ERROR =
  "Generation didn't finish. Try once more.";

export type GenerateOutcome = { ok: true } | { ok: false; error: string };

export async function requestReplanGeneration(input: {
  goalId: string;
  weeklyCheckInId: string;
}): Promise<GenerateOutcome> {
  return postReplanGeneration({
    goal_id: input.goalId,
    trigger: "weekly_check_in",
    weekly_check_in_id: input.weeklyCheckInId,
  });
}

/** The structural sibling: goal-detail banner click → one structural_edit
 *  generation (slice-2 frozen shape: structural_change.summary, 1..500). */
export async function requestStructuralReplanGeneration(input: {
  goalId: string;
  summary: string;
}): Promise<GenerateOutcome> {
  return postReplanGeneration({
    goal_id: input.goalId,
    trigger: "structural_edit",
    structural_change: { summary: input.summary },
  });
}

async function postReplanGeneration(
  body: Record<string, unknown>,
): Promise<GenerateOutcome> {
  try {
    const res = await fetch("/api/ai/replan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const text = (await res.text()).trim();
    return { ok: false, error: text || GENERATE_FALLBACK_ERROR };
  } catch {
    return { ok: false, error: GENERATE_FALLBACK_ERROR };
  }
}
