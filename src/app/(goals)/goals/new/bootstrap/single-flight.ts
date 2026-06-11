/**
 * single-flight.ts — serialized goal-draft minting for the bootstrap route.
 *
 * THE RACE: one tile click through the Next client router fires TWO
 * concurrent GET /goals/new/bootstrap requests (RSC redirect handling plus
 * browser navigation). Both miss the not-yet-set cookie, so a plain insert
 * path mints two goal_drafts rows ~100ms apart and orphans one (observed in
 * gate re-verification: 2 rows, 114ms apart). A select-then-insert check does
 * NOT fix this — both requests pass the check before either commits.
 *
 * THE FIX: real single-flight. mintOrReuseDraft runs inside
 * scopedDb().transaction and FIRST takes a per-user Postgres advisory
 * transaction lock (ScopedTx.lockScope — pg_advisory_xact_lock keyed on
 * namespace + userId). Concurrent requests serialize: the second waits for
 * the first's commit, then sees and REUSES the row the first minted instead
 * of inserting a duplicate. Both responses set the SAME cookie token, so
 * whichever lands last in the browser is consistent.
 *
 * Reuse is deliberately narrow — only a row that is plausibly "the other half
 * of this same click":
 *   - same seed (a null seed only matches a null seed),
 *   - unexpired,
 *   - created within the last 30 seconds,
 *   - zero activity (raw_transcript still its empty-array column default).
 * Anything else (expired, has chat activity, different seed, older) gets a
 * fresh row, exactly as before. Reload/resume and stale-cookie re-mint
 * behavior are unchanged — those paths resolve an EXISTING cookie in the
 * route and only reach this mint when no row resolves.
 */
import { gte } from "drizzle-orm";

import type { ScopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { draftExpiresAt, generateSessionToken } from "@/lib/ai/session";

/** Advisory-lock namespace for the bootstrap mint. A constant — never derived
 *  from input; the per-user dimension comes from lockScope itself. */
export const BOOTSTRAP_LOCK_NAMESPACE = "goal_drafts:bootstrap";

/** How recent a sibling row must be to count as "the same click". */
export const BOOTSTRAP_REUSE_WINDOW_MS = 30_000;

/** The row slice the reuse decision reads (subset of goal_drafts columns). */
export interface DraftCandidate {
  session_token: string;
  seed: string | null;
  raw_transcript: unknown;
  expires_at: Date;
  created_at: Date;
}

/** True when the draft's transcript is still the empty-array column default —
 *  i.e. no chat turn or safety event has touched the draft. */
function hasNoActivity(rawTranscript: unknown): boolean {
  return Array.isArray(rawTranscript) && rawTranscript.length === 0;
}

/**
 * Pure reuse decision: among `rows` (the scoped user's own recent drafts),
 * the most recent one that is same-seed, unexpired, inside the reuse window,
 * and untouched — or null when a fresh insert is warranted. Pure so the
 * matrix (expired / activity / different seed / multiple candidates) is
 * unit-testable with no DB.
 */
export function pickReusableDraft<T extends DraftCandidate>(
  rows: readonly T[],
  seed: string | null,
  now: Date = new Date(),
): T | null {
  const cutoff = now.getTime() - BOOTSTRAP_REUSE_WINDOW_MS;
  const eligible = rows.filter(
    (row) =>
      (row.seed ?? null) === seed &&
      row.expires_at.getTime() > now.getTime() &&
      row.created_at.getTime() >= cutoff &&
      hasNoActivity(row.raw_transcript),
  );
  if (eligible.length === 0) return null;
  return eligible.reduce((latest, row) =>
    row.created_at.getTime() > latest.created_at.getTime() ? row : latest,
  );
}

/**
 * Mint a fresh draft for the scoped user — or reuse the one a concurrent
 * sibling request just minted — and return its session token (the caller
 * writes it to the cookie). Serialized per user on an advisory transaction
 * lock; see the module header for why select-then-insert is not enough.
 *
 * Row-iff-cookie invariant preserved: a failed insert rolls the transaction
 * back and throws before the caller issues any cookie; a reused row's token
 * was already issued by the sibling that created it and is re-issued (same
 * value) here.
 */
export async function mintOrReuseDraft(
  sdb: ScopedDb,
  seed: string | null,
): Promise<string> {
  return sdb.transaction(async (tx) => {
    // Serialize before reading: a concurrent sibling holding the lock commits
    // its insert before our select runs, so we see (and reuse) its row.
    await tx.lockScope(BOOTSTRAP_LOCK_NAMESPACE);

    const now = new Date();
    const recent = await tx.selectFrom(goal_drafts, {
      where: gte(
        goal_drafts.created_at,
        new Date(now.getTime() - BOOTSTRAP_REUSE_WINDOW_MS),
      ),
    });
    const reusable = pickReusableDraft(recent, seed, now);
    if (reusable) return reusable.session_token;

    const token = generateSessionToken();
    await tx.insert(goal_drafts, {
      user_id: sdb.userId,
      session_token: token,
      seed,
      expires_at: draftExpiresAt(now),
    });
    return token;
  });
}
