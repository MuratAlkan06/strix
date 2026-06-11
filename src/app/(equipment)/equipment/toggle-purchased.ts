/**
 * toggle-purchased.ts — the batch's only write: flip equipment.purchased_at
 * (now() / null) on a row the requesting user owns (phase-1-golden-path
 * "Equipment aggregated view" purchased checkbox).
 *
 * Guards, all zero-write:
 *   - No Clerk session → reject before any DB access.
 *   - Malformed equipment id → reject before any DB access (also avoids a
 *     Postgres uuid-cast exception standing in for validation).
 *   - Ownership/soft-delete: the update goes through scopedDb, whose
 *     transitive scope filter (equipment → parent goal → live user) means a
 *     forged or foreign id matches ZERO rows — we detect the empty result and
 *     report it; nothing was written.
 *
 * The client toggles optimistically and reverts on { ok: false }.
 */
"use server";

import { auth } from "@clerk/nextjs/server";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { scopedDb } from "@/db/scoped";
import { equipment } from "@/db/schema";
import type { TogglePurchasedResult } from "./equipment-model";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function togglePurchased(input: {
  equipmentId: string;
  purchased: boolean;
}): Promise<TogglePurchasedResult> {
  const { userId } = await auth();
  if (!userId) {
    return { ok: false, error: "Your session expired. Sign in to continue." };
  }

  const equipmentId =
    typeof input?.equipmentId === "string" ? input.equipmentId : "";
  if (!UUID_RE.test(equipmentId)) {
    return { ok: false, error: "We couldn't find that item." };
  }
  const purchased = input.purchased === true;

  let updated: Array<unknown>;
  try {
    updated = await scopedDb(userId).update(equipment, {
      set: {
        purchased_at: purchased ? new Date() : null,
        updated_at: new Date(),
      },
      where: eq(equipment.id, equipmentId),
    });
  } catch {
    return { ok: false, error: "That didn't save. Try once more." };
  }

  // Zero rows ⇔ the scope filter excluded it (not this user's row, or the
  // user is soft-deleted). Nothing was written.
  if (updated.length === 0) {
    return { ok: false, error: "We couldn't find that item." };
  }

  revalidatePath("/equipment");
  return { ok: true, purchased };
}
