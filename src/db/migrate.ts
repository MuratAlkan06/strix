/**
 * Production migration runner. Local dev uses `pnpm db:push` against a Neon
 * branch. CI/prod runs `pnpm db:migrate` which executes this script.
 *
 * Loads .env.local so the same script works for local dev runs without a
 * wrapper. In CI, env vars are injected via the CI environment, not files,
 * so the missing-file case is silently ignored by dotenv.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { migrate } from "drizzle-orm/neon-http/migrator";

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required");
  }
  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);
  console.log("Running migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
