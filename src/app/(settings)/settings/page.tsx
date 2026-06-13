/**
 * /settings — minimal settings landing (phase 2.5, S7): the app's first
 * sign-out affordance plus the session-end purge watcher. Phase 3's /billing
 * and Phase 4's full settings sections nest under the same (settings) group.
 *
 * Authenticated (per middleware/proxy), so it must render per-request — not
 * statically — to read the user's session.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignOutButton } from "./sign-out-button";

export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return (
    <main className="flex flex-col gap-5 sm:gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          More to come here. For now: your account.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
          <CardDescription>
            Signing out also clears this device&apos;s offline copy of your
            dashboard — on a shared device, the next person sees nothing of
            yours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
