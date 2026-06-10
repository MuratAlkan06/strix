/**
 * Server-side PostHog wrapper. Feature code MUST import from here, never
 * from `posthog-node` directly — the Phase 5 event-taxonomy enforcement
 * relies on this single chokepoint.
 *
 * In serverless, we shutdown() per-call would be wasteful; we keep a
 * singleton client and rely on PostHog's batched flush. Always `await
 * capture()` so the event makes the batch before the function returns.
 */
import { PostHog } from "posthog-node";

let _client: PostHog | null = null;

function getClient(): PostHog | null {
  if (process.env.POSTHOG_API_KEY === undefined) return null;
  if (_client) return _client;
  _client = new PostHog(process.env.POSTHOG_API_KEY, {
    host: process.env.POSTHOG_HOST ?? "https://us.i.posthog.com",
    flushAt: 1,
    flushInterval: 0,
  });
  return _client;
}

export async function capture(
  distinctId: string,
  event: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const client = getClient();
  if (!client) return;
  client.capture({ distinctId, event, properties });
}

export async function identify(
  distinctId: string,
  properties: Record<string, unknown> = {},
): Promise<void> {
  const client = getClient();
  if (!client) return;
  client.identify({ distinctId, properties });
}

export async function shutdown(): Promise<void> {
  if (_client) {
    await _client.shutdown();
    _client = null;
  }
}
