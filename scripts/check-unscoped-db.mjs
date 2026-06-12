#!/usr/bin/env node
/**
 * CI check — five-layer access-isolation enforcement.
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
 * `drizzle-orm/neon-http`) may not be imported anywhere in the repo outside
 * the db plumbing modules and the two named operator-run live-DB scripts —
 * otherwise any file could mint a fresh query-capable client and bypass
 * Layers 1-3 entirely.
 *
 * Layer 5: `scopedDb` may not be aliased. In non-test src/ files the
 * identifier may appear only as a direct call `scopedDb(...)` or as a plain
 * (un-renamed) import/export specifier. `const db = scopedDb`,
 * `{ scopedDb: x }`, `import { scopedDb as db }`, a re-export under another
 * name, or a call with a comment spliced between the identifier and its
 * opening paren all detach call sites from the Layer-3 shape check, so they
 * are violations.
 *
 * All import layers match static imports, `export … from`, dynamic
 * `import()`, and `require()` forms — with ', ", or ` as the quote and an
 * optional explicit file extension on the module path. The scan walks the
 * WHOLE repo (not just src/), including dot-directories, so a file parked in
 * an unconventional location cannot dodge the import layers; Layers 3 and 5
 * (call/alias shape) apply to src/ only, where request-scoped code lives.
 *
 * Test files are exempt from Layers 3 and 5 — they legitimately call
 * scopedDb with arbitrary string fixtures and alias/mock it.
 *
 * Application code MUST go through scopedDb(userId) from "@/db/scoped"
 * for all user-authenticated paths.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

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
  // Env-gated live-DB test: unscopedDb for fixture lifecycle (users can't be
  // created through scopedDb by design) + neutral residue checks only.
  ["src", "db", "scoped.integration.test.ts"].join(sep),
]);

// Files that may import `internalDb` directly from "@/db/client".
const CLIENT_ALLOWED_FILES = new Set([
  ["src", "db", "scoped.ts"].join(sep),
  ["src", "db", "unscoped.ts"].join(sep),
  ["src", "db", "migrate.ts"].join(sep),
]);

// Files exempt from all checks (the modules being protected themselves, and
// this checker — its own comments and regex sources quote the patterns).
const SELF_FILES = new Set([
  ["src", "db", "client.ts"].join(sep),
  ["src", "db", "unscoped.ts"].join(sep),
  ["src", "db", "scoped.ts"].join(sep),
  ["src", "db", "migrate.ts"].join(sep),
  ["scripts", "check-unscoped-db.mjs"].join(sep),
]);

// Layer 4 allowlist — the only files that may import the raw Neon/drizzle
// driver. The two scripts are operator-run live-DB tooling (smoke test +
// schema introspection); they never serve requests.
const DRIVER_ALLOWED_FILES = new Set([
  ["src", "db", "client.ts"].join(sep),
  ["scripts", "smoke-scoped-db.ts"].join(sep),
  ["scripts", "verify-schema.ts"].join(sep),
]);

const EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

// Never descend into these (vendored/generated trees — nothing in them is
// repo-authored runtime code). Dot-directories are otherwise scanned: a file
// parked under src/.anything/ must not dodge the import layers.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  ".claude",
  ".playwright-mcp",
  "coverage",
  "test-results",
  "playwright-report",
]);

const violations = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
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
// import(), and require() forms; quotes may be ', ", or ` (a template
// literal with no interpolation is a valid module specifier to bundlers),
// and an explicit file extension (".ts", ".js", …) does not dodge the match.
const UNSCOPED_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`](?:@\/|[./]{1,2}(?:[^"'`]*\/)?)db\/unscoped(?:\.[cm]?[jt]sx?)?["'`]/;
const CLIENT_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`](?:@\/|[./]{1,2}(?:[^"'`]*\/)?)db\/client(?:\.[cm]?[jt]sx?)?["'`]/;

// Layer 4 — raw driver imports. Any of these outside the db plumbing modules
// mints a fresh query-capable client and bypasses every other layer.
const DRIVER_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`](?:@neondatabase\/serverless|drizzle-orm\/neon-http)(?:\/[^"'`]*)?["'`]/;

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

// Files exempt from Layers 3 + 5 — tests need arbitrary fixture IDs and
// legitimately alias/mock scopedDb.
const TEST_FILE = /\.(test|spec)\.[mc]?[jt]sx?$/;
function isTestFile(rel) {
  return TEST_FILE.test(rel) || rel.includes(`${sep}__tests__${sep}`);
}

// Length-preserving blanking (offsets and line numbers stay valid).
function blank(s) {
  return s.replace(/[^\n]/g, " ");
}

// Blank block comments and line comments. The `[^:"'\`]` guard keeps URL
// "//" inside strings (https://…) from eating the rest of the line; this is
// a heuristic, but an imperfect blank can only HIDE a reference (handled by
// the layers' import checks), never invent one — no false-positive risk.
function blankComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`])\/\/[^\n]*/gm, (m, p1) => p1 + blank(m.slice(p1.length)));
}

