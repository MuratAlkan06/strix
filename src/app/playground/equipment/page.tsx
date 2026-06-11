/**
 * /playground/equipment — auth-exempt, deterministic harness for the Slice 8
 * aggregated equipment view. No DB: fixture rows run through the REAL
 * buildEquipmentModel (with a PINNED `today`, 2026-06-10, so grouping never
 * shifts as wall-clock time passes) into the REAL <EquipmentList /> behind a
 * local no-op toggle.
 *
 * The populated state covers every group and edge:
 *   This week  — an OVERDUE item (amber note) + an exactly-7-days item
 *   This month — an 8-days item (boundary) + a PURCHASED item (struck, still
 *                visible in place)
 *   Later      — a 31-days item
 *   No date    — a milestone-linked item whose milestone has no target_date
 *
 * ?state=empty renders the honest page-level empty.
 *
 * /playground(.*) is Clerk-excluded (src/proxy.ts); the segment layout
 * noindexes it. Out of the README tree by design.
 */
import { Card } from "@/components/ui/card";
import {
  buildEquipmentModel,
  type EquipmentRowLike,
  type GoalLike,
  type MilestoneDateLike,
} from "../../(equipment)/equipment/equipment-model";
import { EquipmentHarness } from "./harness";

const TODAY = "2026-06-10";

const GOALS: GoalLike[] = [
  {
    id: "g-climb",
    title: "Climb Mont Blanc next July",
    status: "active",
    color_index: 0,
  },
  {
    id: "g-race",
    title: "Run the valley trail half marathon",
    status: "active",
    color_index: 1,
  },
];

const MILESTONES: MilestoneDateLike[] = [
  { id: "ms-glacier", target_date: "2026-06-17" }, // exactly today + 7
  { id: "ms-longrun", target_date: null }, // no date yet → no_date group
];

const EQUIPMENT: EquipmentRowLike[] = [
  {
    id: "eq-crampons",
    goal_id: "g-climb",
    title: "Crampons",
    cost_usd: "180.00",
    milestone_id: null,
    standalone_deadline: "2026-06-07", // overdue
    purchased_at: null,
  },
  {
    id: "eq-harness",
    goal_id: "g-climb",
    title: "Climbing harness",
    cost_usd: "95.50",
    milestone_id: "ms-glacier", // derived deadline = 2026-06-17 (this week)
    standalone_deadline: null,
    purchased_at: null,
  },
  {
    id: "eq-shoes",
    goal_id: "g-race",
    title: "Trail running shoes",
    cost_usd: "145.00",
    milestone_id: null,
    standalone_deadline: "2026-06-18", // 8 days → this month
    purchased_at: null,
  },
  {
    id: "eq-vest",
    goal_id: "g-race",
    title: "Hydration vest",
    cost_usd: "120.00",
    milestone_id: null,
    standalone_deadline: "2026-07-05", // this month — already purchased
    purchased_at: "2026-06-05T09:00:00.000Z",
  },
  {
    id: "eq-boots",
    goal_id: "g-climb",
    title: "Mountaineering boots",
    cost_usd: "450.00",
    milestone_id: null,
    standalone_deadline: "2026-07-11", // 31 days → later
    purchased_at: null,
  },
  {
    id: "eq-headlamp",
    goal_id: "g-race",
    title: "Headlamp",
    cost_usd: null, // optional cost — renders nothing
    milestone_id: "ms-longrun", // milestone has no date → "No date yet"
    standalone_deadline: null,
    purchased_at: null,
  },
];

interface PageProps {
  searchParams: Promise<{ state?: string | string[] }>;
}

export default async function PlaygroundEquipmentPage({
  searchParams,
}: PageProps) {
  const { state } = await searchParams;
  const selected = Array.isArray(state) ? state[0] : state;

  const groups =
    selected === "empty"
      ? []
      : buildEquipmentModel({
          equipment: EQUIPMENT,
          milestones: MILESTONES,
          goals: GOALS,
          today: TODAY,
        });

  // Mirrors the authenticated /equipment page frame so the harness reads the
  // same surface.
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-4 sm:gap-6 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-medium tracking-tight text-foreground sm:text-[28px]">
          Equipment
        </h1>
        <p className="text-sm text-muted-foreground">
          Everything your active goals call for, ordered by when you need it.
        </p>
      </header>

      {groups.length === 0 ? (
        <Card className="p-5">
          <p className="text-sm text-muted-foreground">
            Nothing to gear up for yet. When a plan calls for equipment, it
            shows up here.
          </p>
        </Card>
      ) : (
        <EquipmentHarness groups={groups} />
      )}
    </main>
  );
}
