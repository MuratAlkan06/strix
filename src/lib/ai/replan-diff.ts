/**
 * replan-diff.ts — the Zod-typed diff structure stored in
 * replan_proposals.proposed_changes (phase-2-close-the-loop "Replan flow").
 * The AI always proposes a DIFF — add / modify / remove arrays per type —
 * never an absolute replacement; the AI's response is validated against this
 * schema before persisting.
 *
 * EMPTY_REPLAN_DIFF: Phase-2 Slice-1 (weekly check-in) inserts it as the
 * placeholder proposed_changes on every proposal it creates — the replan-
 * consumer slice (POST /api/ai/replan) is what writes real diffs. A pending
 * proposal with the empty diff means "requested, not yet generated".
 */
import { z } from "zod";

export const ReplanDiffSchema = z.object({
  recurring_tasks: z.object({
    add: z.array(
      z.object({
        title: z.string(),
        cadence: z.enum(["daily", "weekly"]),
        weekday: z.number().int().min(0).max(6).nullable(),
        estimated_duration_min: z.number().int().positive(),
      }),
    ),
    modify: z.array(
      z.object({
        id: z.string(),
        changes: z.object({
          title: z.string().optional(),
          weekday: z.number().int().min(0).max(6).nullable().optional(),
          estimated_duration_min: z.number().int().positive().optional(),
          active: z.boolean().optional(),
        }),
      }),
    ),
    remove: z.array(z.object({ id: z.string() })),
  }),
  milestones: z.object({
    add: z.array(
      z.object({
        title: z.string(),
        target_date: z.string(),
        position: z.number().int(),
      }),
    ),
    modify: z.array(
      z.object({
        id: z.string(),
        changes: z.object({
          title: z.string().optional(),
          target_date: z.string().optional(),
          position: z.number().int().optional(),
        }),
      }),
    ),
    remove: z.array(z.object({ id: z.string() })),
  }),
  equipment: z.object({
    add: z.array(
      z.object({
        title: z.string(),
        cost_usd: z.number().nullable(),
        milestone_id: z.string().nullable(),
        standalone_deadline: z.string().nullable(),
      }),
    ),
    modify: z.array(
      z.object({
        id: z.string(),
        changes: z.object({
          title: z.string().optional(),
          cost_usd: z.number().nullable().optional(),
          milestone_id: z.string().nullable().optional(),
          standalone_deadline: z.string().nullable().optional(),
        }),
      }),
    ),
    remove: z.array(z.object({ id: z.string() })),
  }),
});

export type ReplanDiff = z.infer<typeof ReplanDiffSchema>;

/** The all-empty diff Slice 1 persists as the pending placeholder. */
export const EMPTY_REPLAN_DIFF: ReplanDiff = {
  recurring_tasks: { add: [], modify: [], remove: [] },
  milestones: { add: [], modify: [], remove: [] },
  equipment: { add: [], modify: [], remove: [] },
};
