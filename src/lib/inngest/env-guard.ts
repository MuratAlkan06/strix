/**
 * Runtime guard turning ADR-0002 Decision 6 / B1 ("INNGEST_DEV must be ABSENT
 * in every Vercel scope") from a config-only convention into a HARD assertion
 * (closes the adjacent Medium in docs/security/pr-71-retroactive-review.md).
 *
 * When `INNGEST_DEV` is truthy the Inngest SDK runs in dev mode and
 * `/api/inngest` SKIPS signature verification — the cron triggers (archival
 * sweeps, monthly resets, the Phase-3 billing jobs) become world-callable. On
 * Vercel that is a live, data-mutating endpoint anyone can POST to.
 *
 * "Truthy" here = defined and non-empty. A set-but-falsy value ("0" / "false")
 * is treated as a VIOLATION on purpose: B1 says INNGEST_DEV must be ABSENT, so
 * ANY set value in a Vercel scope is a misconfiguration worth failing loudly
 * rather than second-guessing the operator's intent.
 */
export function assertInngestDevAbsentOnVercel(
  env: Record<string, string | undefined> = process.env,
): void {
  const onVercel = env.VERCEL !== undefined && env.VERCEL !== "";
  const inngestDevSet = env.INNGEST_DEV !== undefined && env.INNGEST_DEV !== "";
  if (onVercel && inngestDevSet) {
    throw new Error(
      "INNGEST_DEV is set in a Vercel scope (VERCEL is present). INNGEST_DEV " +
        "disables /api/inngest signature verification, making the cron " +
        "triggers world-callable. Remove INNGEST_DEV from every Vercel scope " +
        "(ADR-0002 Decision 6 / B1).",
    );
  }
}
