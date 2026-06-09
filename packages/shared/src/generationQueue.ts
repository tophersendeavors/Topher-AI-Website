// AI Production Queue / Generation Planner — shared types.
//
// Read-only layer over creative content. Mirrors approved curated shots
// into queue items that track per-shot generation state, model
// assignment, outputs, review notes, and version history. Writes go to
// projects.metadata.generationQueue[episodeId] only — never to
// scripts.fountain or script_scenes.

export const GENERATION_QUEUE_STATUSES = [
  "not_ready",
  "ready",
  "queued",
  "generating",
  "needs_review",
  "approved",
  "rejected",
  "retry_needed",
  "final",
] as const;
export type GenerationQueueStatus = (typeof GENERATION_QUEUE_STATUSES)[number];

export const MODEL_TARGETS = [
  "veo",
  "kling",
  "runway",
  "luma",
  "pika",
  "higgsfield",
  "midjourney_still",
  "manual_external",
] as const;
export type ModelTarget = (typeof MODEL_TARGETS)[number];

export const MODEL_TARGET_LABEL: Record<ModelTarget, string> = {
  veo: "Veo",
  kling: "Kling",
  runway: "Runway",
  luma: "Luma",
  pika: "Pika",
  higgsfield: "Higgsfield",
  midjourney_still: "Midjourney (still)",
  manual_external: "Manual / External",
};

export interface GenerationOutputReview {
  /** Stable id — generated server-side when the row is created. */
  id: string;
  /** URL or file reference the user pastes after generating externally. */
  url: string;
  modelTarget: ModelTarget;
  /** Free-form, e.g. "v1", "v2 — softer eyes". */
  versionLabel?: string;
  status: "candidate" | "approved" | "rejected";
  reviewNotes?: string;
  retryInstruction?: string;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface QueueReadinessCheck {
  approvedShotBrief: boolean;
  promptGenerated: boolean;
  characterRefsReady: boolean;
  locationBibleReady: boolean;
  propContinuityReady: boolean;
  soundNotesReady: boolean;
  /** Human-readable blockers, in the same order the UI should display them. */
  blockers: string[];
}

export interface GenerationQueueItem {
  /** Stable id, derived from `${sceneOrd}-${shotIndex}`. */
  id: string;
  episodeId: string;
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;

  /** Mirrored from the approved shot brief — recomputed on every sync. */
  shotDescription: string;
  characters: string[];
  location: string;
  props: string[];
  timeOfDay: string | null;
  aspectRatio: string;
  durationSec: number;
  promptText: string;
  promptHasModelHint: string | null;

  /** Sound canon snapshot (read-only) for handoff. Null when not approved. */
  soundNotes: {
    ambientBed: string;
    keyDiegetic: string[];
    nonDiegeticMusic: string;
    audioField: string | null;
  } | null;

  /** Continuity requirements summary — null entries indicate "not required". */
  continuityRequirements: {
    characters: string[];
    location: string | null;
    props: string[];
  };

  /** User-editable. */
  modelTarget: ModelTarget;
  status: GenerationQueueStatus;
  reviewNotes?: string;
  retryInstruction?: string;

  /** Version history of outputs the user has attached. */
  outputs: GenerationOutputReview[];
  approvedOutputId?: string;

  /** Recomputed every sync — never persisted as source of truth. */
  readiness: QueueReadinessCheck;

  briefApprovedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GenerationQueue {
  episodeId: string;
  scriptId: string;
  items: GenerationQueueItem[];
  lastSyncedAt: string;
  updatedAt: string;
}

export type BatchGroupBy =
  | "character"
  | "location"
  | "model"
  | "aspect_ratio"
  | "time_of_day"
  | "scene"
  | "continuity";

export interface GenerationQueueBatch {
  key: string;
  label: string;
  groupBy: BatchGroupBy;
  itemIds: string[];
  itemCount: number;
}

export interface SceneCompletion {
  sceneOrd: number;
  slugline: string;
  totalShots: number;
  generatedShots: number;
  approvedShots: number;
  rejectedShots: number;
  missingShots: number;
  completionPct: number;
}

export interface GenerationQueueSummary {
  episodeId: string;
  totalShots: number;
  byStatus: Record<GenerationQueueStatus, number>;
  byModel: Record<ModelTarget, number>;
  scenes: SceneCompletion[];
  overallCompletionPct: number;
  readyCount: number;
  blockedCount: number;
  awaitingReviewCount: number;
}

export interface GenerationQueueResponse {
  projectId: string;
  projectTitle: string | null;
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scriptId: string | null;
  scriptDraftNumber: number | null;
  scriptIsLocked: boolean;
  policy: {
    projectType: string;
    defaultAspectRatio: string;
    defaultDurationSec: number;
    composerKey: string;
    isMicroDramaTier: boolean;
  };
  queue: GenerationQueue;
  summary: GenerationQueueSummary;
  batches: {
    byCharacter: GenerationQueueBatch[];
    byLocation: GenerationQueueBatch[];
    byModel: GenerationQueueBatch[];
    byAspectRatio: GenerationQueueBatch[];
    byTimeOfDay: GenerationQueueBatch[];
    byScene: GenerationQueueBatch[];
  };
}

export const GENERATION_QUEUE_EXPORTS = [
  "queue_csv",
  "approved_manifest_json",
  "scene_assembly_checklist_markdown",
  "model_batch_text",
  "trailer_batch_text",
] as const;
export type GenerationQueueExportFormat =
  (typeof GENERATION_QUEUE_EXPORTS)[number];

/** Body shape for PATCHing one item. Only included fields are changed.
 *  status is intentionally narrow — readiness blockers are computed, not set. */
export interface GenerationQueueItemPatch {
  modelTarget?: ModelTarget;
  status?: GenerationQueueStatus;
  reviewNotes?: string;
  retryInstruction?: string;
  approvedOutputId?: string | null;
}

/** Body shape for adding a generated output to an item. */
export interface GenerationOutputCreate {
  url: string;
  modelTarget?: ModelTarget;
  versionLabel?: string;
  reviewNotes?: string;
  retryInstruction?: string;
}

/** Body shape for reviewing an output (approve / reject / re-note). */
export interface GenerationOutputReviewPatch {
  status?: "candidate" | "approved" | "rejected";
  reviewNotes?: string;
  retryInstruction?: string;
  versionLabel?: string;
}
