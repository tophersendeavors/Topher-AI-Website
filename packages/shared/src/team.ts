// Creative Team & Role Assignment — shared types + static registry.
//
// Stored at projects.metadata.roleAssignments[roleKey]. No new DB table.
// Auto-derived roles use prefixed keys:
//   • "actor:<characterId>"   — on-camera performer
//   • "voice:<characterId>"   — voice performance (V.O., looping)

// ---------------------------------------------------------------------------
// Workflow mode — which style of studio is producing this project.
// Recommendations adapt per mode, but the user can always override.
// ---------------------------------------------------------------------------

export const WORKFLOW_MODES = ["solo_ai", "hybrid", "human_led"] as const;
export type WorkflowMode = (typeof WORKFLOW_MODES)[number];

export const DEFAULT_WORKFLOW_MODE: WorkflowMode = "solo_ai";

export const WORKFLOW_MODE_LABEL: Record<WorkflowMode, string> = {
  solo_ai: "Solo AI Studio",
  hybrid: "Hybrid Creative Studio",
  human_led: "Human-Led Production",
};

export const WORKFLOW_MODE_DESCRIPTION: Record<WorkflowMode, string> = {
  solo_ai:
    "One person uses AI to fill most or all roles.",
  hybrid:
    "Some roles are live people, some AI Creative, some AI generators.",
  human_led:
    "Live people own most roles; AI supports with briefs, prompts, and reviews.",
};

export type RoleKind = "ai" | "ai_creative" | "live_person";

export const ROLE_KINDS: readonly RoleKind[] = [
  "ai",
  "ai_creative",
  "live_person",
] as const;

export const ROLE_KIND_LABEL: Record<RoleKind, string> = {
  ai: "AI Generator",
  ai_creative: "AI Creative Assistant",
  live_person: "Real Person",
};

/** Plain-language one-liner shown next to each kind option in the
 *  Creative Team drawer so the user doesn't have to guess. */
export const ROLE_KIND_DESCRIPTION: Record<RoleKind, string> = {
  ai: "AI creates the final asset.",
  ai_creative: "AI helps plan, direct, review, or brief.",
  live_person: "A human owns this role.",
};

export type RoleCategory =
  | "leadership"
  | "writing"
  | "directing"
  | "camera"
  | "production_design"
  | "sound_music"
  | "post"
  | "talent"
  | "ops";

export const ROLE_CATEGORY_LABEL: Record<RoleCategory, string> = {
  leadership: "Leadership",
  writing: "Writing",
  directing: "Directing",
  camera: "Camera",
  production_design: "Production Design",
  sound_music: "Sound & Music",
  post: "Post & Edit",
  talent: "Talent",
  ops: "Production Ops",
};

// Per-kind handoff vocabulary --------------------------------------------------

export const CREATIVE_BRIEF_STYLES = [
  "department_note",
  "shot_plan",
  "rewrite_notes",
  "prompt_strategy",
  "review_notes",
] as const;
export type CreativeBriefStyle = (typeof CREATIVE_BRIEF_STYLES)[number];

export const CREATIVE_BRIEF_LABEL: Record<CreativeBriefStyle, string> = {
  department_note: "Department note",
  shot_plan: "Shot plan",
  rewrite_notes: "Rewrite notes",
  prompt_strategy: "Prompt strategy",
  review_notes: "Review notes",
};

export const HANDOFF_FORMATS = [
  "human_brief",
  "task_list",
  "actor_notes",
  "wardrobe_notes",
  "composer_brief",
  "director_notes",
  "review_checklist",
] as const;
export type HandoffFormat = (typeof HANDOFF_FORMATS)[number];

export const HANDOFF_LABEL: Record<HandoffFormat, string> = {
  human_brief: "Creative brief",
  task_list: "Task list",
  actor_notes: "Actor notes",
  wardrobe_notes: "Wardrobe notes",
  composer_brief: "Composer brief",
  director_notes: "Director notes",
  review_checklist: "Review checklist",
};

// Reuse the GenerationQueue model registry instead of duplicating it.
// (Imported into the team page rather than re-declared here.)

// Conceptual category each model target belongs to. Used to filter
// the model picker per role — e.g. a Composer should not see Veo, and
// a Voice role should not see video models.
export type ModelTargetCategory =
  | "video_generation"
  | "image_generation"
  | "voice_generation"
  | "music_generation"
  | "text_creative"
  | "manual_external";

import type { ModelTarget } from "./generationQueue";

export const MODEL_TARGET_CATEGORY: Record<ModelTarget, ModelTargetCategory> = {
  veo: "video_generation",
  kling: "video_generation",
  runway: "video_generation",
  luma: "video_generation",
  pika: "video_generation",
  higgsfield: "video_generation",
  midjourney_still: "image_generation",
  manual_external: "manual_external",
};

