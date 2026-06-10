import type { ReactNode } from "react";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <section className="mx-auto max-w-2xl p-6">{children}</section>;
}
