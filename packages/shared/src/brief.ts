// Brief Router — shared types.
//
// Given a shot + a role assignment, the router produces the right
// handoff artifact for that role's kind. Three artifact shapes:
//
//   • ai_model      — model-ready prompt block for direct generation
//   • ai_creative   — creative-department guidance (notes, strategy, review)
//   • live_person   — human-readable handoff brief (task list, actor
//                     notes, director notes, etc.)
//
// The router does not call LLMs and does not regenerate creative
// content. It composes deterministic briefs from existing canonical
// data: master shot briefs, scene rows, character visual bibles, sound
// bibles, location + prop bibles, and role assignments.

import type {
  CreativeBriefStyle,
  HandoffFormat,
  RoleKind,
} from "./team";
import type { ModelTarget } from "./generationQueue";

export type BriefKind = "ai_model" | "ai_creative" | "live_person";

// ---------------------------------------------------------------------------
// AI Model brief — for ai-kind roles. Mirrors the inputs Veo / Kling /
// Runway adapters need to render a single shot.
// ---------------------------------------------------------------------------

export interface AIModelBriefRef {
  /** Stable id, e.g. character id or location key. */
  id: string;
  label: string;
  /** Free-text description the model should honour. */
  description: string;
  /** Approved reference image URL if available. */
  referenceUrl?: string;
}

export interface AIModelBrief {
  kind: "ai_model";
  modelTarget: ModelTarget;
  aspectRatio: string;
  durationSec: number;
  /** The model-ready prompt text (already composed by the existing
   *  composer — the router does not regenerate it). */
  promptText: string;
  characterRefs: AIModelBriefRef[];
  locationRef: AIModelBriefRef | null;
  propRefs: AIModelBriefRef[];
  /** Continuity locks the model must honour: eyelines, wardrobe, etc. */
  continuityLocks: string[];
  /** Audio direction snapshot from the approved sound bible. */
  soundNotes: {
    ambientBed: string;
    keyDiegetic: string[];
    nonDiegeticMusic: string;
    audioField: string | null;
  } | null;
  avoidList: string[];
  /** Hints the adapter can read — e.g. "verticalMicro", "phoneInsert". */
  adapterHints: string[];
}

// ---------------------------------------------------------------------------
// AI Creative brief — for ai_creative roles (director, DP, etc.). The
// content varies by `creativeBriefStyle`, but the shape is shared.
// ---------------------------------------------------------------------------

export interface AICreativeBrief {
  kind: "ai_creative";
  style: CreativeBriefStyle;
  shotIntent: string;
  emotionalBeat: string;
  visualStrategy: string;
  /** Two-to-three alternative approaches the team can consider. */
  alternateApproaches: string[];
  reviewCriteria: string[];
  promptStrategy: string;
  riskNotes: string[];
  continuityConcerns: string[];
}

// ---------------------------------------------------------------------------
// Live Person brief — for live_person roles. Format varies by
// `handoffFormat`, but the structured payload is constant — the renderer
// (Markdown / Copy / Export) emits the chosen format.
// ---------------------------------------------------------------------------

export interface LivePersonBrief {
  kind: "live_person";
  format: HandoffFormat;
  /** Display name of the recipient when known. */
  recipient: string | null;
  email: string | null;
  /** Headline action this brief asks for. */
  taskHeadline: string;
  /** Full scene + shot context the human needs. */
  context: string;
  /** What the human is expected to deliver. */
  deliverable: string;
  /** Inline checklist for the format-appropriate tasks. */
  checklist: string[];
  /** Reference materials the human should consult. */
  references: string[];
  /** Department-specific notes (DP language, actor blocking, etc.). */
  departmentNotes: string[];
}

// ---------------------------------------------------------------------------
// Top-level artifact + router output
// ---------------------------------------------------------------------------

export type AnyBrief = AIModelBrief | AICreativeBrief | LivePersonBrief;

export interface RoleBriefArtifact {
  /** Stable shot id, e.g. "<sceneOrd>-<shotIndex>". */
  shotId: string;
  sceneOrd: number;
  shotIndex: number;
  roleKey: string;
  /** Display label (from the role definition or the assignment). */
  roleLabel: string;
  roleKind: RoleKind;
  brief: AnyBrief;
  generatedAt: string;
}

export interface BriefRouterSkip {
  roleKey: string;
  roleLabel: string;
  reason: string;
}

export interface ShotRoleBriefs {
  shotId: string;
  sceneOrd: number;
  shotIndex: number;
  shotDescription: string;
  characters: string[];
  artifacts: RoleBriefArtifact[];
  skipped: BriefRouterSkip[];
}

export interface EpisodeRoleBriefsResponse {
  projectId: string;
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scriptId: string | null;
  /** True when the project's character bible has been read. */
  rolesAvailable: boolean;
  /** True when at least one assignment exists project-wide. */
  hasAssignments: boolean;
  shots: ShotRoleBriefs[];
}

export const BRIEF_EXPORT_FORMATS = ["json", "markdown"] as const;
export type BriefExportFormat = (typeof BRIEF_EXPORT_FORMATS)[number];
