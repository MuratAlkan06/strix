/**
 * /playground/install-banner — auth-exempt, deterministic harness for the S8
 * install affordance (planning/phase-2.5-pwa-polish.md "Install affordance";
 * the playground-check-in scheme). Renders the REAL <InstallBannerView /> in
 * each reachable visual state behind local no-op handlers — no Clerk user, no
 * beforeinstallprompt, no DB.
 *
 * ?state= variants:
 *   ios       — iOS Safari manual "Add to Home Screen" instructions.
 *   chrome    — Chrome/Android native Install button (default).
 *   dismissed — the post-dismiss / not-eligible reality (renders nothing).
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import type { InstallVariant } from "@/lib/install-platform";
import { InstallBannerHarness } from "./harness";

const STATE_TO_VARIANT: Record<string, InstallVariant> = {
  ios: "ios",
  chrome: "chrome",
  dismissed: "none",
};

export default async function PlaygroundInstallBannerPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const { state } = await searchParams;
  const variant = STATE_TO_VARIANT[state ?? "chrome"] ?? "chrome";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Install banner harness
        </h1>
        <p className="text-sm text-muted-foreground">
          The real install-affordance view in each reachable state. Eligibility
          and platform branching are unit-tested; this is the visual register.
        </p>
      </header>
      <InstallBannerHarness variant={variant} />
    </main>
  );
}
