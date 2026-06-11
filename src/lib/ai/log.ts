/**
 * log.ts — a tiny structured server log for AI usage (ADR-0001).
 *
 * Captures token accounting (including cache creation/read) so the prompt-cache
 * win is observable in production logs. Deliberately NO PII: only the operation
 * name, model, and numeric token counts — never transcript content, user IDs,
 * or goal text. Emitted as a single-line JSON object so log aggregators can
 * parse it without a custom decoder.
 */
import type { Usage } from "@anthropic-ai/sdk/resources/messages";

export interface AiUsageLog {
  op: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

/**
 * Normalize a (possibly partial) Anthropic Usage into the flat numeric shape.
 * message_start carries input + cache fields; finalMessage carries the final
 * output_tokens — callers merge by passing whichever is most complete.
 */
export function toUsageLog(
  op: string,
  model: string,
  usage: Partial<Usage> | null | undefined,
): AiUsageLog {
  return {
    op,
    model,
    input_tokens: usage?.input_tokens ?? 0,
    output_tokens: usage?.output_tokens ?? 0,
    cache_creation_input_tokens: usage?.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage?.cache_read_input_tokens ?? 0,
  };
}

/** Emit the usage record as one structured line. */
export function logAiUsage(entry: AiUsageLog): void {
  console.info(JSON.stringify({ event: "ai_usage", ...entry }));
}

/**
 * Server-side error log for an AI operation. The raw provider error (which may
 * carry rate-limit notes or request-id fragments) stays on the server; it must
 * never be forwarded to the client. Like logAiUsage, this is PII-free: only the
 * operation name and the error name/message — never transcript content.
 */
export function logAiError(op: string, err: unknown): void {
  const name = err instanceof Error ? err.name : "UnknownError";
  const message = err instanceof Error ? err.message : String(err);
  console.error(JSON.stringify({ event: "ai_error", op, name, message }));
}
