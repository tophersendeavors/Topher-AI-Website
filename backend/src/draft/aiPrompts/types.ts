// Shared types for the AI Video Model Router + Prompt Adapter system.
// One Master Shot Brief per shot is the source of truth. Adapters never
// mutate it; they DERIVE per-model prompts. Each prompt persists as a
// versioned record so the writer can compare, A/B, and revert.

export type ModelKey =
  | "veo"
  | "kling"
  | "runway"
  | "pika"
  | "luma"
  | "midjourney"
  | "generic_video"
  | "generic_image"
  | "custom";

export type ModelType =
  | "image"
  | "video"
  | "image_to_video"
  | "text_to_video"
  | "hybrid";

export type PromptType =
  | "text_to_video"
  | "image_to_video"
  | "reference_to_video"
  | "text_to_image";

/**
 * Per-axis reliability scores 0..1. The router multiplies these by the
 * brief's visualWeight to pick the right model — so changing a reliability
 * (e.g. when a new Kling release improves hands) re-routes everything
 * without a code change.
 */
export interface ReliabilityScores {
  motion: number;             // smooth, on-spec motion
  character: number;          // identity / costume continuity
  hands: number;              // hands + fingers
  dialogue: number;           // lip-sync + native dialogue
  atmosphere: number;         // environments / weather / mood
}

/** Editable per-model guidance. Defaults ship in code; projects override. */
export interface ModelProfile {
  key: ModelKey;
  modelName: string;
  /** Free-text version tag the user maintains (e.g. "Veo 3", "Gen-3 Alpha"). */
  version?: string;
  /** ISO timestamp — when the writer last revised this profile. */
  lastUpdated?: string;
  modelType: ModelType;
  strengths: string[];
  weaknesses: string[];
  bestUseCases: string[];
  avoidUseCases: string[];
  /** "verbose-cinematic" | "concise-action" | "image-led" | "key-art" */
  maxPromptStyle: string;
  preferredPromptStructure: string;
  supportedInputs: PromptType[];
  supportedAspectRatios: string[];
  supportedDurationRange: { minSec: number; maxSec: number } | null;
  motionControlNotes: string;
  characterConsistencyNotes: string;
  dialogueOrLipSyncNotes: string;
  safetyLimitations: string;
  negativePromptSupport: boolean;
  seedOrReferenceSupport: boolean;
  outputNotes: string;
  /** Editable reliability scores — what the router actually consults. */
  reliability: ReliabilityScores;
  /** Free-form notes the writer appends from prior generations. */
  userNotes?: string[];
  /** True when the user has overridden the default profile. */
  userOverride?: boolean;
}

export interface BriefCharacter {
  name: string;
  description: string;
  wardrobe?: string;
}

/** Production-category tags. A shot can carry several. */
export type ShotTag =
  | "ENV"   // environment / atmosphere plate
  | "BEH"   // behavioural insert
  | "CHAR"  // character performance
  | "TRANS" // transition / spatial continuity
  | "PRE"   // pre-viz / blocking test
  | "VO"    // voiceover-driven emotional beat
  | "KEY"   // keyframe / poster / concept still
  | "ACT"   // action / physical movement
  | "INT"   // interior production design
  | "EXT";  // exterior establishing

export const SHOT_TAG_LABEL: Record<ShotTag, string> = {
  ENV: "Environment / atmosphere plate",
  BEH: "Behavioural insert",
  CHAR: "Character performance",
  TRANS: "Transition / spatial continuity",
  PRE: "Pre-viz / blocking test",
  VO: "Voiceover-driven emotional beat",
  KEY: "Keyframe / poster / concept still",
  ACT: "Action / physical movement",
  INT: "Interior production design",
  EXT: "Exterior establishing",
};

/**
 * Visual weight 0..100 per axis. The router treats this as the primary
 * routing signal — narrative importance is intentionally NOT consulted.
 * The percentages need not sum to exactly 100; the router normalizes.
 */
export interface VisualWeight {
  environment: number;
  character: number;
  object: number;
  cameraMovement: number;
  dialogue: number;
  action: number;
  atmosphere: number;
}

