"use client";

/**
 * EquipmentList — the presentational aggregated-equipment surface
 * (phase-1-golden-path "Equipment aggregated view"). A client component only
 * because of the purchased checkbox: it toggles optimistically and reverts on
 * a failed result. Everything else is display over the pure model; the
 * product page passes the real server action, the playground harness a local
 * no-op.
 *
 * Row = clean chrome (DESIGN.md §4.5/§6 — no illustration on equipment
 * rows): checkbox + title + GoalChip deep-link + deadline + cost. The
 * checkbox's EFFECTIVE target is ≥44×44 (size-5 glyph + extended hit area —
 * the playground's 16px control is NOT copied verbatim, §11 graduation), and
 * the checked state is never color-only (check glyph + strikethrough).
 * Purchased rows stay visible in their group, struck and muted — nothing
 * disappears silently. Overdue gets an amber icon-paired note (§8: warning is
 * amber/primary, never red).
 */
import { useState } from "react";
import Link from "next/link";
import { CircleAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { GoalChip } from "@/components/goal-chip";
import { formatDate, formatUsd } from "@/lib/format";
import type { EquipmentUrgency } from "@/lib/equipment-urgency";
import type {
  EquipmentGroupModel,
  EquipmentRowModel,
  TogglePurchasedHandler,
  TogglePurchasedResult,
} from "./equipment-model";

const GROUP_LABELS: Record<EquipmentUrgency, string> = {
  this_week: "This week",
  this_month: "This month",
  later: "Later",
  no_date: "No date yet",
};

function DeadlineNote({ row }: { row: EquipmentRowModel }) {
  if (row.deadline === null) return null;
  if (row.overdue) {
    // §8: overdue is an amber inline note with icon + text — a plain
    // statement, never red, never shame copy.
    return (
      <span className="inline-flex items-center gap-1 text-xs text-primary">
        <CircleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="tabular-nums">
          Was due {formatDate(row.deadline)}
        </span>
      </span>
    );
  }
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      By {formatDate(row.deadline)}
    </span>
  );
}

function EquipmentRow({
  row,
  purchased,
  onToggle,
}: {
  row: EquipmentRowModel;
  purchased: boolean;
  onToggle: (row: EquipmentRowModel, next: boolean) => void;
}) {
  const cost = formatUsd(row.costUsd);
  return (
    <li className="flex items-center gap-3 rounded-lg px-2 py-2">
      {/* size-5 glyph; the after:* hit area extends it to a 44×44 effective
          target (20px + 2×12px). Checked state = glyph + strikethrough. */}
      <Checkbox
        checked={purchased}
        onCheckedChange={(v) => onToggle(row, v === true)}
        aria-label={`Purchased: ${row.title}`}
        className="size-5 cursor-pointer after:-inset-3 [&_svg]:size-4"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={
            purchased
              ? "text-sm leading-snug text-muted-foreground line-through"
              : "text-sm leading-snug text-foreground"
          }
        >
          {row.title}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <Link
            href={`/goals/${row.goalId}`}
            className="-my-3 inline-flex min-h-11 min-w-11 cursor-pointer items-center rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <GoalChip
              colorIndex={row.goalColorIndex as 0 | 1 | 2 | 3 | 4}
              name={row.goalTitle}
              className="transition-colors hover:text-foreground"
            />
          </Link>
          <DeadlineNote row={row} />
        </span>
      </span>
      {cost && (
        <span
          className={
            purchased
              ? "shrink-0 text-sm tabular-nums text-muted-foreground line-through"
              : "shrink-0 text-sm tabular-nums text-foreground"
          }
        >
          {cost}
        </span>
      )}
    </li>
  );
}

export function EquipmentList({
  groups,
  onToggle,
}: {
  groups: EquipmentGroupModel[];
  onToggle: TogglePurchasedHandler;
}) {
  // Optimistic layer over the server-derived purchased state; reverted on a
  // failed toggle. Keyed by equipment id.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);

  async function handleToggle(row: EquipmentRowModel, next: boolean) {
    setError(null);
    setOverrides((o) => ({ ...o, [row.id]: next }));
    let result: TogglePurchasedResult;
    try {
      result = await onToggle({ equipmentId: row.id, purchased: next });
    } catch {
      result = { ok: false, error: "That didn't save. Try once more." };
    }
    if (!result.ok) {
      setOverrides((o) => ({ ...o, [row.id]: row.purchased }));
      setError(result.error);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Calm, plain error line (§8) — announced politely, never a red screen. */}
      <p aria-live="polite" role="status" className="sr-only">
        {error ?? ""}
      </p>
      {error && <p className="text-sm text-muted-foreground">{error}</p>}

      {groups.map((group) => (
        <section key={group.urgency} className="flex flex-col gap-2">
          <h2 className="font-heading text-base font-medium text-foreground">
            {GROUP_LABELS[group.urgency]}
          </h2>
          {group.urgency === "no_date" && (
            <p className="text-xs text-muted-foreground">
              Tied to milestones that don&apos;t have dates yet.
            </p>
          )}
          <Card className="py-2">
            <ul className="flex flex-col gap-0.5 px-2">
              {group.rows.map((row) => (
                <EquipmentRow
                  key={row.id}
                  row={row}
                  purchased={overrides[row.id] ?? row.purchased}
                  onToggle={handleToggle}
                />
              ))}
            </ul>
          </Card>
        </section>
      ))}
    </div>
  );
}
