#!/usr/bin/env node
/**
 * CI check — four-layer access-isolation enforcement.
 *
 * Layer 1: `unscopedDb` (the named escape hatch) may only be imported by
 *   - src/lib/inngest/**           (cross-user background jobs)
 *   - src/app/api/webhooks/**      (Clerk/Stripe webhook handlers)
 *   - src/lib/auth/lifecycle.ts    (soft-delete write + login recovery —
 *                                   the one interactive flow that must see
 *                                   soft-deleted users)
 * Additions to this allowlist happen HERE and only here — never weaken the
 * check inline at a call site.
 *
 * Layer 2: the raw client (`internalDb` from "@/db/client") may only be
 * imported by
 *   - src/db/scoped.ts
 *   - src/db/unscoped.ts
 *   - src/db/migrate.ts
 *
 * Without Layer 2, the unscopedDb rule could be bypassed by importing
 * `internalDb` directly from "@/db/client" (zero indirection) or by
 * re-exporting unscopedDb from an allowed file under a different name and
 * importing that re-export from anywhere. Closing the raw client off
 * removes both bypasses without depending on a tighter grep.
 *
 * Layer 3: `scopedDb(...)` may only be called with a safe argument shape:
 *   - `userId` (the canonical destructure: `const { userId } = await auth()`)
 *   - `auth().userId` (direct, no destructure)
 * DEFAULT-DENY: any call site whose argument is anything else — including
 * shapes this script can't parse — is a violation. (An earlier version
 * silently skipped arguments containing parentheses, which allowed exactly
 * the wrapped-user-input shapes the layer exists to catch, e.g.
 * scopedDb(getUserId(req)).)
 *
 * Closes the residual concern from the security review: scopedDb trusts
 * whatever userId the caller passes. If a route handler reads a URL
 * parameter and passes it as the userId, every guarantee in scoped.ts is
 * defeated. Restricting the call shape forces the userId to come from
 * Clerk's auth() in every production call site.
 *
 * Layer 4: the raw Neon/drizzle driver (`@neondatabase/serverless`,
 * `drizzle-orm/neon-http`) may not be imported anywhere in src/ outside the
 * db plumbing modules — otherwise any file could mint a fresh query-capable
 * client and bypass Layers 1-3 entirely.
 *
 * All import layers match static imports, `export … from`, dynamic
 * `import()`, and `require()` forms.
 *
 * Test files are exempt from Layer 3 — they legitimately call scopedDb
 * with arbitrary string fixtures.
 *
 * Application code MUST go through scopedDb(userId) from "@/db/scoped"
 * for all user-authenticated paths.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");

// Directories whose files may import `unscopedDb`.
// Exported: scripts/check-doc-parity.mjs asserts the docs quote this list.
export const UNSCOPED_ALLOWED_PREFIXES = [
  ["src", "lib", "inngest"].join(sep),
  ["src", "app", "api", "webhooks"].join(sep),
];

// Single files that may import `unscopedDb`. (Prefix matching appends a
// path separator, so individual files need their own exact-match set.)
// Exported for the same doc-parity reason.
export const UNSCOPED_ALLOWED_FILES = new Set([
  ["src", "lib", "auth", "lifecycle.ts"].join(sep),
]);

// Files that may import `internalDb` directly from "@/db/client".
const CLIENT_ALLOWED_FILES = new Set([
  ["src", "db", "scoped.ts"].join(sep),
  ["src", "db", "unscoped.ts"].join(sep),
  ["src", "db", "migrate.ts"].join(sep),
]);

// Files exempt from both checks (the modules being protected themselves).
const SELF_FILES = new Set([
  ["src", "db", "client.ts"].join(sep),
  ["src", "db", "unscoped.ts"].join(sep),
  ["src", "db", "scoped.ts"].join(sep),
  ["src", "db", "migrate.ts"].join(sep),
]);

const EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      walk(full);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot < 0 || !EXT.has(name.slice(dot))) continue;
    checkFile(full);
  }
}

// Import path patterns. Alias ("@/db/...") and relative ("./client",
// "../db/client") shapes are caught, in static-import, export-from, dynamic
// import(), and require() forms.
const UNSCOPED_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@\/|[./]{1,2}(?:[^"']*\/)?)db\/unscoped["']/;
const CLIENT_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@\/|[./]{1,2}(?:[^"']*\/)?)db\/client["']/;

// Layer 4 — raw driver imports. Any of these outside the db plumbing modules
// mints a fresh query-capable client and bypasses every other layer.
const DRIVER_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'](?:@neondatabase\/serverless|drizzle-orm\/neon-http)(?:\/[^"']*)?["']/;

// Allowed first-argument shapes for scopedDb(...). Add new identifiers here
// only after confirming they are derived from `auth()` exclusively.
const ALLOWED_USERID_SHAPES = new Set(["userId", "auth().userId"]);

// Layer 3 call-site extraction: find each `scopedDb(` and walk to the
// MATCHING close paren (balance counting), so parenthesized arguments like
// `getUserId(req)` are captured and judged instead of silently skipped.
function findScopedDbCallArgs(src) {
  const calls = [];
  const re = /\bscopedDb\s*\(/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      i++;
    }
    calls.push({ index: m.index, arg: src.slice(re.lastIndex, i - 1).trim() });
  }
  return calls;
}

// Files exempt from Layer 3 (call-shape) — tests need arbitrary fixture IDs.
const TEST_FILE = /\.(test|spec)\.[mc]?[jt]sx?$/;
function isTestFile(rel) {
  return TEST_FILE.test(rel) || rel.includes(`${sep}__tests__${sep}`);
}

function checkFile(full) {
  const rel = relative(ROOT, full);
  if (SELF_FILES.has(rel)) return;
  const src = readFileSync(full, "utf8");

  // Layer 1: unscopedDb imports.
  if (UNSCOPED_IMPORT.test(src)) {
    const ok =
      UNSCOPED_ALLOWED_PREFIXES.some((p) => rel.startsWith(p + sep)) ||
      UNSCOPED_ALLOWED_FILES.has(rel);
    if (!ok) {
      violations.push(
        `${rel}  imports from @/db/unscoped — only src/lib/inngest/**, src/app/api/webhooks/**, and src/lib/auth/lifecycle.ts may`,
      );
    }
  }

  // Layer 2: raw client imports.
  if (CLIENT_IMPORT.test(src)) {
    if (!CLIENT_ALLOWED_FILES.has(rel)) {
      violations.push(
        `${rel}  imports from @/db/client — funnel through scopedDb (@/db/scoped) or unscopedDb (@/db/unscoped)`,
      );
    }
  }

  // Layer 3: scopedDb(...) call shape — default-deny. Skip test files.
  if (!isTestFile(rel)) {
    for (const { index, arg } of findScopedDbCallArgs(src)) {
      // Empty parens = no argument; let TypeScript catch that, not us.
      if (arg.length === 0) continue;
      if (!ALLOWED_USERID_SHAPES.has(arg)) {
        // Find 1-based line number for the match.
        const line = src.slice(0, index).split("\n").length;
        violations.push(
          `${rel}:${line}  scopedDb(${arg}) — argument must be \`userId\` (destructured from auth()) or \`auth().userId\`. ` +
            `Passing user-controlled values (URL params, request body) defeats the scope.`,
        );
      }
    }
  }

  // Layer 4: raw driver imports.
  if (DRIVER_IMPORT.test(src)) {
    violations.push(
      `${rel}  imports the raw Neon/drizzle driver — only src/db/client.ts constructs a client; everything else goes through scopedDb/unscopedDb`,
    );
  }
}

function main() {
  walk(SRC);

  if (violations.length > 0) {
    console.error("Access-isolation violation(s):");
    for (const v of violations) console.error("  - " + v);
    console.error(
      "\nUse scopedDb(userId) from @/db/scoped for user-authenticated paths. " +
        "Use unscopedDb from @/db/unscoped (under lib/inngest/**, app/api/webhooks/**, " +
        "or lib/auth/lifecycle.ts) only for genuinely cross-user or lifecycle operations. " +
        "Allowlist changes are made in scripts/check-unscoped-db.mjs only.",
    );
    process.exit(1);
  }

  console.log("check-unscoped-db: OK (no violations).");
}

// Run only when executed directly — check-doc-parity.mjs imports the
// allowlist constants above without triggering a scan.
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  main();
}
