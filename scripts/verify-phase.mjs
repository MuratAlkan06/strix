#!/usr/bin/env node
/**
 * verify-phase.mjs — run the verification matrix for a given phase and
 * print pass/fail rows. Invoked as `pnpm verify:phase-N`.
 *
 * Phase 0 closer matrix: every step the Phase 0 verification block asks
 * for, in one command, with a single pass/fail summary at the end. Steps
 * stream their output as they run; the matrix at the end is the
 * authoritative recap.
 *
 * Adding a new phase: extend STEPS_BY_PHASE with the relevant slice and
 * keep step names short — they're the matrix-row labels.
 */
import { spawn } from "node:child_process";
import process from "node:process";

const PLACEHOLDER_ENV = {
  DATABASE_URL:
    process.env.DATABASE_URL ??
    "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY ?? "sk_test_placeholder",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "pk_test_placeholder",
};

/**
 * Each step: { name, cmd, args, env? }.
 * The matrix prints `name` and the exit status of the child.
 */
const STEPS_BY_PHASE = {
  "0": [
    { name: "typecheck", cmd: "pnpm", args: ["typecheck"] },
    { name: "lint", cmd: "pnpm", args: ["lint"] },
    {
      name: "ci:check-unscoped",
      cmd: "pnpm",
      args: ["ci:check-unscoped"],
    },
    {
      name: "db:generate",
      cmd: "pnpm",
      args: ["db:generate"],
      env: PLACEHOLDER_ENV,
    },
    { name: "test:run", cmd: "pnpm", args: ["test:run"] },
    {
      name: "build",
      cmd: "pnpm",
      args: ["build"],
      env: PLACEHOLDER_ENV,
    },
  ],
};

function run(step) {
  return new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, {
      stdio: "inherit",
      env: { ...process.env, ...(step.env ?? {}) },
    });
    child.on("close", (code) => resolve({ name: step.name, code }));
    child.on("error", () => resolve({ name: step.name, code: 127 }));
  });
}

async function main() {
  const phase = process.argv[2];
  if (!phase) {
    console.error("Usage: node scripts/verify-phase.mjs <phase-number>");
    process.exit(2);
  }
  const steps = STEPS_BY_PHASE[phase];
  if (!steps) {
    console.error(
      `No verification matrix defined for phase ${phase}. Available: ${Object.keys(
        STEPS_BY_PHASE,
      ).join(", ")}`,
    );
    process.exit(2);
  }

  console.log(`\n— Phase ${phase} verification matrix —\n`);
  const results = [];
  for (const step of steps) {
    console.log(`\n· running: ${step.name}`);
    const result = await run(step);
    results.push(result);
    // Continue on failure so the user sees every step's status, not just
    // the first failure. Exit code is rolled up at the end.
  }

  console.log(`\n— Phase ${phase} matrix —\n`);
  const nameWidth = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.code === 0 ? "PASS" : `FAIL (exit ${r.code})`;
    console.log(`  ${r.name.padEnd(nameWidth)}   ${status}`);
  }
  const failed = results.filter((r) => r.code !== 0);
  console.log("");
  if (failed.length === 0) {
    console.log(`All ${results.length} checks passed. Phase ${phase} verified.`);
    process.exit(0);
  } else {
    console.log(
      `${failed.length} of ${results.length} checks failed: ${failed
        .map((f) => f.name)
        .join(", ")}`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
