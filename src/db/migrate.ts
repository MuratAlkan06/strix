/**
 * Production migration runner. Local dev uses `pnpm db:push` against a Neon
 * branch. CI/prod runs `pnpm db:migrate` which executes this script.
 *
 * Loads .env.local so the same script works for local dev runs without a
 * wrapper. In CI, env vars are injected via the CI environment, not files,
 * so the missing-file case is silently ignored by dotenv.
 *
 * Migrations run against the Neon DIRECT (non-pooled) host via
 * `DIRECT_DATABASE_URL` (ADR-0002 Decision 1). The runtime `DATABASE_URL` is
 * the POOLED string; running DDL through the pooler is a footgun on the shared
 * preview DB, so a resolved `-pooler` host is rejected outright below.
 */
import { pathToFileURL } from "node:url";
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

/**
 * Resolve the migration connection string: prefer the dedicated direct host,
 * fall back to `DATABASE_URL`. Throws if neither is set, or if the resolved
 * string targets a Neon pooled host (`-pooler` in the hostname) — migrations
 * must hit the direct/non-pooled endpoint.
 *
 * Exported so the resolution + guard is unit-testable without invoking the
 * runner's top-level side effects.
 */
export function resolveMigrationUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const url = env.DIRECT_DATABASE_URL ?? env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DIRECT_DATABASE_URL (preferred) or DATABASE_URL is required to run migrations",
    );
  }
  if (url.includes("-pooler")) {
    throw new Error(
      "Refusing to migrate against a Neon pooled host (-pooler). Migrations " +
        "must run against the direct/non-pooled host — set DIRECT_DATABASE_URL " +
        "to the non-pooler Neon connection string.",
    );
  }
  return url;
}

async function main() {
  const sql = neon(resolveMigrationUrl());
  const db = drizzle(sql);
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
}

// Run only when executed directly (`tsx src/db/migrate.ts`), not when imported
// — importing this module for tests must not open a Neon connection or trip the
// pooler guard against the loaded .env.local. `process.argv[1]` is the executed
// script's path; compare it as a file URL to this module's URL.
const isEntryPoint =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntryPoint) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
