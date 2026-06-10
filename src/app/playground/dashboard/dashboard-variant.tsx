"use client";

/**
 * DashboardVariant — one full DAWN dashboard composition (plan Appendix §5.2).
 *
 * Rendered three times by page.tsx, once inside each .v1/.v2/.v3 wrapper, so the
 * three palettes sit side-by-side for curation. Layout is mobile-first and
 * responsive 375→1440: single column on mobile, a 2-col row for week/upcoming at
 * 768, and a 2-col grid (primary Today left, right rail of week/upcoming/
 * equipment) at 1024+, capped at max-w-7xl.
 *
 * The ONLY client state is checkbox toggling (trivial). Everything else is the
 * static seed. Task rows are clean chrome: text + GoalChip + checkbox — no
 * illustration, per the task-row rule.
 */
import { useState } from "react";
import { Calendar, Package } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { CountdownStat } from "@/components/countdown-stat";
import { GoalChip } from "@/components/goal-chip";
import { HorizonHeader } from "@/components/horizon-header";
import { Scene } from "@/components/scene";
import { cn } from "@/lib/utils";

import {
  COUNTDOWN,
  DATE_LABEL,
  EQUIPMENT,
  GOALS,
  GREETING,
  MILESTONES,
  THIS_WEEK,
  TODAY,
  type TaskRow as TaskRowData,
} from "./seed";

/* -------------------------------------------------------------------------- */
/* Task row — text + GoalChip + checkbox. Clean chrome, no illustration.       */
/* -------------------------------------------------------------------------- */
function TaskRow({ row }: { row: TaskRowData }) {
  const [checked, setChecked] = useState(row.checked);
  return (
    <label
      className={cn(
        "pg-row flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 hover:bg-accent",
      )}
    >
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => setChecked(v === true)}
        aria-label={row.text}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span
          className={cn(
            "text-sm leading-snug",
            checked
              ? "text-muted-foreground line-through"
              : "text-foreground",
          )}
        >
          {row.text}
        </span>
        <GoalChip colorIndex={row.colorIndex} name={row.goalName} />
      </span>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Goals rail — slim "your goals" strip (3 dawn mini-scenes + title + dot).     */
/* -------------------------------------------------------------------------- */
function GoalsRail() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Your goals</CardTitle>
        <CardDescription>{GOALS.length} in progress</CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-3">
        {GOALS.map((g) => (
          <div key={g.id} className="flex flex-col gap-1.5">
            <div className="h-16 overflow-hidden rounded-lg ring-1 ring-foreground/10">
              <Scene state="dawn" variant={g.scene} />
            </div>
            <GoalChip colorIndex={g.colorIndex} name={g.title} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Today — the primary column.                                                 */
/* -------------------------------------------------------------------------- */
function TodayCard() {
  const done = TODAY.filter((t) => t.checked).length;
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle>Today</CardTitle>
        <CardDescription>
          {done} of {TODAY.length} done
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {TODAY.map((row) => (
          <TaskRow key={row.id} row={row} />
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* This week.                                                                  */
/* -------------------------------------------------------------------------- */
function ThisWeekCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>This week</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {THIS_WEEK.map((row) => (
          <div
            key={row.id}
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-2"
          >
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-sm leading-snug text-foreground">
                {row.text}
              </span>
              <GoalChip colorIndex={row.colorIndex} name={row.goalName} />
            </span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              {row.when}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Upcoming milestones.                                                         */
/* -------------------------------------------------------------------------- */
function UpcomingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Upcoming milestones</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {MILESTONES.map((m) => (
          <div
            key={m.id}
            className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-2"
          >
            <Calendar
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">
              {m.text}
            </span>
            <span className="flex shrink-0 items-center gap-1.5">
              <span
                aria-hidden="true"
                className="size-2 rounded-full ring-1 ring-foreground/10"
                style={{ backgroundColor: `var(--goal-color-${m.colorIndex})` }}
              />
              <span className="text-xs tabular-nums text-muted-foreground">
                {m.when}
              </span>
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Equipment — warning-toned (amber/primary), never red.                       */
/* -------------------------------------------------------------------------- */
function EquipmentCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equipment</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-0.5">
        {EQUIPMENT.map((e) => (
          <div
            key={e.id}
            className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-2"
          >
            <Package
              className="size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-sm leading-snug text-foreground">
                {e.item}
                <span className="text-primary"> · {e.when}</span>
              </span>
              <GoalChip colorIndex={e.colorIndex} name={e.goalName} />
            </span>
            <span className="shrink-0 text-sm tabular-nums text-foreground">
              {e.price}
            </span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* The full composition.                                                        */
/* -------------------------------------------------------------------------- */
export function DashboardVariant() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 sm:gap-5 sm:p-5">
      <HorizonHeader greeting={GREETING} date={DATE_LABEL} state="dawn" />

      {/* hero goal stat + adjust stub */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-4">
          <CountdownStat
            value={COUNTDOWN.value}
            label={COUNTDOWN.label}
            sublabel={COUNTDOWN.sublabel}
            size="lg"
          />
          <Button variant="outline" size="sm">
            Adjust
          </Button>
        </CardContent>
      </Card>

      {/* responsive body: single col → 2-col grid (Today left, rail right) at lg */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-4 sm:gap-5">
          <TodayCard />
        </div>
        <div className="flex flex-col gap-4 sm:gap-5">
          <GoalsRail />
          {/* week + upcoming sit 2-col at md, stacked in the rail at lg */}
          <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 lg:grid-cols-1">
            <ThisWeekCard />
            <UpcomingCard />
          </div>
          <EquipmentCard />
        </div>
      </div>
    </div>
  );
}
