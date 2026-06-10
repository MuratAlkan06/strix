/**
 * Clerk webhook receiver.
 *
 * Signature is verified with `svix` against CLERK_WEBHOOK_SECRET before any
 * DB write — unsigned/invalid requests return 400.
 *
 * Handled events:
 *   - user.created   → insert users row (tier=free, intensity_preference=NULL)
 *   - user.updated   → sync email + display_name (no tier mutation)
 *
 * NOT handled:
 *   - user.deleted   → account deletion is a Phase 4 in-app flow, not a Clerk
 *                      dashboard action. Ignoring it here is intentional.
 */
import { and, eq, isNull } from "drizzle-orm";
import { Webhook } from "svix";
import { unscopedDb } from "@/db/unscoped";
import { users } from "@/db/schema";
import { capture, identify } from "@/lib/analytics/server";

interface EmailAddress {
  id: string;
  email_address: string;
}

interface ClerkUser {
  id: string;
  email_addresses?: EmailAddress[];
  primary_email_address_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  external_accounts?: Array<{ provider?: string }>;
}

/** PostHog `signup { method }` — "google" / "apple" for OAuth accounts,
 *  "email" for magic-link signups. */
function signupMethod(u: ClerkUser): string {
  const provider = u.external_accounts?.[0]?.provider;
  return provider ? provider.replace(/^oauth_/, "") : "email";
}

type ClerkEvent =
  | { type: "user.created"; data: ClerkUser }
  | { type: "user.updated"; data: ClerkUser }
  | { type: string; data: unknown };

function primaryEmail(u: ClerkUser): string | null {
  const list = u.email_addresses ?? [];
  if (list.length === 0) return null;
  const primary = u.primary_email_address_id
    ? list.find((e) => e.id === u.primary_email_address_id)
    : undefined;
  return (primary ?? list[0])?.email_address ?? null;
}

function displayName(u: ClerkUser): string | null {
  const parts = [u.first_name, u.last_name].filter(
    (p): p is string => typeof p === "string" && p.length > 0,
  );
  if (parts.length > 0) return parts.join(" ");
  return u.username ?? null;
}

export async function POST(req: Request): Promise<Response> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  const svixId = req.headers.get("svix-id");
  const svixTimestamp = req.headers.get("svix-timestamp");
  const svixSignature = req.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    console.warn("[clerk-webhook] missing svix headers");
    return new Response("Missing svix headers", { status: 400 });
  }

  const body = await req.text();

  let event: ClerkEvent;
  try {
    const wh = new Webhook(secret);
    event = wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as ClerkEvent;
  } catch (err) {
    console.warn(
      "[clerk-webhook] signature verification failed:",
      err instanceof Error ? err.message : err,
    );
    return new Response("Invalid signature", { status: 400 });
  }

  // Derive timezone from request header if Clerk forwards it; else UTC.
  const timezone = req.headers.get("x-vercel-ip-timezone") ?? "UTC";

  try {
    if (event.type === "user.created") {
      const u = event.data as ClerkUser;
      const email = primaryEmail(u);
      if (!email) {
        console.warn("[clerk-webhook] user.created has no email", u.id);
        return new Response("OK", { status: 200 });
      }
      const inserted = await unscopedDb
        .insert(users)
        .values({
          id: u.id,
          email,
          display_name: displayName(u),
          timezone,
          // intensity_preference intentionally NULL — set at first intake.
          tier: "free",
        })
        .onConflictDoNothing({ target: users.id })
        .returning({ id: users.id });
      // Fire signup analytics only when the row was actually created —
      // webhook replays (conflict → no row) must not double-count signups.
      // Analytics failures never fail the webhook; the row insert is the
      // contract, the event is best-effort.
      if (inserted.length > 0) {
        try {
          await identify(u.id, { email });
          await capture(u.id, "signup", { method: signupMethod(u) });
        } catch (err) {
          console.warn("[clerk-webhook] signup analytics failed:", err);
        }
      }
      return new Response("OK", { status: 200 });
    }

    if (event.type === "user.updated") {
      const u = event.data as ClerkUser;
      const email = primaryEmail(u);
      const name = displayName(u);
      // Soft-deleted users get no profile sync during the 30-day grace
      // window — webhook side-effects are suppressed for them; recovery
      // re-syncs state. (unscopedDb has no soft-delete filter, so the
      // guard lives in the WHERE clause.)
      await unscopedDb
        .update(users)
        .set({
          ...(email ? { email } : {}),
          display_name: name,
          updated_at: new Date(),
        })
        .where(and(eq(users.id, u.id), isNull(users.deleted_at)));
      return new Response("OK", { status: 200 });
    }

    // Other event types acknowledged but ignored.
    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("[clerk-webhook] processing error:", err);
    return new Response("Processing error", { status: 500 });
  }
}
