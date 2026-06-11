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
 *   4. Stream Sonnet text deltas to the client as SSE — possibly across several
 *      model rounds within the one POST (see duplicate-flag suppression below).
 *   5. On submit_intake: canonicalize (Haiku) the loose fields, then write the
 *      validated summary to goal_drafts.intake_summary_draft.
 *   6. Persist the assistant turn; capture + log token usage (cache fields).
 *
 * Duplicate-flag suppression (safety-override flow): prompt instructions alone
 * do not stop the model from re-flagging a concern the user already decided,
 * so the route enforces it. A flag_safety call whose concern matches an
 * already-staged flag (fuzzy normalized matching — see matchesConcern) is
 * NOT re-staged and emits NO safety_flag SSE event. Instead the route answers
 * the tool call in-protocol: a follow-up request in the SAME POST carries a
 * tool_result naming the user's recorded decision and instructing the model
 * to continue, and the continuation's text keeps streaming to the client as
 * ordinary deltas. Continuations are bounded (DUPLICATE_FLAG_CONTINUATIONS);
 * past the bound the empty-prose guard below still leaves the user with prose.
 *
 * Empty-prose guard: a response cycle must never end with a silent assistant
 * bubble. If no round produced text (flag-only responses, suppressed or
 * legitimate), the route synthesizes one minimal in-register line — a lead-in
 * for a fresh decision card, or a "decision stands" line after suppression —
 * emitted as a delta and persisted as the assistant turn.
 *
 * All AI access goes through src/lib/ai/* — never @anthropic-ai/sdk directly.
 */
import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import type {
  ContentBlock,
  ContentBlockParam,
  MessageParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from "@anthropic-ai/sdk/resources/messages";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";

import { scopedDb } from "@/db/scoped";
import { goal_drafts } from "@/db/schema";
import { DRAFT_COOKIE_NAME } from "@/lib/ai/session";
import { streamIntake } from "@/lib/ai/intake";
import { canonicalize } from "@/lib/ai/canonicalize";
import {
  flagSafetySchema,
  submitIntakeSchema,
  FLAG_SAFETY_TOOL_NAME,
  SUBMIT_INTAKE_TOOL_NAME,
  type FlagSafetyInput,
  type SubmitIntakeInput,
} from "@/lib/ai/intake-schema";
import {
  appendFlag,
  asEventLog,
  duplicateFlagToolResultText,
  findStagedMatch,
  mergeSafetyFlags,
  pendingFlag,
  stagedFlags,
  type IntakeEvent,
  type StagedSafetyFlag,
} from "@/lib/ai/safety-flags";
import {
  asTranscript,
  isAtUserTurnCap,
  toMessageParams,
  type TranscriptTurn,
} from "@/lib/ai/transcript";
import { logAiError, logAiUsage, toUsageLog } from "@/lib/ai/log";
import { MODEL_SONNET } from "@/lib/ai/models";

export const dynamic = "force-dynamic";

/** Bound on tool_result follow-up rounds per POST (duplicate-flag handling).
 *  1 + this many model calls is the per-message ceiling. */
const DUPLICATE_FLAG_CONTINUATIONS = 2;

/** Empty-prose guard lines — minimal, in register, constant. */
const FLAG_LEAD_IN_LINE =
  "Before we go on, there's a concern to settle.";
const DECISION_STANDS_LINE =
  "That concern is settled — your decision stands. Let's keep going.";
const CONTINUE_LINE = "Noted. Let's keep going.";

interface IntakeBody {
  message?: unknown;
}

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
  );
}

/** Re-shape response content blocks into request params for the continuation
 *  (the SDK's response blocks carry extra fields the API rejects on input).
 *  Empty text blocks are dropped — the API requires non-empty text. */
