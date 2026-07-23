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

/**
 * Per-request options for every metered model call (S1 contract, issue #96).
 * A 60s single-request timeout with ONE retry bounds a hung provider call:
 * the worst case (initial + one retry, each capped at 60s, minus the SDK's
 * retry-after sleep) stays comfortably inside the outer 80s AbortSignal the
 * wrapper threads — which is itself provably < the routes' maxDuration=90.
 * Passed as the second arg to messages.parse in plan.ts / replan.ts.
 */
export const AI_REQUEST_OPTIONS = { timeout: 60_000, maxRetries: 1 } as const;

/**
 * The Anthropic SDK error classes, re-exported through the chokepoint so
 * feature code (the metered wrapper's failure classifier) never imports
 * `@anthropic-ai/sdk` for runtime values directly (ADR-0001). The class
 * hierarchy the classifier relies on:
 *   APIError                         (base; has .status)
 *   ├─ APIConnectionError            (no status — transport)
 *   │  └─ APIConnectionTimeoutError  (single-request timeout)
 *   ├─ APIUserAbortError             (external AbortSignal fired)
 *   ├─ RateLimitError                (429)
 *   └─ InternalServerError           (>= 500)
 */
export {
  APIError,
  APIConnectionError,
  APIConnectionTimeoutError,
  APIUserAbortError,
  RateLimitError,
  InternalServerError,
} from "@anthropic-ai/sdk";

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
