/**
 * confirm-intensity.ts — the server action behind the intensity confirmation
 * card (phase-1-golden-path "Intensity confirmation step").
 *
 * On confirm it does two writes, both scoped to the live authenticated user:
 *   1. Stages `suggested_intensity` + `confirmed_intensity` back into
 *      goal_drafts.intake_summary_draft. intake_summaries rows are NOT created
 *      here — they materialise at "Save goal" in a later slice (the schema's
 *      nullable-goal_id, "nothing saves silently" design).
 *   2. Updates users.intensity_preference to the user's pick. That column is
 *      the final fallback in the intensity chain and the Settings default; it
 *      does NOT anchor future confirmation cards (each card pre-selects the
 *      AI's suggestion for that goal).
 *
 * The draft is resolved from the HttpOnly session-token cookie (never from
 * client input) and re-owned through the scoped DB, so a forged or foreign
 * token mutates zero rows.
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
import {
  asIntakeSummaryDraft,
  buildConfirmPayload,
  isIntensity,
  type Intensity,
} from "./intensity-confirm";

export interface ConfirmIntensityResult {
  ok: boolean;
  /** Set when ok is false — a plain, in-register line the card can surface. */
  error?: string;
}

/**
 * Persist the user's intensity pick for the active goal draft.
 *
 * @param confirmed The intensity the user explicitly chose (may differ from the
 *                  AI's suggestion).
 */
export async function confirmIntensity(
  confirmed: Intensity,
): Promise<ConfirmIntensityResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "Your session expired. Sign in to continue." };
  }
  if (!isIntensity(confirmed)) {
    return { ok: false, error: "Pick an intensity to continue." };
  }

  const token = (await cookies()).get(DRAFT_COOKIE_NAME)?.value;
  if (!token) {
    return { ok: false, error: "We couldn't find your goal draft." };
  }

  const sdb = scopedDb(userId);

  const rows = await sdb.selectFrom(goal_drafts, {
    where: eq(goal_drafts.session_token, token),
  });
  const draft = rows[0];
  if (!draft) {
    return { ok: false, error: "We couldn't find your goal draft." };
  }

  const summary = asIntakeSummaryDraft(draft.intake_summary_draft);
  if (!summary) {
    // No completed-intake summary to confirm against — the card should not have
    // rendered. Treat as a stale submission rather than writing a partial row.
    return { ok: false, error: "Intake isn't finished yet." };
  }

  const payload = buildConfirmPayload(summary.suggested_intensity, confirmed);

  // Stage the pick back into the same draft jsonb, preserving every other
  // intake field already captured.
  const staged = {
    ...(draft.intake_summary_draft as Record<string, unknown>),
    suggested_intensity: payload.suggested_intensity,
    confirmed_intensity: payload.confirmed_intensity,
  };

  await sdb.update(goal_drafts, {
    set: { intake_summary_draft: staged },
    where: eq(goal_drafts.id, draft.id),
  });

  // Final fallback in the intensity chain + the Settings default. Writing the
  // user's pick here does not re-anchor any future goal's confirmation card.
  await sdb.updateSelf({ intensity_preference: confirmed });

  return { ok: true };
}
