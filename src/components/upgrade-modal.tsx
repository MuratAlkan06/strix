"use client";

/**
 * UpgradeModal — the cap-hit / upgrade dialog (SPEC §10 "Upgrade prompt on cap
 * hit"; Phase-3 slice S1).
 *
 * Copy is restrained (DESIGN.md register): a plain statement of the cap, then
 * a two-card Pro vs Max compare. Parameterized per cap kind (plan generations,
 * replans, active goals) so every metered surface can reuse it. The check-in
 * capacity flow opens it pre-flight with the default (replans) copy.
 *
 * CTAs are rendered as an EXPLICIT "coming soon" state, not broken buttons:
 * functional Stripe Checkout wiring is slice S3 (Switch to Pro) / S4 (Start
 * Max trial), which land after the prod cutover. This repo ships no dead
 * buttons — the disabled state + caption is the honest interim. Prices are
 * display-only strings (no Stripe import, no env price IDs — that is S2).
 */
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DISPLAY_PRICES } from "@/lib/billing/display-prices";

export type CapKind = "plan_generations" | "replans" | "active_goals";

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Which cap was hit — drives the headline/subline. Defaults to replans
   *  (the check-in capacity surface that first shipped this modal). */
  capKind?: CapKind;
}

const CAP_COPY: Record<CapKind, { title: string; subline: string }> = {
  plan_generations: {
    title: "You've used all 3 plan generations this month.",
    subline:
      "Upgrade to Pro or Max for unlimited plan generations and replans.",
  },
  replans: {
    title: "You've used all your replans this month.",
    subline:
      "Upgrade to Pro or Max for unlimited plan generations and replans.",
  },
  active_goals: {
    title: "You've reached the Free plan's 3 active goals.",
    subline: "Upgrade to Pro or Max to run up to 5 active goals at once.",
  },
};

/** A single plan card — token-styled, no hard-coded colors/spacing. */
function PlanCard({
  name,
  price,
  features,
  cta,
  ctaNote,
}: {
  name: string;
  price: string;
  features: string;
  cta: string;
  ctaNote?: string;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div>
        <h3 className="font-heading text-base font-medium text-foreground">
          {name}
        </h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{price}</p>
      </div>
      <p className="text-sm leading-relaxed text-foreground">{features}</p>
      {/* Caption sits ABOVE the button so the button is the last, bottom-pinned
          child — this bottom-aligns the CTAs across cards even when captions
          differ in line count (Pro 1 line vs Max 3). */}
      <div className="mt-auto flex flex-col gap-1">
        <p className="text-center text-xs text-muted-foreground">
          Coming soon{ctaNote ? ` · ${ctaNote}` : ""}
        </p>
        {/* Coming soon: Checkout wiring is S3/S4. Explicit, not a dead button. */}
        <Button type="button" variant="outline" disabled className="w-full">
          {cta}
        </Button>
      </div>
    </div>
  );
}

export function UpgradeModal({
  open,
  onOpenChange,
  capKind = "replans",
}: UpgradeModalProps) {
  const copy = CAP_COPY[capKind];
  // Ref to the dialog popup element (threaded through DialogContent's prop
  // passthrough onto the Base UI Popup); used to anchor initial focus below.
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Viewport-bounded height with internal scroll so short screens (e.g.
          375x560, active_goals) never clip the title or the "Maybe later"
          dismiss. overflow-x-hidden pairs with overflow-y-auto (house pattern,
          see select.tsx) so the footer's -mx-4 bleed can't trip a horizontal
          scrollbar. */}
      <DialogContent
        ref={contentRef}
        // When the modal overflows into its internal scroll, Base UI's default
        // open-focus moves to the first tabbable element — here "Maybe later"
        // (both CTAs are disabled), which the browser scrolls into view,
        // opening the dialog at the bottom with the title and close X clipped
        // above the fold. Anchor initial focus on the popup container itself
        // (it carries tabIndex=-1, non-interactive, no focus ring) so the modal
        // opens at scrollTop=0 with the header visible. The focus trap and the
        // first-Tab -> "Maybe later" -> close X order are unchanged.
        initialFocus={() => contentRef.current}
        className="max-h-[calc(100dvh-2rem)] overflow-x-hidden overflow-y-auto"
      >
        <DialogHeader>
          {/* pr-9 reserves room for the absolutely-positioned close X (size-7 at
              right-2); leading-snug keeps the now-wrappable title legible. */}
          <DialogTitle className="pr-9 leading-snug">{copy.title}</DialogTitle>
          <DialogDescription>{copy.subline}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <PlanCard
            name="Pro"
            price={`${DISPLAY_PRICES.pro.monthly} · ${DISPLAY_PRICES.pro.annual}`}
            features="Unlimited plan generations and replans. Up to 5 active goals."
            cta="Switch to Pro"
          />
          <PlanCard
            name="Max"
            price={`${DISPLAY_PRICES.max.monthly} · ${DISPLAY_PRICES.max.annual}`}
            features="Everything in Pro, with a one-week free trial to start."
            cta="Start Max trial"
            ctaNote="Card required · Cancel anytime within the week"
          />
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>
            Maybe later
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
