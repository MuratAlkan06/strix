import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Reusable timestamp columns. Every table includes created_at + updated_at
// except stripe_webhook_events, which carries only processed_at.
// ---------------------------------------------------------------------------
const timestamps = {
  created_at: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------
export const userTier = pgEnum("user_tier", ["free", "pro", "max"]);

export const intensityLevel = pgEnum("intensity_level", [
  "comfortable",
  "challenging",
  "brutal",
]);

export const goalStatus = pgEnum("goal_status", [
  "active",
  "completed",
  "archived",
]);

export const taskCadence = pgEnum("task_cadence", ["daily", "weekly"]);

// 'skipped' is written ONLY by the check-in "Skip this week" path — skips are
// not sentiment data and are excluded from any feeling-signal query (replan
// prompts, analytics aggregates). Appended last to keep enum order stable.
export const weeklyFeeling = pgEnum("weekly_feeling", [
  "too_easy",
  "right",
  "too_hard",
  "skipped",
]);

export const replanTrigger = pgEnum("replan_trigger", [
  "weekly_check_in",
  "structural_edit",
]);

export const replanStatus = pgEnum("replan_status", [
  "pending",
  "accepted",
  "partially_accepted",
  "rejected",
]);

export const activityType = pgEnum("activity_type", [
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
]);

export const billingPeriod = pgEnum("billing_period", ["monthly", "annual"]);

// Mirrors the Stripe subscription.status values we actually expect to store.
export const subscriptionStatus = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "unpaid",
  "paused",
]);

export const archiveReason = pgEnum("archive_reason", [
  "user_action",
  "trial_expired_no_action",
  "downgrade_selection",
]);

// ---------------------------------------------------------------------------
// users — Clerk's user_id is the PK (text). intensity_preference is NULL
// until the user explicitly confirms one at the end of intake.
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    display_name: text("display_name"),
    timezone: text("timezone").notNull().default("UTC"),
    intensity_preference: intensityLevel("intensity_preference"),
    tier: userTier("tier").notNull().default("free"),
    stripe_customer_id: text("stripe_customer_id"),
    deleted_at: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    // Partial index for the Phase 4 hard-delete cron scan.
    deletedAtIdx: index("users_deleted_at_idx")
      .on(t.deleted_at)
      .where(sql`${t.deleted_at} IS NOT NULL`),
  }),
);

// ---------------------------------------------------------------------------
// subscriptions
// ---------------------------------------------------------------------------
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    stripe_subscription_id: text("stripe_subscription_id").notNull().unique(),
    tier: userTier("tier").notNull(),
    billing_period: billingPeriod("billing_period").notNull(),
    status: subscriptionStatus("status").notNull(),
    current_period_start: timestamp("current_period_start", {
      withTimezone: true,
    }),
    current_period_end: timestamp("current_period_end", { withTimezone: true }),
    trial_start: timestamp("trial_start", { withTimezone: true }),
    trial_end: timestamp("trial_end", { withTimezone: true }),
    cancel_at_period_end: boolean("cancel_at_period_end")
      .notNull()
      .default(false),
    // Write-once: set when user completes the downgrade-and-archive screen;
    // webhook handlers MUST NOT overwrite. The single exception is the
    // "Resume Max" before trial-end flow, which clears it back to NULL.
    canceled_at: timestamp("canceled_at", { withTimezone: true }),
    // Trial-cancel deferred-execution selection. Populated when a trialing
    // user cancels; consumed by `applyPendingArchive` at trial-end.
    pending_archive_goal_ids: jsonb("pending_archive_goal_ids").$type<
      string[] | null
    >(),
    pending_archive_decided_at: timestamp("pending_archive_decided_at", {
      withTimezone: true,
    }),
    // Idempotency marker for the `trialReminderTomorrow` Inngest job.
    trial_reminder_sent_at: timestamp("trial_reminder_sent_at", {
      withTimezone: true,
    }),
    // Set when this subscription is being replaced by another (e.g. Max→Pro
    // cancel+create). The customer.subscription.deleted handler must skip
    // tier/goal logic for superseded rows (still syncing status='canceled')
    // — the created/deleted webhook pair arrives in arbitrary order, and
    // without this marker the deleted event routes down a cancel path that
    // would clobber the new subscription's tier. Cleared if the transition
    // aborts before completing.
    superseded_at: timestamp("superseded_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    // One active subscription row per user. Canceled / past_due rows can
    // accumulate as history.
    oneActivePerUser: uniqueIndex("subscriptions_one_active_per_user")
      .on(t.user_id)
      .where(sql`${t.status} IN ('trialing', 'active')`),
  }),
);

