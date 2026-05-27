import type { WorkflowStageId } from "@toburt/shared";

/**
 * The pipeline graph. Each node lists its successors. The orchestrator
 * walks this graph one stage at a time, pausing on approval gates.
 */
export const PIPELINE: Record<WorkflowStageId, WorkflowStageId[]> = {
  idea: ["logline"],
  logline: ["synopsis"],
  synopsis: ["treatment"],
  treatment: ["season_arc"],
  season_arc: ["episode_outline"],
  episode_outline: ["beat_sheet"],
  beat_sheet: ["scene_list"],
  scene_list: ["draft_v1"],
  draft_v1: ["rewrite"],
  rewrite: ["continuity_pass"],
  continuity_pass: ["production_draft"],
  production_draft: ["exports"],
  exports: [],
};

export function nextStage(current: WorkflowStageId): WorkflowStageId | null {
  return PIPELINE[current][0] ?? null;
}
