/**
 * smoke-posthog.ts — verify the server-side PostHog wrapper actually emits
 * events that land in the configured PostHog project.
 *
 * Phase 0 verification (per phase-0-foundations.md line 130):
 *   "posthog-node capture for a test event appears in PostHog within 30s."
 *
 * This script exercises the full path: env vars → our lib/analytics/server.ts
 * wrapper → posthog-node SDK → ingest endpoint → PostHog project.
 *
 * Re-runnable. Idempotent. Uses a deterministic distinct_id so the test
 * events cluster in the dashboard rather than scattering across fake users.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { capture, identify, shutdown } from "../src/lib/analytics/server";

const DISTINCT_ID = "phase-0-smoke-test";
const EVENT_NAME = "phase_0_verification_smoke";

async function main() {
  console.log("\n— PostHog smoke test —\n");

  if (!process.env.POSTHOG_API_KEY) {
    console.error(
      "POSTHOG_API_KEY is not set in .env.local — cannot run smoke test.",
    );
    process.exit(1);
  }
  console.log(`Host: ${process.env.POSTHOG_HOST ?? "https://us.i.posthog.com"}`);
  console.log(`Key:  ${process.env.POSTHOG_API_KEY.slice(0, 8)}… (project key)`);
  console.log(`Distinct ID: ${DISTINCT_ID}`);
  console.log(`Event name:  ${EVENT_NAME}\n`);

  // Identify first so PostHog can render the test as a real "person."
  await identify(DISTINCT_ID, {
    note: "Phase 0 verification smoke-test identity. Safe to delete.",
    role: "smoke-test",
  });

  // Capture the event we'll look for in the dashboard.
  await capture(DISTINCT_ID, EVENT_NAME, {
    phase: 0,
    purpose: "verify the lib/analytics/server.ts wrapper actually emits events",
    timestamp_iso: new Date().toISOString(),
    runner: "scripts/smoke-posthog.ts",
  });

  // CRITICAL: shutdown() flushes the in-memory batch. Without this, the
  // process exits before the SDK has POSTed the events and they're lost.
  // Verified against posthog-js/packages/node/example.mjs.
  console.log("Flushing via shutdown() (required in short-lived processes)…");
  await shutdown();
  console.log("Done. Events submitted to PostHog ingest.");

  console.log("\nNext: check the PostHog dashboard within 30 seconds.");
  console.log("  Activity → Live events  (or Events → Live events)");
  console.log(`  Look for: ${EVENT_NAME}  from distinct_id=${DISTINCT_ID}\n`);
}

main().catch(async (err) => {
  console.error("smoke-posthog failed:", err);
  try {
    await shutdown();
  } catch {
    /* best-effort flush */
  }
  process.exit(1);
});
