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
 * Multi-statement transactions go through `withTransactionalDb` below, which
 * constructs a `@neondatabase/serverless` Pool INSIDE the call and closes it
 * before returning — never a Pool at module scope. It is private plumbing for
 * scoped.ts (scopedDb().transaction), under the same import restrictions as
 * `internalDb`.
 */
import { neon, Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { drizzle as drizzleWs } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

const sql = neon(process.env.DATABASE_URL);

export const internalDb = drizzle(sql, { schema, casing: "snake_case" });

export type Db = typeof internalDb;
export { schema };

/**
 * PRIVATE (same import rules as `internalDb`): run `fn` inside a single
 * interactive Postgres transaction — the mechanism this file's header
 * prescribes for multi-statement transactions. The HTTP driver above cannot
 * hold a transaction open, so a WebSocket Pool is constructed PER CALL
 * (inside the request, never at module scope) and closed before returning.
 *
 * The transaction client is cast to `Db`: both drivers expose the same
 * Drizzle query-builder surface over the same dialect + schema, and scoped.ts
 * (the only consumer, via scopedDb().transaction) uses only that surface
 * (select / insert / update / delete with .returning()).
 */
export async function withTransactionalDb<T>(
  fn: (tx: Db) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const db = drizzleWs(pool, { schema, casing: "snake_case" });
    return await db.transaction(async (tx) => fn(tx as unknown as Db));
  } finally {
    await pool.end();
  }
}
