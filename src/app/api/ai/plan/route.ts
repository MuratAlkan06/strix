/**
 * POST /api/ai/plan — non-streaming plan generation (phase-1-golden-path
 * "Plan generation"; ADR-0001).
 *
 * Flow:
 *   1. Clerk auth → userId (never from body/params).
 *   2. Load the draft via the HttpOnly session-token cookie + scopedDb
 *      ownership (a forged/foreign token loads zero rows and 404s). An
 *      optional body goal_draft_id is cross-checked against the cookie's
 *      draft, never used as the lookup credential.
 *   3. Guard: the draft must carry a completed intake — an
 *      intake_summary_draft with a confirmed_intensity (the user's explicit
 *      pick). Anything less rejects with zero writes.
 *   4. generatePlan() — one cached-prefix Sonnet call, structured output,
 *      zod-validated (src/lib/ai/plan.ts).
 *   5. Write the validated plan to goal_drafts.plan_draft via scopedDb;
 *      capture plan_generated.
 *
 * Deliberately NON-streaming (phase doc): streaming the JSON would complicate
 * the review UI and the latency is acceptable. A repeat call regenerates and
 * overwrites plan_draft (draft-stage, pre-save — nothing saved silently); a
 * concurrent call for the same draft is rejected with 409 via a best-effort
 * per-instance in-flight guard so a double-submit doesn't double-charge.
 *
 * All AI access goes through src/lib/ai/* — never @anthropic-ai/sdk directly.
 */
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
import {
  generatePlan,
  PlanUnavailableError,
} from "@/lib/ai/plan";
import { INTENSITY_LEVELS } from "@/lib/ai/intake-schema";
import { logAiError } from "@/lib/ai/log";
import { capture } from "@/lib/analytics/server";

export const dynamic = "force-dynamic";

/** Best-effort double-charge guard: draft ids with a generation in flight on
 *  THIS instance. Serverless siblings each keep their own set — acceptable;
 *  the client auto-kicks once and the worst case is one redundant call. */
const inFlight = new Set<string>();

interface PlanBody {
  goal_draft_id?: unknown;
}

/** Completed intake = a summary object whose confirmed_intensity is one of the
 *  intensity enum values (the explicit pick staged by the confirm action). */
function hasConfirmedIntake(
  summary: unknown,
): summary is Record<string, unknown> {
  if (typeof summary !== "object" || summary === null) return false;
  const confirmed = (summary as Record<string, unknown>).confirmed_intensity;
  return (
    typeof confirmed === "string" &&
    (INTENSITY_LEVELS as readonly string[]).includes(confirmed)
  );
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = (await cookies()).get(DRAFT_COOKIE_NAME)?.value;
  if (!token) {
    return new Response("No active goal draft.", { status: 400 });
  }

  // The body is optional (the UI auto-kick sends none); when a goal_draft_id
  // is supplied it must agree with the cookie-resolved draft below.
  let body: PlanBody = {};
  try {
    body = (await req.json()) as PlanBody;
  } catch {
    body = {};
  }

  const sdb = scopedDb(userId);

  // Load + own the draft via the session token (scopedDb adds user-is-live +
  // user_id ownership; the token narrows to the one row).
  const rows = await sdb.selectFrom(goal_drafts, {
    where: eq(goal_drafts.session_token, token),
  });
  const draft = rows[0];
  if (!draft) {
    return new Response("Goal draft not found.", { status: 404 });
  }
  if (
    typeof body.goal_draft_id === "string" &&
    body.goal_draft_id !== draft.id
  ) {
    return new Response("Goal draft not found.", { status: 404 });
  }

  // Guard before spending a model call: intake must be complete AND the
  // intensity explicitly confirmed (spec §8 — the AI suggests, the user
  // chooses; the plan is calibrated to the user's pick, never the suggestion).
  if (!hasConfirmedIntake(draft.intake_summary_draft)) {
    return new Response("Intake is not complete.", { status: 409 });
  }

  if (inFlight.has(draft.id)) {
    return new Response("Plan generation is already running.", {
      status: 409,
    });
  }
  inFlight.add(draft.id);

  try {
    const plan = await generatePlan({
      intakeSummary: draft.intake_summary_draft,
    });

    // Overwrite-on-regenerate is intentional: plan_draft is draft-stage state
    // ("nothing saves silently" — no goal rows exist until Save in Slice 7).
    await sdb.update(goal_drafts, {
      set: { plan_draft: plan },
      where: eq(goal_drafts.id, draft.id),
    });

    await capture(userId, "plan_generated", { goal_draft_id: draft.id });

    return Response.json({ plan });
  } catch (err) {
    if (err instanceof PlanUnavailableError) {
      return new Response("AI service unavailable.", { status: 503 });
    }
    // Keep the raw provider/validation error (rate-limit notes, zod issues)
    // on the server; the client only ever sees a constant message.
    logAiError("plan", err);
    return new Response("Plan generation failed.", { status: 502 });
  } finally {
    inFlight.delete(draft.id);
  }
}
