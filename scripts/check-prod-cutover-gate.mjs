#!/usr/bin/env node
/**
 * CI tripwire — prod-cutover gate for commerce code (ADR-0002, issue #70).
 *
 * Strix v0.5.0 certifies native-feel on a PREVIEW environment only. The
 * PRODUCTION standup (custom domain + Clerk prod instance + prod Neon + prod
 * PostHog + Stripe) is Phase 3, and ADR-0002's "Phase-3 commerce exit gate"
 * is BLOCKING: no commerce/Stripe code may ship to a real paying user until
 * the prod cutover + a re-run of the device matrix on the real prod origin
 * have both passed.
 *
 * This script is one of the three enforcement points named in that gate (the
 * others: a runtime Stripe-live-key guard added in Phase 3, and tracking
 * issue #70). It scans src/** for two commerce signals:
 *
 *   1. an `sk_live_` string literal (a live Stripe secret key), and
 *   2. an import of the `stripe` package (static `from "stripe"`, dynamic
 *      `import("stripe")`, or `require("stripe")`, with optional subpath).
 *
 * If EITHER appears AND the committed marker file `.prod-cutover-verified`
 * is absent at the repo root, the gate fails (exit 1) with an explanation.
 * Committing the marker is the deliberate, reviewed act that records the prod
 * cutover has happened — only then may commerce code land green.
 *
 * Mirrors scripts/check-unscoped-db.mjs: ESM, whole-of-src walk, a pure
 * exported detector for unit-testing, and a main() guarded so importing the
 * module never triggers a scan.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

// Committed marker that unlocks commerce code. Its presence is the auditable
// record that the Phase-3 prod cutover (ADR-0002) has been completed.
export const MARKER_FILE = ".prod-cutover-verified";

// Only source files carry runtime code worth gating.
const EXT = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);

// Never descend into vendored/generated trees.
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  "coverage",
  "test-results",
  "playwright-report",
]);

// Commerce signal 1 — a live Stripe secret key literal.
const LIVE_KEY = /sk_live_/;

// Commerce signal 2 — importing the `stripe` package in any module form
// (static import / export-from, dynamic import(), require()), with the quote
// as ', " or `, and an optional subpath (e.g. "stripe/lib/...").
const STRIPE_IMPORT =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`]stripe(?:\/[^"'`]*)?["'`]/;

/**
 * Pure detector — given a file's source text, return the commerce signals it
 * contains. Exported for unit testing (no filesystem, no process exit).
 * @param {string} src
 * @returns {{ liveKey: boolean, stripeImport: boolean }}
 */
export function detectCommerceSignals(src) {
  return {
    liveKey: LIVE_KEY.test(src),
    stripeImport: STRIPE_IMPORT.test(src),
  };
}

function walk(dir, hits) {
  for (const name of readdirSync(dir)) {
    if (IGNORED_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      walk(full, hits);
      continue;
    }
    const dot = name.lastIndexOf(".");
    if (dot < 0 || !EXT.has(name.slice(dot))) continue;
    const { liveKey, stripeImport } = detectCommerceSignals(
      readFileSync(full, "utf8"),
    );
    if (!liveKey && !stripeImport) continue;
    const rel = relative(ROOT, full);
    if (liveKey) hits.push(`${rel} — contains an sk_live_ (live Stripe key) literal`);
    if (stripeImport) hits.push(`${rel} — imports the \`stripe\` package`);
  }
}

/**
 * Scan src/** and return the list of commerce-signal hits.
 * @returns {string[]}
 */
export function scanForCommerce() {
  const hits = [];
  const srcDir = join(ROOT, "src");
  if (existsSync(srcDir)) walk(srcDir, hits);
  return hits;
}

function main() {
  const hits = scanForCommerce();

  if (hits.length === 0) {
    console.log("check-prod-cutover-gate: OK (no commerce code in src/).");
    return;
  }

  // Commerce code is present. Allowed only once the prod cutover is recorded.
  if (existsSync(join(ROOT, MARKER_FILE))) {
    console.log(
      `check-prod-cutover-gate: commerce code present and ${MARKER_FILE} found — ` +
        "prod cutover recorded, gate open.",
    );
    return;
  }

  console.error(
    `\ncheck-prod-cutover-gate: BLOCKED.\n\n` +
      `Commerce/Stripe signal(s) detected in src/:\n` +
      hits.map((h) => `  - ${h}`).join("\n") +
      `\n\nADR-0002's Phase-3 commerce exit gate is BLOCKING: no commerce code\n` +
      `may ship to a real paying user until BOTH (1) the prod cutover (custom\n` +
      `domain + Clerk prod instance + prod Neon + prod PostHog) and (2) a re-run\n` +
      `of the native-feel + gate-9.5 device matrix on the real prod origin have\n` +
      `passed. See docs/adr/0002-production-deploy.md and issue #70.\n\n` +
      `When that is genuinely done, commit an empty marker file at the repo root\n` +
      `to open this gate:\n\n` +
      `  git commit --allow-empty-message -m "" # then:\n` +
      `  touch ${MARKER_FILE} && git add ${MARKER_FILE}\n`,
  );
  process.exit(1);
}

// Run only when executed directly — unit tests import the detector/scanner
// above without triggering a scan or a process exit.
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main();
}
