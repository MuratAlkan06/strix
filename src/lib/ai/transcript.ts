/**
 * transcript.ts — pure helpers for the intake message history (ADR-0001).
 *
 * The raw transcript persisted to goal_drafts.raw_transcript is a flat array of
 * { role, content } turns. These helpers are side-effect-free so they can be
 * unit-tested with no DB and reused by the route to enforce the hard turn cap
 * before spending a model call.
 */
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

/** A single persisted turn — the API MessageParam shape, content as string. */
export interface TranscriptTurn {
  role: "user" | "assistant";
  content: string;
}

/** HARD CAP on user turns (phase-1 doc / prompts/intake.ts). */
export const MAX_USER_TURNS = 10;

/** Narrow unknown jsonb into a transcript array, dropping malformed entries. */
export function asTranscript(value: unknown): TranscriptTurn[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (t): t is TranscriptTurn =>
      typeof t === "object" &&
      t !== null &&
      (t as TranscriptTurn).role !== undefined &&
      ((t as TranscriptTurn).role === "user" ||
        (t as TranscriptTurn).role === "assistant") &&
      typeof (t as TranscriptTurn).content === "string",
  );
}

/** Append a turn, returning a new array (no mutation). */
export function appendTurn(
  transcript: TranscriptTurn[],
  turn: TranscriptTurn,
): TranscriptTurn[] {
  return [...transcript, turn];
}

/** Count user turns in a transcript. */
export function countUserTurns(transcript: TranscriptTurn[]): number {
  return transcript.filter((t) => t.role === "user").length;
}

/**
 * True when adding another user turn would exceed the hard cap. Checked BEFORE
 * accepting a new user message, so the model is never asked for an 11th round.
 */
export function isAtUserTurnCap(transcript: TranscriptTurn[]): boolean {
  return countUserTurns(transcript) >= MAX_USER_TURNS;
}

/** Convert a persisted transcript to the API MessageParam[] shape. */
export function toMessageParams(transcript: TranscriptTurn[]): MessageParam[] {
  return transcript.map((t) => ({ role: t.role, content: t.content }));
}
