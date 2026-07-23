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
import * as readline from "node:readline/promises";
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

/**
 * Confirm WHICH prod database is about to be migrated (CS-7 Medium,
 * docs/security/pr-71-retroactive-review.md). The `-pooler` guard above proves
 * we hit the direct host but never proves it is the *intended* host — this
 * closes that gap. Given the resolved URL, the env, and whether stdin is a TTY,
 * it decides how the target is confirmed WITHOUT running any prompt (so it is
 * unit-testable with no TTY — the readline prompt lives in
 * `confirmMigrationTarget` below):
 *
 *   a. `STRIX_MIGRATE_TARGET` set → comma-separated allowlist of exact
 *      hostnames (whitespace trimmed). Resolved hostname in the list →
 *      `{ proceed: true }`; not in the list → throw.
 *   b. unset + stdin IS a TTY → `{ confirmRequired: true }`; the caller runs
 *      the interactive confirm.
 *   c. unset + stdin NOT a TTY → throw (a non-interactive run has no operator
 *      to confirm, so the allowlist is mandatory).
 *
 * SECURITY: only the resolved HOSTNAME is ever named in output or errors —
 * never the full credentialed URL or its query string. Allowlist values are
 * themselves hostnames, so echoing them back on a mismatch is safe.
 *
 * Exported (like `resolveMigrationUrl`) so the decision is unit-testable
 * without a TTY and without invoking `main()`'s side effects.
 */
export function assertMigrationTarget(
  url: string,
  env: Record<string, string | undefined> = process.env,
  isTTY: boolean = Boolean(process.stdin.isTTY),
): { proceed: true } | { confirmRequired: true } {
  const hostname = new URL(url).hostname;
  const rawAllowlist = env.STRIX_MIGRATE_TARGET;

  // An empty / whitespace-only value is treated as unset — an empty allowlist
  // would match nothing and throw a confusing "not in allowlist ()" error;
  // falling through to the TTY/non-TTY branches gives a clearer message.
  if (rawAllowlist !== undefined && rawAllowlist.trim() !== "") {
    const allowlist = rawAllowlist
      .split(",")
      .map((h) => h.trim())
      .filter(Boolean);
    if (allowlist.includes(hostname)) {
      return { proceed: true };
    }
    throw new Error(
      `Refusing to migrate: resolved target host "${hostname}" is not in the ` +
        `STRIX_MIGRATE_TARGET allowlist (${allowlist.join(", ")}).`,
    );
  }

  if (isTTY) {
    return { confirmRequired: true };
  }

  throw new Error(
    "non-interactive migration requires STRIX_MIGRATE_TARGET allowlist " +
      `(resolved target host "${hostname}").`,
  );
}

/**
 * Interactive target confirmation (case b). Kept OUT of
 * `assertMigrationTarget` so the decision logic stays TTY-free and testable.
 * Prompts the operator to retype the resolved hostname exactly; resolves true
 * on an exact match, false otherwise. Only the hostname is shown — never the
 * credentialed URL.
 */
async function confirmMigrationTarget(hostname: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(
      `Type the target host "${hostname}" to confirm this migration: `,
    );
    return answer.trim() === hostname;
  } finally {
    rl.close();
  }
}

async function main() {
  const url = resolveMigrationUrl();
  // Echo the HOSTNAME ONLY — never the credentialed URL or query string.
  const hostname = new URL(url).hostname;
  console.log(`Migration target: ${hostname}`);

  const decision = assertMigrationTarget(url);
  if ("confirmRequired" in decision) {
    const confirmed = await confirmMigrationTarget(hostname);
    if (!confirmed) {
      console.error("Migration aborted: target host not confirmed.");
      process.exit(1);
    }
  }

  const sql = neon(url);
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
