/**
 * /goals/new — the goal-intake conversational chat (phase-1-golden-path "Goal
 * intake conversational chat").
 *
 * Routing note (flagged for doc amendment): the phase doc names this
 * `app/(goals)/new/page.tsx`, which — route groups adding no URL segment —
 * resolves to `/new`, not `/goals/new`. The empty-state dashboard tiles link to
 * `/goals/new?seed=…`, so the route must nest explicitly under `goals/`:
 * `(goals)/goals/new/page.tsx` → `/goals/new`. This mirrors how
 * `(dashboard)/dashboard/page.tsx` serves `/dashboard`.
 *
 * Seed handling: `?seed=` is validated against the server-side whitelist at the
 * edge (proxy.ts) — a non-empty invalid seed is rejected with 400 before this
 * page renders or the AI prompt sees it (prompt-injection mitigation). Here we
 * re-derive the validated seed from the trusted set for the draft; an absent or
 * empty seed opens the intake neutrally.
 *
 * Draft handling: render is READ-ONLY (Next.js forbids cookie writes during
 * Server Component render), so a first landing with no resolvable draft
 * redirects to the bootstrap Route Handler (./bootstrap/route.ts), which
 * creates the goal_drafts row and sets the HttpOnly cookie together, then
 * redirects back here — where the fresh draft resumes like any returning
 * visit. The bootstrap's ?boot=1 marker breaks the redirect loop when the
 * cookie cannot stick (cookies disabled): instead of bouncing again, the page
 * renders guidance.
 *
 * Authenticated by default via proxy.ts; defense-in-depth redirect for the
 * never-trust-the-edge case.
 */
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";

import { findDraft } from "./draft";
import { decideSeed } from "./seed-guard";
import { IntakeFlow } from "./intake-flow";
import { resolveSurface } from "./intensity-confirm";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ seed?: string | string[]; boot?: string | string[] }>;
}

export default async function GoalIntakePage({ searchParams }: PageProps) {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  const { seed: rawSeed, boot } = await searchParams;

  // proxy.ts already 400'd any non-empty, non-whitelisted seed at the edge; this
  // re-derives the validated slug (or null) from the trusted set for the draft.
  const decision = decideSeed(rawSeed);
  const seed = decision.ok ? decision.seed : null;

  const draft = await findDraft(userId);

  if (!draft) {
    if (boot !== undefined) {
      // We just came back from the bootstrap and still see no cookie — the
      // browser refused it. Render guidance instead of redirect-looping.
      return (
        <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
          <header className="flex flex-col gap-1">
            <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
              Let&apos;s shape your goal
            </h1>
          </header>
          <p className="max-w-prose text-base leading-relaxed text-foreground">
            We couldn&apos;t hold on to your draft session. Your browser is
            blocking the cookie that keeps it — enable cookies for this site,
            then reload the page.
          </p>
        </main>
      );
    }
    redirect(
      seed ? `/goals/new/bootstrap?seed=${seed}` : "/goals/new/bootstrap",
    );
  }

  // Server-derived surface routing (resumable): a completed-intake draft with
  // an unconfirmed intensity resumes at the card; a confirmed one at interim.
  const surface = resolveSurface({ summary: draft.summary });

  return (
    <main className="mx-auto flex h-[calc(100dvh-1px)] w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Let&apos;s shape your goal
        </h1>
        <p className="text-sm text-muted-foreground">
          A few questions, then a plan. Take your time.
        </p>
      </header>

      <IntakeFlow
        goalDraftId={draft.id}
        seed={draft.seed}
        initialTranscript={draft.transcript}
        initialSurface={surface}
        initialSummary={draft.summary}
        initialPendingFlag={draft.pendingSafetyFlag}
        initialPlanReady={draft.planReady}
      />
    </main>
  );
}
