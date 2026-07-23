/**
 * usage-limits.ts — the Free-tier cap constants + the metered-kind vocabulary
 * (SPEC §10; Phase-3 slice S1 frozen contract, issue #96).
 *
 * Deliberately client-safe (no "server-only", no DB): the numbers are needed
 * on both sides — the server gate (src/lib/billing/usage.ts) enforces them,
 * and client surfaces (the check-in capacity math, the cap-hit modal copy)
 * display them. Keeping them here, with usage.ts importing FROM this module,
 * lets @/lib/limits re-export the constants into the client bundle without
 * dragging the server-only gate in with them.
 */

/** Free tier: 3 plan generations per usage period (calendar month, user TZ). */
export const FREE_PLAN_GENERATION_LIMIT = 3;

/** Free tier: 2 replans per usage period. */
export const FREE_REPLAN_LIMIT = 2;

/**
 * D2 (issue #96): granted Zod-validation refunds per usage period, per user,
 * SHARED across both metered kinds. The window is the period itself (resets
 * with the row default — zero new infra). Counts granted refunds only.
 */
export const VALIDATION_REFUND_LIMIT = 3;

/** The internal metered-operation union. Payload `kind` strings differ (see
 *  CAP_KIND_LABEL) — these are the counter columns' identity. */
export type MeteredKind = "plan" | "replan";

/** The wire `kind` string in the 402 cap_hit body + the free_tier_cap_hit
 *  analytics `cap` property (plan doc vocabulary). */
export const CAP_KIND_LABEL: Record<MeteredKind, "plan_generations" | "replans"> =
  {
    plan: "plan_generations",
    replan: "replans",
  };

/** The Free-tier limit for a given metered kind. */
export function freeLimitFor(kind: MeteredKind): number {
  return kind === "plan" ? FREE_PLAN_GENERATION_LIMIT : FREE_REPLAN_LIMIT;
}
