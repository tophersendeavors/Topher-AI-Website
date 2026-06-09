// Creative Team & Role Assignment — shared types + static registry.
//
// Stored at projects.metadata.roleAssignments[roleKey]. No new DB table.
// Auto-derived roles use prefixed keys:
//   • "actor:<characterId>"   — on-camera performer
//   • "voice:<characterId>"   — voice performance (V.O., looping)

export type RoleKind = "ai" | "ai_creative" | "live_person";

export const ROLE_KINDS: readonly RoleKind[] = [
  "ai",
  "ai_creative",
  "live_person",
] as const;

export const ROLE_KIND_LABEL: Record<RoleKind, string> = {
  ai: "AI",
  ai_creative: "AI Creative",
  live_person: "Live Person",
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
] as const;
export type HandoffFormat = (typeof HANDOFF_FORMATS)[number];

export const HANDOFF_LABEL: Record<HandoffFormat, string> = {
  human_brief: "Human brief",
  task_list: "Task list",
  actor_notes: "Actor notes",
  wardrobe_notes: "Wardrobe notes",
  composer_brief: "Composer brief",
  director_notes: "Director notes",
};

// Reuse the GenerationQueue model registry instead of duplicating it.
// (Imported into the team page rather than re-declared here.)

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
  slots: RoleSlot[];
  summary: TeamRosterSummary;
}
