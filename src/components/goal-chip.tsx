/**
 * GoalChip — the goal-attribution primitive (DESIGN.md §5, §6).
 *
 * A coloured dot PLUS the goal-name text. Colour is NEVER the sole meaning
 * carrier: the name always rides alongside the dot, so the chip passes
 * colour-not-only by construction. The dot is the goal-ramp hue
 * (`--goal-color-N`) with a 1px inner ring at 10% foreground (≥3:1 on its card).
 *
 * Used in task rows, this-week rows, milestones, and equipment — the only
 * decorative colour the clean task chrome carries.
 */
import { cn } from "@/lib/utils";

interface GoalChipProps {
  /** 0–4 → goal-ramp hue via var(--goal-color-N). */
  colorIndex: 0 | 1 | 2 | 3 | 4;
  name: string;
  className?: string;
}

export function GoalChip({ colorIndex, name, className }: GoalChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full ring-1 ring-foreground/10"
        style={{ backgroundColor: `var(--goal-color-${colorIndex})` }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}
