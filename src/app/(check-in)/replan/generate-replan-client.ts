/**
 * generate-replan-client.ts — the one client-side caller of
 * POST /api/ai/replan for the weekly trigger, shared by the replan diff
 * page's Generate action and the check-in confirmation's per-goal fan-out
 * (phase-2-close-the-loop "Replan flow" / "Replan diff UI").
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
  try {
    const res = await fetch("/api/ai/replan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        goal_id: input.goalId,
        trigger: "weekly_check_in",
        weekly_check_in_id: input.weeklyCheckInId,
      }),
    });
    if (res.ok) return { ok: true };
    const text = (await res.text()).trim();
    return { ok: false, error: text || GENERATE_FALLBACK_ERROR };
  } catch {
    return { ok: false, error: GENERATE_FALLBACK_ERROR };
  }
}
