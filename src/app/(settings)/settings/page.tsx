/**
 * Placeholder so the (settings) route group has a parent layout that
 * Phase 3's /billing and Phase 4's full settings landing can nest under.
 *
 * Authenticated (per middleware/proxy), so it must render per-request — not
 * statically — to read the user's session.
 */
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="space-y-2">
      <h1 className="text-2xl font-medium">Settings</h1>
      <p className="text-sm opacity-70">Coming soon.</p>
    </main>
  );
}
