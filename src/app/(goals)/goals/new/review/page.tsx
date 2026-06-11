/**
 * /goals/new/review — the draft-plan review/edit screen (phase-1-golden-path
 * "Draft-plan review/edit UI").
 *
 * Routing note (flagged for doc amendment, same class as /goals/new): the
 * phase doc names this `app/(goals)/new/review/page.tsx`, which — route
 * groups adding no URL segment — would resolve to `/new/review`. The route
 * nests explicitly under `goals/`: `(goals)/goals/new/review/page.tsx` →
 * `/goals/new/review`, matching the established pattern.
 *
 * Resume logic: the draft is loaded via the HttpOnly session-token cookie +
 * scopedDb ownership. No cookie, no draft, no plan_draft, or an unconfirmed
 * intake → redirect back to /goals/new, whose surface routing resumes the
 * user at the right step. Nothing here writes; the only commit path is the
 * saveGoal server action behind the client component's "Save goal".
 *
 * Medical disclaimer: physical activity types get one factual line under the
 * plan header (review-plan.ts holds the predicate + the phase-doc copy).
 *
 * Authenticated by default via proxy.ts; defense-in-depth redirect for the
 * never-trust-the-edge case.
 */
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
import { planDraftSchema } from "@/lib/ai/plan-schema";
import { isIntensity } from "../intensity-confirm";
import { PlanReview } from "./plan-review";
import { saveGoal } from "./save-goal";
import { MEDICAL_DISCLAIMER, requiresMedicalDisclaimer } from "./review-plan";

export const dynamic = "force-dynamic";

/** The header slice of the staged intake summary, or null when the draft has
 *  not actually finished intake (belt — plan_draft implies it). */
function intakeHeader(
  value: unknown,
): { goalSentence: string; activityType: string } | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.one_sentence_goal !== "string") return null;
  if (typeof v.activity_type !== "string") return null;
  if (!isIntensity(v.confirmed_intensity)) return null;
  return {
    goalSentence: v.one_sentence_goal,
    activityType: v.activity_type,
  };
}

export default async function PlanReviewPage() {
  const { userId, redirectToSignIn } = await auth();
  if (!userId) {
    return redirectToSignIn();
  }

  const token = (await cookies()).get(DRAFT_COOKIE_NAME)?.value;
  if (!token) {
    redirect("/goals/new");
  }

  const sdb = scopedDb(userId);
  const rows = await sdb.selectFrom(goal_drafts, {
    where: eq(goal_drafts.session_token, token),
  });
  const draft = rows[0];
  if (!draft || draft.plan_draft == null) {
    redirect("/goals/new");
  }

  const plan = planDraftSchema.safeParse(draft.plan_draft);
  const header = intakeHeader(draft.intake_summary_draft);
  if (!plan.success || !header) {
    redirect("/goals/new");
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Review your plan
        </h1>
        <p className="text-sm text-muted-foreground">{header.goalSentence}</p>
        {requiresMedicalDisclaimer(header.activityType) && (
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {MEDICAL_DISCLAIMER}
          </p>
        )}
      </header>

      <PlanReview plan={plan.data} onSave={saveGoal} />
    </main>
  );
}
