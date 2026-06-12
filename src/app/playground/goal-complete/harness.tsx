"use client";

/**
 * GoalCompleteHarness — client wrapper for the playground goal-completion
 * surface. Renders the REAL <GoalDetail /> behind deterministic local
 * actions (the goal-detail harness scheme): completeGoal always succeeds, so
 * "Mark complete" → confirm → sunrise is exercisable end-to-end without a
 * server or DB. `initialCelebration` pins the settled celebration frame for
 * the ?state=celebrating screenshots.
 */
import { useRef } from "react";

import { GoalDetail } from "../../(goals)/goals/[id]/goal-detail";
import type {
  GoalDetailActions,
  GoalDetailModel,
} from "../../(goals)/goals/[id]/detail-model";

export function GoalCompleteHarness({
  model,
  initialCelebration,
}: {
  model: GoalDetailModel;
  initialCelebration: boolean;
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
      replanFlag={undefined}
      initialCelebration={initialCelebration}
    />
  );
}