// ---------------------------------------------------------------------------
// Role definition — one row in the static registry, plus the derived
// shape for actor:<id> / voice:<id> rows.
// ---------------------------------------------------------------------------

export interface RoleDefinition {
  /** Stable, lowercase snake_case key (e.g. "director", "actor:<uuid>"). */
  key: string;
  /** Short user-facing label (e.g. "Director", "Actor: Margot"). */
  label: string;
  /** One-line description shown under the label. */
  description: string;
  category: RoleCategory;
  /** What kind the assignment usually defaults to when blank. */
  defaultKind: RoleKind;
  /** When true, the role is REQUIRED — Stage 5 (Assign Roles) only
   *  reaches "complete" when every required role has an assignment. */
  required: boolean;
  /** Department key from the existing departments registry, if any. */
  departmentKey?: string;
  /** Marks roles derived from a Character row. */
  derivedFromCharacterId?: string;
  /** Convenience label suggestions for the UI. */
  exampleAssignments?: string[];
  /** Smart defaults + filtering rules — what the OS recommends for this
   *  role and what model targets the picker should show. Reflects the
   *  project's current workflow mode (the aggregator picks from
   *  `recommendationsByMode` before returning). */
  recommendation?: RoleRecommendation;
  /** Per-mode recommendations. Aggregator overlays the entry matching
   *  the project's current `workflowMode` onto `recommendation`. When a
   *  mode is missing, the base `recommendation` is used. */
  recommendationsByMode?: Partial<Record<WorkflowMode, RoleRecommendation>>;
}

/** Per-role recommendation surfaced in the assignment drawer. */
export interface RoleRecommendation {
  /** Default kind the drawer pre-selects on first open. */
  recommendedKind: RoleKind;
  /** Kinds the picker offers. Other kinds are hidden so the user can't
   *  pick obviously-wrong combos (e.g. Producer → AI → Veo). */
  allowedKinds: RoleKind[];
  /** When kind === "ai", the model target the drawer pre-selects. */
  recommendedModelTarget?: ModelTarget;
  /** When kind === "ai", filters the model picker. Models outside this
   *  list are hidden. */
  allowedModelTargets?: ModelTarget[];
  /** When kind === "ai_creative", the brief style the drawer pre-selects. */
  recommendedBriefStyle?: CreativeBriefStyle;
  /** When kind === "live_person", the handoff format the drawer
   *  pre-selects. */
  recommendedHandoffFormat?: HandoffFormat;
  /** One-line explanation of why this default is suggested. Surfaced in
   *  the drawer's recommendation card. */
  reason: string;
}

// ---------------------------------------------------------------------------
// Per-role assignment — what gets stored on the project metadata.
// ---------------------------------------------------------------------------

export interface RoleAssignment {
  kind: RoleKind;
  /** Friendly display label, e.g. "Veo (Margot scenes)" or "Jane Doe". */
  label: string;
  notes?: string;

  // AI-only fields
  modelTarget?: import("./generationQueue").ModelTarget;
  /** References model_profile id when present, otherwise free text. */
  profileId?: string;
  avoidList?: string[];

  // AI-Creative-only fields
  creativeBriefStyle?: CreativeBriefStyle;

  // Live-Person-only fields
  personName?: string;
  personEmail?: string;
  handoffFormat?: HandoffFormat;

  // Provenance
  assignedAt: string;
  assignedBy: string | null;
}

/** Body shape for PATCH /projects/:p/team/roles/:roleKey. */
export interface RoleAssignmentPatch {
  kind: RoleKind;
  label: string;
  notes?: string;
  modelTarget?: import("./generationQueue").ModelTarget;
  profileId?: string;
  avoidList?: string[];
  creativeBriefStyle?: CreativeBriefStyle;
  personName?: string;
  personEmail?: string;
  handoffFormat?: HandoffFormat;
}

// ---------------------------------------------------------------------------
// Slot — what the UI renders per row (definition + current assignment).
// ---------------------------------------------------------------------------

export interface RoleSlot {
  definition: RoleDefinition;
  assignment: RoleAssignment | null;
}

export interface TeamRosterSummary {
  totalRoles: number;
  requiredRoles: number;
  assignedRoles: number;
  assignedRequiredRoles: number;
  byKind: Record<RoleKind, number>;
  /** Stage 4 / 5 derivation — surfaced for the Studio Timeline too. */
  rosterApprovedAt: string | null;
  allRequiredAssigned: boolean;
}

export interface TeamRosterResponse {
  projectId: string;
  projectTitle: string | null;
  workflowMode: WorkflowMode;
  slots: RoleSlot[];
  summary: TeamRosterSummary;
}