function toAssistantParamBlocks(content: ContentBlock[]): ContentBlockParam[] {
  const blocks: ContentBlockParam[] = [];
  for (const b of content) {
    if (b.type === "text" && b.text.length > 0) {
      blocks.push({ type: "text", text: b.text });
    } else if (b.type === "tool_use") {
      blocks.push({ type: "tool_use", id: b.id, name: b.name, input: b.input });
    }
  }
  return blocks;
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

  // raw_transcript is an event log: conversational turns + staged safety
  // flags. asTranscript() is the conversational view; the flag entries are
  // preserved across writes (rewriting only the filtered view would drop them).
  const log = asEventLog(draft.raw_transcript);

  // Enforce the hard cap before spending a model call.
  if (isAtUserTurnCap(asTranscript(log))) {
    return new Response("Intake turn cap reached.", { status: 409 });
  }

  // Pending-decision discipline (server side of the composer hold): while a
  // safety flag is undecided, the explicit card choice must come first.
  if (pendingFlag(log)) {
    return new Response("A safety decision is pending.", { status: 409 });
  }

  const userTurn: TranscriptTurn = { role: "user", content: message };
  const withUser: IntakeEvent[] = [...log, userTurn];

  // Persist the user turn immediately so a mid-stream disconnect still records
  // what the user said.
  await sdb.update(goal_drafts, {
    set: { raw_transcript: withUser },
    where: eq(goal_drafts.id, draft.id),
  });

  const initialMessages = toMessageParams(asTranscript(withUser));

  let stream: MessageStream;
  try {
    stream = streamIntake({
      messages: initialMessages,
      seed: draft.seed,
    });
  } catch {
    return new Response("AI service unavailable.", { status: 503 });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        // Flags already staged on the draft (all decided here — an undecided
        // one 409s above) + the ones staged during this response cycle. Both
        // populations participate in duplicate matching.
        const priorStaged = stagedFlags(log);
        const newFlags: FlagSafetyInput[] = [];

        let assistantText = "";
        let apiMessages: MessageParam[] = initialMessages;
        let currentStream = stream;
        let continuations = 0;
        let suppressedAny = false;
        let parsedSubmit: SubmitIntakeInput | null = null;
        let invalidSubmit = false;

        // The model-round loop: one round per request/response with the
        // model; duplicate-flag tool_results trigger bounded follow-ups.
        for (;;) {
          let roundHadText = false;
          currentStream.on("text", (delta) => {
            if (!roundHadText && assistantText.length > 0) {
              // Seam between a round's prose and its continuation's prose.
              assistantText += "\n\n";
              controller.enqueue(sse("delta", { text: "\n\n" }));
            }
            roundHadText = true;
            assistantText += delta;
            controller.enqueue(sse("delta", { text: delta }));
          });

          const finalMessage = await currentStream.finalMessage();
          logAiUsage(toUsageLog("intake", MODEL_SONNET, finalMessage.usage));

          const toolUses = finalMessage.content.filter(
            (b): b is ToolUseBlock => b.type === "tool_use",
          );
          const submitUse = toolUses.find(
            (b) => b.name === SUBMIT_INTAKE_TOOL_NAME,
          );

          // Classify flag_safety calls: genuinely new concerns get staged;
          // re-raises of an already-staged concern (decided on a prior turn,
          // or staged moments ago in this same response) are suppressed.
          const roundNewFlags: FlagSafetyInput[] = [];
          const duplicates = new Map<string, StagedSafetyFlag>();
          for (const block of toolUses) {
            if (block.name !== FLAG_SAFETY_TOOL_NAME) continue;
            const parsedFlag = flagSafetySchema.safeParse(block.input);
            if (!parsedFlag.success) continue;
            const stagedSoFar = [
              ...priorStaged,
              ...[...newFlags, ...roundNewFlags].map(
                (f): StagedSafetyFlag => ({
                  type: "safety_flag",
                  ...f,
                  user_overrode: null,
                  decided_at: null,
                }),
              ),
            ];
            const match = findStagedMatch(stagedSoFar, parsedFlag.data.concern);
            if (match) {
              duplicates.set(block.id, match);
              suppressedAny = true;
            } else {
              roundNewFlags.push(parsedFlag.data);
            }
          }
          newFlags.push(...roundNewFlags);

          // Termination round?
          if (submitUse) {
            const parsed = submitIntakeSchema.safeParse(submitUse.input);
            if (parsed.success) {
              parsedSubmit = parsed.data;
            } else {
              invalidSubmit = true;
            }
            break;
          }

          // A fresh concern: the decision card renders and the composer
          // holds — the user must decide before the model speaks again.
          if (roundNewFlags.length > 0) break;

          // Only suppressed duplicates: answer the tool calls in-protocol and
          // let the model continue productively within this same POST.
          if (duplicates.size > 0 && continuations < DUPLICATE_FLAG_CONTINUATIONS) {
            const toolResults: ToolResultBlockParam[] = toolUses.map((tu) => ({
              type: "tool_result",
              tool_use_id: tu.id,
              content: duplicates.has(tu.id)
                ? duplicateFlagToolResultText(duplicates.get(tu.id)!)
                : "Received. Continue the intake.",
            }));
            apiMessages = [
              ...apiMessages,
              {
                role: "assistant",
                content: toAssistantParamBlocks(finalMessage.content),
              },
              { role: "user", content: toolResults },
            ];
            continuations++;
            currentStream = streamIntake({
              messages: apiMessages,
              seed: draft.seed,
            });
            continue;
          }

          // Plain prose round, or the continuation budget is spent.
          break;
        }

        // Empty-prose guard: never leave the user a silent bubble. (A
        // text-less submit_intake is fine — the surface hands off to the
        // confirmation card; an invalid submit already reports an error.)
        if (
          !parsedSubmit &&
          !invalidSubmit &&
          assistantText.trim().length === 0
        ) {
          const line =
            newFlags.length > 0
              ? FLAG_LEAD_IN_LINE
              : suppressedAny
                ? DECISION_STANDS_LINE
                : CONTINUE_LINE;
          assistantText = line;
          controller.enqueue(sse("delta", { text: line }));
        }

        // Persist the assistant turn (combined prose across rounds) plus any
        // newly staged flags — the pending flag stays the LAST event.
        let withAssistant: IntakeEvent[] =
          assistantText.length > 0
            ? [...withUser, { role: "assistant", content: assistantText }]
            : [...withUser];
        for (const flag of newFlags) {
          withAssistant = appendFlag(withAssistant, flag);
        }

        let completed = false;
        if (parsedSubmit) {
          // Merge staged decisions into the final safety_flags: staged
          // flags carry the user's user_overrode/decided_at; model-only
          // flags keep null decisions (the product is the decider's pen).
          const merged = mergeSafetyFlags(
            stagedFlags(withAssistant),
            parsedSubmit.safety_flags,
          );
          const summary = await buildSummaryDraft(
            { ...parsedSubmit, safety_flags: merged },
            asTranscript(withAssistant),
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
          await sdb.update(goal_drafts, {
            set: { raw_transcript: withAssistant },
            where: eq(goal_drafts.id, draft.id),
          });
          if (invalidSubmit) {
            // Tool input failed validation — keep the transcript, ask again.
            controller.enqueue(
              sse("error", { message: "Intake summary was incomplete." }),
            );
          }
        }

        // Emit the decision card(s) only after the flag is durably staged, so
        // a rendered card always has a server-side pending flag behind it.
        for (const flag of newFlags) {
          controller.enqueue(sse("safety_flag", { flag }));
        }

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
