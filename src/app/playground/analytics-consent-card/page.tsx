/**
 * /playground/analytics-consent-card — auth-exempt, deterministic harness for
 * the #11 settings Analytics card (the playground-check-in scheme). The real
 * /settings surface is Clerk-gated, so reviewers can't reach the card live and
 * it has no axe gate there; this route renders the REAL
 * <AnalyticsConsentCardView /> in both switch states behind local no-op state —
 * no consent store write, no PostHog, so the surface stays network-free.
 *
 * ?state= variants:
 *   off — analytics off, switch unchecked (the resting default).
 *   on  — analytics on, switch checked.
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. The app-wide <ConsentBanner /> container returns null on
 * /playground, so this harness is the only consent UI on the page.
 */
import { AnalyticsConsentCardHarness } from "./harness";

export default async function PlaygroundAnalyticsConsentCardPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const initialState = state === "on" ? "on" : "off";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Analytics consent card harness
        </h1>
        <p className="text-sm text-muted-foreground">
          The real settings Analytics card in each switch state. The store and
          PostHog wiring are unit-tested; this is the visual register for the
          auth-gated /settings surface.
        </p>
      </header>
      <AnalyticsConsentCardHarness initialState={initialState} />
    </main>
  );
}
