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
 * 409/502/503/504 — see src/app/api/ai/replan/route.ts); those lines surface
 * verbatim. Transport failures collapse into one calm fallback. Repeating
 * the POST while the proposal is pending regenerates — retry is always safe
 * here.
 *
 * Cap hit (402): the JSON cap_hit body is parsed into `capHit` so the caller
 * can open the upgrade modal instead of the generic error surface. The client
 * free_tier_cap_hit event fires HERE, at the cap boundary, so every replan
 * caller reports it once without duplicating the capture. `capHit` is an
 * optional field on the existing failure shape — no consumer that only reads
 * `.error` breaks.
 */
import { capture } from "@/lib/analytics/client";

export const GENERATE_FALLBACK_ERROR =
  "Generation didn't finish. Try once more.";

export const GENERATE_CAP_ERROR =
  "You've used all your replans this month.";

export interface GenerateCapHit {
  cap: number;
  used: number;
  kind: "replans";
}

export type GenerateOutcome =
  | { ok: true }
  | { ok: false; error: string; capHit?: GenerateCapHit };

export async function requestReplanGeneration(input: {
  goalId: string;
  weeklyCheckInId: string;
}): Promise<GenerateOutcome> {
  return postReplanGeneration(input.goalId, {
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
  return postReplanGeneration(input.goalId, {
    goal_id: input.goalId,
    trigger: "structural_edit",
    structural_change: { summary: input.summary },
  });
}

async function postReplanGeneration(
  goalId: string,
  body: Record<string, unknown>,
): Promise<GenerateOutcome> {
  try {
    const res = await fetch("/api/ai/replan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    // Cap hit — parse the JSON body and report it once for the upgrade modal.
    if (res.status === 402) {
      let capHit: GenerateCapHit = { cap: 2, used: 2, kind: "replans" };
      try {
        const parsed = (await res.json()) as Partial<GenerateCapHit>;
        capHit = {
          cap: typeof parsed.cap === "number" ? parsed.cap : 2,
          used: typeof parsed.used === "number" ? parsed.used : 2,
          kind: "replans",
        };
      } catch {
        /* keep the default capHit */
      }
      capture("free_tier_cap_hit", { cap: "replans", goal_id: goalId });
      return { ok: false, error: GENERATE_CAP_ERROR, capHit };
    }
    const text = (await res.text()).trim();
    return { ok: false, error: text || GENERATE_FALLBACK_ERROR };
  } catch {
    return { ok: false, error: GENERATE_FALLBACK_ERROR };
  }
}
