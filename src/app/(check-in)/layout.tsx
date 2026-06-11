import type { ReactNode } from "react";

/**
 * (check-in) route-group layout — the authenticated shell for the weekly
 * check-in at /check-in. A SEGMENT layout under the root layout (no second
 * <html>), matching the (goals)/(dashboard)/(equipment) posture; the page
 * supplies its own max-width + padding. Auth is enforced by the proxy.ts
 * middleware (negative matcher — /check-in is not in the public whitelist).
 */
export default function CheckInLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-full">{children}</div>;
}
