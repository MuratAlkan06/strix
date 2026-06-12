/**
 * goal-scene tests — the activity_type → Scene-variant mapping is total,
 * deterministic, and never yields the dashboard-only "header" variant.
 */
import { describe, expect, it } from "vitest";

import { ACTIVITY_TYPES } from "@/lib/ai/intake-schema";
import {
  DEFAULT_GOAL_SCENE_VARIANT,
  sceneVariantForActivity,
} from "./goal-scene";

describe("sceneVariantForActivity", () => {
  it.each([
    ["climbing", "mountain"],
    ["mountaineering", "mountain"],
    ["running", "race"],
    ["cycling", "race"],
    ["swimming", "race"],
    ["strength", "race"],
    ["language", "language"],
    ["writing", "book"],
    ["study", "book"],
    ["instrument", "instrument"],
    ["business", "mountain"],
    ["other", "mountain"],
  ] as const)("%s → %s", (activity, variant) => {
    expect(sceneVariantForActivity(activity)).toBe(variant);
  });

  it("covers every ACTIVITY_TYPES value (total mapping, no surprise default)", () => {
    for (const activity of ACTIVITY_TYPES) {
      const variant = sceneVariantForActivity(activity);
      expect(variant).not.toBe("header");
      expect(["mountain", "language", "race", "book", "instrument"]).toContain(
        variant,
      );
    }
  });

  it.each([null, undefined, "", "skydiving", "hasOwnProperty"])(
    "missing/unknown activity (%j) → the default scene",
    (activity) => {
      expect(sceneVariantForActivity(activity)).toBe(
        DEFAULT_GOAL_SCENE_VARIANT,
      );
    },
  );
});
