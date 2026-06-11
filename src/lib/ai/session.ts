/**
 * session.ts — goal-draft session-token generation + the cookie contract
 * (ADR-0001; phase-1 doc "Goal intake conversational chat").
 *
 * A draft is keyed by a random opaque token written to an HttpOnly cookie; the
 * token (not the draft id) is the lookup credential, so a leaked draft id is
 * inert without the cookie. 32 random bytes encoded base64url gives a 43-char
 * URL-safe token with ~256 bits of entropy.
 */
import { randomBytes } from "node:crypto";

/** Cookie name carrying the draft session token. */
export const DRAFT_COOKIE_NAME = "strix_goal_draft" as const;

/** Draft lifetime — 30 days (Inngest sweep prunes expired rows). */
export const DRAFT_TTL_DAYS = 30;
const DRAFT_TTL_MS = DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;
export const DRAFT_COOKIE_MAX_AGE_SEC = DRAFT_TTL_DAYS * 24 * 60 * 60;

/** Generate a ~32-byte base64url session token (43 chars, URL-safe charset). */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The expiry timestamp for a freshly created draft (now + 30d). */
export function draftExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + DRAFT_TTL_MS);
}
