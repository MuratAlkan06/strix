/**
 * INTEGRATION TEST — prompt-caching proof (env-gated; live Anthropic API).
 *
 * Skips cleanly when ANTHROPIC_API_KEY is unset (CI, key-less dev), so the
 * default `pnpm test:run` is unaffected. When a key IS present this makes two
 * real calls sharing the cached intake system prefix and asserts the SECOND
 * call reads from cache (cache_read_input_tokens > 0) — the load-bearing proof
 * that the system block is byte-stable and the ephemeral breakpoint works.
 *
 * This is the ONE test in the suite that spends real tokens. It is named
 * *.integration.test.ts and gated, never part of the no-DB unit posture.
 */
import { describe, expect, it } from "vitest";
import { getClient } from "./client";
import { MODEL_SONNET } from "./models";
import { intakeSystem } from "./prompts/intake";

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const run = hasKey ? describe : describe.skip;

run("prompt caching (integration)", () => {
  it("second identical-prefix call reads the cache", async () => {
    const client = getClient();
    expect(client).not.toBeNull();
    if (!client) return;

    const system = intakeSystem();
    const base = {
      model: MODEL_SONNET,
      max_tokens: 16,
      system,
    } as const;

    // First call writes the cache (cache_creation_input_tokens > 0).
    const first = await client.messages.create({
      ...base,
      messages: [{ role: "user", content: "Say 'ready' and nothing else." }],
    });
    expect(first.usage.cache_creation_input_tokens ?? 0).toBeGreaterThan(0);

    // Second call with the same cached prefix should read it back.
    const second = await client.messages.create({
      ...base,
      messages: [{ role: "user", content: "Say 'again' and nothing else." }],
    });
    expect(second.usage.cache_read_input_tokens ?? 0).toBeGreaterThan(0);
  }, 60_000);
});
