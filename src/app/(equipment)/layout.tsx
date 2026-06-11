import type { ReactNode } from "react";

/**
 * (equipment) route-group layout — the authenticated shell for the aggregated
 * equipment view at /equipment. A SEGMENT layout under the root layout (no
 * second <html>), matching the (goals)/(dashboard) posture; the page supplies
 * its own max-width + padding.
 */
export default function EquipmentLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-full">{children}</div>;
}
