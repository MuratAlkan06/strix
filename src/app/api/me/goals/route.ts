/**
 * GET /api/me/goals — the scoped-access round-trip surface from the Phase 0
 * verification list: a signed-in user gets exactly their own goals (an empty
 * array pre-Phase-1). Also the seed of Phase 1's goals-list endpoint.
 *
 * userId comes exclusively from Clerk's auth() — never from params or body
 * (enforced repo-wide by the Layer 3 call-shape check).
 */
import { auth } from "@clerk/nextjs/server";
import { scopedDb } from "@/db/scoped";
import { goals } from "@/db/schema";

export async function GET(): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }
  const rows = await scopedDb(userId).selectFrom(goals);
  return Response.json(rows);
}
