// Guided Production Workflow types (Stage 5).
//
// The workflow is a 12-stage linear-ish state machine per episode/script.
// State is stored on script.metadata.episodeWorkflow + derived from the
// existing canonSources / bibles / briefs so existing approvals
// auto-populate the relevant deliverables.

export type StageKey =
  | "script_approved"
  | "roles_assigned"
  | "production_design"
  | "art_dept"
  | "props"
  | "wardrobe_hmu"
  | "blocking"
  | "cinematography"
  | "continuity"
  | "prompt_supervisor"
  | "preflight"
  | "generate";

export const ALL_STAGE_KEYS: StageKey[] = [
  "script_approved",
  "roles_assigned",
  "production_design",
  "art_dept",
  "props",
  "wardrobe_hmu",
  "blocking",
  "cinematography",
  "continuity",
  "prompt_supervisor",
  "preflight",
  "generate",
];

export type StageStatus =
  | "locked"
  | "available"
  | "in_progress"
  | "approved"
  | "blocked";

export interface StageDeliverable {
  key: string;
  label: string;
  /** Human-readable description of what this deliverable means. */
  description?: string;
  /** True when the deliverable is satisfied (derived from canonSources /
   *  bibles). The user's explicit Approve Stage click is separate. */
  satisfied: boolean;
  /** When satisfied, the current value the system will use (compact). */
  currentValue?: string;
  /** When the deliverable points at a specific canon field, this is its
   *  path — used by the Canon Target Picker to deep-link. */
  canonFieldPath?: string;
  /** Stage 7 — Distinct from `satisfied`. True when a human has
   *  explicitly approved this field's value via a textOverride entry on
   *  canonSources. Bibles having a value alone does NOT count. The
   *  AI-Proposal view uses this to decide whether to show the
   *  "✓ Approved" badge vs "AI proposes — Approve?" buttons. */
  hasApprovedCanon?: boolean;
  /** Stage 7 (A) — True when there is a cached AI proposal on
   *  script.metadata.workflowAIProposals for this canon field path.
   *  Tells the UI it can show "Approve as canon" without first asking
   *  the user to click Regenerate. */
  hasAIProposal?: boolean;
  /** Subject within the deliverable (location key, prop key, character
   *  name, shot id, etc.) — gives the UI extra context for grouping. */
  subjectKey?: string;
  subjectLabel?: string;
}

export interface StageState {
  status: StageStatus;
  /** Which stage(s) this is blocked on, if any. */
  blockedBy: StageKey[];
  /** Stage-level explicit approval — separate from deliverable
   *  satisfaction. The user must click Approve to advance. */
  approvedBy: string | null;
  approvedAt: string | null;
  /** When the user clicked "Request changes" — the stage falls back to
   *  in_progress with these notes. */
  changesRequestedAt: string | null;
  changesRequestedNotes: string | null;
  /** Stage 7 (B) — Per-stage human-approval progress. Computed live
   *  from deliverables. `approveable` is the count of deliverables with
   *  a canon field path (only these can be approved-as-canon).
   *  `approved` is how many of those have hasApprovedCanon = true.
   *  `requiredRatio` is the gate threshold the stage must hit before
   *  the user can click Approve Stage. */
  approvalProgress?: {
    approved: number;
    approveable: number;
    requiredRatio: number;
    meetsGate: boolean;
  };
}

export type RoleKey =
  | "director"
  | "script_supervisor"
  | "production_designer"
  | "art_director"
  | "set_decorator"
  | "propmaster"
  | "wardrobe"
  | "hmu"
  | "cinematographer"
  | "blocking"
  | "prompt_supervisor"
  | "quality_control";

export interface RoleMeta {
  key: RoleKey;
  label: string;
  /** One-line summary of what this role decides. */
  responsibility: string;
  /** Department this role contributes to (maps to existing dept registry). */
  departmentKey: string;
}

export type AssignmentType = "ai_generic" | "ai_influence" | "live_person";

export interface RoleAssignment {
  roleKey: RoleKey;
  assignmentType: AssignmentType;
  /** When assignmentType === "ai_influence" */
  influenceKey: string | null;
  /** When assignmentType === "live_person" — UUID of a project_members.user_id */
  assigneeUserId: string | null;
  assigneeName: string | null;
  status: "unassigned" | "assigned" | "approved";
  updatedAt: string;
}

export interface EpisodeWorkflowState {
  stages: Record<StageKey, StageState>;
  roleAssignments: Record<RoleKey, RoleAssignment>;
  /** When the user explicitly confirms Stage 2 (Roles Assigned) the
   *  workflow advances. We track the snapshot here for audit. */
  rolesConfirmedAt: string | null;
  updatedAt: string;
}

/** The shape returned by GET /scripts/:id/workflow — a fully derived view
 *  the frontend renders. */
export interface WorkflowReport {
  scriptId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  state: EpisodeWorkflowState;
  /** Per-stage deliverables derived from canonSources + bibles. */
  deliverables: Record<StageKey, StageDeliverable[]>;
  /** Convenience: which stage the user should focus on right now. */
  currentStageKey: StageKey;
}
