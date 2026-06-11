"use client";

/**
 * EquipmentHarness — client wrapper for the playground equipment surface.
 * Provides the REAL <EquipmentList /> a deterministic local toggle handler
 * (always ok, no server action, no DB) so the optimistic checkbox flow —
 * including the struck-but-visible purchased state — is exercisable without
 * auth.
 */
import { EquipmentList } from "../../(equipment)/equipment/equipment-list";
import type { EquipmentGroupModel } from "../../(equipment)/equipment/equipment-model";

export function EquipmentHarness({
  groups,
}: {
  groups: EquipmentGroupModel[];
}) {
  return (
    <EquipmentList
      groups={groups}
      onToggle={async ({ purchased }) => ({ ok: true as const, purchased })}
    />
  );
}