// ---------------------------------------------------------------------------
// usage_counters — one row per user per calendar month
// (per §3.5: calendar-1st reset in user's timezone).
// ---------------------------------------------------------------------------
export const usage_counters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    period_start: date("period_start").notNull(),
    period_end: date("period_end").notNull(),
    plan_generations_used: integer("plan_generations_used")
      .notNull()
      .default(0),
    replans_used: integer("replans_used").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    userPeriodUnique: uniqueIndex("usage_counters_user_period_uniq").on(
      t.user_id,
      t.period_start,
    ),
  }),
);

// ---------------------------------------------------------------------------
// goals
// ---------------------------------------------------------------------------
export const goals = pgTable(
  "goals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    description: text("description"),
    status: goalStatus("status").notNull().default("active"),
    color_index: integer("color_index").notNull(),
    intensity_override: intensityLevel("intensity_override"),
    target_date: date("target_date"),
    started_at: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    archived_at: timestamp("archived_at", { withTimezone: true }),
    auto_archive_at: timestamp("auto_archive_at", { withTimezone: true }),
    archive_reason: archiveReason("archive_reason"),
    archive_notice_dismissed_at: timestamp("archive_notice_dismissed_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (t) => ({
    userStatusIdx: index("goals_user_id_status_idx").on(t.user_id, t.status),
  }),
);

// ---------------------------------------------------------------------------
// goal_drafts — stages intake transcripts and plan_draft before "Save goal"
// commits the materialized rows.
// ---------------------------------------------------------------------------
export const goal_drafts = pgTable(
  "goal_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // ~32 bytes base64url opaque token. Mapped to an HttpOnly cookie.
    session_token: text("session_token").notNull(),
    // Whitelisted slug for empty-state tile (e.g. "climb", "language").
    // Server-side whitelist: {climb, language, race, book, instrument}.
    seed: text("seed"),
    raw_transcript: jsonb("raw_transcript").notNull().default(sql`'[]'::jsonb`),
    intake_summary_draft: jsonb("intake_summary_draft"),
    plan_draft: jsonb("plan_draft"),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (t) => ({
    userExpiresIdx: index("goal_drafts_user_id_expires_at_idx").on(
      t.user_id,
      t.expires_at,
    ),
    // UNIQUE: the token is a random cookie-mapped lookup credential — one
    // draft per token, deterministic cookie resolution.
    sessionTokenIdx: uniqueIndex("goal_drafts_session_token_idx").on(
      t.session_token,
    ),
  }),
);

// ---------------------------------------------------------------------------
// intake_summaries — goal_id is NULL while staged in goal_drafts; populated
// at "Save goal" time. Required structured fields for v3 partner matching.
// ---------------------------------------------------------------------------
export const intake_summaries = pgTable("intake_summaries", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Nullable until "Save goal" is committed.
  goal_id: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
  one_sentence_goal: text("one_sentence_goal").notNull(),
  starting_point: text("starting_point").notNull(),
  prior_experience: text("prior_experience"),
  suggested_intensity: intensityLevel("suggested_intensity"),
  confirmed_intensity: intensityLevel("confirmed_intensity").notNull(),
  days_per_week: integer("days_per_week"),
  time_per_session_min: integer("time_per_session_min"),
  budget_usd: numeric("budget_usd", { precision: 10, scale: 2 }),
  location_city: text("location_city"),
  location_region: text("location_region"),
  location_country: text("location_country"),
  activity_type: activityType("activity_type").notNull(),
  activity_type_other_label: text("activity_type_other_label"),
  // [{ concern, alternative, user_overrode, decided_at }]
  safety_flags: jsonb("safety_flags").notNull().default(sql`'[]'::jsonb`),
  raw_transcript: jsonb("raw_transcript").notNull(),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// recurring_tasks
// ---------------------------------------------------------------------------
export const recurring_tasks = pgTable("recurring_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  goal_id: uuid("goal_id")
    .notNull()
    .references(() => goals.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  cadence: taskCadence("cadence").notNull(),
  weekday: integer("weekday"), // 0-6, required when cadence='weekly'
  estimated_duration_min: integer("estimated_duration_min"),
  active: boolean("active").notNull().default(true),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// task_completions
// ---------------------------------------------------------------------------
export const task_completions = pgTable(
  "task_completions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recurring_task_id: uuid("recurring_task_id")
      .notNull()
      .references(() => recurring_tasks.id, { onDelete: "restrict" }),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Denormalized for dashboard query speed.
    goal_id: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "restrict" }),
    for_date: date("for_date").notNull(),
    completed_at: timestamp("completed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (t) => ({
    taskDateUnique: uniqueIndex("task_completions_task_for_date_uniq").on(
      t.recurring_task_id,
      t.for_date,
    ),
    userForDateIdx: index("task_completions_user_id_for_date_idx").on(
      t.user_id,
      t.for_date,
    ),
  }),
);

