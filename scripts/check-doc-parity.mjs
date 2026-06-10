#!/usr/bin/env node
/**
 * check-doc-parity.mjs — deterministic doc↔code parity check.
 *
 * Docs drift from code silently, and the cost is real: the 2026-06 external
 * plan review burned a chunk of its findings on stale docs. The mechanical
 * class of that drift (enumerable invariants) should never be an LLM's job —
 * this script catches it for zero tokens on every verify/CI run.
 *
 * ADMISSION RULE — read before adding an invariant:
 *   An invariant CLASS earns a spot here only after a real drift instance
 *   burned us. Admit the class, not just the literal instance (the enum that
 *   drifted justifies checking ALL enums), but do not add speculative
 *   invariants because they feel thorough. Each block below names the burn
 *   that seeded it.
 *
 * Blocking checks (exit 1):
 *   1. Layer-count phrase parity      (burn: README said "Three-layer" after Layer 4 landed)
 *   2. unscopedDb allowlist parity    (burn: docs listed two entries after lifecycle.ts was decided)
 *   3. Enum value-list parity         (burn: PLAN.md §2 + verify-schema.ts lacked weekly_feeling 'skipped')
 *   4. README layout-tree paths exist (burn: README listed middleware.ts; the file is proxy.ts)
 *
 * Advisory (never affects exit code):
 *   - Last commit touched src/ but no .md — a nudge, not a gate; code-only
 *     commits with no doc-relevant surface are common and legitimate.
 */
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join, sep } from "node:path";
import {
  UNSCOPED_ALLOWED_FILES,
  UNSCOPED_ALLOWED_PREFIXES,
} from "./check-unscoped-db.mjs";

