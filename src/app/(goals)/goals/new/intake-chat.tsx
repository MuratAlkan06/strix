/**
 * intake-chat.tsx — the streaming goal-intake chat UI (phase-1-golden-path
 * "Goal intake conversational chat"; DESIGN.md §6 clean-chrome task UI).
 *
 * Crisp chrome, no illustration (DESIGN.md §4.5: chat is working UI). Dusk
 * tokens only, Hanken body / Fraunces nowhere needed here (the page owns the one
 * h1). Targets clear ≥44×44px; the send button is min-h-11; motion is the
 * restrained row strike / fade carried by the shared primitives.
 *
 * Streams assistant deltas from POST /api/ai/intake over SSE. PostHog (existing
 * wrappers): intake_started on the first user message; intake_completed +
 * intake_turn_count on completion; intake_drop_off_turn best-effort on
 * navigate-away mid-intake.
 *
 * Completion handoff is a calm terminal state only — the intensity confirmation
 * card (Slice 4) and safety decision cards (Slice 5) are NOT built here; safety
 * pushback arrives as ordinary assistant prose.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { capture, initPostHog } from "@/lib/analytics/client";
import type { TranscriptTurn } from "@/lib/ai/transcript";

interface IntakeChatProps {
  goalDraftId: string;
  seed: string | null;
  initialTranscript: TranscriptTurn[];
  initiallyCompleted: boolean;
  /**
   * Fixture mode for the auth-exempt design-review harness
   * (/playground/intake-chat). Defaults to false so the real /goals/new route
   * is byte-identical at runtime. When true: no PostHog init/capture, no
   * drop-off effect, and send() echoes a deterministic local turn instead of
   * calling /api/ai/intake — the chat stays interactive with zero live API/DB.
   */
  fixtureMode?: boolean;
  /**
   * Lifts the completed intake summary to a parent so it can lead into the
   * intensity confirmation card (Slice 4). When provided, the chat suppresses
   * its own inline completion block — the parent owns the handoff. Absent in
   * the standalone /playground/intake-chat harness, which keeps the inline
   * completion handoff as its terminal state.
   */
  onIntakeComplete?: (summary: SummaryShape | null) => void;
}

type Turn = TranscriptTurn;

interface SummaryShape {
  structured_fields_count?: number;
  [k: string]: unknown;
}

function opener(seed: string | null): string {
  switch (seed) {
    case "climb":
      return "A mountain. Tell me which one, or the kind of climb you have in mind — and where you're starting from today.";
    case "language":
      return "A new language. Which one, and what does fluent-enough look like for you? Tell me where you're starting from.";
    case "race":
      return "A race. What distance, and is there a date you're aiming for? Tell me where your training is today.";
    case "book":
      return "A book. What's it about, and how finished do you want it to be? Tell me what you've written so far.";
    case "instrument":
      return "An instrument. Which one, and what do you want to be able to play? Tell me where you're starting from.";
    default:
      return "Tell me what you want to work toward, and where you're starting from today.";
  }
}

