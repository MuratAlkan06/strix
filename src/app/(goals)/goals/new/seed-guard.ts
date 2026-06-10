/**
 * seed-guard.ts — the /goals/new ?seed= decision, extracted as a pure predicate
 * so the 400 path is unit-testable without rendering the server component.
 *
 * Rules (phase-1-golden-path verification step 2):
 *   - absent or empty seed  → accept, open neutrally (seed = null)
 *   - whitelisted seed      → accept (seed = the slug)
 *   - non-empty, non-whitelisted seed → reject with 400 (e.g. "evil_payload",
 *     "mountain" — the Scene variant name is NOT a seed slug)
 */
import { isGoalSeed, type GoalSeed } from "@/lib/goal-seeds";

export type SeedDecision =
  | { ok: true; seed: GoalSeed | null }
  | { ok: false };

export function decideSeed(raw: string | string[] | undefined): SeedDecision {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined || value === "") return { ok: true, seed: null };
  if (isGoalSeed(value)) return { ok: true, seed: value };
  return { ok: false };
}
