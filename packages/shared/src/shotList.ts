// Curated Shot List — shared types.
//
// The Shot List is a UI / approval layer over the existing
// `scripts.metadata.aiPrompts.briefs` data. It does not generate new
// briefs (autoBuildBriefs already does that). It groups, edits,
// approves, and exports.

export type ShotApprovalStatus = "draft" | "needs_review" | "approved";

/** Production mode for one shot — drives which downstream pipeline the
 *  shot feeds. */
export type ShotProductionMode =
  | "ai_video"
  | "live_action"
  | "hybrid"
  | "storyboard_only";

/** Per-shot curated metadata. Lives on the brief itself (writers edit it)
 *  or in a sibling map. We keep it sibling so an unmigrated brief is
 *  still readable; the curated view fills sensible defaults from the
 *  brief + project shotPolicy when the curated row is missing. */
export interface ShotCurated {
  productionMode: ShotProductionMode;
  /** "draft" | "needs_review" | "approved" — drives the approval gate. */
  status: ShotApprovalStatus;
  notes?: string;
}

/** Stamped approval record. Per-shot, per-scene, per-episode tiers all
 *  share the same shape. */
export interface ShotApprovalRecord {
  approvedAt: string;
  approvedBy: string;
}

/** Full approval map for a script. Keys:
 *    shots["{ord}-{shotIndex}"] → ShotApprovalRecord
 *    scenes["{ord}"]            → ShotApprovalRecord
 *    episode                    → ShotApprovalRecord | null
 *  When a higher-level approval is set, all lower levels are considered
 *  approved transitively (UI surfaces this; backend stores both). */
export interface ShotListApproval {
  shots: Record<string, ShotApprovalRecord>;
  scenes: Record<string, ShotApprovalRecord>;
  episode: ShotApprovalRecord | null;
  updatedAt: string;
}

/** Sound Bible context surfaced read-only on a shot card. Only present
 *  when the SoundBible scene row is approved. */
export interface ShotSoundContext {
  ambientBed: string;
  keyDiegetic: string[];
  nonDiegeticMusic: string;
  motifIds: string[];
  audioField: string | null;
}

/** Sceneless, model-friendly shot row. Mirrors MasterShotBrief shape but
 *  flattens the fields the curated UI needs to render quickly. */
export interface ShotListRow {
  id: string;
  sceneOrd: number;
  shotIndex: number;
  primaryImage: string;
  shotType: string;
  cameraLanguage: string;
  subject: string;
  action: string;
  emotionalBeat: string;
  visualMotif: string;
  location: string;
  characters: string[];
  props: string[];
  durationSec: number;
  aspectRatio: string;
  aiModelHint: string | null;
  curated: ShotCurated;
  approvedAt: string | null;
  /** Read-only sound canon for the scene (when the SoundBible scene row
   *  is approved). UI shows this; the writer doesn't edit it here. */
  soundContext: ShotSoundContext | null;
  /** True when the brief was flagged as user-edited (autoBuild won't
   *  overwrite it without explicit confirm). */
  userEdited: boolean;
}

export interface ShotListSceneGroup {
  sceneOrd: number;
  slugline: string;
  summary: string | null;
  status: string | null;
  shotCount: number;
  shots: ShotListRow[];
  sceneApprovedAt: string | null;
}

export interface ShotListPolicySummary {
  projectType: string;
  label: string;
  defaultAspectRatio: string;
  defaultDurationSec: number;
  minDurationSec: number;
  maxDurationSec: number;
  coverageDensity: "minimal" | "standard" | "comprehensive";
  composerKey: "generic" | "vertical_micro";
  isMicroDramaTier: boolean;
}

export interface ShotListResponse {
  scriptId: string;
  scriptTitle: string | null;
  draftNumber: number | null;
  episodeId: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  policy: ShotListPolicySummary;
  scenes: ShotListSceneGroup[];
  approval: {
    episodeApprovedAt: string | null;
    sceneApprovedCount: number;
    sceneTotalCount: number;
    shotApprovedCount: number;
    shotTotalCount: number;
  };
  /** True when the script is locked (metadata.lockedWritingDraft).
   *  Curated edits are STILL allowed on locked drafts — only fountain
   *  and script_scenes are protected — but the UI shows a banner. */
  scriptIsLocked: boolean;
}

/** Body shape for editing one shot. Partial — only included fields are
 *  patched onto the existing brief. */
export interface ShotEditPatch {
  primaryImage?: string;
  shotType?: string;
  cameraLanguage?: string;
  subject?: string;
  action?: string;
  emotionalBeat?: string;
  visualMotif?: string;
  location?: string;
  characters?: string[];
  props?: string[];
  durationSec?: number;
  aspectRatio?: string;
  aiModelHint?: string | null;
  productionMode?: ShotProductionMode;
  status?: ShotApprovalStatus;
  notes?: string;
}

export const SHOT_LIST_EXPORT_FORMATS = ["markdown", "csv", "json"] as const;
export type ShotListExportFormat = (typeof SHOT_LIST_EXPORT_FORMATS)[number];
