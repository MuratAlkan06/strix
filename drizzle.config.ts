import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs standalone (unlike Next.js) and doesn't auto-load
// .env.local. Load it explicitly so `pnpm db:*` commands work without a
// wrapper. .env (production-style) takes precedence if set in the
// environment already.
config({ path: ".env.local" });

// Prefer the direct (non-pooled) host so `db:push`/`db:studio` mirror the
// migration runner's posture (ADR-0002 Decision 1). Unlike src/db/migrate.ts
// we deliberately do NOT reject a `-pooler` host here: this config also backs
// `db:generate` (runs in CI with a dummy DATABASE_URL) and `db:push` for local
// Neon-branch dev, where a hard reject would break legitimate flows.
const dbUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!dbUrl) {
  throw new Error(
    "DIRECT_DATABASE_URL or DATABASE_URL is required to run drizzle-kit",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url: dbUrl,
  },
  strict: true,
  verbose: true,
});
