"use client";

/**
 * UpgradeModal — the free-cap dialog (phase-2-close-the-loop "Weekly check-in
 * UI": tapping a capacity-disabled goal opens the upgrade modal; the same
 * modal serves future cap-hit surfaces).
 *
 * Copy is restrained (DESIGN.md register): a plain statement of the cap and
 * what Pro changes — no urgency, no shame. There is deliberately NO upgrade
 * CTA yet: billing ships in Phase 3 and this repo ships no dead buttons.
 * "Got it" dismisses.
 */
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

interface UpgradeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function UpgradeModal({ open, onOpenChange }: UpgradeModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            You&apos;ve used all your replans for this month.
          </DialogTitle>
          <DialogDescription>
            Free includes 2 replans a month. Pro removes the cap.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button />}>Got it</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
