/**
 * /playground/upgrade-modal — auth-exempt, deterministic harness for the
 * Phase-3 S1 <UpgradeModal /> (SPEC §10 "Upgrade prompt on cap hit"). No DB, no
 * auth, no analytics: the modal is presentational (open / onOpenChange /
 * capKind) and the free_tier_cap_hit capture lives in the CALLERS, not the
 * modal — so this surface emits no telemetry. Prices are the static
 * DISPLAY_PRICES strings (real Stripe wiring is S2/S3/S4), so screenshots never
 * shift.
 *
 * ?state= selects the cap kind the modal was opened for:
 *   plan_generations — the /goals/new plan-generation cap (default).
 *   replans          — the check-in / replan capacity cap (the modal's own
 *                      component default).
 *   active_goals     — the Free plan's 3-active-goals cap on save.
 *
 * The two-card Pro/Max compare is one column below sm (640px) and two columns
 * at and above it (grid-cols-1 sm:grid-cols-2 in upgrade-modal.tsx).
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import { type CapKind } from "@/components/upgrade-modal";

import { UpgradeModalHarness } from "./harness";

const CAP_KINDS: CapKind[] = ["plan_generations", "replans", "active_goals"];

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundUpgradeModalPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const requested = Array.isArray(state) ? state[0] : state;
  const selected: CapKind =
    requested && (CAP_KINDS as string[]).includes(requested)
      ? (requested as CapKind)
      : "plan_generations";

  return <UpgradeModalHarness capKind={selected} />;
}