/** The universal source of truth. Adapters consume this; nothing modifies it
 *  except the explicit setMasterShotBrief / editMasterShotBrief routes. */
export interface MasterShotBrief {
  /** Stable id: SELVAJE_EP1_SC03_SH04. */
  id: string;
  projectTitle: string;
  episodeNumber?: number | null;
  episodeTitle?: string | null;
  sceneOrd: number;
  shotIndex: number;
  /**
   * Primary Image — the single photographable image that defines the shot.
   * One sentence, present-tense, observable, no character interpretation.
   * Example: "The last lights of San José dissolving through a rain-covered
   * rear window." The composer is required to open the final prompt with
   * this image; the readiness gate rejects any prompt that doesn't.
   */
  primaryImage?: string;

  // ------------------------------------------------------------------
  //  The seven photographable fields — primary shot-brief structure.
  //  Every field must be observable. The validator strips interpretation
  //  at write time. Legacy fields below stay optional for back-compat.
  // ------------------------------------------------------------------

  /** Camera Sees — observable visual facts only. Several sentences,
   *  describing what is literally in the frame. */
  cameraSees?: string;
  /** Frame — composition and camera placement (framing + lens + movement
   *  as one descriptive line). Replaces cameraFraming + lensSuggestion +
   *  cameraMovement when present. */
  frame?: string;
  /** Light — observable lighting conditions (source, direction, quality,
   *  palette). Replaces lighting + colorPalette when present. */
  light?: string;
  /** Texture — materials, atmosphere, environmental detail (rain on glass,
   *  smoke, dust, foliage). Replaces visualMotif + productionDesign. */
  texture?: string;
  /** Locked Details — props, wardrobe, continuity anchors as a single
   *  list-like line. Replaces props[] + character wardrobe + continuityNotes
   *  for the prompt's purpose; the legacy fields remain available. */
  lockedDetails?: string;
  /**
   * Interpretation-vs-photography warnings stored at write time by
   * briefValidator. Format: 'field "phrase" — label'. Surfaced by the
   * composer's readiness gate as: "Brief contains interpretation
   * instead of photography." so the writer sees exactly what was stripped.
   */
  interpretiveWarnings?: string[];
  shotPurpose: string;
  storyBeat: string;
  emotionalBeat: string;
  characters: BriefCharacter[];
  location: string;
  timeOfDay: string;
  lighting: string;
  colorPalette: string;
  cameraFraming: string;
  lensSuggestion: string;
  cameraMovement: string;
  action: string;
  performanceDirection?: string;
  dialogue?: string;
  continuityNotes?: string;
  props?: string[];
  productionDesign?: string;
  visualMotif?: string;
  aspectRatio: string;
  durationSec: number;
  outputType: "video" | "still" | "either";
  safetyNotes?: string;
  referenceAssets?: string[];
  /**
   * Per-field source-confidence. A non-expert user shouldn't have to assume
   * everything in the brief is approved canon. Strict mode + the post-gen
   * validator populate this.
   *   source_confirmed       — appears in the scene / bibles directly
   *   conservative_inference — safe extrapolation from approved material
   *   speculative            — new specific not present in source — needs writer approval
   *   not_enough_source      — could not be determined from source
   *
   * Keyed by main-field name on MasterShotBrief.
   */
  fieldConfidence?: Partial<
    Record<
      | "characters"
      | "location"
      | "timeOfDay"
      | "action"
      | "performanceDirection"
      | "dialogue"
      | "cameraFraming"
      | "lensSuggestion"
      | "cameraMovement"
      | "lighting"
      | "colorPalette"
      | "productionDesign"
      | "visualMotif"
      | "props"
      | "continuityNotes"
      | "safetyNotes"
      | "aspectRatio"
      | "durationSec"
      | "outputType"
      | "shotTags"
      | "visualWeight"
      | "shotPurpose"
      | "storyBeat"
      | "emotionalBeat",
      "source_confirmed" | "conservative_inference" | "speculative" | "not_enough_source"
    >
  >;
  /**
   * Fields the writer has manually edited or approved. Once flipped, the
   * confidence label still shows but the writer's edit overrides the
   * canon judgement.
   */
  userEditedFields?: string[];
  /**
   * Non-canon ideas the strict pass moved out of main fields. Surfaced to
   * the writer as "Possible details — not canon" so nothing is lost.
   */
  nonCanonNotes?: string;
  /** Production-category tags. Multiple per shot. */
  shotTags?: ShotTag[];
  /**
   * Visual weight per axis (0..100). The router routes by visual weight,
   * NOT narrative importance. When omitted, the engine infers it.
   */
  visualWeight?: VisualWeight;
  /**
   * True when the writer has consciously approved a duration longer than
   * the tag-default range. Adapters refuse longer takes otherwise.
   */
  longerDurationApproved?: boolean;
  /**
   * Camera-awareness mode for THIS shot. Drives the eyeline rules the
   * composer injects into the system prompt and negative prompt.
   *
   *   observational_default — narrative observer (no direct-to-lens)
   *   direct_to_camera      — character intentionally looks into lens
   *   POV_character         — POV of another character; eyeline OK
   *   surveillance_camera   — character aware of hidden cam
   *   phone_selfie          — selfie / vlog framing, direct gaze OK
   *   video_call            — FaceTime / Zoom / video call, direct gaze OK
   *   confession_camera     — interview / confessional, direct gaze OK
   *
   * Defaults to observational_default when omitted. The composer ONLY
   * permits direct eye contact when the mode is one of the exception
   * values; everything else gets the no-look-at-lens rule injected.
   */
  cameraAwareness?:
    | "observational_default"
    | "direct_to_camera"
    | "POV_character"
    | "surveillance_camera"
    | "phone_selfie"
    | "video_call"
    | "confession_camera";
  /**
   * Eyeline — where the character is looking and what they're reacting
   * to. One observable sentence. When set, the composer threads it into
   * the prompt verbatim. When missing on a close-up / eye-level /
   * character-driven shot, the readiness gate raises a warning so the
   * writer knows the prompt may cause unwanted direct-to-lens performance.
   *
   * Examples:
   *   "Maya's eyeline stays off-camera toward the nightstand, reacting to the phone buzz."
   *   "Maya looks down at the phone screen, not into the lens."
   *   "Camera observes from beside the bed; Maya does not acknowledge the lens."
   */
  eyeline?: string;
  /**
   * V3.5 — Hero Image / Shot Priority.
   *
   *   heroSubject              — the ONE noun this shot is about
   *                              (e.g. "clock", "phone", "closet door").
   *   forbiddenDominantDetails — surrounding-context nouns that must NOT
   *                              outweigh the hero in the opening 40% of
   *                              the prompt (e.g. "nightstand",
   *                              "wood grain", "phone" when hero is clock).
   *
   * The composer's readiness gate uses these to fail any prompt where
   * supporting nouns appear more often than the hero in the opening
   * 40% of word count.
   */
  heroSubject?: string;
  forbiddenDominantDetails?: string[];
  /**
   * V4.4 — Shot-aware view zones. The Production Designer authors the
   * full physical world (location + props + lighting); each shot tells
   * the composer WHICH SLICE of that world is in the frame and which
   * must NOT be. The composer scopes the continuity directive to the
   * visible slice so prompts don't drown in unrelated bible facts.
   *
   *   cameraViewZone         — short label: "clock insert / Maya POV", "inside-closet POV", "bed CU"
   *   visibleSetElements     — what the lens sees in this shot
   *   forbiddenSetElements   — what must NOT appear in this shot
   *   characterStartPosition — where the character starts the shot
   *   characterEndPosition   — where they end up
   *   movementPath           — one continuous motion or "static"
   *   eyelineTarget          — the specific noun the gaze tracks
   *                             (complement to the prose `eyeline` field)
   *   propPositions          — per-shot prop positions (override bible's home position when needed)
   *   lightingContinuity     — which practical(s) light THIS shot
   */
  cameraViewZone?: string;
  visibleSetElements?: string[];
  forbiddenSetElements?: string[];
  characterStartPosition?: string;
  characterEndPosition?: string;
  movementPath?: string;
  eyelineTarget?: string;
  propPositions?: string;
  lightingContinuity?: string;
  /**
   * Phone Insert Mode. When set to anything other than "none", the
   * composer goes into literal-screen mode: prioritize on-screen text
   * legibility, render UI minimal + literal, forbid invented
   * notifications / app clutter / fake history, keep hand/thumb
   * secondary, and avoid showing the surrounding room unless the brief
   * explicitly opts in via phoneShowSurroundings.
   *
   * Modes:
   *   lock_screen              — clock + a single notification banner
   *   text_thread              — messaging app screenshot, contact + bubbles
   *   incoming_call            — call UI with contact + Accept/Decline
   *   outgoing_call            — call UI with contact + Calling indicator
   *   typing_screen            — keyboard visible + cursor in input field
   *   photo_attachment_screen  — photo attachment open in messages
   */
  phoneInsertMode?:
    | "none"
    | "lock_screen"
    | "text_thread"
    | "incoming_call"
    | "outgoing_call"
    | "typing_screen"
    | "photo_attachment_screen";
  /**
   * Exact, verbatim on-screen text — what the audience reads. When set,
   * the composer threads it into the prompt as the literal screen
   * content. When missing on a phone-insert shot the readiness gate
   * raises a warning ("verbatim screen text required") because the
   * model otherwise invents plausible-looking gibberish.
   */
  phoneScreenText?: string;
  /**
   * Allow the surrounding room / hand / context to enter the frame.
   * Default false — phone inserts are tight on the screen.
   */
  phoneShowSurroundings?: boolean;
  /** True when this brief was generated by Auto-build (vs typed by the writer). */
  autoGenerated?: boolean;
  /**
   * Flipped to true the first time the writer edits an auto-generated brief.
   * Subsequent Auto-build runs require explicit confirmation before
   * overwriting briefs with this flag set.
   */
  userEdited?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type FeedbackTag =
  | "worked"
  | "needs_camera"
  | "character_inconsistent"
  | "bad_motion"
  | "bad_face"
  | "wrong_mood"
  | "too_stylized"
  | "too_generic"
  | "safety_blocked"
  | "use_as_reference";

export const FEEDBACK_TAG_LABEL: Record<FeedbackTag, string> = {
  worked: "Worked well",
  needs_camera: "Needs stronger camera direction",
  character_inconsistent: "Character inconsistent",
  bad_motion: "Bad motion",
  bad_face: "Bad face",
  wrong_mood: "Wrong mood",
  too_stylized: "Too stylized",
  too_generic: "Too generic",
  safety_blocked: "Safety blocked",
  use_as_reference: "Use as reference for future",
};

export interface PromptFeedback {
  tags: FeedbackTag[];
  comment?: string;
  /** Optional URL of the generated result the writer wants to attach. */
  resultLink?: string;
  taggedAt: string;
}

export interface PromptVersion {
  /** "v1", "v2", … — major-only; minor revisions overwrite the same vN. */
  versionId: string;
  /** Full label: SELVAJE_EP1_SC03_SH04_FlowPrompt_v1. */
  versionLabel: string;
  /** Model this prompt targets. */
  model: ModelKey;
  promptType: PromptType;
  mainPrompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  durationSec?: number;
  /** Recommended input mode (matches PromptType but exposed as a hint). */
  inputMode: PromptType;
  notes: string[];
  safetyWarnings: string[];
  /** Source brief id this version was derived from. Brief is immutable. */
  sourceBriefId: string;
  createdAt: string;
  updatedAt: string;
  /** Writer's own edits to the prompt body (kept separately). */
  userEdits?: string;
  /** Only the writer marks this true. */
  approved: boolean;
  feedback?: PromptFeedback;
  /**
   * Structured per-field "ingredients" the adapter produced before the
   * composer polished them into the final paragraph. Only shown in
   * Advanced mode under "Prompt construction details".
   */
  adapterIngredients?: Record<string, string>;
  /**
   * Plain-English usage notes for the writer, written by the composer.
   * Example: "Copy this into Luma.", "Environment-heavy transition shot."
   */
  usageNotes?: string[];
  /**
   * Output of the readiness gate. When ok=false the UI surfaces a warning
   * banner before letting the writer copy or approve.
   */
  readiness?: {
    ok: boolean;
    issues: string[];
  };
  /**
   * V3.1 — structured reference handoff. The Composer threads each
   * character's reference platform, approved image URL, Kling Element ID,
   * and any multi-angle reference set so the UI can show per-platform
   * Copy-to-Kling / Copy-Element-ID / Open-image controls without re-
   * parsing the prose. Absent on prompts generated before V3.1.
   */
  referenceMetadata?: {
    characters: Array<{
      name: string;
      platform: string | null;
      imageUrl: string | null;
      klingElementId: string | null;
      klingElementName: string | null;
      multiAngle: Array<{ url: string; angle?: string; label?: string }>;
    }>;
  };
}

export interface RouterScore {
  model: ModelKey;
  score: number;          // 0..100
  reasons: string[];      // top contributing factors
  risks: string[];
}

export interface RouterResult {
  recommended: ModelKey;
  confidence: number;     // 0..1
  reason: string;         // 1-sentence summary
  alternatives: RouterScore[];
  /** Safety pass: present when shot includes flagged content. */
  safety?: {
    flagged: boolean;
    categories: string[];
    suggestedAlternatives: string[];
  };
  /** Recommended clip duration band (driven by shot tags + risk factors). */
  durationGuidance?: {
    recommendedMinSec: number;
    recommendedMaxSec: number;
    reason: string;
    requiresExplicitApproval: boolean;
  };
}

// --- Quality Gate (post-generation review) -----------------------------------
export type QualityCategory =
  | "behavioral_accuracy"
  | "character_consistency"
  | "atmospheric_fidelity"
  | "emotional_subtext"
  | "edit_readiness"
  | "motion_stability"
  | "face_hand_quality"
  | "reference_continuity"
  | "prompt_adherence"
  | "safety_compliance";

export const QUALITY_CATEGORY_LABEL: Record<QualityCategory, string> = {
  behavioral_accuracy: "Behavioural accuracy",
  character_consistency: "Character consistency",
  atmospheric_fidelity: "Atmospheric fidelity",
  emotional_subtext: "Emotional subtext",
  edit_readiness: "Edit readiness",
  motion_stability: "Motion stability",
  face_hand_quality: "Face / hand quality",
  reference_continuity: "Reference continuity",
  prompt_adherence: "Prompt adherence",
  safety_compliance: "Safety / platform compliance",
};

export type QualityOutcome =
  | "accept"
  | "accept_with_notes"
  | "regenerate"
  | "regenerate_revised"
  | "use_as_previz";

export const QUALITY_OUTCOME_LABEL: Record<QualityOutcome, string> = {
  accept: "Accept",
  accept_with_notes: "Accept with post-production notes",
  regenerate: "Regenerate",
  regenerate_revised: "Regenerate with revised prompt",
  use_as_previz: "Use only as pre-viz / reference",
};

export interface QualityGateResult {
  /** Score 1..10 per category — writer-supplied. */
  scores: Record<QualityCategory, number>;
  /** Weighted average 1..10 (informational). */
  overall: number;
  outcome: QualityOutcome;
  /** Concrete actionable fix(es), e.g. "simplify to one hand motion". */
  fixes: string[];
  /** Writer's free-form notes attached to this review. */
  notes?: string;
  reviewedAt: string;
}

// --- Production result (per-generation persistent record) --------------------
export interface ProductionResult {
  /** Stable id under (scriptId, sceneOrd, shotIndex, model). */
  id: string;
  scriptId: string;
  episodeNumber?: number | null;
  sceneOrd: number;
  shotIndex: number;
  shotTags: ShotTag[];
  model: ModelKey;
  /** Label of the prompt version that produced this clip. */
  promptVersionLabel: string;
  referenceAssets?: string[];
  /** URL or filename of the rendered clip. */
  resultLink?: string;
  /** Writer's 1..5 rating. */
  rating?: number;
  /** Bullet lists of what worked / failed. */
  worked: string[];
  failed: string[];
  accepted: boolean;
  usedInFinalEdit: boolean;
  postNotes?: string;
  qualityGate?: QualityGateResult;
  createdAt: string;
  updatedAt: string;
}
