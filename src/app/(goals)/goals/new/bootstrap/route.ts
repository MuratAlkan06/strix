/**
 * GET /goals/new/bootstrap — first-landing goal-draft creation (the legal
 * home for the insert + cookie write pair).
 *
 * Next.js forbids cookie writes during Server Component render, so the
 * /goals/new page cannot create the draft itself: it redirects here when no
 * draft resolves, this handler creates the goal_drafts row AND sets the
 * HttpOnly session-token cookie on the same redirect response, and the page
 * then resumes the fresh draft like any returning visit. Because both writes
 * live in one Route Handler — the cookie set on a response object cannot fail
 * once the insert succeeded, and a failed insert throws before any cookie is
 * issued — a draft row exists if and only if its cookie was issued (no
 * orphan rows).
 *
 * Idempotent: a valid existing cookie+row redirects straight back with no
 * insert, so repeat calls never mint extra rows. The redirect back carries
 * ?boot=1 so the page can detect a cookie that failed to stick (cookies
 * disabled) and render guidance instead of redirect-looping.
 *
 * Single-flight: one tile click via the Next client router fires TWO of
 * these requests concurrently, both missing the not-yet-set cookie — so the
 * mint itself is serialized on a per-user advisory transaction lock and the
 * loser reuses the winner's fresh row (same cookie token) instead of
 * inserting a duplicate. See ./single-flight.ts for the full contract.
 *
 * Seed: validated against the whitelist at the edge (proxy.ts covers this
 * path too) and re-derived from the trusted set here (defense in depth),
 * mirroring the page.
 */
import { auth } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import {
  DRAFT_COOKIE_NAME,
  DRAFT_COOKIE_MAX_AGE_SEC,
} from "@/lib/ai/session";
import { decideSeed } from "../seed-guard";
import { mintOrReuseDraft } from "./single-flight";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  // proxy.ts already 400'd any non-empty, non-whitelisted seed at the edge;
  // this re-derives the validated slug (or null) from the trusted set.
  const rawSeed = req.nextUrl.searchParams.get("seed") ?? undefined;
  const decision = decideSeed(rawSeed);
  if (!decision.ok) {
    return new NextResponse("Invalid seed.", { status: 400 });
  }
  const seed = decision.seed;

  // Built before the insert so nothing between the insert and the cookie
  // write can throw — the row-iff-cookie invariant rests on this ordering.
  const backUrl = new URL("/goals/new", req.url);
  if (seed) backUrl.searchParams.set("seed", seed);
  backUrl.searchParams.set("boot", "1");

  const sdb = scopedDb(userId);

  // Idempotency: an existing cookie that resolves to an owned row means the
  // draft is already bootstrapped — redirect back with zero writes.
  const existingToken = req.cookies.get(DRAFT_COOKIE_NAME)?.value;
  if (existingToken) {
    const rows = await sdb.selectFrom(goal_drafts, {
      where: eq(goal_drafts.session_token, existingToken),
    });
    if (rows[0]) {
      return NextResponse.redirect(backUrl, 303);
    }
    // Cookie present but no matching row (expired/swept) — mint a fresh
    // draft below; the new cookie overwrites the stale one.
  }

  // Serialized mint (advisory lock inside): concurrent first-landing
  // requests agree on ONE row and ONE token instead of double-inserting.
  const token = await mintOrReuseDraft(sdb, seed);

  const res = NextResponse.redirect(backUrl, 303);
  res.cookies.set(DRAFT_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: DRAFT_COOKIE_MAX_AGE_SEC,
    path: "/",
  });
  return res;
}
