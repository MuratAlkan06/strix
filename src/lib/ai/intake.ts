/**
 * intake.ts — streamIntake (ADR-0001). Opens a streaming Sonnet conversation
 * for goal intake and hands the raw MessageStream back to the route, which owns
 * the SSE plumbing, transcript persistence, and tool-call handling.
 *
 * The cached system block (prompts/intake.ts) is byte-stable per build; the
 * per-conversation variability (seed opener + transcript) lives entirely in
 * `messages`, so the cache prefix hits on every turn.
 *
 * Per-request context (today's date + the seed, when present) is injected as
 * a leading bracketed context line on the first user message rather than into
 * the system prompt — keeping the cached prefix free of per-request data. The
 * date anchor is what lets the model place target dates and relative dates
 * ("in October") in the FUTURE instead of its training-era calendar.
 */
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { MessageStream } from "@anthropic-ai/sdk/lib/MessageStream";

import { getClient } from "./client";
import { MODEL_SONNET } from "./models";
import { intakeSystem } from "./prompts/intake";
import { todayIso } from "./today";
import { FLAG_SAFETY_TOOL, SUBMIT_INTAKE_TOOL } from "./intake-schema";

const MAX_TOKENS = 1024;

/** Human-readable opener context per seed slug. Plain, in register. */
const SEED_CONTEXT: Record<string, string> = {
  climb: "The user arrived from the \"Climb a mountain\" starting point.",
  language: "The user arrived from the \"Learn a language\" starting point.",
  race: "The user arrived from the \"Run a race\" starting point.",
  book: "The user arrived from the \"Write a book\" starting point.",
  instrument: "The user arrived from the \"Learn an instrument\" starting point.",
};

export interface StreamIntakeArgs {
  /** The full prior transcript (user + assistant turns) in API shape. */
  messages: MessageParam[];
  /** Optional whitelisted seed slug — only used to colour the opener. */
  seed?: string | null;
}

/**
 * Build the messages array, prepending the per-request context line to the
 * first user turn: today's date (always — the model has no other calendar
 * anchor, and target dates must land in the future) plus the seed context
 * when a seed is present. Rebuilt per request, so a multi-day intake always
 * carries the current date; never touches the cached system block.
 */
export function buildIntakeMessages(args: StreamIntakeArgs): MessageParam[] {
  const { messages, seed } = args;
  if (messages.length === 0) return messages;

  const [first, ...rest] = messages;
  if (!first || first.role !== "user" || typeof first.content !== "string") {
    return messages;
  }
  const seedContext = seed ? SEED_CONTEXT[seed] : undefined;
  const context =
    `Today's date is ${todayIso()}. Interpret relative dates as their next ` +
    `future occurrence.` +
    (seedContext ? ` ${seedContext}` : "");
  return [
    { role: "user", content: `[context: ${context}]\n\n${first.content}` },
    ...rest,
  ];
}

/**
 * Open the streaming intake conversation. Throws when no client is configured
 * (the route translates that into a 503 at the boundary).
 */
export function streamIntake(args: StreamIntakeArgs): MessageStream {
  const client = getClient();
  if (!client) {
    throw new Error(
      "AI client is not configured (ANTHROPIC_API_KEY unset). " +
        "streamIntake requires a live client.",
    );
  }
  return client.messages.stream({
    model: MODEL_SONNET,
    max_tokens: MAX_TOKENS,
    system: intakeSystem(),
    messages: buildIntakeMessages(args),
    tools: [SUBMIT_INTAKE_TOOL, FLAG_SAFETY_TOOL],
    tool_choice: { type: "auto" },
  });
}
