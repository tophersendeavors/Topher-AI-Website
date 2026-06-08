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
  scene_list: "Scene Plan",
  draft_v1: "Draft 1",
  rewrite: "Rewrite & Polish",
  continuity_pass: "Story Consistency Check",
  production_draft: "Production Breakdown",
  exports: "Export",
};

/**
 * Showrunner-facing journey. The engine still runs the 13 stages above in
 * order; these groups are purely a presentation layer that collapses the
 * story-foundation stages into one step and renames the rest into the
 * language a creator thinks in. Groups follow engine order so a roadmap's
 * "done / current / upcoming" state is always faithful to the real pipeline.
 */
export interface StageGroup {
  id: string;
  label: string;
  blurb: string;
  stages: WorkflowStageId[];
  /**
   * Optional visual-only group — not part of the orchestrator's stage chain.
   * Renders as a recommended step the writer can do anytime (e.g. Pitch
   * Materials sits between Story Foundation and Scene Plan but doesn't gate
   * the workflow).
   */
  optional?: boolean;
  /** When optional, where the step's call-to-action takes the writer. */
  href?: (projectId: string) => string;
  /** Short CTA shown on the optional step. */
  ctaLabel?: string;
}

export const STAGE_GROUPS: StageGroup[] = [
  {
    id: "idea",
    label: "Start With an Idea",
    blurb: "Your premise — where the story begins.",
    stages: ["idea"],
  },
  {
    id: "foundation",
    label: "Develop Story Foundation",
    blurb: "Logline, synopsis, treatment, season arc, episode outline and beats.",
    stages: [
      "logline",
      "synopsis",
      "treatment",
      "season_arc",
      "episode_outline",
      "beat_sheet",
    ],
  },
  {
    id: "pitch_materials",
    label: "Generate Pitch Materials",
    blurb:
      "Optional but recommended — turn your approved foundation into a buyer-facing deck, lookbook, one-sheet or treatment. Refresh after Draft 1, Rewrite & Polish, or Continuity.",
    stages: [],
    optional: true,
    href: (projectId) => `/projects/${projectId}/pitch`,
    ctaLabel: "Open Pitch Materials",
  },
  {
    id: "scene_plan",
    label: "Approve Scene Plan",
    blurb: "The scene-by-scene blueprint for the episode.",
    stages: ["scene_list"],
  },
  {
    id: "draft",
    label: "Write Draft 1",
    blurb: "The AI writes the episode, scene by scene.",
    stages: ["draft_v1"],
  },
  {
    id: "polish",
    label: "Rewrite & Polish",
    blurb: "Tighten dialogue, subtext and emotional truth.",
    stages: ["rewrite"],
  },
  {
    id: "consistency",
    label: "Story Consistency Check",
    blurb: "Catch timeline, character and continuity slips.",
    stages: ["continuity_pass"],
  },
  {
    id: "production",
    label: "Production Breakdown",
    blurb: "Budget tier and production flags.",
    stages: ["production_draft"],
  },
  {
    id: "export",
    label: "Export",
    blurb: "Download your script in industry formats.",
    stages: ["exports"],
  },
];

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
