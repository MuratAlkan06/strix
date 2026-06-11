import type { ReactNode } from "react";

/**
 * (goals) route-group layout — the authenticated shell for goal-creation and
 * goal-management surfaces (intake at /goals/new now; goals list / detail in
 * later slices). A SEGMENT layout under the root layout (no second <html>);
 * each page supplies its own max-width + padding so it can size its own frame.
 */
export default function GoalsLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-full">{children}</div>;
}
