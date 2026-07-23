/**
 * limits.ts — free-tier usage caps (SPEC §10 "Free tier usage limits").
 *
 * Phase 3 (slice S1, issue #96) moved the real quota logic into the billing
 * module: the server gate lives in @/lib/billing/usage (server-only), the
 * numbers in @/lib/billing/usage-limits (client-safe). This file stays as the
 * stable @/lib/limits import surface — it re-exports ONLY the client-safe
 * constants, so client bundles (the check-in capacity math) keep resolving it
 * without dragging the server-only gate in. The Phase-2 `checkAndIncrement`
 * stub (and its "plan_generation" spelling) is gone; metered routes now go
 * through the runMeteredAi wrapper (@/lib/ai/metered), never a bare call.
 */
import { FREE_REPLAN_LIMIT } from "@/lib/billing/usage-limits";

export {
  FREE_PLAN_GENERATION_LIMIT,
  FREE_REPLAN_LIMIT,
  VALIDATION_REFUND_LIMIT,
  CAP_KIND_LABEL,
  freeLimitFor,
  type MeteredKind,
} from "@/lib/billing/usage-limits";

/**
 * Legacy alias kept for check-in-model.ts's capacity math (SPEC §10: Free gets
 * 2 replans a month). Same value as FREE_REPLAN_LIMIT.
 */
export const FREE_MONTHLY_REPLAN_LIMIT = FREE_REPLAN_LIMIT;
