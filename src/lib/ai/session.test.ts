/**
 * session-token tests (no DB, node env).
 *
 * The token is the cookie-mapped lookup credential for a goal draft. It must be
 * URL-safe (base64url), of the right length (32 bytes → 43 chars), and unique
 * across calls (it carries the draft's security).
 */
import { describe, expect, it } from "vitest";
import {
  draftExpiresAt,
  DRAFT_COOKIE_MAX_AGE_SEC,
  DRAFT_TTL_DAYS,
  generateSessionToken,
} from "./session";

const BASE64URL = /^[A-Za-z0-9_-]+$/;

describe("generateSessionToken", () => {
  it("produces a base64url string of 43 chars (32 bytes, unpadded)", () => {
    const token = generateSessionToken();
    expect(token).toMatch(BASE64URL);
    expect(token).not.toContain("="); // base64url is unpadded
    expect(token.length).toBe(43);
  });

  it("is unique across many calls", () => {
    const n = 1000;
    const set = new Set<string>();
    for (let i = 0; i < n; i++) set.add(generateSessionToken());
    expect(set.size).toBe(n);
  });
});

describe("draft TTL", () => {
  it("expires 30 days out", () => {
    expect(DRAFT_TTL_DAYS).toBe(30);
    const now = new Date("2026-06-10T00:00:00.000Z");
    const exp = draftExpiresAt(now);
    expect(exp.toISOString()).toBe("2026-07-10T00:00:00.000Z");
  });

  it("cookie max-age matches the 30-day TTL in seconds", () => {
    expect(DRAFT_COOKIE_MAX_AGE_SEC).toBe(30 * 24 * 60 * 60);
  });
});
