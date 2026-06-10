/**
 * PRIVATE module — do not import `internalDb` from anywhere except:
 *   - src/db/scoped.ts   (the only public access path for user-authenticated code)
 *   - src/db/unscoped.ts (the CI-restricted escape hatch for webhooks + Inngest)
 *
 * `internalDb` is the raw Drizzle client. Reaching it directly defeats the
 * scopedDb access-isolation model. The CI check at
 * scripts/check-unscoped-db.mjs fails the build on imports of this module
 * from anywhere outside the two allowed files.
 *
 * Driver: `drizzle-orm/neon-http` — stateless HTTP, safe at module scope.
 * For multi-statement transactions (Phase 1+), construct a `@neondatabase/
 * serverless` Pool INSIDE the request handler and close it via
 * ctx.waitUntil(pool.end()).
 */
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

export const internalDb = drizzle(sql, { schema, casing: "snake_case" });

export type Db = typeof internalDb;
export { schema };
