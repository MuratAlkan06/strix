import "server-only";

/**
 * Anthropic client chokepoint (ADR-0001). Feature code imports the narrow
 * helpers from this directory — never `@anthropic-ai/sdk` directly — so the
 * provider, model IDs, caching posture, and usage logging stay in one place.
 *
 * Mirrors src/lib/analytics/server.ts: a lazily-instantiated singleton guarded
 * on the API key. In a serverless runtime, constructing a fresh client per call
 * is wasteful; the singleton is reused across invocations within a warm
 * instance. getClient() returns null when ANTHROPIC_API_KEY is unset, so unit
 * tests and key-less environments degrade cleanly instead of throwing at import.
 */
import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/**
 * The shared Anthropic client, or null when ANTHROPIC_API_KEY is unset.
 * Callers that need a live client (the intake route) translate null into a
 * 503/configuration error at the request boundary, never at module load.
 */
export function getClient(): Anthropic | null {
  if (process.env.ANTHROPIC_API_KEY === undefined) return null;
  if (_client) return _client;
  _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _client;
}
