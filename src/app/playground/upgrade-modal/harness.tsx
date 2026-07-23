"use client";

/**
 * UpgradeModalHarness — client wrapper for the playground upgrade-modal surface.
 * Renders the REAL <UpgradeModal /> OPEN with local open-state so its dismiss
 * ("Maybe later" / close) and the reopen control are exercisable without auth.
 *
 * NO telemetry: the free_tier_cap_hit capture lives in the modal's CALLERS
 * (plan-generation / generate-replan-client / save-goal), never in the modal
 * itself, so rendering it here emits nothing. Display prices are the static
 * DISPLAY_PRICES strings, so the surface is deterministic.
 *
 * The three cap kinds are URL-addressable via the ?state= switcher links (the
 * house pattern). The modal is a full-screen overlay, so dismiss it ("Maybe
 * later") to use the switcher, then pick the next variant.
 */
import Link from "next/link";
import { useState } from "react";

import { Button, buttonVariants } from "@/components/ui/button";
import { UpgradeModal, type CapKind } from "@/components/upgrade-modal";
import { cn } from "@/lib/utils";

const VARIANTS: { kind: CapKind; label: string }[] = [
  { kind: "plan_generations", label: "Plan generations" },
  { kind: "replans", label: "Replans" },
  { kind: "active_goals", label: "Active goals" },
];

export function UpgradeModalHarness({ capKind }: { capKind: CapKind }) {
  const [open, setOpen] = useState(true);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 p-4 text-center">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          UpgradeModal ·{" "}
          <span className="font-medium text-foreground">{capKind}</span>
        </p>
        <nav
          aria-label="Cap kind"
          className="flex flex-wrap justify-center gap-2"
        >
          {VARIANTS.map((v) => (
            <Link
              key={v.kind}
              href={`?state=${v.kind}`}
              aria-current={v.kind === capKind ? "page" : undefined}
              className={cn(
                buttonVariants({
                  variant: v.kind === capKind ? "default" : "outline",
                  size: "sm",
                }),
              )}
            >
              {v.label}
            </Link>
          ))}
        </nav>
      </div>

      {!open && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
        >
          Reopen modal
        </Button>
      )}

      <UpgradeModal open={open} onOpenChange={setOpen} capKind={capKind} />
    </main>
  );
}
