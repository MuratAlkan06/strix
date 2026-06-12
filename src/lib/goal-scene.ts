/**
 * goal-scene.ts — which Scene variant illustrates a real goal.
 *
 * The five tile scenes (DESIGN.md §4.4 — mountain, language, race, book,
 * instrument) were authored for the five example seeds; real goals need a
 * deterministic way to pick one. The only goal-linked semantic signal in the
 * data model is `intake_summaries.activity_type` (the Haiku-canonicalized
 * enum every golden-path goal carries), so the mapping lives on that:
 *
 *   climbing/mountaineering            → mountain
 *   running/cycling/swimming/strength  → race    (effort toward a start line)
 *   language                           → language
 *   writing/study                      → book
 *   instrument                         → instrument
 *   business/other/missing summary     → mountain (the brand hero scene —
 *                                        the horizon header's grammar)
 *
 * Pure data + one total function; shared by goal detail's completion moment
 * today and the dashboard's accomplished section later. No component logic
 * here — callers hand the variant to <Scene>/<CompletionScene>.
 */
import type { SceneVariant } from "@/components/scene-data";
import { ACTIVITY_TYPES } from "@/lib/ai/intake-schema";

/** The per-goal scenes — every variant except the dashboard-only `header`. */
export type GoalSceneVariant = Exclude<SceneVariant, "header">;

type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Fallback when the activity is unmapped or the goal has no intake summary. */
export const DEFAULT_GOAL_SCENE_VARIANT: GoalSceneVariant = "mountain";

const VARIANT_BY_ACTIVITY: Record<ActivityType, GoalSceneVariant> = {
  climbing: "mountain",
  mountaineering: "mountain",
  running: "race",
  cycling: "race",
  swimming: "race",
  strength: "race",
  language: "language",
  writing: "book",
  study: "book",
  instrument: "instrument",
  business: "mountain",
  other: "mountain",
};

/**
 * Total over arbitrary input: a missing summary (null) or an unknown string
 * (defensive — the enum is the source of truth, but a variant pick must never
 * throw a render) resolves to the default scene.
 */
export function sceneVariantForActivity(
  activity: string | null | undefined,
): GoalSceneVariant {
  if (activity != null && Object.hasOwn(VARIANT_BY_ACTIVITY, activity)) {
    return VARIANT_BY_ACTIVITY[activity as ActivityType];
  }
  return DEFAULT_GOAL_SCENE_VARIANT;
}
