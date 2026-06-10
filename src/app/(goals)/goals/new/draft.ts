/**
 * draft.ts — server-side goal-draft bootstrap for /goals/new.
 *
 * On first landing (no valid draft cookie) a fresh goal_drafts row is created
 * keyed by a random session_token, and the token is written to an HttpOnly
 * cookie. On a returning visit the cookie resolves the existing draft and the
 * transcript resumes. This keeps all intake state staged in goal_drafts (no
 * goal row exists until "Save goal" in a later slice).
 *
 * It is only ever imported by the server page (it reads cookies and touches the
 * scoped DB) — every API it uses is server-only, so it cannot leak into a client
 * bundle.
 */
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import {
  DRAFT_COOKIE_NAME,
  DRAFT_COOKIE_MAX_AGE_SEC,
  draftExpiresAt,
  generateSessionToken,
} from "@/lib/ai/session";
import { asTranscript, type TranscriptTurn } from "@/lib/ai/transcript";
import {
  asEventLog,
  pendingFlag,
  toFlagPayload,
  type SafetyFlagPayload,
} from "@/lib/ai/safety-flags";
import {
  asIntakeSummaryDraft,
  type IntakeSummaryDraft,
} from "./intensity-confirm";

export interface ResolvedDraft {
  id: string;
  seed: string | null;
  transcript: TranscriptTurn[];
  /** True when intake has already produced a summary (completion handoff). */
  completed: boolean;
  /**
   * The card-relevant slice of intake_summary_draft (suggestion + reasoning +
   * the user's pick once confirmed), or null while intake is still in progress.
   * Drives the page's chat / confirm / interim surface routing.
   */
  summary: IntakeSummaryDraft | null;
  /**
   * An undecided safety flag staged in the draft's event log, or null. On a
   * resume mid-decision the chat re-renders the decision card from this and
   * holds the composer until the user decides (server-derived, like the
   * surface routing).
   */
  pendingSafetyFlag: SafetyFlagPayload | null;
  /**
   * True when goal_drafts.plan_draft is populated — the interim surface then
   * resumes at "Your plan is ready." instead of re-kicking generation
   * (server-derived, resumable like the rest of the draft state).
   */
  planReady: boolean;
}

/**
 * Resolve the draft for the current request: load the existing one from the
 * cookie, or create a fresh row (and set the cookie) on first landing.
 *
 * @param userId  Clerk userId (from auth()).
 * @param seed    Validated whitelisted seed (or null) — only applied on create.
 */
export async function resolveDraft(
  userId: string,
  seed: string | null,
): Promise<ResolvedDraft> {
  const sdb = scopedDb(userId);
  const jar = await cookies();
  const token = jar.get(DRAFT_COOKIE_NAME)?.value;

  if (token) {
    const rows = await sdb.selectFrom(goal_drafts, {
      where: eq(goal_drafts.session_token, token),
    });
    const existing = rows[0];
    if (existing) {
      const log = asEventLog(existing.raw_transcript);
      const pending = pendingFlag(log);
      return {
        id: existing.id,
        seed: existing.seed,
        transcript: asTranscript(existing.raw_transcript),
        completed: existing.intake_summary_draft != null,
        summary: asIntakeSummaryDraft(existing.intake_summary_draft),
        pendingSafetyFlag: pending ? toFlagPayload(pending) : null,
        planReady: existing.plan_draft != null,
      };
    }
    // Cookie present but no matching row (expired/swept) — fall through to
    // create a fresh draft below.
  }

  const newToken = generateSessionToken();
  const inserted = await sdb.insert(goal_drafts, {
    user_id: userId,
    session_token: newToken,
    seed,
    expires_at: draftExpiresAt(),
  });
  const row = inserted[0]!;

  jar.set(DRAFT_COOKIE_NAME, newToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DRAFT_COOKIE_MAX_AGE_SEC,
    path: "/",
  });

  return {
    id: row.id,
    seed: row.seed,
    transcript: [],
    completed: false,
    summary: null,
    pendingSafetyFlag: null,
    planReady: false,
  };
}
