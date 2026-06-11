// Human Read Approval Pipeline.
//
// GLOBAL RULE: Human Read Passes diagnose. They do not authorize rewrites.
// Only approved Change Proposals authorize rewrites. The rewrite agent may
// ONLY apply proposals with approval_status "approved" or "auto_safe", and
// must be built from the Approved Change Set's locked payload — never from
// the free-form Human Read report.

export const HUMAN_READ_RULE =
  "Human Read Passes diagnose; they do not authorize rewrites. A Human Read Pass may " +
  "score the script, diagnose issues, and suggest improvements, but all story, structure, " +
  "character, scene, dialogue, tone, pacing, and ending changes must first be converted into " +
  "Change Proposals and approved by the creator. The rewrite system may only apply Change " +
  "Proposals with approval_status 'approved' or 'auto_safe'. Rejected, held, pending, or " +
  "revised-but-unapproved proposals must not be applied, referenced, or indirectly " +
  "incorporated. Every rewrite must be generated only from the approved source script version, " +
  "the approved change set, the protected-elements list, the rewrite-scope boundaries, and the " +
  "continuity constraints. The rewrite agent must preserve creator intent and must not " +
  "reinterpret feedback as permission to reinvent the episode.";

/** Only APPROVED and AUTO_SAFE may enter a rewrite. */
export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revise"
  | "hold"
  | "auto_safe";

export const APPROVAL_STATUSES: ApprovalStatus[] = [
  "pending",
  "approved",
  "rejected",
  "revise",
  "hold",
  "auto_safe",
];

/** The statuses that are permitted to flow into a rewrite. */
export const REWRITE_ELIGIBLE_STATUSES: ApprovalStatus[] = ["approved", "auto_safe"];

export type ProposalRisk = "low" | "medium" | "high";

/** One actionable diagnosis lifted from a Human Read report. */
export interface HumanReadNote {
  id: string;
  category: string;
  severity: ProposalRisk;
  affectedScenes: number[];
  noteText: string;
  evidence: string;
  suggestedAction: string;
}

/** A system-generated, creator-approvable change. Never applied until the
 *  creator sets approvalStatus to "approved" or "auto_safe". */
export interface ChangeProposal {
  id: string;
  humanReadNoteId: string;
  projectId: string;
  episodeId: string;
  /** The script version the proposal was diagnosed against. */
  scriptVersionId: string;
  title: string;
  problem: string;
  /** Why it matters — quoted/paraphrased from the Human Read. */
  evidence: string;
  proposedSolution: string;
  scenesAffected: number[];
  /** Human-readable boundary, e.g. "Scenes 4-5 only, optional echo later". */
  rewriteScope: string;
  /** Canon that must NOT be altered while applying this change. */
  protectedElements: string[];
  riskLevel: ProposalRisk;
  approvalStatus: ApprovalStatus;
  creatorDecisionNotes: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The locked payload handed to the rewrite agent — and NOTHING else. It
 *  contains only approved/auto_safe changes. */
export interface ApprovedChangePayload {
  sourceScriptId: string;
  rule: string;
  approvedChanges: Array<{
    proposalId: string;
    title: string;
    proposedSolution: string;
    scenesAffected: number[];
    rewriteScope: string;
    protectedElements: string[];
    riskLevel: ProposalRisk;
    creatorDecisionNotes: string;
  }>;
  /** Union of every protected element across the approved changes. */
  protectedElements: string[];
  /** Union of every rewrite-scope boundary. */
  rewriteBoundaries: string[];
}

export interface ApprovedChangeSet {
  id: string;
  projectId: string;
  episodeId: string;
  sourceScriptVersionId: string;
  approvedProposalIds: string[];
  lockedPromptPayload: ApprovedChangePayload;
  createdBy: string;
  createdAt: string;
}

export type RewriteStatus =
  | "queued"
  | "running"
  | "complete"
  | "failed"
  | "rejected"
  | "promoted";

/** Per-scene before/after detail for the diff review. */
export interface RewriteSceneDiff {
  ord: number;
  heading: string;
  before: string;
  after: string;
  changed: boolean;
  changeSummary: string;
  /** Approved-change ids this scene's edit satisfies. */
  satisfies: string[];
  protectedTouched: boolean;
  continuityRisks: string[];
}

/** Records a controlled rewrite attempt. Produced from — and only from — an
 *  Approved Change Set. The original draft is never modified; promotion mints
 *  a new draft version. */
export interface RewriteJob {
  id: string;
  projectId: string;
  episodeId: string;
  sourceScriptVersionId: string;
  approvedChangeSetId: string;
  rewriteStatus: RewriteStatus;
  /** Set only after the creator promotes the rewrite. */
  newScriptVersionId: string | null;
  newDraftNumber: number | null;
  changeLog: string;
  continuityRisks: string[];
  /** Only in-scope scenes appear here; out-of-scope scenes are untouched. */
  diff: RewriteSceneDiff[];
  /** The full reassembled draft text (out-of-scope scenes byte-identical). */
  newFountain: string;
  /** How many scenes were in the approved scope vs left untouched. */
  scenesRewritten: number;
  scenesUntouched: number;
  createdAt: string;
  completedAt: string | null;
}

/** Everything the Approval Board needs in one fetch. */
export interface HumanReadPipelineResponse {
  /** Provenance of the Human Read report the proposals came from. */
  reportRef: { scriptId: string; draftLabel: string; bingeScore: number; generatedAt: string } | null;
  proposals: ChangeProposal[];
  changeSets: ApprovedChangeSet[];
  rewriteJobs: RewriteJob[];
  rule: string;
}
