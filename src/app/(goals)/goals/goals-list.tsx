/**
 * GoalsList — the presentational goals-list surface (phase-1-golden-path
 * "Goals list"). Pure display over a GoalsListModel: the authenticated /goals
 * page feeds it scopedDb-derived data; /playground/goals-list feeds it
 * fixtures. Server-safe — every interaction is a link.
 *
 * Composition (DESIGN.md discipline):
 *   - Active grid: each card is one link to /goals/[id] (Slice 9 — interim
 *     404 accepted by the phase contract). GoalChip carries the color
 *     attribution text-paired with the title (color never the sole signal);
 *     progress bar = completed/total milestones with the count written out;
 *     a 0-milestone goal states that honestly instead of a fake 0% bar.
 *   - "Add new goal" tile while active < cap (5): previews the next palette
 *     slot — dot AND name ("dawn amber") so the preview is not color-only.
 *     At cap: no tile, no fake upsell (Phase 3 adds real messaging).
 *   - "Completed" section + collapsed "Archived" disclosure (native
 *     details/summary) render honest empties until Phase 2 populates them.
 *   - Zero goals anywhere → honest empty pointing at /goals/new.
 *
 * Clean chrome: no illustration here (§4.5 — goals-list scene tiles are a
 * later design pass; nothing decorative is invented in this slice). Targets
 * ≥44×44, one h1, declarative copy.
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { Card } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { GoalChip } from "@/components/goal-chip";
import { GOAL_COLOR_NAMES } from "@/lib/goal-colors";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  ActiveGoalCardModel,
  GoalsListModel,
  InactiveGoalRowModel,
} from "./list-model";

const CARD_LINK_CLASS =
  "group/card block h-full cursor-pointer rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50";

function ActiveGoalCard({ goal }: { goal: ActiveGoalCardModel }) {
  return (
    <Link href={`/goals/${goal.id}`} className={CARD_LINK_CLASS}>
      <Card className="h-full gap-3 p-5 transition-colors group-hover/card:ring-foreground/25">
        <GoalChip
          colorIndex={goal.colorIndex as 0 | 1 | 2 | 3 | 4}
          name={goal.title}
          className="font-heading text-base font-medium text-foreground"
        />

        {goal.milestonesTotal > 0 ? (
          <div className="flex flex-col gap-1.5">
            <div
              aria-hidden="true"
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full"
                style={{
                  width: `${goal.progressPercent ?? 0}%`,
                  backgroundColor: `var(--goal-color-${goal.colorIndex})`,
                }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">
              {goal.milestonesCompleted} of {goal.milestonesTotal} milestones
            </span>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            No milestones in this plan yet.
          </span>
        )}

        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {goal.targetDate && (
            <span className="tabular-nums">
              Target {formatDate(goal.targetDate)}
            </span>
          )}
          {goal.milestonesTotal > 0 &&
            (goal.nextMilestoneTitle ? (
              <span className="truncate">Next: {goal.nextMilestoneTitle}</span>
            ) : (
              <span>All milestones done.</span>
            ))}
        </div>
      </Card>
    </Link>
  );
}

function AddGoalTile({ colorIndex }: { colorIndex: number }) {
  return (
    <Link href="/goals/new" className={CARD_LINK_CLASS}>
      <Card className="h-full justify-center gap-1.5 p-5 transition-colors group-hover/card:ring-foreground/25">
        <GoalChip
          colorIndex={colorIndex as 0 | 1 | 2 | 3 | 4}
          name="Add a new goal"
          className="font-heading text-base font-medium text-foreground"
        />
        <span className="text-xs text-muted-foreground">
          Its color will be {GOAL_COLOR_NAMES[colorIndex]}.
        </span>
      </Card>
    </Link>
  );
}

function InactiveGoalRow({ goal }: { goal: InactiveGoalRowModel }) {
  return (
    <li>
      <Link
        href={`/goals/${goal.id}`}
        className="flex min-h-11 cursor-pointer items-center rounded-lg px-2 outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <GoalChip
          colorIndex={goal.colorIndex as 0 | 1 | 2 | 3 | 4}
          name={goal.title}
          className="text-sm text-foreground"
        />
      </Link>
    </li>
  );
}

export function GoalsList({ model }: { model: GoalsListModel }) {
  const totalGoals =
    model.active.length + model.completed.length + model.archived.length;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:gap-8 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Your goals
        </h1>
        <p className="text-sm text-muted-foreground">
          Long efforts, one plan each.
        </p>
      </header>

      {totalGoals === 0 ? (
        // Honest empty — no goals anywhere yet.
        <Card className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="font-heading text-base font-medium text-foreground">
              Nothing in motion yet
            </span>
            <span className="text-sm text-muted-foreground">
              Describe what you want to work toward and we build the plan
              together.
            </span>
          </div>
          <Link
            href="/goals/new"
            className={cn(
              buttonVariants({ size: "lg" }),
              "h-11 min-h-11 w-full px-5 sm:w-auto",
            )}
          >
            Create a goal
          </Link>
        </Card>
      ) : (
        <>
          <section aria-label="Active goals">
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {model.active.map((goal) => (
                <li key={goal.id}>
                  <ActiveGoalCard goal={goal} />
                </li>
              ))}
              {model.addTileColorIndex !== null && (
                <li>
                  <AddGoalTile colorIndex={model.addTileColorIndex} />
                </li>
              )}
            </ul>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="font-heading text-base font-medium text-foreground">
              Completed
            </h2>
            {model.completed.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing completed yet. Goals you finish move here.
              </p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {model.completed.map((goal) => (
                  <InactiveGoalRow key={goal.id} goal={goal} />
                ))}
              </ul>
            )}
          </section>

          <details className="group/archived">
            <summary className="flex min-h-11 w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg pr-2 outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              <ChevronRight
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open/archived:rotate-90"
              />
              <h2 className="font-heading text-base font-medium text-foreground">
                Archived
              </h2>
            </summary>
            <div className="pt-1 pl-[22px]">
              {model.archived.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nothing archived.
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {model.archived.map((goal) => (
                    <InactiveGoalRow key={goal.id} goal={goal} />
                  ))}
                </ul>
              )}
            </div>
          </details>
        </>
      )}
    </main>
  );
}
