/**
 * verify-schema.ts — introspects the connected Neon database and asserts
 * that Phase 0's schema landed exactly as PLAN.md §2 specifies.
 *
 * Runs against DATABASE_URL. Read-only — never modifies. Re-runnable any
 * time the schema changes (Phase 1+ migrations should leave the existing
 * Phase 0 invariants intact).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { neon } from "@neondatabase/serverless";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (check .env.local)");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

const EXPECTED_TABLES = [
  "equipment",
  "goal_drafts",
  "goals",
  "intake_summaries",
  "milestones",
  "recurring_tasks",
  "replan_proposals",
  "stripe_webhook_events",
  "subscriptions",
  "task_completions",
  "usage_counters",
  "users",
  "weekly_check_ins",
];

const EXPECTED_ENUMS: Record<string, string[]> = {
  activity_type: [
    "climbing",
    "mountaineering",
    "running",
    "cycling",
    "swimming",
    "strength",
    "language",
    "writing",
    "instrument",
    "business",
    "study",
    "other",
  ],
  archive_reason: [
    "user_action",
    "trial_expired_no_action",
    "downgrade_selection",
  ],
  billing_period: ["monthly", "annual"],
  goal_status: ["active", "completed", "archived"], // NO `paused` per DECISIONS.md
  intensity_level: ["comfortable", "challenging", "brutal"],
  replan_status: ["pending", "accepted", "partially_accepted", "rejected"],
  replan_trigger: ["weekly_check_in", "structural_edit"],
  subscription_status: [
    "trialing",
    "active",
    "past_due",
    "canceled",
    "incomplete",
    "incomplete_expired",
    "unpaid",
    "paused",
  ],
  task_cadence: ["daily", "weekly"],
  user_tier: ["free", "pro", "max"],
  // 'skipped' appended last (revision 3): written only by the check-in skip
  // path; excluded from feeling-signal queries.
  weekly_feeling: ["too_easy", "right", "too_hard", "skipped"],
};

interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
}

async function checkTables() {
  const rows = (await sql`
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename
  `) as Array<{ tablename: string }>;
  const found = rows.map((r) => r.tablename);
  const missing = EXPECTED_TABLES.filter((t) => !found.includes(t));
  const extra = found.filter((t) => !EXPECTED_TABLES.includes(t));
  if (missing.length === 0 && extra.length === 0) {
    record("tables", true, `${found.length} tables, all match`);
  } else {
    const bits = [];
    if (missing.length) bits.push(`missing: ${missing.join(", ")}`);
    if (extra.length) bits.push(`unexpected: ${extra.join(", ")}`);
    record("tables", false, bits.join(" | "));
  }
}

async function checkEnums() {
  const rows = (await sql`
    SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder
  `) as Array<{ typname: string; enumlabel: string }>;
  const grouped: Record<string, string[]> = {};
  for (const r of rows) {
    (grouped[r.typname] ||= []).push(r.enumlabel);
  }
  for (const [name, expected] of Object.entries(EXPECTED_ENUMS)) {
    const actual = grouped[name];
    if (!actual) {
      record(`enum:${name}`, false, "type missing");
      continue;
    }
    const sameOrderAndValues =
      actual.length === expected.length &&
      actual.every((v, i) => v === expected[i]);
    if (sameOrderAndValues) {
      record(`enum:${name}`, true, `[${actual.join(", ")}]`);
    } else {
      record(
        `enum:${name}`,
        false,
        `expected [${expected.join(", ")}], got [${actual.join(", ")}]`,
      );
    }
  }
  // Bonus check: ensure goal_status does NOT have 'paused' (was removed
  // explicitly per DECISIONS.md). Caught by the strict-equality test
  // above; surfacing as its own line for visibility.
  const goalStatus = grouped["goal_status"] ?? [];
  record(
    "enum:goal_status no paused",
    !goalStatus.includes("paused"),
    goalStatus.includes("paused")
      ? "'paused' present — should have been removed per DECISIONS.md"
      : "confirmed absent",
  );
}

async function checkPartialUniqueOnSubscriptions() {
  const rows = (await sql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'subscriptions'
      AND indexname = 'subscriptions_one_active_per_user'
  `) as Array<{ indexdef: string }>;
  if (rows.length === 0) {
    record("partial uniq: subscriptions one_active_per_user", false, "index missing");
    return;
  }
  const def = rows[0]!.indexdef;
  const ok =
    /CREATE UNIQUE INDEX/i.test(def) &&
    /WHERE/i.test(def) &&
    /trialing/.test(def) &&
    /active/.test(def);
  record(
    "partial uniq: subscriptions one_active_per_user",
    ok,
    ok ? "present with WHERE status IN ('trialing','active')" : `definition off: ${def}`,
  );
}

async function checkPartialIndexOnUsersDeletedAt() {
  const rows = (await sql`
    SELECT indexdef
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename = 'users'
      AND indexname = 'users_deleted_at_idx'
  `) as Array<{ indexdef: string }>;
  if (rows.length === 0) {
    record("partial idx: users.deleted_at", false, "index missing");
    return;
  }
  const def = rows[0]!.indexdef;
  const ok = /WHERE/i.test(def) && /deleted_at IS NOT NULL/i.test(def);
  record(
    "partial idx: users.deleted_at",
    ok,
    ok ? "present with WHERE deleted_at IS NOT NULL" : `definition off: ${def}`,
  );
}

async function checkStripeWebhookEventsShape() {
  const rows = (await sql`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'stripe_webhook_events'
    ORDER BY ordinal_position
  `) as Array<{ column_name: string }>;
  const cols = rows.map((r) => r.column_name);
  const expected = ["event_id", "type", "processed_at"];
  const ok =
    cols.length === expected.length &&
    cols.every((c, i) => c === expected[i]);
  record(
    "stripe_webhook_events shape",
    ok,
    ok
      ? "exactly [event_id, type, processed_at] — no updated_at"
      : `got [${cols.join(", ")}]`,
  );
}

async function checkFkOnDeleteBehaviors() {
  const expected: Array<{ from: string; to: string; action: string }> = [
    { from: "goal_drafts", to: "users", action: "c" }, // CASCADE
    { from: "goals", to: "users", action: "r" }, // RESTRICT
    { from: "subscriptions", to: "users", action: "r" },
    { from: "task_completions", to: "users", action: "r" },
    { from: "usage_counters", to: "users", action: "c" },
    { from: "weekly_check_ins", to: "users", action: "r" },
    { from: "intake_summaries", to: "goals", action: "c" },
    { from: "recurring_tasks", to: "goals", action: "c" },
    { from: "milestones", to: "goals", action: "r" },
    { from: "equipment", to: "goals", action: "c" },
    { from: "replan_proposals", to: "goals", action: "c" },
    { from: "task_completions", to: "recurring_tasks", action: "r" },
    { from: "equipment", to: "milestones", action: "n" }, // SET NULL
    { from: "replan_proposals", to: "weekly_check_ins", action: "n" },
  ];
  // pg_constraint.confdeltype: c=CASCADE, r=RESTRICT, n=SET NULL, a=NO ACTION
  const rows = (await sql`
    SELECT
      conrelid::regclass::text AS from_table,
      confrelid::regclass::text AS to_table,
      confdeltype AS action
    FROM pg_constraint
    WHERE contype = 'f'
      AND connamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
  `) as Array<{ from_table: string; to_table: string; action: string }>;
  let mismatches = 0;
  for (const e of expected) {
    const found = rows.find(
      (r) => r.from_table === e.from && r.to_table === e.to,
    );
    if (!found) {
      mismatches++;
      record(
        `fk: ${e.from} → ${e.to}`,
        false,
        "constraint missing",
      );
      continue;
    }
    if (found.action !== e.action) {
      mismatches++;
      const got = { c: "CASCADE", r: "RESTRICT", n: "SET NULL", a: "NO ACTION" }[
        found.action
      ];
      const want = { c: "CASCADE", r: "RESTRICT", n: "SET NULL", a: "NO ACTION" }[
        e.action
      ];
      record(`fk: ${e.from} → ${e.to}`, false, `expected ${want}, got ${got}`);
    }
  }
  if (mismatches === 0) {
    record(
      "fk on-delete behaviors",
      true,
      `${expected.length} foreign keys match PLAN.md §2`,
    );
  }
}

async function main() {
  console.log("\n— Schema verification against connected Neon branch —\n");
  console.log(`DB: ${new URL(process.env.DATABASE_URL!).host}\n`);

  await checkTables();
  await checkEnums();
  await checkPartialUniqueOnSubscriptions();
  await checkPartialIndexOnUsersDeletedAt();
  await checkStripeWebhookEventsShape();
  await checkFkOnDeleteBehaviors();

  console.log("Results:");
  const nameWidth = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const status = r.ok ? "PASS" : "FAIL";
    console.log(`  ${r.name.padEnd(nameWidth)}  ${status}  ${r.detail}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log("");
  if (failed.length === 0) {
    console.log(
      `All ${results.length} schema invariants verified against the live DB.`,
    );
    process.exit(0);
  } else {
    console.log(`${failed.length} of ${results.length} checks failed.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
