"use client";

/**
 * GoalDetailHarness — client wrapper for the playground goal-detail surface.
 * Renders the REAL <GoalDetail /> behind deterministic local actions: every
 * write succeeds without a server or DB, creates mint sequential local ids
 * (pg-new-1, pg-new-2, …) so add flows are exercisable.
 *
 * Replan banner (slice 4): the default states pin the flag OFF (the Phase 1
 * posture — structural edits save normally, no banner anywhere). The
 * banner-* states pass replanFlag="true" + pre-landed structural edits (and
 * optionally a mid-flight/error banner state) so every banner posture is
 * deterministic on load. The generation stub ALWAYS fails with the
 * endpoint's constant 502 line — clicking exercises the calm error → Try
 * again loop without auth, a server, or a model call (the replan-diff
 * harness scheme); the real success route is covered live.
 */
import { useRef } from "react";

import { GoalDetail } from "../../(goals)/goals/[id]/goal-detail";
import type {
  GoalDetailActions,
  GoalDetailModel,
  ReplanBannerState,
  StructuralEdit,
} from "../../(goals)/goals/[id]/detail-model";

export function GoalDetailHarness({
  model,
  replanFlag,
  initialStructuralEdits,
  initialReplanBannerState,
}: {
  model: GoalDetailModel;
  replanFlag?: string;
  initialStructuralEdits?: StructuralEdit[];
  initialReplanBannerState?: ReplanBannerState;
}) {
  const counter = useRef(0);
  const nextId = () => {
    counter.current += 1;
    return `pg-new-${counter.current}`;
  };

  const actions: GoalDetailActions = {
    setIntensity: async () => ({ ok: true }),
    completeGoal: async () => ({ ok: true }),
    addTask: async () => ({ ok: true, id: nextId() }),
    updateTask: async () => ({ ok: true }),
    removeTask: async () => ({ ok: true }),
    addMilestone: async () => ({ ok: true, id: nextId() }),
    updateMilestone: async () => ({ ok: true }),
    removeMilestone: async () => ({ ok: true }),
    moveMilestone: async () => ({ ok: true }),
    addEquipment: async () => ({ ok: true, id: nextId() }),
    updateEquipment: async () => ({ ok: true }),
    removeEquipment: async () => ({ ok: true }),
  };

  return (
    <GoalDetail
      model={model}
      actions={actions}
      replanFlag={replanFlag}
      initialStructuralEdits={initialStructuralEdits}
      initialReplanBannerState={initialReplanBannerState}
      onGenerateReplan={async () => ({
        ok: false,
        error: "Replan generation failed.",
      })}
    />
  );
}
