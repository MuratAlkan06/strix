"use client";

/**
 * GoalDetailHarness — client wrapper for the playground goal-detail surface.
 * Renders the REAL <GoalDetail /> behind deterministic local actions: every
 * write succeeds without a server or DB, creates mint sequential local ids
 * (pg-new-1, pg-new-2, …) so add flows are exercisable. The replan flag is
 * pinned OFF — the Phase 1 posture (structural edits save normally, no
 * banner anywhere); the gate itself is unit-tested.
 */
import { useRef } from "react";

import { GoalDetail } from "../../(goals)/goals/[id]/goal-detail";
import type {
  GoalDetailActions,
  GoalDetailModel,
} from "../../(goals)/goals/[id]/detail-model";

export function GoalDetailHarness({ model }: { model: GoalDetailModel }) {
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

  return <GoalDetail model={model} actions={actions} replanFlag={undefined} />;
}
