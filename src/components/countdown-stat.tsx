/**
 * CountdownStat — a tabular number + label (DESIGN.md §6, §3).
 *
 * The data primitive for countdowns ("18 days to Mont Buet") and similar
 * figures. The number uses `tabular-nums` so digits don't jitter as they
 * change, and the display face (Fraunces) is allowed on the big variant per the
 * type stance. Plain and declarative — no progress ring, no gamification.
 */
import { cn } from "@/lib/utils";

interface CountdownStatProps {
  /** The figure, e.g. "18". Rendered with tabular-nums. */
  value: string | number;
  /** The unit/label, e.g. "days to Mont Buet". */
  label: string;
  /** Optional second line, e.g. a target date. */
  sublabel?: string;
  size?: "sm" | "lg";
  className?: string;
}

export function CountdownStat({
  value,
  label,
  sublabel,
  size = "sm",
  className,
}: CountdownStatProps) {
  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-baseline gap-1.5">
        <span
          className={cn(
            "font-heading font-medium tabular-nums tracking-tight text-foreground",
            size === "lg" ? "text-[28px] leading-none" : "text-[22px] leading-none",
          )}
        >
          {value}
        </span>
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      {sublabel && (
        <span className="mt-1 text-xs text-muted-foreground">{sublabel}</span>
      )}
    </div>
  );
}
