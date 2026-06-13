/**
 * /playground/session-purge — auth-exempt harness for the S7 session-end
 * purge (e2e/session-purge.spec.ts). The spec seeds Cache Storage from the
 * page context, clicks the harness button (the REAL purgeClientCaches), and
 * asserts the in-page post-purge snapshot is empty.
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import { PurgeHarness } from "./harness";

export default function PlaygroundSessionPurgePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Session purge harness
        </h1>
        <p className="text-sm text-muted-foreground">
          Seeds nothing itself — the e2e spec seeds Cache Storage, then this
          button runs the real session-end purge.
        </p>
      </header>
      <PurgeHarness />
    </main>
  );
}
