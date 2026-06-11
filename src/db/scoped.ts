/**
 * scopedDb(userId) — the only DB access path for user-authenticated code paths.
 *
 * Guarantees:
 *   - Every read injects an ownership filter so cross-user reads are empty.
 *   - Every insert is a single atomic INSERT … SELECT whose SELECT proves
 *     ownership (and that the user is live) in the same statement — zero rows
 *     inserted means the proof failed and we throw. No check-then-insert
 *     window, and one DB round-trip instead of two.
 *   - update().set() payloads are validated against per-table forbidden keys
 *     (ownership/scope columns can never be rewritten). This guarantee
 *     assumes plain parameterized values in `set` — raw sql`` fragments
 *     bypass key inspection and must never be built from anything
 *     user-influenced.
 *   - Soft-deleted users (users.deleted_at IS NOT NULL) get empty results
 *     and rejected writes (reads, updates, deletes AND inserts) — built in
 *     from Phase 0, not bolted on in Phase 4.
 *   - transaction(fn) runs fn inside a single Postgres transaction whose
 *     callback surface is the same scoped binding (ScopedTx) — every
 *     statement inside keeps all of the above; a throw rolls everything back.
 *     ScopedTx additionally exposes lockScope(namespace), a per-user advisory
 *     transaction lock for serializing concurrent same-user work (the key
 *     embeds the scoped userId, so a user can only lock their own scope).
 *
 * Direct-ownership tables (filter on `user_id = userId`):
 *   goals, goal_drafts, usage_counters, weekly_check_ins, subscriptions,
 *   task_completions
 *
 * Transitive-ownership tables (filter on parent goal ownership):
 *   intake_summaries, recurring_tasks, milestones, equipment, replan_proposals
 *
 * The `users` row itself is reachable only through getSelf()/updateSelf(),
 * which are pinned to the scoped user's own live row and forbid mutating
 * system-managed columns (id, email, tier, stripe_customer_id, deleted_at —
 * those belong to the Clerk/Stripe webhooks and the auth lifecycle module).
 *
 * If you need a genuinely cross-user query (webhook, Inngest job) or must
 * bypass the soft-delete filter (account lifecycle), import `unscopedDb`
 * from "@/db/unscoped". A CI check (scripts/check-unscoped-db.mjs) restricts
 * those imports to lib/inngest/*, app/api/webhooks/*,
 * lib/auth/lifecycle.ts, and the fixture lifecycle of the env-gated
 * db/scoped.integration.test.ts.
 */
import {
  and,
  count,
  eq,
  getTableColumns,
  is,
  isNull,
  sql,
  SQL,
} from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { internalDb, withTransactionalDb, type Db } from "./client";
import {
  equipment,
  goals,
  goal_drafts,
  intake_summaries,
  milestones,
  recurring_tasks,
  replan_proposals,
  subscriptions,
  task_completions,
  usage_counters,
  users,
  weekly_check_ins,
} from "./schema";

// ---------------------------------------------------------------------------
// Table classification
// ---------------------------------------------------------------------------
const directOwnership = new Map<PgTable, { user_id: unknown }>([
  [goals, goals],
  [goal_drafts, goal_drafts],
  [usage_counters, usage_counters],
  [weekly_check_ins, weekly_check_ins],
  [subscriptions, subscriptions],
  [task_completions, task_completions],
] as const as Array<[PgTable, { user_id: unknown }]>);

const transitiveOwnership = new Map<PgTable, { goal_id: unknown }>([
  [intake_summaries, intake_summaries],
  [recurring_tasks, recurring_tasks],
  [milestones, milestones],
  [equipment, equipment],
  [replan_proposals, replan_proposals],
] as const as Array<[PgTable, { goal_id: unknown }]>);

function isDirectOwnership(
  table: PgTable,
): table is PgTable & { user_id: unknown } {
  return directOwnership.has(table);
}

function isTransitiveOwnership(
  table: PgTable,
): table is PgTable & { goal_id: unknown } {
  return transitiveOwnership.has(table);
}

