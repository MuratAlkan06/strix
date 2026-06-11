# ADR-0001 — AI client stack

**Status:** Accepted (frozen) · **Date:** 2026-06-10 · **Phase:** 1 (Slice 3)

## Context

Phase 1 introduces the first AI surfaces: the streaming goal-intake
conversation (Slice 3) and, later, plan generation (Slice 6). Both need a
streaming chat model with tool use, Anthropic prompt caching on a large stable
system prompt, and reliable JSON extraction from tool calls. A single
lightweight Haiku classifier canonicalizes loose intake fields.

The choice is between a thin direct wrapper over `@anthropic-ai/sdk` and a
higher-level abstraction such as the Vercel AI SDK.

## Decision

Use the **direct `@anthropic-ai/sdk`**, pinned **exactly** to **`0.104.1`** —
the only new runtime dependency this slice adds.

All AI access is funneled through a chokepoint at **`src/lib/ai/`**, mirroring
the `src/lib/analytics/server.ts` posture:

- A lazily-instantiated singleton `getClient()`, guarded on `ANTHROPIC_API_KEY`
  (returns `null` when unset, so key-less environments and unit tests degrade
  cleanly instead of throwing at import).
- Narrow, named functions — `streamIntake(...)` and `canonicalize(...)`.
  `generatePlan(...)` is Slice 6; a clean seam is left for it with no stub logic.
- Model-ID constants `MODEL_SONNET = "claude-sonnet-4-6"` and
  `MODEL_HAIKU = "claude-haiku-4-5"` defined **once**, in `src/lib/ai/models.ts`.
- The cached system prompt lives in `src/lib/ai/prompts/`, assembled as a
  `system: [{ type: "text", …, cache_control: { type: "ephemeral" } }]` block
  with **zero per-request variability** so the cache prefix is byte-stable.

**Feature code imports only from `src/lib/ai/`, never `@anthropic-ai/sdk`
directly.** This keeps the provider, model IDs, caching posture, and usage
logging in one place.

## Rationale (direct SDK over Vercel AI SDK)

- **`cache_control` fidelity** — Anthropic prompt caching is configured at the
  content-block level (`cache_control: { type: "ephemeral" }`). The direct SDK
  exposes this precisely; an abstraction layer can blur or lag it.
- **JSON extraction fidelity** — intake terminates via a forced/structured tool
  call (`submit_intake`); canonicalization uses a forced Haiku tool. Reading
  `tool_use` blocks straight off the message is exact and version-stable.
- **House thin-wrapper style** — this repo already funnels cross-cutting clients
  (PostHog, the DB) through narrow `src/lib/*` chokepoints. The AI client
  follows the same shape, so there is one obvious place to evolve.

## Consequences

- One dependency, exact-pinned; upgrades are deliberate, not transitive.
- Streaming, tool use, and usage accounting are written against the SDK's typed
  surface (`MessageStream`, `TextBlockParam`, `Tool`, `Usage`).
- Token usage (including `cache_creation_input_tokens` /
  `cache_read_input_tokens`) is logged through a small structured server log,
  with no PII.

## Revisit triggers

Re-evaluate this decision (and whether a higher-level abstraction now earns its
weight) when ANY of the following lands:

- a **second model provider** enters the stack;
- **generative UI** (streaming React components) is needed;
- the system grows **beyond ~4–5 AI endpoints**;
- **agentic loops** (multi-step tool orchestration) become a core flow.
