"use client";

/**
 * use-focus-on-mount.ts — move keyboard focus INTO an inline editor the
 * moment it opens (issue #46, revision: focus-on-open).
 *
 * The counterpart to use-restore-focus: these editors REPLACE their trigger,
 * so when one opens the control that held focus unmounts and the browser
 * silently drops focus to <body>. Nothing shows a focus ring, screen readers
 * announce nothing, and the editor's container-level Escape handler is
 * unreachable — a keydown on <body> never passes through the editor, so
 * "open → Escape" was a no-op.
 *
 * The mechanism: attach the returned ref to the editor's container. On mount
 * (these editors render conditionally, so mount IS open) the hook focuses
 * the container's first interactive control in DOM order. Per surface that
 * lands on:
 *   - the EditorFrame editors (plan review, goal detail): the first field —
 *     the Title/Item input. "Edit" is an explicit intent to type, so the
 *     mobile keyboard appearing is the point, and the labeled field
 *     announces the editor to screen readers.
 *   - the replan ✎ ChangeEditor: the first proposed field (a select or an
 *     input, whichever the change carries first).
 * (The Mark-complete confirm focuses its Cancel button via `autoFocus`
 * instead — its container lives inline in GoalDetail, which is already
 * mounted when the confirm opens, so a mount-scoped hook can't see it.)
 *
 * Close-restore stays use-restore-focus's job; this hook runs once on mount
 * and never steals focus afterwards.
 */
import { useEffect, useRef, type RefObject } from "react";

const FIRST_CONTROL = "input, select, textarea, button";

export function useFocusOnMount<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>(FIRST_CONTROL)?.focus();
  }, []);
  return ref;
}
