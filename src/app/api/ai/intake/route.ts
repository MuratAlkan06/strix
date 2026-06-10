/**
 * POST /api/ai/intake — the streaming goal-intake endpoint (phase-1-golden-path
 * "Goal intake conversational chat"; ADR-0001).
 *
 * Flow:
 *   1. Clerk auth → userId (never from body/params).
 *   2. Load the draft via the HttpOnly session-token cookie + scopedDb ownership
 *      (a forged/foreign token loads zero rows and 404s).
 *   3. Append the incoming user message to goal_drafts.raw_transcript, enforcing
 *      the hard 10-user-turn cap before spending a model call.
 *   4. Stream Sonnet text deltas to the client as SSE.
 *   5. On submit_intake: canonicalize (Haiku) the loose fields, then write the
 *      validated summary to goal_drafts.intake_summary_draft.
 *   6. Persist the assistant turn; capture + log token usage (cache fields).
 *
 * All AI access goes through src/lib/ai/* — never @anthropic-ai/sdk directly.
 */
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
import { streamIntake } from "@/lib/ai/intake";
import { canonicalize } from "@/lib/ai/canonicalize";
import {
  submitIntakeSchema,
  SUBMIT_INTAKE_TOOL_NAME,
  type SubmitIntakeInput,
} from "@/lib/ai/intake-schema";
import {
  appendTurn,
  asTranscript,
  isAtUserTurnCap,
  toMessageParams,
  type TranscriptTurn,
} from "@/lib/ai/transcript";
import { logAiError, logAiUsage, toUsageLog } from "@/lib/ai/log";
import { MODEL_SONNET } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

interface IntakeBody {
  message?: unknown;
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }

  const token = (await cookies()).get(DRAFT_COOKIE_NAME)?.value;
  if (!token) {
    return new Response("No active goal draft.", { status: 400 });
  }

  let body: IntakeBody;
  try {
    body = (await req.json()) as IntakeBody;
  } catch {
    return new Response("Invalid JSON body.", { status: 400 });
  }
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) {
    return new Response("A non-empty message is required.", { status: 400 });
  }

  const sdb = scopedDb(userId);

  // Load + own the draft via the session token (scopedDb adds user-is-live +
  // user_id ownership; the token narrows to the one row).
  const rows = await sdb.selectFrom(goal_drafts, {
    where: eq(goal_drafts.session_token, token),
  });
  const draft = rows[0];
  if (!draft) {
    return new Response("Goal draft not found.", { status: 404 });
  }

  const transcript = asTranscript(draft.raw_transcript);

  // Enforce the hard cap before spending a model call.
  if (isAtUserTurnCap(transcript)) {
    return new Response("Intake turn cap reached.", { status: 409 });
  }

  const userTurn: TranscriptTurn = { role: "user", content: message };
  const withUser = appendTurn(transcript, userTurn);

  // Persist the user turn immediately so a mid-stream disconnect still records
  // what the user said.
  await sdb.update(goal_drafts, {
    set: { raw_transcript: withUser },
    where: eq(goal_drafts.id, draft.id),
  });

  let stream;
  try {
    stream = streamIntake({
      messages: toMessageParams(withUser),
      seed: draft.seed,
    });
  } catch {
    return new Response("AI service unavailable.", { status: 503 });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let assistantText = "";
      try {
        stream.on("text", (delta) => {
          assistantText += delta;
          controller.enqueue(sse("delta", { text: delta }));
        });

        const finalMessage = await stream.finalMessage();

        // Persist the assistant turn (prose part) onto the transcript.
        const withAssistant = appendTurn(withUser, {
          role: "assistant",
          content: assistantText,
        });

        // Did the model terminate via submit_intake?
        const toolUse = finalMessage.content.find(
          (b) => b.type === "tool_use" && b.name === SUBMIT_INTAKE_TOOL_NAME,
        );

        let completed = false;
        if (toolUse && toolUse.type === "tool_use") {
          const parsed = submitIntakeSchema.safeParse(toolUse.input);
          if (parsed.success) {
            const summary = await buildSummaryDraft(
              parsed.data,
              withAssistant,
            );
            await sdb.update(goal_drafts, {
              set: {
                raw_transcript: withAssistant,
                intake_summary_draft: summary,
              },
              where: eq(goal_drafts.id, draft.id),
            });
            completed = true;
            controller.enqueue(sse("complete", { summary }));
          } else {
            // Tool input failed validation — keep the transcript, ask again.
            await sdb.update(goal_drafts, {
              set: { raw_transcript: withAssistant },
              where: eq(goal_drafts.id, draft.id),
            });
            controller.enqueue(
              sse("error", { message: "Intake summary was incomplete." }),
            );
          }
        } else {
          await sdb.update(goal_drafts, {
            set: { raw_transcript: withAssistant },
            where: eq(goal_drafts.id, draft.id),
          });
        }

        logAiUsage(toUsageLog("intake", MODEL_SONNET, finalMessage.usage));

        if (!completed) {
          controller.enqueue(sse("done", { completed: false }));
        }
        controller.close();
      } catch (err) {
        // Keep the raw provider error (rate-limit notes, request-id fragments)
        // on the server; the client only ever sees a constant message.
        logAiError("intake", err);
        controller.enqueue(
          sse("error", { message: "The intake stream failed." }),
        );
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

/**
 * Compose the intake_summary_draft jsonb: the validated submit_intake payload,
 * with location + activity_type tightened by the Haiku canonicalizer over the
 * full transcript. The canonical pass overrides only when it succeeds; the
 * Sonnet-emitted values are the fallback.
 */
async function buildSummaryDraft(
  input: SubmitIntakeInput,
  transcript: TranscriptTurn[],
): Promise<Record<string, unknown>> {
  let canonical = null;
  try {
    canonical = await canonicalize(toMessageParams(transcript));
  } catch {
    canonical = null;
  }
  return {
    ...input,
    location_city: canonical?.location_city ?? input.location_city ?? null,
    location_region:
      canonical?.location_region ?? input.location_region ?? null,
    location_country:
      canonical?.location_country ?? input.location_country ?? null,
    activity_type: canonical?.activity_type ?? input.activity_type,
    activity_type_other_label:
      canonical?.activity_type_other_label ??
      input.activity_type_other_label ??
      null,
  };
}
