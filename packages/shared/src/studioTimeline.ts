// Studio Timeline — the 10-stage spine every project follows.
//
// Three phases (writing, team, production), each with a few stages.
// The timeline is the user's primary mental model: "where am I, what's
// done, what's next." Each stage is derived from existing state — no
// new persistence required for Phase A.

export type StudioPhase = "writing" | "team" | "production";

export type StudioStageKey =
  | "write_script"
  | "review_collaborate"
  | "lock_script"
  | "assemble_team"
  | "assign_roles"
  | "production_prep"
  | "shot_prompt_planning"
  | "generation_queue"
  | "review_final_assets"
  | "export_delivery";

export type StudioStageStatus =
  | "not_started"
  | "in_progress"
  | "blocked"
  | "complete";

export interface StudioStage {
  /** 1-based ordinal — matches the user-facing numbering. */
  number: number;
  key: StudioStageKey;
  phase: StudioPhase;
  title: string;
  /** What this stage produces when complete — one short phrase. */
  deliverable: string;
  /** One-sentence next action surfaced on the stage card. */
  nextAction: string;
  status: StudioStageStatus;
  /** Short status line — e.g. "Draft 5 locked", "0 / 20 approved". */
  statusDetail: string;
  /** Primary CTA — relative to /projects/:projectId. */
  primary: { label: string; toRel: string };
  /** Optional second CTA on the card. */
  secondary?: { label: string; toRel: string };
  /** Existing-page references this stage uses, surfaced as small links. */
  surfaces: Array<{ label: string; toRel: string }>;
}

export interface StudioTimelineSummary {
  totalStages: number;
  completeStages: number;
  currentStageKey: StudioStageKey | null;
  /** 0–100; (completeStages / totalStages) rounded. */
  progressPct: number;
}

export interface StudioTimelineResponse {
  projectId: string;
  projectTitle: string | null;
  projectType: string;
  /** Episode the production-phase stages were derived from (first
   *  episode with a current draft, falling back to first episode). */
  representativeEpisodeId: string | null;
  representativeEpisodeNumber: number | null;
  representativeEpisodeTitle: string | null;
  stages: StudioStage[];
  summary: StudioTimelineSummary;
}
