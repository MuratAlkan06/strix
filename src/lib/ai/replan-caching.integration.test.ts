/**
 * INTEGRATION TEST — replan-prompt caching proof (env-gated; live Anthropic
 * API).
 *
 * Mirrors plan-caching.integration.test.ts for the replan system prompt.
 * Skips cleanly when ANTHROPIC_API_KEY is unset (CI, key-less dev). When a
 * key IS present:
 *   1. count_tokens proves the cached block clears Anthropic's 1024-token
 *      cache floor — below it, cache_control is silently ignored (the Slice 3
 *      lesson), so this is the canary for prompt shrinkage.
 *   2. Two real calls share the cached prefix (system + the constant
 *      output_config schema, exactly as production sends them) and the SECOND
 *      call must read from cache (cache_read_input_tokens > 0).
 *
 * These spend real tokens; they are named *.integration.test.ts and gated,
 * never part of the no-DB unit posture.
 */
import { describe, expect, it } from "vitest";
import { getClient } from "./client";
import { MODEL_SONNET } from "./models";
import { replanSystem } from "./prompts/replan";
import { replanOutputFormat } from "./replan-diff";

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
const run = hasKey ? describe : describe.skip;

run("replan prompt caching (integration)", () => {
  it("the cached system block clears the 1024-token cache floor", async () => {
    const client = getClient();
    expect(client).not.toBeNull();
    if (!client) return;

    const count = await client.messages.countTokens({
      model: MODEL_SONNET,
      system: replanSystem(),
      messages: [{ role: "user", content: "x" }],
    });
    console.info(
      `replan system prompt tokens (incl. tiny user turn): ${count.input_tokens}`,
    );
    expect(count.input_tokens).toBeGreaterThan(1024);
  }, 30_000);

  it("second identical-prefix call reads the cache", async () => {
    const client = getClient();
    expect(client).not.toBeNull();
    if (!client) return;

    const base = {
      model: MODEL_SONNET,
      max_tokens: 16,
      system: replanSystem(),
      output_config: { format: replanOutputFormat() },
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

    console.info(
      `replan cache: first creation=${first.usage.cache_creation_input_tokens} ` +
        `read=${first.usage.cache_read_input_tokens}; ` +
        `second creation=${second.usage.cache_creation_input_tokens} ` +
        `read=${second.usage.cache_read_input_tokens}`,
    );
  }, 60_000);
});
