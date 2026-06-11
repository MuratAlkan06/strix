/**
 * decide-safety.ts — the server action behind the safety-override decision
 * card (phase-1-golden-path "Safety-override flow"; SPEC §7A: the user is the
 * decider).
 *
 * On decide it does ONE write, scoped to the live authenticated user: the
 * pending (last undecided) staged flag in goal_drafts.raw_transcript gets
 * user_overrode + decided_at = now(), and a kind:"decision" user-role turn is
 * appended so the model continues the intake with the chosen direction as
 * the working goal. The decision is merged into the final summary's
 * safety_flags when the model terminates via submit_intake (route-side).
 *
 * The draft is resolved from the HttpOnly session-token cookie (never from
 * client input) and re-owned through the scoped DB, so a forged or foreign
 * token mutates zero rows. No pending flag → stale submission → no write.
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
import {
  asEventLog,
  decideFlag,
  decisionTurn,
  type IntakeEvent,
} from "@/lib/ai/safety-flags";

export interface DecideSafetyResult {
  ok: boolean;
  /** Set when ok is false — a plain, in-register line the card can surface. */
  error?: string;
}

/**
 * Persist the user's safety decision for the active goal draft.
 *
 * @param userOverrode false = "Use the safer plan", true = "Proceed with the
 *                     original plan". Both are explicit, neither destructive.
 */
export async function decideSafety(
  userOverrode: boolean,
): Promise<DecideSafetyResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "Your session expired. Sign in to continue." };
  }
  if (typeof userOverrode !== "boolean") {
    return { ok: false, error: "Pick one of the two directions to continue." };
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

  const log = asEventLog(draft.raw_transcript);
  const decided = decideFlag(log, userOverrode, new Date().toISOString());
  if (!decided) {
    // No undecided flag on record — the card should not have rendered. Treat
    // as a stale submission rather than inventing a flag to decide.
    return { ok: false, error: "There's no decision waiting here." };
  }

  // One write: the decided flag in place + the decision conveyed back into
  // the conversation as a user-role turn the model reads on the next call.
  const withDecision: IntakeEvent[] = [
    ...decided.log,
    decisionTurn(decided.flag, userOverrode),
  ];

  await sdb.update(goal_drafts, {
    set: { raw_transcript: withDecision },
    where: eq(goal_drafts.id, draft.id),
  });

  return { ok: true };
}
