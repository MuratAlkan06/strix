/**
 * draft.ts — server-side goal-draft lookup for /goals/new.
 *
 * READ-ONLY by design: a Server Component render may read cookies but never
 * set them (Next.js allows cookie writes only in Server Actions and Route
 * Handlers — a render-time cookies().set() throws and 500s the page). First-
 * landing draft CREATION therefore lives in the bootstrap Route Handler
 * (./bootstrap/route.ts), where the goal_drafts insert and the HttpOnly
 * cookie write happen together in a legal context. The page calls findDraft()
 * and redirects to the bootstrap when nothing resolves; a returning visit
 * resolves the existing draft from the cookie and the transcript resumes.
 * All intake state stays staged in goal_drafts (no goal row exists until
 * "Save goal" in a later slice).
 *
 * Only ever imported by server code (it reads cookies and touches the scoped
 * DB) — every API it uses is server-only, so it cannot leak into a client
 * bundle.
 */
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
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
 * Resolve the draft for the current request from the session-token cookie, or
 * null when there is no cookie or no matching row (first landing, or an
 * expired/swept draft) — the page then redirects to the bootstrap Route
 * Handler, which owns creation. No writes happen here.
 *
 * @param userId  Clerk userId (from auth()).
 */
export async function findDraft(userId: string): Promise<ResolvedDraft | null> {
  const sdb = scopedDb(userId);
  const jar = await cookies();
  const token = jar.get(DRAFT_COOKIE_NAME)?.value;
  if (!token) return null;

  const rows = await sdb.selectFrom(goal_drafts, {
    where: eq(goal_drafts.session_token, token),
  });
  const existing = rows[0];
  if (!existing) return null;

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
