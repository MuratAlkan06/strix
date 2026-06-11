import type { ReactNode } from "react";

/**
 * (dashboard) route-group layout — the authenticated product shell that the
 * dashboard (and future authenticated surfaces nesting here) renders inside.
 *
 * This is a SEGMENT layout under the existing root layout (no second <html>);
 * it just provides the full-height frame. The empty-state / active dashboard
 * supplies its own internal max-width + padding so it can run the brand moment
 * full-bleed.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-full">{children}</div>;
}
