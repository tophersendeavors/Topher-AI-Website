import type { z } from "zod";
import type { AgentRole, WorkflowStageId } from "@toburt/shared";

export interface StageContext {
  projectId: string;
  workflowId: string;
  stage: WorkflowStageId;
  user?: { id: string; name?: string };
  /** Input artifact from the previous stage(s). */
  previousArtifacts: Record<WorkflowStageId, unknown>;
  /** Fresh user prompt for this stage (optional). */
  prompt?: string;
  /**
   * Revision notes from a rejected approval. When set, the stage should pass
   * these to its agent as a `critique` so the regeneration addresses them.
   */
  revisionNote?: string;
  /** Set when this workflow is episode-scoped (developing one episode). */
  episodeId?: string;
  /** The episode's number within the season (for stage targeting). */
  episodeNumber?: number;
}

export interface StageResult<T = unknown> {
  artifact: T;
  /** If true, the orchestrator opens an approval card and pauses. */
  awaitingApproval: boolean;
  /** Free-form notes appended to the workflow record. */
  notes?: string[];
}

export interface Stage<T = unknown> {
  id: WorkflowStageId;
  title: string;
  requiresApproval: boolean;
  inputs: WorkflowStageId[];
  agents: AgentRole[];
  // `any` for the input/output zod types tolerates schemas that use
  // `.default()` / `.optional()` (input type differs from output type).
  outputSchema: z.ZodType<T, z.ZodTypeDef, any>;
  run(ctx: StageContext): Promise<StageResult<T>>;
}