// ---------------------------------------------------------------------------
// Per-table keys forbidden in `update(...).set` and in transitive insert
// payloads. Mutating these would defeat the scope: e.g. `update(goals, { set:
// { user_id: victim } })` would transfer ownership, `update(milestones, { set:
// { goal_id: victim_goal_id } })` would re-parent into someone else's goal.
// The scope filter protects WHICH rows you can touch — this list protects
// WHAT you can write into them.
//
// `id` is included everywhere to prevent re-keying a row to collide with an
// existing one.
// ---------------------------------------------------------------------------
const forbiddenMutationKeys: ReadonlyMap<PgTable, ReadonlyArray<string>> =
  new Map<PgTable, ReadonlyArray<string>>([
    // Direct-ownership
    [goals, ["id", "user_id"]],
    [goal_drafts, ["id", "user_id"]],
    [usage_counters, ["id", "user_id"]],
    [weekly_check_ins, ["id", "user_id"]],
    [subscriptions, ["id", "user_id"]],
    [task_completions, ["id", "user_id", "goal_id", "recurring_task_id"]],
    // Transitive-ownership
    [intake_summaries, ["id", "goal_id"]],
    [recurring_tasks, ["id", "goal_id"]],
    [milestones, ["id", "goal_id"]],
    [equipment, ["id", "goal_id"]],
    [replan_proposals, ["id", "goal_id", "user_id"]],
  ] as Array<[PgTable, ReadonlyArray<string>]>);

function assertNoForbiddenKeys(table: PgTable, payload: object, op: string) {
  const forbidden = forbiddenMutationKeys.get(table);
  if (!forbidden) return;
  const present = forbidden.filter((k) =>
    Object.prototype.hasOwnProperty.call(payload, k),
  );
  if (present.length > 0) {
    throw new ScopedDbError(
      `scopedDb.${op}: forbidden key(s) in payload — ${present.join(", ")}. ` +
        `These columns define ownership/scope and cannot be mutated through ` +
        `scopedDb. If you genuinely need to re-parent or transfer ownership, ` +
        `do it through unscopedDb in an authorized webhook/job context.`,
    );
  }
}

class ScopedDbError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScopedDbError";
  }
}

function requireUserId(userId: string | undefined | null): asserts userId is string {
  if (!userId || typeof userId !== "string" || userId.length === 0) {
    throw new ScopedDbError(
      "scopedDb requires a non-empty userId. Pass auth().userId from a route handler.",
    );
  }
}

// ---------------------------------------------------------------------------
// Scope clauses
// ---------------------------------------------------------------------------

/**
 * Subquery asserting the user exists and is not soft-deleted.
 * AND-merged into every scoped clause so a deleted user's data is invisible.
 */
