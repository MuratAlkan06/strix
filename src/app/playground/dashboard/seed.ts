/**
 * seed.ts — static playground seed data (plan Appendix §5.1, verbatim).
 *
 * Hard-coded, no DB, no fetch. This is the curation fixture: three goals, five
 * "today" rows (row 2 pre-checked + struck), three "this week", two milestones,
 * one equipment row. Held constant across all three variants so the curation
 * pass reads colour/polarity, not content.
 */
import type { SceneVariant } from "@/components/scene-data";

type ColorIndex = 0 | 1 | 2 | 3 | 4;

export interface Goal {
  id: string;
  title: string;
  colorIndex: ColorIndex;
  scene: Extract<SceneVariant, "mountain" | "race" | "book">;
  next: string;
}

export interface TaskRow {
  id: string;
  text: string;
  goalName: string;
  colorIndex: ColorIndex;
  checked: boolean;
}

export interface WeekRow {
  id: string;
  text: string;
  goalName: string;
  colorIndex: ColorIndex;
  when: string;
}

export interface Milestone {
  id: string;
  text: string;
  when: string;
  colorIndex: ColorIndex;
}

export interface EquipmentRow {
  id: string;
  item: string;
  when: string;
  goalName: string;
  colorIndex: ColorIndex;
  price: string;
  purchased: boolean;
}

// G1 amber/mountain, G2 alpine-blue/race, G3 dusk-plum/book.
export const GOALS: Goal[] = [
  {
    id: "g1",
    title: "Climb Mont Blanc",
    colorIndex: 0,
    scene: "mountain",
    next: "Mont Buet acclimatization climb",
  },
  {
    id: "g2",
    title: "Half marathon",
    colorIndex: 1,
    scene: "race",
    next: "10k time-trial, Sat",
  },
  {
    id: "g3",
    title: "Write a novel",
    colorIndex: 4,
    scene: "book",
    next: "Finish chapter 3",
  },
];

// The hero countdown for G1 (tabular).
export const COUNTDOWN = {
  value: 18,
  label: "days to Mont Buet",
  sublabel: "Target: Sat 28 Jun",
} as const;

// Today — 5 rows; row 2 (Write 500 words) is CHECKED + struck.
export const TODAY: TaskRow[] = [
  {
    id: "t1",
    text: "Zone-2 run, 40 min",
    goalName: "Half marathon",
    colorIndex: 1,
    checked: false,
  },
  {
    id: "t2",
    text: "Write 500 words",
    goalName: "Write a novel",
    colorIndex: 4,
    checked: true,
  },
  {
    id: "t3",
    text: "Stair intervals, 30 min",
    goalName: "Climb Mont Blanc",
    colorIndex: 0,
    checked: false,
  },
  {
    id: "t4",
    text: "Mobility + stretch, 10 min",
    goalName: "Half marathon",
    colorIndex: 1,
    checked: false,
  },
  {
    id: "t5",
    text: "Read 20 pages (craft)",
    goalName: "Write a novel",
    colorIndex: 4,
    checked: false,
  },
];

// This week — 3 rows.
export const THIS_WEEK: WeekRow[] = [
  {
    id: "w1",
    text: "Long run 16 km",
    goalName: "Half marathon",
    colorIndex: 1,
    when: "Sat",
  },
  {
    id: "w2",
    text: "Hill repeats w/ pack",
    goalName: "Climb Mont Blanc",
    colorIndex: 0,
    when: "Thu",
  },
  {
    id: "w3",
    text: "Outline chapter 4",
    goalName: "Write a novel",
    colorIndex: 4,
    when: "Wed",
  },
];

// Upcoming milestones — 2.
export const MILESTONES: Milestone[] = [
  {
    id: "m1",
    text: "Mont Buet acclimatization climb",
    when: "in 18 days",
    colorIndex: 0,
  },
  { id: "m2", text: "10k time-trial", when: "in 9 days", colorIndex: 1 },
];

// Equipment — 1 row.
export const EQUIPMENT: EquipmentRow[] = [
  {
    id: "e1",
    item: "Crampons",
    when: "order by Fri (in 4 days)",
    goalName: "Climb Mont Blanc",
    colorIndex: 0,
    price: "$120",
    purchased: false,
  },
];

export const GREETING = "Good morning, Murat.";
export const DATE_LABEL = "Wednesday, 10 June";
