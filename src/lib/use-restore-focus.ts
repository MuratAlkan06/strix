"use client";

/**
 * use-restore-focus.ts — one focus-restore pattern for inline editors that
 * REPLACE their trigger (issue #46: the EditorFrame surfaces and the replan
 * diff ✎ editor, fixed together as one mechanism).
 *
 * The problem: these editors render in the trigger's place, so the control
 * that opened them unmounts while they are open. When the editor closes
 * (Cancel click, Escape, or a confirming Done/Save), the editor's chrome
 * unmounts too and keyboard focus silently drops to <body> — a WCAG 2.4.3
 * focus-order failure for keyboard and screen-reader users.
 *
 * The mechanism: the OWNER of the editing state calls the returned capture
 * function in the same handler that opens an editor, naming the trigger by
 * element id (ids survive the unmount/remount round-trip; element refs do
 * not). When `open` flips back to false the hook refocuses that element —
 * or the fallback id when the trigger itself unmounted (e.g. Remove deleted
 * the row, so its Edit button is gone and focus goes to the section's Add
 * control instead).
 *
 * It never steals focus: if anything besides <body> holds focus after the
 * close commit (the user dismissed by clicking some still-mounted control,
 * like "Save goal"), nothing moves.
 */
import { useCallback, useEffect, useRef } from "react";

type Captured = { triggerId: string; fallbackId: string | null };

export function useRestoreFocus(
  open: boolean,
): (triggerId: string, fallbackId?: string) => void {
  const captured = useRef<Captured | null>(null);
  const wasOpen = useRef(open);

  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (!closed || captured.current === null) return;
    const { triggerId, fallbackId } = captured.current;
    captured.current = null;
    // Focus only moved if it was actually dropped — anything still holding
    // focus (a clicked control outside the editor) keeps it.
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const target =
      document.getElementById(triggerId) ??
      (fallbackId !== null ? document.getElementById(fallbackId) : null);
    target?.focus();
  }, [open]);

  return useCallback((triggerId: string, fallbackId?: string) => {
    captured.current = { triggerId, fallbackId: fallbackId ?? null };
  }, []);
}
