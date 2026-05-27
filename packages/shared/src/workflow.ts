import type { AgentRole } from "./agents";

export const WORKFLOW_STAGES = [
  "idea",
  "logline",
  "synopsis",
  "treatment",
  "season_arc",
  "episode_outline",
  "beat_sheet",
  "scene_list",
  "draft_v1",
  "rewrite",
  "continuity_pass",
  "production_draft",
  "exports",
] as const;

export type WorkflowStageId = (typeof WORKFLOW_STAGES)[number];

export type WorkflowStageStatus =
  | "pending"
  | "running"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "completed"
  | "skipped"
  | "rolled_back";

export const STAGE_LABELS: Record<WorkflowStageId, string> = {
  idea: "Idea",
  logline: "Logline",
  synopsis: "Synopsis",
  treatment: "Treatment",
  season_arc: "Season Arc",
  episode_outline: "Episode Outline",
  beat_sheet: "Beat Sheet",
  scene_list: "Scene List",
  draft_v1: "First Draft",
  rewrite: "Rewrite",
  continuity_pass: "Continuity Pass",
  production_draft: "Production Draft",
  exports: "Exports",
};

export const STAGE_AGENTS: Record<WorkflowStageId, AgentRole[]> = {
  idea: [],
  logline: ["concept", "showrunner"],
  synopsis: ["concept", "plot", "showrunner"],
  treatment: ["plot", "character", "world", "character_wound", "showrunner"],
  season_arc: ["plot", "character", "world", "relationship_tension", "showrunner"],
  episode_outline: ["plot", "character", "relationship_tension", "showrunner"],
  beat_sheet: ["plot", "scene", "emotional_truth", "showrunner"],
  scene_list: ["scene", "continuity"],
  draft_v1: [
    "scene",
    "dialogue",
    "character",
    "continuity",
    // Emotional Intelligence Layer — runs after the scene draft is in place.
    "behavior",
    "subtext",
    "emotional_truth",
    "relationship_tension",
    "showrunner",
  ],
  rewrite: [
    "script_doctor",
    "dialogue",
    "subtext",
    "emotional_truth",
    "behavior",
    "showrunner",
  ],
  continuity_pass: ["continuity", "world"],
  production_draft: ["producer", "showrunner"],
  exports: [],
};

export const STAGE_REQUIRES_APPROVAL: Record<WorkflowStageId, boolean> = {
  idea: false,
  logline: true,
  synopsis: true,
  treatment: true,
  season_arc: true,
  episode_outline: true,
  beat_sheet: true,
  scene_list: false,
  draft_v1: true,
  rewrite: true,
  continuity_pass: false,
  production_draft: true,
  exports: false,
};

export interface WorkflowSummary {
  id: string;
  project_id: string;
  episode_id?: string | null;
  title: string;
  current_stage: WorkflowStageId;
  status: WorkflowStageStatus;
  created_at: string;
  updated_at: string;
}
