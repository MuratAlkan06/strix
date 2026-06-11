/**
 * harness.tsx — the client boundary for the plan-review design-review
 * harness. The page is a server component (it resolves searchParams); the
 * review component needs an onSave function prop, which a server component
 * cannot pass to a client component — so this thin client wrapper supplies a
 * deterministic no-op (resolves { ok: true } → the component flips to its
 * calm saved state). No server action, no DB, no redirect.
 */
"use client";

import { PlanReview } from "../../(goals)/goals/new/review/plan-review";
import type { PlanDraft } from "@/lib/ai/plan-schema";

export function PlanReviewHarness({ plan }: { plan: PlanDraft }) {
  return <PlanReview plan={plan} onSave={async () => ({ ok: true })} />;
}