export function IntakeChat({
  goalDraftId,
  seed,
  initialTranscript,
  initiallyCompleted,
  fixtureMode = false,
  onIntakeComplete,
}: IntakeChatProps) {
  const [turns, setTurns] = useState<Turn[]>(initialTranscript);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [completed, setCompleted] = useState(initiallyCompleted);
  const [error, setError] = useState<string | null>(null);

  const startedRef = useRef(initialTranscript.length > 0);
  const completedRef = useRef(initiallyCompleted);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fixtureMode) return;
    initPostHog();
  }, [fixtureMode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, streaming]);

  // Best-effort drop-off: if the user leaves mid-intake (started, not done).
  useEffect(() => {
    if (fixtureMode) return;
    return () => {
      if (startedRef.current && !completedRef.current) {
        capture("intake_drop_off_turn", {
          goal_draft_id: goalDraftId,
          last_turn: countUserTurns(initialTranscript),
        });
      }
    };
    // Intentionally bound once on mount; refs carry live values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback(async () => {
    const message = input.trim();
    if (!message || streaming || completed) return;

    if (!startedRef.current) {
      startedRef.current = true;
      if (!fixtureMode) {
        capture("intake_started", {
          goal_draft_id: goalDraftId,
          ...(seed ? { seed } : {}),
        });
      }
    }

    setError(null);
    setInput("");
    setStreaming(true);
    setTurns((prev) => [...prev, { role: "user", content: message }]);

    // Optimistic empty assistant turn we stream into.
    setTurns((prev) => [...prev, { role: "assistant", content: "" }]);

    // Fixture mode (design-review harness): never touch the network. Echo a
    // deterministic local assistant turn so the chat stays interactive offline.
    if (fixtureMode) {
      setTurns((prev) =>
        appendToLastAssistant(
          prev,
          "Noted. That gives me enough to keep shaping the plan.",
        ),
      );
      setStreaming(false);
      return;
    }

    try {
      const res = await fetch("/api/ai/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok || !res.body) {
        throw new Error(
          res.status === 409
            ? "We've covered enough to build your plan."
            : "The intake service is unavailable right now.",
        );
      }
      await consumeSse(res.body, {
        onDelta: (text) =>
          setTurns((prev) => appendToLastAssistant(prev, text)),
        onComplete: (summary) => {
          completedRef.current = true;
          setCompleted(true);
          const count = countUserTurns([
            ...initialTranscript,
            { role: "user", content: message },
          ]);
          capture("intake_completed", {
            goal_draft_id: goalDraftId,
            turn_count: count,
            structured_fields_count: structuredFieldCount(summary),
          });
          capture("intake_turn_count", {
            goal_draft_id: goalDraftId,
            turn_count: count,
          });
          // Hand the summary up so the parent can lead into the intensity
          // confirmation card.
          onIntakeComplete?.(summary);
        },
        onError: (msg) => setError(msg),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setStreaming(false);
    }
  }, [
    input,
    streaming,
    completed,
    goalDraftId,
    seed,
    initialTranscript,
    fixtureMode,
    onIntakeComplete,
  ]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div
        ref={scrollRef}
        aria-live="polite"
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      >
        {turns.length === 0 && (
          <p className="max-w-prose text-base leading-relaxed text-foreground">
            {opener(seed)}
          </p>
        )}
        {turns.map((turn, i) => (
          <Message key={i} role={turn.role} content={turn.content} />
        ))}
        {completed && !onIntakeComplete && (
          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-base leading-relaxed text-foreground">
              That&apos;s everything I need. I&apos;ll put together a plan from
              here.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              The next step is coming together.
            </p>
          </div>
        )}
      </div>

      {error && (
        <p
          role="status"
          className="text-sm text-muted-foreground"
        >
          {error}
        </p>
      )}

      {!completed && (
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <label htmlFor="intake-input" className="sr-only">
            Your reply
          </label>
          <textarea
            id="intake-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            disabled={streaming}
            rows={2}
            placeholder="Write your reply"
            className="min-h-11 w-full resize-none rounded-lg border border-input bg-transparent px-3 py-2.5 text-base leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
          />
          <Button
            type="submit"
            size="lg"
            disabled={streaming || input.trim().length === 0}
            className="h-11 min-h-11 px-5"
          >
            {streaming ? "Sending" : "Send"}
          </Button>
        </form>
      )}
    </div>
  );
}

function Message({ role, content }: { role: Turn["role"]; content: string }) {
  const isUser = role === "user";
  return (
    <div
      className={
        isUser ? "flex min-w-0 justify-end" : "flex min-w-0 justify-start"
      }
    >
      <div
        className={
          isUser
            ? "min-w-0 max-w-prose break-words [overflow-wrap:anywhere] rounded-xl bg-secondary px-4 py-2.5 text-base leading-relaxed text-secondary-foreground"
            : "min-w-0 max-w-prose break-words [overflow-wrap:anywhere] text-base leading-relaxed text-foreground"
        }
      >
        <span className="sr-only">{isUser ? "You:" : "Coach:"} </span>
        {content || (
          <span className="text-muted-foreground" aria-label="Thinking">
            …
          </span>
        )}
      </div>
    </div>
  );
}

function appendToLastAssistant(turns: Turn[], text: string): Turn[] {
  const next = [...turns];
  for (let i = next.length - 1; i >= 0; i--) {
    const turn = next[i];
    if (turn && turn.role === "assistant") {
      next[i] = { ...turn, content: turn.content + text };
      return next;
    }
  }
  return next;
}

function countUserTurns(turns: Turn[]): number {
  return turns.filter((t) => t.role === "user").length;
}

function structuredFieldCount(summary: SummaryShape | null): number {
  if (!summary) return 0;
  if (typeof summary.structured_fields_count === "number") {
    return summary.structured_fields_count;
  }
  // Count non-null scalar fields the summary carries.
  return Object.entries(summary).filter(
    ([, v]) => v != null && typeof v !== "object",
  ).length;
}

/** Minimal SSE reader over a fetch ReadableStream (no EventSource — POST). */
async function consumeSse(
  body: ReadableStream<Uint8Array>,
  handlers: {
    onDelta: (text: string) => void;
    onComplete: (summary: SummaryShape | null) => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = parseSseEvent(raw);
      if (!event) continue;
      switch (event.name) {
        case "delta":
          if (typeof event.data?.text === "string") {
            handlers.onDelta(event.data.text);
          }
          break;
        case "complete":
          handlers.onComplete(
            (event.data?.summary as SummaryShape | null) ?? null,
          );
          break;
        case "error":
          handlers.onError(
            typeof event.data?.message === "string"
              ? event.data.message
              : "The intake service hit an error.",
          );
          break;
        default:
          break;
      }
    }
  }
}

function parseSseEvent(
  raw: string,
): { name: string; data: Record<string, unknown> | null } | null {
  let name = "message";
  let dataLine = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
  }
  if (!dataLine) return { name, data: null };
  try {
    return { name, data: JSON.parse(dataLine) as Record<string, unknown> };
  } catch {
    return { name, data: null };
  }
}