// Plain import/export clauses (single-name, namespace, or braced specifier
// lists, incl. multi-line) — the only places a bare `scopedDb` token is
// legitimate. Renames are caught BEFORE these are blanked.
const IMPORT_EXPORT_CLAUSE =
  /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|[\w$]+|\*\s+as\s+[\w$]+)(?:\s*,\s*\{[^}]*\})?\s+from\s+["'`][^"'`\n]+["'`]/g;

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

// Layer 5 — scopedDb aliasing. Default posture: outside import/export
// specifiers, every `scopedDb` token must be a direct call. Operates on the
// comment-blanked source (shared with Layer 3).
function checkScopedDbAliasing(decommented, rel) {
  // 5a: renamed import/export specifier (`scopedDb as anything`).
  const renamed = /\bscopedDb\s+as\s+[\w$]+/.exec(decommented);
  if (renamed) {
    violations.push(
      `${rel}:${lineOf(decommented, renamed.index)}  renames scopedDb (\`${renamed[0]}\`) — aliasing detaches call sites from the call-shape check; always call it as scopedDb(...)`,
    );
  }

  // 5b: bare references outside import/export clauses.
  const code = decommented.replace(IMPORT_EXPORT_CLAUSE, blank);
  const word = /\bscopedDb\b/g;
  let m;
  while ((m = word.exec(code)) !== null) {
    if (!/^\s*\(/.test(code.slice(m.index + "scopedDb".length))) {
      violations.push(
        `${rel}:${lineOf(code, m.index)}  references scopedDb without calling it — passing or rebinding the function detaches it from the call-shape check`,
      );
    }
  }
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

  // Layers 3 + 5 apply to non-test src/ files (request-scoped code). Both
  // scan the comment-blanked source: comments can neither hide a call from
  // Layer 3 (a splice between `scopedDb` and `(` blanks away) nor trip a
  // false positive by quoting a bad shape in prose.
  const inSrc = rel.startsWith(`src${sep}`);
  if (inSrc && !isTestFile(rel)) {
    const decommented = blankComments(src);

    // Layer 3: scopedDb(...) call shape — default-deny.
    for (const { index, arg } of findScopedDbCallArgs(decommented)) {
      // Empty parens = no argument; let TypeScript catch that, not us.
      if (arg.length === 0) continue;
      if (!ALLOWED_USERID_SHAPES.has(arg)) {
        violations.push(
          `${rel}:${lineOf(decommented, index)}  scopedDb(${arg}) — argument must be \`userId\` (destructured from auth()) or \`auth().userId\`. ` +
            `Passing user-controlled values (URL params, request body) defeats the scope.`,
        );
      }
    }

    // Layer 5: scopedDb aliasing.
    checkScopedDbAliasing(decommented, rel);
  }

  // Layer 4: raw driver imports.
  if (DRIVER_IMPORT.test(src) && !DRIVER_ALLOWED_FILES.has(rel)) {
    violations.push(
      `${rel}  imports the raw Neon/drizzle driver — only src/db/client.ts (and the named live-DB scripts) may construct a client; everything else goes through scopedDb/unscopedDb`,
    );
  }
}

function main() {
  walk(ROOT);

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
