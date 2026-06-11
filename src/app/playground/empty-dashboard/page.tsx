/**
 * /playground/empty-dashboard — auth-exempt preview harness for the empty-state
 * dashboard composition.
 *
 * KEPT (not throwaway): this is the verify:ui harness surface for the empty
 * state until that harness re-targets the real product surfaces (phase-1
 * Design-system handoff). It renders the EXACT same <EmptyDashboard /> the
 * authenticated /dashboard renders in its zero-goals branch — same components,
 * same global dusk chrome (root layout + globals.css) — but deterministically:
 * the zero-goals branch is hardcoded here (no auth, no scopedDb, no live DB),
 * so the surface is reachable and byte-stable without standing up a session or
 * seeding goals. The /playground(.*) Clerk matcher (src/proxy.ts) already makes
 * it reachable without auth; the segment layout (src/app/playground/layout.tsx)
 * noindexes it.
 *
 * Like /playground/completion it inherits the GLOBAL chrome and does NOT use the
 * /playground/dashboard variant wrappers (playground.css). The frame mirrors the
 * (dashboard) segment layout (`min-h-full`) so the composition renders identically
 * to /dashboard. EmptyDashboard is a server component with no client state.
 */
import { EmptyDashboard } from "@/components/empty-dashboard";

export default function PlaygroundEmptyDashboardPage() {
  return (
    <div className="min-h-full">
      <EmptyDashboard />
    </div>
  );
}