// ---------------------------------------------------------------------------
// milestones
// ---------------------------------------------------------------------------
export const milestones = pgTable(
  "milestones",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goal_id: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "restrict" }),
    title: text("title").notNull(),
    target_date: date("target_date"),
    completed_at: timestamp("completed_at", { withTimezone: true }),
    position: integer("position").notNull().default(0),
    ...timestamps,
  },
  (t) => ({
    goalPositionIdx: index("milestones_goal_id_position_idx").on(
      t.goal_id,
      t.position,
    ),
  }),
);

// ---------------------------------------------------------------------------
// equipment — exactly one of milestone_id / standalone_deadline is set
// (application invariant; not enforced at DB level).
// ---------------------------------------------------------------------------
export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goal_id: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    cost_usd: numeric("cost_usd", { precision: 10, scale: 2 }),
    milestone_id: uuid("milestone_id").references(() => milestones.id, {
      onDelete: "set null",
    }),
    standalone_deadline: date("standalone_deadline"),
    purchased_at: timestamp("purchased_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    goalIdx: index("equipment_goal_id_idx").on(t.goal_id),
  }),
);

// ---------------------------------------------------------------------------
// weekly_check_ins — user-scoped; one row per user per week.
// ---------------------------------------------------------------------------
export const weekly_check_ins = pgTable(
  "weekly_check_ins",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    week_start_date: date("week_start_date").notNull(),
    feeling: weeklyFeeling("feeling").notNull(),
    notes: text("notes"),
    ...timestamps,
  },
  (t) => ({
    userWeekUnique: uniqueIndex(
      "weekly_check_ins_user_id_week_start_date_uniq",
    ).on(t.user_id, t.week_start_date),
  }),
);

// ---------------------------------------------------------------------------
// replan_proposals
// ---------------------------------------------------------------------------
export const replan_proposals = pgTable(
  "replan_proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    goal_id: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    // Denormalized from goals.user_id for soft-delete-filter join speed +
    // PostHog event firing.
    user_id: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    trigger: replanTrigger("trigger").notNull(),
    weekly_check_in_id: uuid("weekly_check_in_id").references(
      () => weekly_check_ins.id,
      { onDelete: "set null" },
    ),
    // Zod-typed diff in Phase 2:
    // { recurring_tasks: {add,modify,remove}, milestones: {...}, equipment: {...} }
    proposed_changes: jsonb("proposed_changes").notNull(),
    status: replanStatus("status").notNull().default("pending"),
    decided_at: timestamp("decided_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => ({
    userIdx: index("replan_proposals_user_id_idx").on(t.user_id),
  }),
);

// ---------------------------------------------------------------------------
// stripe_webhook_events — Stripe-event idempotency log.
// Insert before processing; PK conflict means already handled.
// Append-only — no updated_at.
// ---------------------------------------------------------------------------
export const stripe_webhook_events = pgTable("stripe_webhook_events", {
  event_id: text("event_id").primaryKey(),
  type: text("type").notNull(),
  processed_at: timestamp("processed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