const ROOT = process.cwd();
const failures = [];
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ---------------------------------------------------------------------------
// 1. Layer-count phrase parity.
// Truth source: the highest "Layer N" marker in check-unscoped-db.mjs.
// ---------------------------------------------------------------------------
{
  const checkSrc = read("scripts/check-unscoped-db.mjs");
  const layerNums = [...checkSrc.matchAll(/\bLayer (\d)\b/g)].map((m) =>
    Number(m[1]),
  );
  const actual = Math.max(...layerNums);
  const WORDS = { 2: "two", 3: "three", 4: "four", 5: "five", 6: "six" };
  const word = WORDS[actual];

  const readme = read("README.md");
  const rm = readme.match(/(\w+)-layer access-isolation/i);
  if (!rm) {
    failures.push(
      'README.md: no "<N>-layer access-isolation" phrase found (expected one)',
    );
  } else if (rm[1].toLowerCase() !== word) {
    failures.push(
      `README.md says "${rm[1]}-layer access-isolation" but check-unscoped-db.mjs defines ${actual} layers`,
    );
  }

  const phase0 = read("planning/phase-0-foundations.md");
  const pm = phase0.match(/check-unscoped-db\.mjs`?,?\s+(\w+) layers/i);
  if (!pm) {
    failures.push(
      "planning/phase-0-foundations.md: no layer-count phrase next to check-unscoped-db.mjs found",
    );
  } else if (pm[1].toLowerCase() !== word) {
    failures.push(
      `planning/phase-0-foundations.md says "${pm[1]} layers" but check-unscoped-db.mjs defines ${actual}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. unscopedDb allowlist parity.
// Every entry the check script enforces must appear in every doc that
// documents the allowlist. (One-directional on purpose: the script is the
// truth source; a doc mentioning a removed entry is caught the day the
// entry's path string no longer matches anything — acceptable.)
// ---------------------------------------------------------------------------
{
  const entries = [
    ...UNSCOPED_ALLOWED_PREFIXES,
    ...UNSCOPED_ALLOWED_FILES,
  ].map((p) => p.split(sep).slice(1).join("/")); // strip the "src" segment

  const ALLOWLIST_DOCS = [
    "README.md",
    "planning/phase-0-foundations.md",
    "src/db/unscoped.ts",
    "src/db/scoped.ts",
  ];
  for (const doc of ALLOWLIST_DOCS) {
    const text = read(doc);
    for (const entry of entries) {
      if (!text.includes(entry)) {
        failures.push(
          `${doc}: missing unscopedDb allowlist entry "${entry}" (check-unscoped-db.mjs enforces it)`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Enum value-list parity: schema.ts is the truth source.
//    a) PLAN.md §2 documents most enums as pipe-lists (`a|b|c`) and
//       activity_type as a comma list in §3.6.
//    b) scripts/verify-schema.ts EXPECTED_ENUMS must mirror schema.ts
//       exactly (order-sensitive — its own check is order-sensitive too).
// subscription_status is intentionally not enumerated in PLAN.md (it mirrors
// Stripe's status vocabulary); it IS checked against verify-schema.ts.
// ---------------------------------------------------------------------------
{
  const schema = read("src/db/schema.ts");
  const enums = {};
  for (const m of schema.matchAll(/pgEnum\(\s*"(\w+)"\s*,\s*\[([^\]]+)\]/g)) {
    enums[m[1]] = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  }
  if (Object.keys(enums).length === 0) {
    failures.push("src/db/schema.ts: failed to parse any pgEnum definitions");
  }

  const plan = read("PLAN.md");
  const PIPE_DOCUMENTED = [
    "user_tier",
    "intensity_level",
    "goal_status",
    "task_cadence",
    "weekly_feeling",
    "replan_trigger",
    "replan_status",
    "billing_period",
    "archive_reason",
  ];
  for (const name of PIPE_DOCUMENTED) {
    if (!enums[name]) {
      failures.push(`schema.ts: expected enum "${name}" not found`);
      continue;
    }
    const pipe = enums[name].join("|");
    if (!plan.includes(pipe)) {
      failures.push(
        `PLAN.md: stale or missing value list for enum ${name} — expected "${pipe}" per schema.ts`,
      );
    }
  }
  if (enums.activity_type) {
    const commaList = enums.activity_type.join(", ");
    if (!plan.includes(commaList)) {
      failures.push(
        `PLAN.md: stale or missing activity_type list — expected "${commaList}" per schema.ts (§3.6)`,
      );
    }
  }

  const vs = read("scripts/verify-schema.ts");
  const block = vs.match(/EXPECTED_ENUMS[^=]*=\s*\{([\s\S]*?)\n\};/)?.[1];
  if (!block) {
    failures.push("scripts/verify-schema.ts: could not locate EXPECTED_ENUMS");
  } else {
    for (const m of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
      const name = m[1];
      const vals = [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      if (!enums[name]) {
        failures.push(
          `verify-schema.ts EXPECTED_ENUMS has "${name}" which schema.ts does not define`,
        );
      } else if (enums[name].join(",") !== vals.join(",")) {
        failures.push(
          `verify-schema.ts EXPECTED_ENUMS.${name} = [${vals.join(", ")}] but schema.ts defines [${enums[name].join(", ")}]`,
        );
      }
    }
    for (const name of Object.keys(enums)) {
      if (!new RegExp(`\\b${name}:`).test(block)) {
        failures.push(
          `verify-schema.ts EXPECTED_ENUMS is missing enum "${name}" (defined in schema.ts)`,
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. README project-layout tree: every listed path exists on disk.
// ---------------------------------------------------------------------------
{
  const readme = read("README.md");
  const section = readme.split("## Project layout")[1];
  const code = section?.match(/```\n([\s\S]*?)```/)?.[1];
  if (!code) {
    failures.push("README.md: could not locate the Project layout code block");
  } else {
    const stack = []; // path segments by depth; stack[0] is the root dir
    const paths = [];
    for (const rawLine of code.split("\n")) {
      const line = rawLine.replace(/\s+$/, "");
      if (!line.trim()) continue;
      const markerIdx = (() => {
        const a = line.indexOf("├── ");
        const b = line.indexOf("└── ");
        if (a === -1) return b;
        if (b === -1) return a;
        return Math.min(a, b);
      })();
      if (markerIdx === -1) {
        // Root line ("src/") or a continuation comment line.
        const t = line.trim();
        if (t.startsWith("#")) continue;
        if (t.endsWith("/")) {
          stack.length = 0;
          stack.push(t.slice(0, -1));
        }
        continue;
      }
      const depth = markerIdx / 4 + 1; // children of the root start at column 0
      const token = line.slice(markerIdx + 4).trim().split(/\s+/)[0];
      if (!token || token.startsWith("#")) continue;
      // Expand {a,b} alternation (e.g. analytics/{server,client}.ts).
      const expand = (t) => {
        const m = t.match(/^(.*)\{([^}]+)\}(.*)$/);
        if (!m) return [t];
        return m[2].split(",").map((alt) => `${m[1]}${alt}${m[3]}`);
      };
      if (token.endsWith("/")) {
        const dir = token.slice(0, -1);
        stack.length = depth;
        stack.push(dir);
        paths.push(stack.join("/"));
      } else {
        stack.length = depth;
        for (const t of expand(token)) {
          paths.push([...stack, t].join("/"));
        }
      }
    }
    for (const p of paths) {
      if (!existsSync(join(ROOT, p))) {
        failures.push(
          `README.md project layout lists "${p}" which does not exist on disk`,
        );
      }
    }
    if (paths.length === 0) {
      failures.push("README.md: parsed zero paths from the Project layout tree");
    }
  }
}

// ---------------------------------------------------------------------------
// Advisory (never blocks): src/ changed in the last commit but no .md did.
// ---------------------------------------------------------------------------
try {
  const changed = execSync("git diff --name-only HEAD~1..HEAD", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .trim()
    .split("\n")
    .filter(Boolean);
  const srcTouched = changed.some((f) => f.startsWith("src/"));
  const docTouched = changed.some((f) => f.endsWith(".md"));
  if (srcTouched && !docTouched) {
    console.log(
      "advisory (non-blocking): the last commit touched src/ but no .md — " +
        "confirm no planning-doc/README surface changed.",
    );
  }
} catch {
  // Shallow clone, first commit, or no git — the advisory just skips.
}

if (failures.length > 0) {
  console.error("Doc-parity violation(s):");
  for (const f of failures) console.error("  - " + f);
  console.error(
    "\nDocs are load-bearing in this repo (plan-driven build). Update the " +
      "stale doc to match the code — or, if the code is wrong, fix the code. " +
      "New invariants are admitted per the rule in this script's header.",
  );
  process.exit(1);
}

console.log("check-doc-parity: OK (all invariants hold).");
