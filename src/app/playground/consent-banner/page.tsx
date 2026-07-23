/**
 * /playground/consent-banner — auth-exempt, deterministic harness for the #11
 * analytics cookie-consent banner (the playground-check-in scheme). Renders the
 * REAL <ConsentBannerView /> behind local no-op handlers — no consent store
 * write, no PostHog, so the surface stays network-free.
 *
 * ?state= variants:
 *   banner    — the pending banner with its two equal-weight actions (default).
 *   dismissed — the post-choice reality (renders nothing).
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. The app-wide <ConsentBanner /> container returns null on
 * /playground, so this harness is the only consent UI on the page.
 */
import { ConsentBannerHarness } from "./harness";

export default async function PlaygroundConsentBannerPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const initialState = state === "dismissed" ? "dismissed" : "banner";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Consent banner harness
        </h1>
        <p className="text-sm text-muted-foreground">
          The real analytics-consent view in each reachable state. The store and
          PostHog gating are unit-tested; this is the visual register.
        </p>
      </header>
      <ConsentBannerHarness initialState={initialState} />
    </main>
  );
}
