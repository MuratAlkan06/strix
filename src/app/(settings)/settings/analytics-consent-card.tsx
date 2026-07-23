"use client";

/**
 * AnalyticsConsentCard — the settings surface for the #11 analytics choice.
 *
 * Makes the privacy policy's "withdraw analytics consent in Settings" claim
 * true: a Switch bound to the device-global consent store. Toggling is
 * effective immediately — granting inits PostHog and opts in; withdrawing calls
 * opt_out_capturing(), which stops capture AND clears PostHog's cookies/storage
 * (src/lib/analytics/client.ts). The choice survives sign-out (device-global).
 *
 * Register mirrors the sibling sign-out card: a calm, declarative Card; the
 * state is spelled out in text (not carried by the switch position alone —
 * DESIGN.md §11 "color is never the sole signal"), and the tap target clears
 * ≥44px via the min-h-11 label that toggles the switch.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { setAnalyticsConsent } from "@/lib/analytics/client";
import { useAnalyticsConsent } from "@/lib/analytics/consent";

const SWITCH_ID = "analytics-consent-switch";

export function AnalyticsConsentCard() {
  const consent = useAnalyticsConsent();
  const granted = consent === "granted";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics</CardTitle>
        <CardDescription>
          Strix uses PostHog to understand how the product is used. It stays off
          until you turn it on; turning it off clears the analytics cookies from
          this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor={SWITCH_ID}
            className="flex min-h-11 cursor-pointer flex-col justify-center gap-0.5"
          >
            <span className="text-sm font-medium text-foreground">
              Product analytics
            </span>
            <span className="text-sm font-normal text-muted-foreground">
              {granted
                ? "On — collecting usage events."
                : "Off — nothing is collected."}
            </span>
          </Label>
          <Switch
            id={SWITCH_ID}
            checked={granted}
            onCheckedChange={(checked) =>
              setAnalyticsConsent(checked ? "granted" : "denied")
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
