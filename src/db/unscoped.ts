/**
 * Raw, unscoped Drizzle client for genuinely cross-user operations.
 *
 * Allowed importers (enforced by scripts/check-unscoped-db.mjs in CI;
 * allowlist changes happen in that file only — never inline):
 *   - src/lib/inngest/*           (cross-user background jobs)
 *   - src/app/api/webhooks/*      (Clerk/Stripe webhook handlers)
 *   - src/lib/auth/lifecycle.ts   (soft-delete write + login recovery —
 *                                  must see soft-deleted users)
 *   - src/db/scoped.integration.test.ts (env-gated live-DB test — fixture
 *                                  user lifecycle + residue checks only)
 *   - src/lib/billing/usage.integration.test.ts (env-gated live-DB test —
 *                                  fixture user lifecycle + counter seed/
 *                                  residue checks only)
 *
 * If you reach for this from anywhere else, you almost certainly want
 * scopedDb(userId) from "@/db/scoped" instead (including getSelf()/
 * updateSelf() for the user's own users row).
 *
 * This module is the single intentional bridge to the raw client; the CI
 * check ALSO forbids direct imports of `internalDb` from "@/db/client" so
 * there's no way around it without tripping the build.
 */
import { internalDb } from "./client";

export const unscopedDb = internalDb;
export type { Db } from "./client";