function userIsLive(userId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${users}
    WHERE ${users.id} = ${userId}
      AND ${users.deleted_at} IS NULL
  )`;
}

/**
 * For direct-ownership tables: user_id = $userId AND user-is-live.
 */
function directScope(
  table: PgTable & { user_id: unknown },
  userId: string,
): SQL {
  const userIdCol = (table as unknown as { user_id: never }).user_id;
  return and(eq(userIdCol, userId), userIsLive(userId)) as SQL;
}

/**
 * For transitive-ownership tables: an EXISTS subquery proving the parent goal
 * belongs to the (live) user. Joining users in the subquery covers the soft-
 * delete filter in a single trip.
 */
function transitiveScope(
  table: PgTable & { goal_id: unknown },
  userId: string,
): SQL {
  const goalIdCol = (table as unknown as { goal_id: never }).goal_id;
  return sql`EXISTS (
    SELECT 1 FROM ${goals}
    JOIN ${users} ON ${users.id} = ${goals.user_id}
    WHERE ${goals.id} = ${goalIdCol}
      AND ${goals.user_id} = ${userId}
      AND ${users.deleted_at} IS NULL
  )`;
}

function tableScope(table: PgTable, userId: string): SQL {
  if (isDirectOwnership(table)) return directScope(table, userId);
  if (isTransitiveOwnership(table)) return transitiveScope(table, userId);
  throw new ScopedDbError(
    `scopedDb: table is not classified as direct- or transitive-ownership. ` +
      `If this table is genuinely cross-user, use unscopedDb. Otherwise add it ` +
      `to the directOwnership or transitiveOwnership map in src/db/scoped.ts.`,
  );
}

// ---------------------------------------------------------------------------
// Atomic-insert projection helpers
//
// Inserts are issued as a single INSERT … SELECT whose SELECT side carries
// the ownership/live-user proof (a row exists ⇔ the write is authorized).
// The payload becomes a projection of casted constants. Raw-SQL projections
// bypass drizzle's column-type driver mapping, so values are explicitly cast
// to the column's SQL type — and jsonb values are stringified first (the
// neon driver would otherwise misread JS arrays as Postgres arrays).
// ---------------------------------------------------------------------------

function castParam(column: PgColumn, value: unknown): SQL {
  const sqlType = column.getSQLType();
  if (sqlType === "jsonb") {
    return sql`${value === null ? null : JSON.stringify(value)}::jsonb`;
  }
  if (value instanceof Date) {
    return sql`${value.toISOString()}::${sql.raw(sqlType)}`;
  }
  return sql`${value}::${sql.raw(sqlType)}`;
}

/** SQL for a column the payload didn't provide: its declared default, or a
 *  typed NULL when nullable. Returns null when the column is required. */
function defaultSql(col: PgColumn): SQL | null {
  if (col.hasDefault) {
    const d = (col as unknown as { default?: unknown }).default;
    if (d !== undefined) {
      return is(d, SQL) ? d : castParam(col, d);
    }
    const fn = (col as unknown as { defaultFn?: () => unknown }).defaultFn;
    if (fn) return castParam(col, fn());
  }
  if (!col.notNull) return sql`NULL::${sql.raw(col.getSQLType())}`;
  return null;
}

/**
 * Drizzle's insert().select() requires the projection to cover EVERY table
 * column in definition order — so absent payload keys are filled with the
 * column's default expression (or typed NULL), preserving plain-insert
 * semantics. `overrides` lets a caller substitute a derived expression
 * (e.g. task_completions.goal_id ← recurring_tasks.goal_id).
 */
function buildScopedProjection(
  table: PgTable,
  payload: Record<string, unknown>,
  op: string,
  overrides?: Record<string, SQL>,
): Record<string, SQL> {
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  for (const [key, value] of Object.entries(payload)) {
    if (value === undefined) continue;
    if (!cols[key]) {
      throw new ScopedDbError(
        `scopedDb.${op}: unknown column "${key}" for this table.`,
      );
    }
  }
  const projection: Record<string, SQL> = {};
  for (const [key, col] of Object.entries(cols)) {
    if (overrides && key in overrides) {
      projection[key] = overrides[key]!;
      continue;
    }
    const value = payload[key];
    if (value !== undefined) {
      projection[key] = castParam(col, value);
      continue;
    }
    const fallback = defaultSql(col);
    if (!fallback) {
      throw new ScopedDbError(
        `scopedDb.${op}: missing required column "${key}" (no default, not nullable).`,
      );
    }
    projection[key] = fallback;
  }
  return projection;
}

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

type SelectOptions = { where?: SQL };
type UpdateOptions<T extends PgTable> = {
  set: PgUpdateSetSource<T>;
  where?: SQL;
};
type DeleteOptions = { where?: SQL };

/** users-row columns a user may edit about themselves. Everything else is
 *  system-managed: id/email come from Clerk, tier/stripe_customer_id from
 *  Stripe webhooks, deleted_at from the auth lifecycle module. */
type SelfUpdatableKeys = "display_name" | "timezone" | "intensity_preference";
type SelfUpdate = Partial<Pick<typeof users.$inferInsert, SelfUpdatableKeys>>;

const SELF_UPDATE_FORBIDDEN = [
  "id",
  "email",
  "tier",
  "stripe_customer_id",
  "deleted_at",
  "created_at",
] as const;

/** The scoped surface shared by scopedDb and its transaction binding. */
type ScopedBase = Omit<ScopedDb, "transaction">;

/**
 * The scoped surface available INSIDE scopedDb().transaction — ScopedDb minus
 * `transaction` itself (no nesting), plus the transaction-only `lockScope`.
 * Every statement issued on it carries the same ownership + soft-delete
 * discipline as outside a transaction: the binding is per-executor, never
 * per-statement.
 */
export interface ScopedTx extends ScopedBase {
  /**
   * Serialize concurrent work for the scoped user: takes a Postgres advisory
   * TRANSACTION lock (pg_advisory_xact_lock) keyed on a stable 64-bit hash of
   * `namespace:userId`, blocking until any concurrent holder of the same key
   * commits or rolls back. Released automatically at transaction end — no
   * unlock call exists or is needed.
   *
   * Ownership discipline: the scoped userId is baked into the key, so a
   * caller can only ever serialize against ITSELF — never take (or contend
   * on) another user's lock. `namespace` must be a compile-time constant
   * (it is parameterized, so injection-safe regardless, but a user-influenced
   * namespace would fragment the serialization it exists to provide).
   *
   * Transaction-only by design: an advisory xact lock outside an explicit
   * transaction spans a single statement and serializes nothing.
   */
  lockScope(namespace: string): Promise<void>;
}

export interface ScopedDb {
  readonly userId: string;

  /** Return rows from `table` owned by the scoped user (with optional extra where). */
  selectFrom<T extends PgTable>(
    table: T,
    opts?: SelectOptions,
  ): Promise<T["$inferSelect"][]>;

  /** The scoped user's own users row, or null if missing / soft-deleted. */
  getSelf(): Promise<(typeof users.$inferSelect) | null>;

  /** Update the scoped user's own users row (live rows only). Only
   *  display_name / timezone / intensity_preference are writable. */
  updateSelf(set: SelfUpdate): Promise<(typeof users.$inferSelect)[]>;

  /** Count rows owned by the scoped user (with optional extra where). */
  count<T extends PgTable>(table: T, opts?: SelectOptions): Promise<number>;

  /** Insert into a direct- or transitive-ownership table. Pre-validates ownership. */
  insert<T extends PgTable>(
    table: T,
    values: T["$inferInsert"],
  ): Promise<T["$inferSelect"][]>;

  /** Update rows owned by the scoped user. Ownership filter is AND-merged. */
  update<T extends PgTable>(
    table: T,
    opts: UpdateOptions<T>,
  ): Promise<T["$inferSelect"][]>;

  /** Delete rows owned by the scoped user. Ownership filter is AND-merged. */
  delete<T extends PgTable>(
    table: T,
    opts?: DeleteOptions,
  ): Promise<T["$inferSelect"][]>;

  /**
   * Run `fn` inside a single Postgres transaction (all-or-nothing). The
   * callback receives the SAME scoped surface bound to the transaction
   * client, so every statement inside keeps the ownership, forbidden-key,
   * and soft-delete guarantees — there is no raw-client escape hatch here.
   * A thrown error (including any ScopedDbError from a failed ownership
   * proof) rolls the whole transaction back.
   */
  transaction<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T>;
}

/**
 * Bind a userId to the constrained surface over a specific executor — the
 * module-scope HTTP client for scopedDb itself, or a transaction client for
 * scopedDb().transaction. All guarantees live here, parameterized only by
 * WHICH connection runs the statements.
 */
function bindScoped(db: Db, userId: string): ScopedBase {
  return {
    userId,

    async getSelf() {
      const rows = await db
        .select()
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deleted_at)))
        .limit(1);
      return rows[0] ?? null;
    },

    async updateSelf(set) {
      const present = SELF_UPDATE_FORBIDDEN.filter((k) =>
        Object.prototype.hasOwnProperty.call(set, k),
      );
      if (present.length > 0) {
        throw new ScopedDbError(
          `scopedDb.updateSelf: forbidden key(s) — ${present.join(", ")}. ` +
            `These columns are system-managed (Clerk/Stripe webhooks or the ` +
            `auth lifecycle module), not user-editable profile fields.`,
        );
      }
      return db
        .update(users)
        .set({ ...set, updated_at: new Date() })
        .where(and(eq(users.id, userId), isNull(users.deleted_at)))
        .returning();
    },

    async selectFrom(table, opts) {
      const scope = tableScope(table, userId);
      const where = opts?.where ? (and(scope, opts.where) as SQL) : scope;
      return db.select().from(table).where(where) as Promise<
        (typeof table)["$inferSelect"][]
      >;
    },

    async count(table, opts) {
      const scope = tableScope(table, userId);
      const where = opts?.where ? (and(scope, opts.where) as SQL) : scope;
      const rows = await db
        .select({ value: count() })
        .from(table)
        .where(where);
      return Number(rows[0]?.value ?? 0);
    },

    async insert(table, values) {
      if (isDirectOwnership(table)) {
        // user_id in payload must match the scoped userId (we'll overwrite
        // either way, but a mismatch is a sign the caller is confused or
        // adversarial — fail loudly rather than silently rewrite it).
        const payloadUserId = (values as { user_id?: unknown }).user_id;
        if (payloadUserId !== undefined && payloadUserId !== userId) {
          throw new ScopedDbError(
            `scopedDb.insert: payload.user_id (${String(
              payloadUserId,
            )}) does not match scoped userId (${userId}).`,
          );
        }
        const withUserId = {
          ...(values as object),
          user_id: userId,
        } as Record<string, unknown>;

        // task_completions: goal_id is DERIVED from the recurring task's
        // parent (it can never disagree with rt.goal_id); when the caller
        // supplies one anyway it is validated in the same statement and a
        // mismatch inserts zero rows. The SELECT side proves, atomically
        // with the insert, that the recurring task belongs to a goal owned
        // by the (live) scoped user.
        if ((table as PgTable) === (task_completions as PgTable)) {
          const recId = withUserId.recurring_task_id as string | undefined;
          const payloadGoalId = withUserId.goal_id as string | undefined;
          if (!recId) {
            throw new ScopedDbError(
              "scopedDb.insert(task_completions): recurring_task_id is required.",
            );
          }
          delete withUserId.goal_id;
          const projection = buildScopedProjection(table, withUserId, "insert", {
            goal_id: sql`${recurring_tasks.goal_id}`,
          });
          const conditions: SQL[] = [
            eq(recurring_tasks.id, recId) as SQL,
            eq(goals.user_id, userId) as SQL,
            isNull(users.deleted_at) as SQL,
          ];
          if (payloadGoalId !== undefined) {
            conditions.push(eq(recurring_tasks.goal_id, payloadGoalId) as SQL);
          }
          const rows = (await db
            .insert(table)
            .select(
              db
                .select(projection as never)
                .from(recurring_tasks)
                .innerJoin(goals, eq(goals.id, recurring_tasks.goal_id))
                .innerJoin(users, eq(users.id, goals.user_id))
                .where(and(...conditions)) as never,
            )
            .returning()) as (typeof table)["$inferSelect"][];
          if (rows.length === 0) {
            throw new ScopedDbError(
              `scopedDb.insert(task_completions): recurring_task_id ${recId}` +
                (payloadGoalId !== undefined ? ` + goal_id ${payloadGoalId}` : "") +
                ` is not an owned (task, parent-goal) pair for user ${userId} ` +
                `(forged task id, mismatched goal_id, or soft-deleted user).`,
            );
          }
          return rows;
        }

        // Other direct-ownership tables: the SELECT side proves the scoped
        // user exists and is live — a soft-deleted user's insert lands zero
        // rows and throws, matching read/update/delete behavior.
        const projection = buildScopedProjection(table, withUserId, "insert");
        const rows = (await db
          .insert(table)
          .select(
            db
              .select(projection as never)
              .from(users)
              .where(
                and(eq(users.id, userId), isNull(users.deleted_at)),
              ) as never,
          )
          .returning()) as (typeof table)["$inferSelect"][];
        if (rows.length === 0) {
          throw new ScopedDbError(
            `scopedDb.insert: user ${userId} not found or soft-deleted — write rejected.`,
          );
        }
        return rows;
      }

      if (isTransitiveOwnership(table)) {
        const goalId = (values as { goal_id?: string }).goal_id;
        if (!goalId) {
          throw new ScopedDbError(
            `scopedDb.insert: transitive-ownership table requires goal_id in payload.`,
          );
        }
        // Synchronous payload validation BEFORE the DB roundtrip:
        // for transitive tables that carry a denormalized user_id
        // (currently replan_proposals), require the payload's user_id to
        // match the scoped userId, then force-set it. Without this, a
        // caller could insert into their own goal with the victim's
        // user_id in the denormalized column, corrupting downstream
        // analytics joins.
        let safeValues = values as Record<string, unknown>;
        if ("user_id" in (values as object)) {
          const payloadUserId = (values as { user_id?: unknown }).user_id;
          if (payloadUserId !== undefined && payloadUserId !== userId) {
            throw new ScopedDbError(
              `scopedDb.insert: payload.user_id (${String(
                payloadUserId,
              )}) does not match scoped userId (${userId}).`,
            );
          }
          safeValues = { ...(values as object), user_id: userId } as Record<
            string,
            unknown
          >;
        }
        // Atomic ownership proof: SELECT from goals⋈users pinned to
        // (goal id, scoped user, live) — zero rows ⇔ not owned ⇔ throw.
        const projection = buildScopedProjection(table, safeValues, "insert");
        const rows = (await db
          .insert(table)
          .select(
            db
              .select(projection as never)
              .from(goals)
              .innerJoin(users, eq(users.id, goals.user_id))
              .where(
                and(
                  eq(goals.id, goalId),
                  eq(goals.user_id, userId),
                  isNull(users.deleted_at),
                ),
              ) as never,
          )
          .returning()) as (typeof table)["$inferSelect"][];
        if (rows.length === 0) {
          throw new ScopedDbError(
            `scopedDb: goal_id ${goalId} does not belong to user ${userId} (or user is soft-deleted).`,
          );
        }
        return rows;
      }

      throw new ScopedDbError(
        `scopedDb.insert: table is not classified as direct- or transitive-ownership.`,
      );
    },

    async update(table, opts) {
      // Forbidden-keys check: opts.set must not include ownership/scope
      // columns. Without this, a caller could do
      //   update(goals, { set: { user_id: victim } })
      // to transfer ownership of their own row, or
      //   update(milestones, { set: { goal_id: victim_goal_id } })
      // to re-parent into someone else's goal. The scope filter governs
      // WHICH rows are touchable; this check governs WHAT can be written.
      assertNoForbiddenKeys(table, opts.set as object, "update");
      const scope = tableScope(table, userId);
      const where = opts.where ? (and(scope, opts.where) as SQL) : scope;
      return db
        .update(table)
        .set(opts.set as PgUpdateSetSource<typeof table>)
        .where(where)
        .returning() as Promise<(typeof table)["$inferSelect"][]>;
    },

    async delete(table, opts) {
      const scope = tableScope(table, userId);
      const where = opts?.where ? (and(scope, opts.where) as SQL) : scope;
      return db.delete(table).where(where).returning() as Promise<
        (typeof table)["$inferSelect"][]
      >;
    },
  };
}

/**
 * scopedDb(userId) — bind a userId to a constrained Drizzle surface.
 * Throws synchronously if userId is missing.
 */
export function scopedDb(userId: string): ScopedDb {
  requireUserId(userId);

  return {
    ...bindScoped(internalDb, userId),

    async transaction(fn) {
      return withTransactionalDb((tx) =>
        fn({
          ...bindScoped(tx, userId),

          // Transaction-only: the lock key embeds the bound userId, so the
          // scoped user can only serialize against themselves (see the
          // ScopedTx doc). hashtextextended gives a stable bigint key for
          // pg_advisory_xact_lock; the lock releases at COMMIT/ROLLBACK.
          async lockScope(namespace: string) {
            if (typeof namespace !== "string" || namespace.trim().length === 0) {
              throw new ScopedDbError(
                "scopedDb.lockScope: namespace must be a non-empty constant string.",
              );
            }
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${namespace}:${userId}`}::text, 0))`,
            );
          },
        }),
      );
    },
  };
}

export { ScopedDbError };
