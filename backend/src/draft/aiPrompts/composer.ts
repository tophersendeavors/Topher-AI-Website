// Prompt composer — final polish step that turns the adapter's structured
// "ingredients" (Camera: …, Subject: …, Environment: …) into a clean,
// model-ready paragraph the writer can copy directly into Luma / Kling /
// Flow / Runway / Pika / Midjourney.
//
// The adapter is preserved as ingredient input. The composer:
//   1. Compresses character bios to visual/performance descriptors.
//   2. Hides field labels (Camera:/Subject:/…) from the final output.
//   3. Builds a model-specific paragraph following each platform's style.
//   4. Sanitizes broken fragments ("in .", "to her .") + truncations.
//   5. Generates a concise negative / avoid list when the model supports it.
//   6. Runs a readiness gate before returning.
//
// LLM is used to write the paragraph; deterministic post-processing
// enforces sanitization + readiness rules.

import { callLLM, extractJSON } from "../../llm/provider.js";
import { config } from "../../config.js";
import type { MasterShotBrief, ModelKey, ModelProfile } from "./types.js";
import type { ProductionRules } from "./productionRules.js";

/**
 * Visual Bible cast library — keyed by uppercased character name. Fed in
 * by the engine on every prompt generation so the composer can prefer the
 * locked consistency prompt over the filmable-descriptor extraction.
 */
export type CastLibrary = Map<
  string,
  {
    consistencyPrompt?: string;
    referenceImageUrl?: string | null;
    /** V3.1 — writer-approved canonical reference. Preferred over
     *  referenceImageUrl (which is the in-flight candidate) when threading
     *  into image-to-video prompts. */
    approvedReferenceImageUrl?: string | null;
    /** "midjourney" | "kling_image" | "kling_element" | "runway" | "generic" */
    referencePlatform?: string | null;
    /** Kling Element ID — when present, the composer threads this into
     *  every shot prompt's references block so the writer can paste it
     *  directly into the Kling Elements field. */
    klingElementId?: string | null;
    klingElementName?: string | null;
    /** Multi-angle reference images for Kling Element / Runway. */
    klingReferenceImages?: Array<{ url: string; angle?: string; label?: string }>;
    /** Stage-2 — per-episode wardrobe / HMU. The composer assembles a
     *  rich cast line from these when the brief carries an episodeNumber;
     *  otherwise falls back to consistencyPrompt. */
    wardrobeByEpisode?: Record<
      string,
      {
        top?: string;
        bottom?: string;
        accessories?: string;
        footwear?: string;
        forbidden?: string[];
      }
    >;
    hmuByEpisode?: Record<
      string,
      {
        hairCondition?: string;
        makeupState?: string;
        faceMarks?: string;
        forbidden?: string[];
      }
    >;
    presenceType?: string;
  }
>;

export interface ComposerInput {
  brief: MasterShotBrief;
  model: ModelKey;
  profile: ModelProfile;
  /** Structured per-field ingredients from the adapter. */
  ingredients: Record<string, string>;
  productionRules?: ProductionRules;
  /** Writer steering for this regen. */
  notes?: string;
  durationSec?: number;
  aspectRatio: string;
  /** Locked visual identities for the project's principal cast. */
  castLibrary?: CastLibrary;
  /**
   * V3.4 — Pre-rendered Continuity Department directive (Location + Prop
   * bibles), built by the engine via resolveShotContinuity +
   * buildContinuityDirective. Already a multi-line system-prompt block
   * the composer can paste verbatim. Empty string = no continuity
   * context resolved for this shot.
   */
  continuityDirective?: string;
  /** V4.7 — per-visible-element distinctive tokens. Readiness gate
   *  enforces that AT LEAST ONE token per visible element appears in
   *  the final prompt body, so no visible element is silently elided. */
  visibleCanonRequirements?: Array<{ label: string; tokens: string[] }>;
  /** Stage 4 — approved canon references for THIS shot (image URLs +
   *  external links + color swatches). Surfaced in the system prompt
   *  as reference cues AND attached to PromptVersion.referenceMetadata
   *  so the panel shows them next to the prompt. */
  canonReferences?: Array<{
    fieldPath: string;
    contributionId: string;
    kind: string;
    title: string;
    url: string | null;
    storage_path: string | null;
    color_hex?: string | null;
    approvedBy?: string;
    approvedAt?: string;
  }>;
}

/** V3.1 — structured reference metadata attached to every prompt so the
 *  AI Video Prompts UI can surface Copy-to-Kling buttons without having to
 *  re-parse the prose. */
export interface PromptReferenceMetadata {
  /** Per-character reference resolution. */
  characters: Array<{
    name: string;
    /** "midjourney" | "kling_image" | "kling_element" | "runway" | "generic" */
    platform: string | null;
    /** Primary image URL — approvedReferenceImageUrl preferred, falls back to referenceImageUrl. */
    imageUrl: string | null;
    klingElementId: string | null;
    klingElementName: string | null;
    multiAngle: Array<{ url: string; angle?: string; label?: string }>;
  }>;
  /** Stage 4 — human-approved canon references for this shot. Image
   *  URLs / external links / color swatches that a project member
   *  uploaded and approved as canon for a bible field visible in
   *  this shot. The panel surfaces them next to the prompt so the
   *  writer can drop them into Kling / Midjourney / Runway reference
   *  slots. */
  canonReferences?: Array<{
    fieldPath: string;
    contributionId: string;
    kind: string;
    title: string;
    url: string | null;
    storage_path: string | null;
    color_hex?: string | null;
    approvedBy?: string;
    approvedAt?: string;
  }>;
}
export interface ComposerOutput {
  finalPrompt: string;
  negativePrompt?: string;
  usageNotes: string[];
  readiness: { ok: boolean; issues: string[] };
  /** V3.1 — structured Kling / Midjourney / Runway reference handoff. */
  referenceMetadata?: PromptReferenceMetadata;
}

// --- Model style guides ----------------------------------------------------
// Each guide is a short, opinionated set of rules. The LLM applies them when
// composing the final paragraph. Kept short on purpose — the brief is the
// source of truth, the guide is direction.

const STYLE_GUIDE: Record<ModelKey, string> = {
  veo: [
    "Flow / Veo style. Cinematic-natural continuity prompt.",
    "RULE 1 (continuity-first opening): The FIRST SENTENCE must contain the",
    "  hero subject + its locked location/orientation + what it reads or",
    "  does. Continuity facts cannot be buried in the middle or end.",
    "  For an INSERT shot the opening pattern is:",
    "    [hero prop] + [locked location/orientation] + [what it reads/does].",
    "  Example: \"A red LED digital clock on Maya's right-side nightstand",
    "  reads 3:17 AM, angled toward Maya's pillow.\"",
    "  For a character shot the opening pattern is:",
    "    [environment / lighting beat] + [hero subject + observable action].",
    "RULE 2 (concise + visual): Keep the main prompt SHORT enough that the",
    "  model does not lose the hero subject. Target 70–110 words. No long",
    "  descriptive tangents. Avoid more than 1–2 secondary objects.",
    "RULE 3 (clause ordering): Put continuity / orientation requirements",
    "  near the TOP. Put the avoid / negative details at the END of the",
    "  prompt body (right before the duration line). The negative prompt",
    "  field is separate; this is about the in-prompt 'do not …' clauses.",
    "RULE 4 (no overload): Do NOT pile decorative texture (wood grain,",
    "  dust, sheen, micro-reflections) above the hero's spatial facts.",
    "RULE 5 (technical): Acceptable to call out lens, framing, and explicit",
    "  continuity. Keep dialogue exact when in-shot.",
  ].join("\n"),
  kling: [
    "Kling style. Emphasize subject, motion, atmosphere, physical action,",
    "and camera movement. Explicit technical constraints are encouraged.",
    "RULE 1 (subject + motion + camera trinity): Every shot states the",
    "  hero subject, its observable motion (or stillness), and the camera",
    "  position / movement (or its absence) explicitly.",
    "RULE 2 (direct continuity): Use direct continuity instructions — call",
    "  out spatial anchors (\"Maya's right-side nightstand\"), orientations",
    "  (\"clock face angled toward Maya's pillow\"), and do-not-flip rules",
    "  explicitly in the prompt body.",
    "RULE 3 (reference metadata separate): Character / element / reference",
    "  IDs are threaded as STRUCTURED METADATA on the prompt version (the",
    "  panel surfaces them as Copy-Element-ID / Copy URL chips). Do NOT",
    "  paste raw URLs or IDs into the prose body.",
    "RULE 4 (no lip-sync language): Avoid dialogue lip-sync language",
    "  unless explicitly required.",
    "RULE 5 (form): Sentence-form paragraph. 70–130 words. Lean physical,",
    "  observable, and continuity-anchored.",
  ].join("\n"),
  runway: [
    "Runway style. Cinematic, motion-focused, camera-and-light first.",
    "Lead with composition + light + motion; subject after. Reference frames welcome.",
    "Sentence-form paragraph. 50–110 words.",
  ].join("\n"),
  pika: [
    "Pika style. Short, punchy, visual. One subject, one motion, one mood.",
    "Avoid character backstory; use a short visual descriptor.",
    "1–3 sentences. ≤ 60 words.",
  ].join("\n"),
  luma: [
    "Luma style. Visual, cinematic, concise, motion-focused.",
    "Lead with the camera/POV and environment, then atmosphere, then motion.",
    "If no character is visible, omit cast entirely.",
    "Sentence-form paragraph. 60–120 words.",
  ].join("\n"),
  midjourney: [
    "Midjourney style. Still-image / keyframe focused. NO video movement language.",
    "Comma-separated descriptor list ending with --ar and --stylize if appropriate.",
    "Subject + setting + light + lens + palette + mood.",
  ].join("\n"),
  generic_video: [
    "Generic video prompt. Cinematic, paragraph form, 60–120 words.",
    "Camera, motion, subject, environment, light, mood, aspect, duration.",
  ].join("\n"),
  generic_image: [
    "Generic image prompt. Comma-separated descriptors. 30–80 words.",
    "Subject, framing, lens, light, palette, mood, aspect ratio.",
  ].join("\n"),
  custom: [
    "Custom model. Treat as generic video unless the project's profile overrides.",
  ].join("\n"),
};

// Compress a character entry into a FILMABLE visual descriptor. Used by
// the composer so character biographies don't bleed into final prompts.
//
// Hard rule: nothing leaves this function unless it matches an allowlist
// of filmable surface descriptors. Strip-listing partial biographical
// clauses leaves fragments behind ("the most perceptive observer in any
// room" → "observer in ."). The allowlist refuses to emit anything that
// isn't an age tier, gender presentation, build, hair/eye/skin descriptor,
// height adjective, or visible wardrobe. Everything else is dropped.
//
// Forbidden categories (NEVER emitted, even if present in source):
//   • profession (therapist, surgeon, cop, lawyer, …)
//   • psychology (grief, restraint, watchful, observant inner state)
//   • relationships / backstory (widow, eighteen months out, mother of …)
//   • story context (most perceptive observer in any room, knows the truth)
//   • anything narrative, not visible

// Allowlisted descriptor vocabulary. Anything matching is kept; everything
// else is discarded. Lower-cased match.
const APPEARANCE_ALLOW = new Set<string>([
  // gender presentation
  "woman", "man", "girl", "boy", "nonbinary",
  // build / silhouette
  "slim", "slender", "thin", "lean", "athletic", "sturdy", "stocky",
  "broad-shouldered", "tall", "short", "petite",
  // hair color
  "blonde", "brunette", "auburn", "redhead", "gray", "grey", "silver",
  "black-haired", "dark-haired",
  // hair style
  "long-haired", "short-haired", "curly", "wavy", "straight-haired",
  "bald", "shaved", "buzzcut", "ponytail",
  // facial hair
  "bearded", "clean-shaven", "stubbled", "moustached",
  // eyes
  "blue-eyed", "brown-eyed", "green-eyed", "hazel-eyed", "dark-eyed",
  // skin / complexion (descriptive, not identity-coded)
  "pale", "fair", "olive-skinned", "tanned", "freckled", "weathered",
  // posture / bearing (visibly observable; NOT psychology)
  "upright", "stooped",
  // visible age cues
  "young", "middle-aged", "older", "elderly",
]);

/** Pull tokens like "48", "in her 40s", "late 50s". */
function extractAgeTier(text: string): string | null {
  // Bare integer 5–99 reads as age.
  const num = text.match(/\b([1-9][0-9])\b/);
  if (num) return num[1];
  const dec = text.match(/\b(?:in (?:her|his|their)\s+)?(?:early|mid|late)?\s*(\d0)s\b/i);
  if (dec) return dec[0].replace(/\s+/g, " ").trim();
  return null;
}

/**
 * Pull only filmable surface descriptors from a description. Anything not
 * matching the allowlist is dropped. Returns a comma-list (max 4 tokens)
 * so the result reads like "48, woman, slim, dark-haired" — visible only.
 */
export function filmableDescriptors(description: string): string {
  const lower = description.toLowerCase();
  const out: string[] = [];

  const age = extractAgeTier(lower);
  if (age) out.push(age);

  // Tokenize on word boundaries; check each token (and hyphenated compounds)
  // against the allowlist. Order is preserved.
  const seen = new Set<string>(age ? [age] : []);
  const tokens = lower.match(/[a-z][a-z-]*[a-z]/g) ?? [];
  for (const t of tokens) {
    if (out.length >= 4) break;
    if (!APPEARANCE_ALLOW.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.join(", ");
}

/**
 * Build the prompt-side cast descriptor. Wardrobe is treated as filmable
 * (it is, by definition, on-screen) but is still passed through the
 * sanitizer downstream.
 */
function compressCharacter(name: string, description: string, wardrobe?: string): string {
  const descriptors = description ? filmableDescriptors(description) : "";
  const parts = [name];
  if (descriptors) parts.push(descriptors);
  if (wardrobe && wardrobe.trim()) parts.push(`wearing ${wardrobe.trim()}`);
  return parts.join(", ");
}

/** True when the brief contains no on-screen character performance. */
function characterIsInvisible(brief: MasterShotBrief): boolean {
  if (brief.characters.length === 0) return true;
  // V4.5 — CHAR / BEH / DIALOGUE / REACTION tags are explicit writer
  // signals that the character IS on screen. These tags trump every
  // heuristic below — without this override the briefs that get
  // auto-built with anonymized action lines ("Body lurches upright"
  // instead of "Maya lurches upright") get misclassified as
  // invisible, which routes the LLM to drop the cast bible entirely
  // and write "A figure" / "A person".
  const tags = (brief.shotTags ?? []).map((t) => String(t).toUpperCase());
  const VISIBLE_TAGS = new Set(["CHAR", "CHARACTER", "BEH", "BEHAVIOR", "DLG", "DIALOGUE", "REACT", "REACTION"]);
  if (tags.some((t) => VISIBLE_TAGS.has(t))) return false;
  // Visual weight check: env+atmosphere+camera dominate → likely no on-screen subject.
  const v = brief.visualWeight;
  if (v) {
    const envHeavy = (v.environment ?? 0) + (v.atmosphere ?? 0) + (v.cameraMovement ?? 0);
    const charHeavy = (v.character ?? 0) + (v.dialogue ?? 0);
    if (envHeavy >= 60 && charHeavy <= 25) return true;
  }
  // Performance + action both empty + no dialogue → no on-screen subject.
  const noPerf = !(brief.performanceDirection ?? "").trim();
  const noDlg = !(brief.dialogue ?? "").trim();
  const actionMentionsCast = brief.characters.some((c) =>
    (brief.action ?? "").toLowerCase().includes(c.name.toLowerCase())
  );
  return noPerf && noDlg && !actionMentionsCast;
}

// --- Composition-first detection ------------------------------------------
//
// Many of the strongest shots in a prestige drama are defined by FRAMING,
// not by the subject inside the frame. The composer used to default to
// "character first" because the LLM was handed cast + performance before
// anything else. This module now decides BEFORE the LLM runs whether the
// shot is composition-led, environment-led, or character-led, and tells
// the LLM which clause has to open the prompt.

/** Strong visual-frame cues. Order matters — earlier entries win. */
const VISUAL_FRAME_CUES: Array<{ keyword: RegExp; label: string }> = [
  { keyword: /\brear[-\s]?window\b/i, label: "rear window of the vehicle" },
  { keyword: /\bwindshield\b/i, label: "windshield" },
  { keyword: /\bside[-\s]?window\b/i, label: "side window" },
  { keyword: /\bcar window\b/i, label: "car window" },
  { keyword: /\bbus window\b|\btrain window\b/i, label: "train/bus window" },
  { keyword: /\bairplane window\b|\bplane window\b/i, label: "airplane window" },
  { keyword: /\bporthole\b/i, label: "porthole" },
  { keyword: /\bdoor(?:way|frame)\b/i, label: "doorway" },
  { keyword: /\bopen door\b/i, label: "open door" },
  { keyword: /\bwindow frame\b|\bthrough (?:the|a) window\b/i, label: "window frame" },
  { keyword: /\bmirror\b/i, label: "mirror reflection" },
  { keyword: /\breflection\b/i, label: "reflection" },
  { keyword: /\bsilhouette\b/i, label: "silhouette" },
  { keyword: /\bcurtain\b|\bdrape\b/i, label: "curtain" },
  { keyword: /\bglass partition\b|\bglass wall\b/i, label: "glass partition" },
  { keyword: /\bthrough (?:the|a) glass\b/i, label: "through glass" },
  { keyword: /\bthreshold\b/i, label: "threshold" },
  { keyword: /\barchway\b|\barch\b/i, label: "archway" },
  { keyword: /\bcrack in (?:the|a) door\b/i, label: "crack in a door" },
  { keyword: /\bcorridor\b|\bhallway\b/i, label: "corridor" },
  { keyword: /\bover[-\s]?the[-\s]?shoulder\b|\bOTS\b/i, label: "over-the-shoulder framing" },
  { keyword: /\bPOV\b|\bpoint[-\s]?of[-\s]?view\b/i, label: "POV" },
  { keyword: /\bfoliage\b|\bbranch(?:es)?\b/i, label: "foliage in foreground" },
  { keyword: /\bsmoke\b|\bmist\b|\bfog\b/i, label: "smoke/mist veil" },
];

/**
 * Search action + visualMotif + productionDesign + location for visual-frame
 * cues. Returns the first match's human label, or null.
 */
function detectVisualFrame(brief: MasterShotBrief): string | null {
  const haystack = [
    brief.action,
    brief.visualMotif,
    brief.productionDesign,
    brief.location,
    brief.cameraFraming,
  ]
    .filter(Boolean)
    .join(" ");
  for (const { keyword, label } of VISUAL_FRAME_CUES) {
    if (keyword.test(haystack)) return label;
  }
  return null;
}

// --- Shot Intent Classifier -----------------------------------------------
//
// Every shot gets classified BEFORE the LLM runs. The classifier inspects
// the brief's signals (frame cues, visual weight, dialogue, action,
// shotTags) and returns one of six intents plus a Composition Weight
// score. That intent drives the system prompt's mandatory clause order
// and the readiness gate's opening-clause check.

export type ShotIntent =
  | "composition_driven"
  | "environment_driven"
  | "character_driven"
  | "action_driven"
  | "dialogue_driven"
  | "transition_driven";

/** Composition-weight signal words. Each match adds to a 0..100 score. */
const COMPOSITION_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /\bwindow\b/i, weight: 18 },
  { pattern: /\bglass\b/i, weight: 14 },
  { pattern: /\breflection\b/i, weight: 18 },
  { pattern: /\bsilhouette\b/i, weight: 18 },
  { pattern: /\bshadow(?:s|y)?\b/i, weight: 10 },
  { pattern: /\bdoor(?:way|frame)?\b/i, weight: 14 },
  { pattern: /\bmirror\b/i, weight: 18 },
  { pattern: /\bnegative space\b/i, weight: 16 },
  { pattern: /\bforeground\b|\bbackground\b/i, weight: 8 },
  { pattern: /\breveal(?:s|ed|ing)?\b/i, weight: 10 },
  { pattern: /\bthreshold\b/i, weight: 16 },
  { pattern: /\bframe(?:s|d)?\b/i, weight: 12 },
  { pattern: /\barch(?:way)?\b/i, weight: 10 },
  { pattern: /\bcurtain\b|\bdrape\b/i, weight: 10 },
  { pattern: /\bporthole\b/i, weight: 14 },
  { pattern: /\bover[-\s]?the[-\s]?shoulder\b|\bOTS\b/i, weight: 14 },
  { pattern: /\bPOV\b|\bpoint[-\s]?of[-\s]?view\b/i, weight: 14 },
  { pattern: /\bthrough (?:the|a) (?:glass|window|door)\b/i, weight: 18 },
];

/** Action-driven cues (verbs). */
const ACTION_SIGNALS = [
  /\brun(?:s|ning)?\b/i, /\bsprint(?:s|ing)?\b/i, /\bfight(?:s|ing)?\b/i,
  /\bchase(?:s|d|ing)?\b/i, /\bexplo(?:de|sion)\b/i, /\bcrash(?:es|ed|ing)?\b/i,
  /\bfall(?:s|ing|en)?\b/i, /\bjump(?:s|ing)?\b/i, /\bdriv(?:e|ing|es)\b/i,
  /\bracing\b/i, /\bcollide(?:s|d)?\b/i, /\bbreak(?:s|ing)? through\b/i,
];

/** Transition-driven cues. */
const TRANSITION_SIGNALS = [
  /\btransition(?:s|al)?\b/i, /\bcut to\b/i, /\bmatch cut\b/i, /\bdissolve\b/i,
  /\bfade (?:in|out|to)\b/i, /\binterstitial\b/i, /\bestablish(?:es|ing|ment)?\b/i,
];

/** Sum of composition-signal weights present in the haystack (capped 100). */
function computeCompositionWeight(brief: MasterShotBrief): number {
  const haystack = [
    brief.action, brief.visualMotif, brief.productionDesign,
    brief.location, brief.cameraFraming, brief.shotPurpose, brief.storyBeat,
  ]
    .filter(Boolean)
    .join(" ");
  let total = 0;
  for (const { pattern, weight } of COMPOSITION_SIGNALS) {
    if (pattern.test(haystack)) total += weight;
  }
  return Math.min(100, total);
}

/**
 * Classify a shot into one of six intents. The signal hierarchy:
 *
 *   1. Transition cues + TRANS tag             → transition_driven
 *   2. Strong frame cue OR comp-weight > 35 AND comp-weight > character weight
 *                                              → composition_driven
 *   3. Action-verb cues with strong action     → action_driven
 *   4. Substantial in-shot dialogue            → dialogue_driven
 *   5. Env+atmosphere weight ≥ 50 OR invisible → environment_driven
 *   6. Default                                 → character_driven
 */
export interface ShotClassification {
  intent: ShotIntent;
  /** 0..100. The primary numeric signal for "composition > character". */
  compositionWeight: number;
  characterWeight: number;
  /** Resolved frame label (rear window, doorway, mirror, …) when present. */
  frame: string | null;
  /** Short, human-readable reason for the chosen intent. */
  reason: string;
}

export function classifyShotIntent(brief: MasterShotBrief): ShotClassification {
  const haystack = [
    brief.action, brief.visualMotif, brief.productionDesign,
    brief.shotPurpose, brief.storyBeat,
  ]
    .filter(Boolean)
    .join(" ");
  const frame = detectVisualFrame(brief);
  const compositionWeight = computeCompositionWeight(brief);
  const v = brief.visualWeight ?? null;
  const characterWeight = v ? (v.character ?? 0) + (v.dialogue ?? 0) : 0;
  const envWeight = v ? (v.environment ?? 0) + (v.atmosphere ?? 0) + (v.cameraMovement ?? 0) : 0;
  const tags = (brief.shotTags ?? []) as string[];
  const invisible = characterIsInvisible(brief);

  // 1. Composition wins over transition. A rear-window shot CAN be a
  //    transition AND a composition piece; "composition_driven" gives
  //    the LLM a more useful clause order (frame first), so we prefer it.
  if (frame || (compositionWeight >= 35 && compositionWeight > characterWeight)) {
    return {
      intent: "composition_driven",
      compositionWeight,
      characterWeight,
      frame,
      reason: frame
        ? `visual frame: ${frame}`
        : `composition weight ${compositionWeight} > character weight ${characterWeight}`,
    };
  }

  // 2. Transition (only if no composition signal already claimed the shot).
  if (
    tags.includes("TRANS") ||
    TRANSITION_SIGNALS.some((r) => r.test(haystack))
  ) {
    return {
      intent: "transition_driven",
      compositionWeight,
      characterWeight,
      frame,
      reason: "transition cue or TRANS tag present",
    };
  }

  // 3. Action.
  const actionHits = ACTION_SIGNALS.filter((r) => r.test(haystack)).length;
  if (actionHits >= 2 || (actionHits === 1 && (v?.action ?? 0) >= 25)) {
    return {
      intent: "action_driven",
      compositionWeight,
      characterWeight,
      frame,
      reason: `action verbs (${actionHits}) and/or visualWeight.action`,
    };
  }

  // 4. Dialogue.
  const dlg = (brief.dialogue ?? "").trim();
  if (dlg && dlg.split(/\s+/).length >= 6 && (v?.dialogue ?? 0) >= 20) {
    return {
      intent: "dialogue_driven",
      compositionWeight,
      characterWeight,
      frame,
      reason: "in-shot dialogue with dialogue weight ≥ 20",
    };
  }

  // 5. Environment.
  //
  // V4.5 — CHAR-tag override. A shot tagged CHAR (character) with a visible
  // character on screen is character-driven even if the brief's prose reads
  // heavy on environment (e.g. "a dark bedroom at 3:17 AM" + Maya jolting
  // upright). Without this override the env-weight gate sometimes classifies
  // a wake-reaction shot as environment_driven, which routes the LLM to lead
  // with darkness instead of the character — producing "A figure snaps
  // upright…" instead of "Maya jolts upright…". The CHAR tag is the writer's
  // explicit signal that the character IS the shot.
  const hasCharTag = tags.some((t) => /^char(acter)?$/i.test(t));
  if (
    !invisible &&
    !hasCharTag &&
    (invisible || (envWeight >= 50 && envWeight > characterWeight))
  ) {
    return {
      intent: "environment_driven",
      compositionWeight,
      characterWeight,
      frame,
      reason: invisible
        ? "no on-screen character performance"
        : `environment+atmosphere weight ${envWeight} > character ${characterWeight}`,
    };
  }
  if (invisible) {
    return {
      intent: "environment_driven",
      compositionWeight,
      characterWeight,
      frame,
      reason: "no on-screen character performance",
    };
  }

  // 6. Default — character.
  return {
    intent: "character_driven",
    compositionWeight,
    characterWeight,
    frame,
    reason: "default — no stronger intent matched",
  };
}

/** Required clause order per intent — the LLM is shown this verbatim.
 *  For every intent except character_driven and dialogue_driven the order
 *  is: Hero Image → Composition → Environment → Character → Props. */
const INTENT_ORDER: Record<ShotIntent, string[]> = {
  composition_driven: ["Hero Image", "Composition / framing", "Environment", "Camera", "Character placement", "Props"],
  environment_driven: ["Hero Image", "Environment", "Composition", "Camera", "Character placement", "Props"],
  character_driven: ["Character placement & appearance", "Composition", "Environment", "Atmosphere", "Props"],
  action_driven: ["Hero Image", "Action / motion", "Camera", "Character", "Environment"],
  dialogue_driven: ["Character (face / performance)", "Camera framing & lens", "Environment", "Atmosphere"],
  transition_driven: ["Hero Image", "Composition / transition device", "Environment / atmosphere", "Camera"],
};

/** Human-readable headline for the LLM's opening clause directive. */
function openingDirective(c: ShotClassification): string {
  switch (c.intent) {
    case "composition_driven":
      return `OPENING CLAUSE — MANDATORY: open by establishing the visual frame ("${c.frame ?? "framing element"}"). The frame is the primary image. Character (if any) is secondary and enters in a later clause.`;
    case "environment_driven":
      return "OPENING CLAUSE — MANDATORY: open with environment + camera POV. The world is the primary image. Character (if any) enters after.";
    case "transition_driven":
      return "OPENING CLAUSE — MANDATORY: open with the transition device or atmosphere (smoke, dissolve, foliage, dawn light). No character clause first.";
    case "action_driven":
      return "OPENING CLAUSE — MANDATORY: open with the motion / action beat. Camera follows. Character is named only in service of the motion.";
    case "dialogue_driven":
      return "OPENING CLAUSE: the character may open, anchored by framing & lens. Do NOT begin with a generic 'woman in her [age]…' clause.";
    case "character_driven":
      return "OPENING CLAUSE: the character may open. Anchor them to the composition and environment — do not use a generic 'woman in her [age]…' clause.";
  }
}

// --- Visual Hierarchy ------------------------------------------------------
//
// Every shot is decomposed into:
//   • Hero Image       — the photographable image that defines the shot
//                        (e.g. "rain-covered car window swallowing the last
//                        lights of San José"). Pulled from frame + motif +
//                        location + atmospheric action.
//   • Hero Subject     — the principal on-screen figure or object
//                        (e.g. "Margot"). Empty when no character visible.
//   • Secondary        — supporting visual elements (props, weather, light
//                        sources). Pulled from props + production design +
//                        atmospheric notes.
//
// Composition rule: when the intent is anything other than character_driven
// or dialogue_driven, the Hero Image must occupy ≥ 50% of the prompt's
// visual attention. The LLM is told this verbatim.

export interface VisualHierarchy {
  heroImage: string;
  heroSubject: string;
  secondary: string[];
}

function extractHeroImage(brief: MasterShotBrief, classification: ShotClassification): string {
  // Prefer the new schema (cameraSees + texture) over the legacy
  // (visualMotif + productionDesign). Whatever the brief carries, the
  // hero image is built from the most photographable signal available.
  const parts: string[] = [];
  if (classification.frame) parts.push(classification.frame);
  const cameraSees = (brief.cameraSees ?? "").split(/[.;]/)[0]?.trim();
  const texture = (brief.texture ?? "").split(/[.;]/)[0]?.trim();
  const motif = (brief.visualMotif ?? "").trim();
  if (cameraSees) parts.push(cameraSees);
  else if (texture) parts.push(texture);
  else if (motif) parts.push(motif);
  const env = [brief.location, brief.timeOfDay].filter(Boolean).join(", ").trim();
  if (env) parts.push(env);
  // Use the FIRST clause of action — the rest is usually beat detail.
  const actionFirst = (brief.action ?? "").split(/[.;]/)[0]?.trim();
  if (actionFirst) parts.push(actionFirst);
  return parts.slice(0, 3).join(" — ").slice(0, 240);
}

function extractHeroSubject(brief: MasterShotBrief): string {
  const visible = !characterIsInvisible(brief);
  if (!visible) return "";
  // Primary character (first cast entry) — name only. The visual descriptor
  // is provided separately via compressCharacter / castLine in the payload.
  const primary = brief.characters[0];
  return primary?.name ?? "";
}

function extractSecondaryElements(brief: MasterShotBrief): string[] {
  const out: string[] = [];
  for (const p of brief.props ?? []) {
    const t = (p ?? "").trim();
    if (t) out.push(t);
  }
  const design = (brief.productionDesign ?? "").trim();
  if (design) out.push(design);
  const lighting = (brief.lighting ?? "").trim();
  if (lighting) out.push(lighting);
  // De-dupe; cap 6.
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const s of out) {
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(s);
    if (deduped.length >= 6) break;
  }
  return deduped;
}

export function extractVisualHierarchy(
  brief: MasterShotBrief,
  classification: ShotClassification
): VisualHierarchy {
  return {
    heroImage: extractHeroImage(brief, classification),
    heroSubject: extractHeroSubject(brief),
    secondary: extractSecondaryElements(brief),
  };
}

// --- Shot Perspective ------------------------------------------------------
//
// Perspective is the "camera's relationship to the subject" — observational
// vs. participatory vs. portrait vs. surveillance vs. memory vs. dream vs.
// documentary. SELVAJE (and most prestige limited series) defaults to
// observational: character seen through glass / foliage / negative space,
// not centered for a publicity still.

export type ShotPerspective =
  | "observational"
  | "participatory"
  | "portrait"
  | "surveillance"
  | "memory"
  | "dream"
  | "documentary";

const PERSPECTIVE_CUES: Array<{ pattern: RegExp; perspective: ShotPerspective }> = [
  { pattern: /\bdream\b|\bnightmare\b/i, perspective: "dream" },
  { pattern: /\bmemory\b|\bflashback\b/i, perspective: "memory" },
  { pattern: /\bsurveillance\b|\bsecurity (?:camera|monitor)\b|\bCCTV\b/i, perspective: "surveillance" },
  { pattern: /\bdocumentary\b|\bvérité\b|\bverite\b/i, perspective: "documentary" },
  { pattern: /\b(?:handheld|first[-\s]?person|POV)\b/i, perspective: "participatory" },
];

/** Project-level keyword signals that observational should be the default. */
const OBSERVATIONAL_PROJECT_HINTS = [
  /\brestrained\b/i, /\bnegative space\b/i, /\bcloud[-\s]?forest\b/i,
  /\bobservational\b/i, /\bprestige\b/i, /\bclinical\b/i,
];

function chooseShotPerspective(
  brief: MasterShotBrief,
  classification: ShotClassification,
  productionPrefer: string[]
): ShotPerspective {
  const haystack = [
    brief.shotPurpose, brief.storyBeat, brief.emotionalBeat,
    brief.visualMotif, brief.action, brief.productionDesign,
  ]
    .filter(Boolean)
    .join(" ");
  // Explicit perspective cues in the brief win.
  for (const { pattern, perspective } of PERSPECTIVE_CUES) {
    if (pattern.test(haystack)) return perspective;
  }
  // Character_driven shots with strong character weight + no framing element
  // are typically portraits.
  if (
    classification.intent === "character_driven" &&
    classification.characterWeight >= 50 &&
    !classification.frame
  ) {
    return "portrait";
  }
  // Project preference for observational language.
  const preferText = productionPrefer.join(" ");
  if (OBSERVATIONAL_PROJECT_HINTS.some((r) => r.test(preferText))) {
    return "observational";
  }
  // Default. Prestige drama is observational unless otherwise signaled.
  return "observational";
}

/** Observational-mode rules the LLM is shown verbatim. */
const OBSERVATIONAL_RULES = [
  "OBSERVATIONAL MODE — non-negotiable when this perspective is active:",
  "  • Character is often viewed THROUGH something (glass, reflection, mist,",
  "    water, foliage, doorway, architecture, negative space).",
  "  • Prefer layered foreground / midground / background depth.",
  "  • AVOID centered character compositions.",
  "  • AVOID promotional-poster framing ('hero stands looking out at the",
  "    vista', 'character lit from behind in heroic pose').",
  "  • AVOID 'person sitting in [location]' compositions — anchor the subject",
  "    to a framing element or atmospheric layer.",
  "  • The shot must read as a frame extracted from a prestige limited",
  "    series, not as a publicity still.",
].join("\n");

/** Per-perspective opening directive that supplements the intent directive. */
const PERSPECTIVE_DIRECTIVE: Record<ShotPerspective, string> = {
  observational: OBSERVATIONAL_RULES,
  participatory:
    "PARTICIPATORY MODE: camera is inside the action. Handheld or POV. The viewer feels embedded; subject responds to the camera presence implicitly.",
  portrait:
    "PORTRAIT MODE: centered character framing is acceptable IF the shot's intent is character-driven. Lens chosen to flatter face, light shaped for the performance.",
  surveillance:
    "SURVEILLANCE MODE: locked-off, wide, slightly elevated. No camera movement. Subject does not know they're being watched. Frame is deliberately uncomposed.",
  memory:
    "MEMORY MODE: hazed edges, soft focus on a single sensory anchor (light, sound, an object). Other elements drift out of focus. No literal sharpness.",
  dream:
    "DREAM MODE: discontinuous space, impossible camera moves, surreal scale. Real-world physics relaxed.",
  documentary:
    "DOCUMENTARY MODE: handheld, available light, subject behaviour over composition. Frame allowed to be loose.",
};

type LeadStrategy = "composition" | "environment" | "character";

// --- Sanitization ----------------------------------------------------------
// Run AFTER the LLM. Strips fragments that signal raw-adapter leakage,
// truncations, or biographical leak ("therapist", "the most perceptive
// observer"). Two passes:
//   1. Surgical fixups on common dangling shapes ("observer in .", "her .").
//   2. Sentence-level drop: any sentence still containing a banned phrase,
//      a dangling preposition, or a forbidden profession/psychology word
//      is removed entirely rather than patched.

const FRAGMENT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /,\s*\./, label: "comma before period" },
  { pattern: /\s+\.(?=\s|$)/, label: "space before period" },
  { pattern: /\b(?:her|his|their|its|the|a|an)\s+\.(?=\s|$)/i, label: "dangling determiner" },
  // "observer in .", "moment of .", "watching from .", etc.
  { pattern: /\b[a-z][a-z-]*\s+(?:in|of|to|from|with|near|by|over|under|on|for|at)\s+\.(?=\s|$)/i, label: "dangling phrase" },
  // Field-label leakage in body text.
  { pattern: /^(?:Camera|Subject|Environment|Lighting|Setting|Action|Atmosphere|Aspect|Composition|Motion|Light|Mood|Performance|Continuity|Lens|Color)\s*:\s*/m, label: "raw field label" },
];

// Forbidden words. Final prompts must NEVER contain these — they're not
// filmable, they're story-bible context.
const FORBIDDEN_BIOGRAPHY = [
  // professions
  "therapist", "surgeon", "doctor", "nurse", "lawyer", "attorney", "judge",
  "cop", "detective", "officer", "soldier", "veteran", "spy", "agent",
  "priest", "nun", "pastor", "rabbi", "imam", "professor", "teacher",
  "journalist", "reporter", "writer", "novelist", "scientist", "engineer",
  // relationships / backstory
  "widow", "widower", "orphan", "survivor", "addict", "alcoholic",
  "ex-wife", "ex-husband", "ex-girlfriend", "ex-boyfriend",
  // psychology / inner state. NB: "broken" intentionally omitted — too
  // common in physical contexts (broken glass, broken light, broken edge).
  "grief", "trauma", "guilt", "regret", "shame", "longing", "yearning",
  "emotionally wounded", "haunted by", "consumed by", "perceptive",
  "observant", "observer", "watchful", "knows the truth", "in mourning",
  "in denial", "to heal", "to feel something",
  // narrative / story-context
  "the truth", "the secret", "the past", "the loss", "back then",
  "since then", "the death of",
  "after the death", "after the loss", "before the death",
  "daughter's death", "son's death", "her daughter", "his son",
  "months out", "years out", "weeks out", "days out",
];

function containsForbidden(line: string): string | null {
  const lower = line.toLowerCase();
  for (const w of FORBIDDEN_BIOGRAPHY) {
    if (lower.includes(w)) return w;
  }
  return null;
}

/**
 * Interpretive / un-photographable phrases. The composer must produce
 * observable behavior, not screenplay analysis. "Effortful calm",
 * "clinical stillness", "expression withheld" — these are inner-state
 * adjectives that read like a director's note, not a shot description.
 *
 * Rule from the writer: if the phrase cannot be photographed, it must
 * not appear in the prompt. The model infers emotion from the image.
 *
 * These are full-phrase regexes (multi-word) so common visual
 * descriptors using the same root words ("restrained lighting",
 * "composed frame") still pass.
 */
const FORBIDDEN_INTERPRETIVE: Array<{ pattern: RegExp; label: string }> = [
  // Effortful / clinical / withheld inner-state phrases.
  { pattern: /\beffortful\s+(?:calm|stillness|control|composure|restraint)\b/i, label: "effortful [inner state]" },
  { pattern: /\bclinical\s+(?:stillness|elegance|restraint|composure|calm|precision)\b/i, label: "clinical [inner state]" },
  { pattern: /\bcomposed\s+(?:stillness|restraint|silence|distance)\b/i, label: "composed [inner state]" },
  { pattern: /\b(?:quiet|measured|guarded|withheld)\s+intensity\b/i, label: "[inner-state] intensity" },
  { pattern: /\bwatchful\s+(?:stillness|silence|presence|patience)\b/i, label: "watchful [inner state]" },
  // Expression-as-state phrases.
  { pattern: /\bexpression\s+(?:withheld|held back|guarded|sealed|veiled|empty|blank|unreadable|inscrutable)\b/i, label: "expression [inner state]" },
  { pattern: /\b(?:withheld|guarded|veiled|sealed)\s+expression\b/i, label: "[inner state] expression" },
  // "Control worn like…", "wears X like…" framing.
  { pattern: /\bcontrol\s+worn\s+like\b/i, label: "control worn like …" },
  { pattern: /\bwears\s+(?:her|his|their)\s+\w+\s+like\b/i, label: "wears [trait] like …" },
  // Direct interpretive adjectives standing alone or compounded.
  { pattern: /\bemotionally\s+(?:restrained|controlled|withdrawn|guarded|distant|absent|withheld)\b/i, label: "emotionally [inner state]" },
  { pattern: /\binternally?\s+(?:conflicted|contained|tense|struggling)\b/i, label: "internally [inner state]" },
  // SELVAJE-specific repeat offenders.
  { pattern: /\bclinical elegance\b/i, label: "clinical elegance" },
  { pattern: /\bcontrolled\s+(?:stillness|presence)\b/i, label: "controlled [inner state]" },
  // "Observational framing" / "non-promotional" — system-internal jargon
  // that categorizes a shot rather than describing it. (prestige-drama and
  // key-art are intentionally NOT here — the LLM can paraphrase them away.)
  { pattern: /\bobservational\s+(?:framing|composition|mode|perspective)\b/i, label: "observational [meta term]" },
  { pattern: /\bnon[-\s]?promotional\b/i, label: "non-promotional" },
  // Generic "stoic / impassive / inscrutable" inner-state adjectives —
  // banned only as standalone characterization (not as visual texture).
  { pattern: /\b(?:stoic|impassive|inscrutable|implacable|unflinching)\s+(?:gaze|face|expression|posture|figure|stance|stillness|presence)\b/i, label: "[stoic/impassive] [inner state]" },
  // Bare "stoic" / "impassive" / "inscrutable" attached to a person noun.
  { pattern: /\b(?:she|he|they)\s+(?:is|stands|sits|appears)\s+(?:stoic|impassive|inscrutable|composed|guarded|withdrawn|restrained)\b/i, label: "subject is [inner state]" },
  // "Telling story" / "story of" interpretive framings.
  { pattern: /\btell(?:s|ing)\s+(?:the|a)\s+story\b/i, label: "telling [the/a] story" },
];

function containsInterpretive(line: string): string | null {
  for (const { pattern, label } of FORBIDDEN_INTERPRETIVE) {
    if (pattern.test(line)) return label;
  }
  return null;
}

// Split text into sentences, keeping punctuation. Newlines also delimit so
// label-style "Camera:\nSubject:" output is broken into discrete lines.
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Extract Midjourney-style `--ar X:Y` / `--stylize N` flags from anywhere
 * in the text. Used by the sanitizer so even if a sentence containing the
 * flags gets dropped by another rule, the flags survive into the final
 * prompt.
 */
function extractMjFlags(text: string): { ar?: string; stylize?: string } {
  const out: { ar?: string; stylize?: string } = {};
  const ar = text.match(/--ar\s+(\d+(?:\.\d+)?:\d+)/i);
  if (ar) out.ar = ar[1];
  const sty = text.match(/--stylize\s+(\d{1,4})/i);
  if (sty) out.stylize = sty[1];
  return out;
}

function sanitize(text: string): { text: string; issues: string[] } {
  const issues: string[] = [];
  // Preserve any Midjourney flags from the raw input before sentence-drop
  // runs — we re-append them at the end so the suffix survives.
  const flags = extractMjFlags(text);

  // Pass 1: surgical fixups on common dangling shapes.
  let pre = text.trim();
  pre = pre
    .replace(/\b([a-z][a-z-]*)\s+(?:in|of|to|from|with|near|by|over|under|on|for|at)\s+\./gi, "$1.")
    .replace(/\b(?:in|of|to|from|with|near|by|over|under|on|for|at)\s+\./gi, "")
    .replace(/,\s*\./g, ".")
    .replace(/\s+\./g, ".")
    .replace(/\.\s*\./g, ".")
    .replace(/\b(?:her|his|their|its|the|a|an)\s+\./gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Pass 2: sentence-level drop. Anything containing a forbidden
  // biography term, an interpretive (un-photographable) phrase, a label
  // leak, or a dangling phrase is removed wholesale.
  const sentences = splitSentences(pre);
  const kept: string[] = [];
  for (const sRaw of sentences) {
    const s = sRaw.trim();
    if (!s) continue;
    const bannedBio = containsForbidden(s);
    if (bannedBio) {
      issues.push(`Dropped sentence: contained forbidden term "${bannedBio}"`);
      continue;
    }
    const bannedInterp = containsInterpretive(s);
    if (bannedInterp) {
      issues.push(`Dropped sentence: contained interpretive phrase (${bannedInterp}) — describe observable behavior instead`);
      continue;
    }
    if (/^(?:Camera|Subject|Environment|Lighting|Setting|Action|Atmosphere|Aspect|Composition|Motion|Light|Mood|Performance|Continuity|Lens|Color)\s*:/i.test(s)) {
      issues.push("Dropped sentence: raw field label");
      continue;
    }
    if (/\s+\.\s*$/.test(s) || /^\.+$/.test(s)) {
      issues.push("Dropped sentence: truncated fragment");
      continue;
    }
    kept.push(s);
  }

  let out = kept.join(" ").trim();

  // Re-attach Midjourney --ar / --stylize flags if they were present in
  // the input but stripped during sentence-drop. We append to the end so
  // the prompt stays copyable for Midjourney.
  if (flags.ar && !/--ar\s+\d/i.test(out)) {
    out = `${out} --ar ${flags.ar}`.trim();
  }
  if (flags.stylize && !/--stylize\s+\d/i.test(out)) {
    out = `${out} --stylize ${flags.stylize}`.trim();
  }

  // Final pattern sweep: report (don't repatch) anything left over.
  for (const { pattern, label } of FRAGMENT_PATTERNS) {
    if (pattern.test(out)) issues.push(label);
  }
  return { text: out, issues };
}

// --- Readiness gate --------------------------------------------------------

export interface ReadinessIssue {
  ok: boolean;
  issues: string[];
}

/** Stop words used by extractContinuityTokens — broad enough that
 *  framework / connector words never count toward "distinctive". */
const CONTINUITY_STOP = new Set<string>(
  ("the and with from into onto over under near her his their its them this " +
    "that these those above below between against through across during after " +
    "before because while there here when then than what which where while who " +
    "does done been being have has had hadnt would could should might must " +
    "shall will would were was are not only also even just very much many some " +
    "every each both either neither none such other another within without around " +
    "about across again still always never ever they them their our your yours " +
    "mine ours yours theirs whose whom whose where whether which whilst whence " +
    "whether locked geometry continuity layout bible camera lens shot angle " +
    "frame framing aspect ratio seconds ~5s film cinematic prompt directive " +
    "system rules section block scoped visible forbidden zone view shotview")
    .split(/\s+/)
);

/** Pull distinctive content tokens from a free-form continuity / cast
 *  block. Drops stop words / framework words / numbers / very short
 *  tokens. Used by readiness to verify the LLM surfaced bible content
 *  in the prompt body. */
function extractContinuityTokens(source: string): string[] {
  if (!source) return [];
  const raw = source
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const tok of raw) {
    if (tok.length < 5) continue;
    if (CONTINUITY_STOP.has(tok)) continue;
    if (/^[0-9]/.test(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** Character nouns that must NOT be the first noun in a non-character shot.
 *  Used by the first-noun check in the readiness gate. */
const CHARACTER_NOUNS = new Set<string>([
  "woman", "women", "man", "men", "girl", "boy",
  "character", "person", "figure", "protagonist",
  "subject", "individual", "lady", "gentleman",
  "she", "he", "they",
]);

/** Light stop-words that never count as the "first noun" of a sentence. */
const FIRST_NOUN_STOP = new Set<string>([
  "the", "a", "an", "this", "that", "these", "those",
  "and", "but", "or", "yet", "so",
  "in", "on", "at", "by", "of", "to", "from", "with", "into", "over",
  "under", "near", "behind", "before", "after", "across", "around",
  "is", "are", "was", "were", "be", "been", "being",
  "static", "slow", "rapid", "subtle", "soft", "harsh", "warm", "cold",
  "deep", "shallow", "wide", "narrow", "low", "high",
  "viewed", "seen", "framed", "shot", "captured", "held",
  "approximately", "about", "exactly",
]);

/**
 * Extract the first content noun of the prompt — used by the readiness
 * gate to detect prompts that lead with a character noun. We strip the
 * leading article/adjective stack and return the first non-stop token.
 */
function firstNoun(text: string): string | null {
  const firstSentence = (text.split(/(?<=[.!?])\s+/)[0] ?? "").trim();
  // Tokenize on whitespace + punctuation; preserve hyphenated compounds.
  const tokens = firstSentence
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (const t of tokens) {
    if (t.length < 3) continue;
    if (FIRST_NOUN_STOP.has(t)) continue;
    return t;
  }
  return null;
}

/** Generic character-portrait opening patterns we refuse to lead with.
 *  Each pattern targets a recognizable "A [adj]* (woman|man|…)" lead-in,
 *  which is what the LLM defaults to when not steered. */
const CHARACTER_FIRST_OPENINGS = [
  // "A man …", "A tall man …", "A young woman in her forties …" — up to
  // three adjective tokens between the article and the noun.
  /^(?:a|an|the)\s+(?:[a-z-]+\s+){0,3}(?:woman|man|girl|boy|character|figure|person|protagonist)\b/i,
  // Bare "Woman …" / "Character …" leads.
  /^(?:woman|man|girl|boy|character|figure|person|protagonist)\s+in\s+(?:her|his|their)\b/i,
  // "in his early fifties / late forties …" leads (age-tier portrait).
  /^(?:[a-z-]+\s+){0,4}in (?:her|his|their)\s+(?:early|mid|late)\s+(?:twenties|thirties|forties|fifties|sixties|seventies)\b/i,
  // SCREENPLAY CUE leads — all-caps name + verb.
  /^[A-Z][A-Z\s]+\s+(?:sits|stands|walks|leans|looks|enters|exits|holds|watches|waits)\b/,
];

/** Key-art / publicity-still framing language that should never appear in a
 *  prestige-drama shot prompt. */
const KEY_ART_PATTERNS: RegExp[] = [
  /\b(?:perfectly )?centered\b/i,
  /\bsymmetric(?:al)?ly framed\b/i,
  /\bhero(?:ic(?:ally)?)? (?:pose|stance|posture|lit)\b/i,
  /\blit from behind\b|\bbacklit silhouette pose\b/i,
  /\blooking (?:heroically|dramatically) (?:into|at) the (?:distance|camera|horizon)\b/i,
  /\bpromotional (?:still|poster|portrait)\b/i,
  /\bkey[-\s]?art\b/i,
  /\bglamour shot\b|\bglossy portrait\b/i,
];

export function readiness(args: {
  text: string;
  negative?: string;
  model: ModelKey;
  durationSec?: number;
  aspectRatio: string;
  leadStrategy?: LeadStrategy;
  visualFrame?: string | null;
  intent?: ShotIntent;
  perspective?: ShotPerspective;
  heroImage?: string;
  heroImageMustDominate?: boolean;
  /** Cast names from the brief — used to detect "Margot sits…" openings. */
  characterNames?: string[];
  /** Authoritative Primary Image written on the brief. When set, the
   *  first sentence MUST contain a recognizable chunk of it. */
  briefPrimaryImage?: string;
  /** Interpretive warnings recorded by briefValidator at write time. */
  interpretiveWarnings?: string[];
  /** Shot tags from the brief. Used by the dominance check — an insert /
   *  detail / macro / object / BEH shot is allowed to lead with the detail
   *  because the detail IS the shot. */
  shotTags?: string[];
  /** V3.2 — camera-awareness mode + per-shot eyeline. Drives the
   *  eyeline-missing warning on close-up / character-driven shots. */
  cameraAwareness?: string;
  eyeline?: string;
  frame?: string;
  cameraFraming?: string;
  /** V3.3 — Phone Insert Mode + verbatim screen text. Drives the
   *  "verbatim screen text required" warning when a phone mode is
   *  declared but the brief didn't supply the literal text. */
  phoneInsertMode?: string;
  phoneScreenText?: string;
  /** V3.5 — Hero Image / Shot Priority. Drives the "insert + supporting
   *  detail dominates first 40%" check. heroSubject is the single noun
   *  the shot is about; forbiddenDominantDetails are nouns that must
   *  not outweigh it in the opening. */
  heroSubject?: string;
  forbiddenDominantDetails?: string[];
  /** V4.5 — distinctive tokens from the cast bible's consistency prompt
   *  (wardrobe / hair / accessories). Readiness verifies ≥ 2 of these
   *  appear in the prompt body on character shots. */
  castWardrobeTokens?: string[];
  /** V4.5 — distinctive tokens from the Location Bible + Visual World
   *  Rules. Readiness verifies ≥ 2 of these appear in the prompt body
   *  whenever a continuity directive is present. */
  locationTokens?: string[];
  /** V4.5 — true when no character performs in the shot (environment /
   *  insert-only). Skips the wardrobe-surfacing check for these shots. */
  invisible?: boolean;
  /** Stage-2 — phrases the LocationBible.setDressing.forbiddenDressing
   *  array said must NOT appear in any prompt for this location. The
   *  gate scans the prompt body for any of these tokens. */
  forbiddenDressing?: string[];
  /** Stage-2 — distinctive tokens drawn from the visible characters'
   *  per-episode wardrobe + HMU blocks. When non-empty, the gate
   *  enforces ≥ 2 surface in the prompt body. Replaces / sharpens
   *  the V4.5b generic cast-wardrobe check on episodes with the
   *  structured block. */
  episodeWardrobeTokens?: string[];
  /** V4.7 — Visible Canon enforcement. For each visible element on the
   *  brief, AT LEAST ONE distinctive canon token must appear in the
   *  output. If a visible element has no canon hit, the prompt is failed
   *  and the writer gets a per-element issue line. */
  visibleCanonRequirements?: Array<{ label: string; tokens: string[] }>;
}): ReadinessIssue {
  const issues: string[] = [];
  const t = args.text;

  // 1. Copyable as-is: non-empty, ≥ 30 chars.
  if (t.length < 30) issues.push("Final prompt is too short to be model-ready.");

  // 2. Free of broken fragments — re-run patterns on the sanitized output.
  for (const { pattern, label } of FRAGMENT_PATTERNS) {
    if (pattern.test(t)) issues.push(`Contains ${label}.`);
  }

  // 3. Model-specific shape.
  if (args.model === "midjourney") {
    if (!/--ar/i.test(t)) issues.push("Midjourney prompt missing --ar flag.");
    if (/\b(?:camera moves|panning|tracking shot|dolly in|push in)\b/i.test(t)) {
      issues.push("Midjourney prompt contains video-motion language.");
    }
  } else if (args.model === "luma" || args.model === "kling" || args.model === "veo") {
    // Accept literal "aspect"/"ratio"/"seconds" OR a numeric aspect like
    // "2.39:1" / "16:9" OR a duration like "5s" / "~5s".
    const hasAspect = /\baspect\b|\bratio\b|\b\d+(?:\.\d+)?:\d+\b/i.test(t);
    const hasDuration = /\bseconds?\b|~?\d+\s?s\b/i.test(t);
    if (!hasAspect && !hasDuration) {
      issues.push("Video prompt missing duration / aspect markers.");
    }
  }

  // 4. Concise enough for the model. Pika ≤ 60 words; others ≤ 220 words.
  const wc = t.split(/\s+/).filter(Boolean).length;
  if (args.model === "pika" && wc > 60) issues.push("Pika prompt is too long (>60 words).");
  if (args.model !== "pika" && args.model !== "midjourney" && wc > 220) {
    issues.push("Prompt exceeds 220 words.");
  }

  // 5. Aspect/duration metadata available outside the body too — required
  //    for video models so the writer can copy them into the platform UI.
  if (
    ["veo", "kling", "luma", "runway", "pika", "generic_video", "custom"].includes(args.model) &&
    args.durationSec == null
  ) {
    issues.push("Duration is unset for a video model.");
  }
  if (!args.aspectRatio) issues.push("Aspect ratio is missing.");

  // 6. Cinematography-first. Three gates (V3.8 — character-shot relaxation):
  //
  //    INSERT / PROP / OBJECT / MACRO / BEH shots
  //      → Sentence 1 must describe the Primary Image; the hero noun
  //        must be the first noun. (Unchanged — prop inserts cannot
  //        afford the model to wander.)
  //
  //    CHARACTER shots (intent === "character_driven" OR shotTags
  //    includes CHAR/CHARACTER)
  //      → Sentence 1 may include atmosphere / location / time / lighting
  //        as long as the character subject + main action also appear in
  //        the same sentence. The "first noun must be the Primary Image
  //        hero" rule is too strict — a character action shot routinely
  //        opens "A woman jolts upright in a dark bedroom at 3:17 AM…",
  //        which is correct cinema even though the noun "woman" is the
  //        first content noun. We relax for CHAR while keeping prop-
  //        insert rules tight.
  //
  //    DIALOGUE shots → also allowed to open with a character clause.
  //
  //    All other intents (composition_driven / environment_driven /
  //    transition_driven / action_driven) → still must lead with the
  //    image.
  const briefPISet = !!(args.briefPrimaryImage && args.briefPrimaryImage.trim());
  const isCharacterShot =
    args.intent === "character_driven" ||
    args.intent === "dialogue_driven" ||
    (args.shotTags ?? []).some((t) => /^char(acter)?$/i.test(t));
  const allowCharacterOpening = isCharacterShot;
  if (!allowCharacterOpening) {
    const firstSentence = (t.split(/(?<=[.!?])\s+/)[0] ?? "").trim();
    for (const re of CHARACTER_FIRST_OPENINGS) {
      if (re.test(firstSentence)) {
        issues.push(
          briefPISet
            ? `Opens with a character clause, but the brief's Primary Image is set. The first sentence MUST describe: "${args.briefPrimaryImage!.slice(0, 100)}".`
            : `Opens with a character clause but shot intent is "${args.intent ?? args.leadStrategy ?? "non-character"}". ` +
                (args.visualFrame
                  ? `Prompt must open with "${args.visualFrame}" framing.`
                  : "Prompt must open with the visual image (frame / environment / motion), not a character portrait.")
        );
        break;
      }
    }
  }

  // 6b. CHAR-shot content check. For character shots WITH a brief
  //     Primary Image set, sentence 1 must still contain BOTH the
  //     character subject AND the main action. We just don't demand
  //     the character clause come first.
  if (isCharacterShot && briefPISet) {
    const firstSentence = (t.split(/(?<=[.!?])\s+/)[0] ?? "").toLowerCase();
    const pi = (args.briefPrimaryImage ?? "").toLowerCase();
    // Pull "distinctive" tokens from the Primary Image (length ≥ 4, not
    // a stop word). Sentence 1 must contain at least 2 of them.
    const STOP = new Set(
      "the and with from into onto over under near her his their its them this that these those a an of in on at to is are was were be been being one two three some many".split(
        /\s+/
      )
    );
    const piTokens = pi
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w));
    const matched = piTokens.filter((w) => firstSentence.includes(w)).length;
    if (piTokens.length > 0 && matched < Math.min(2, piTokens.length)) {
      issues.push(
        `Sentence 1 of a character shot must include the character + main action from the Primary Image (got ${matched} of ${piTokens.length} distinctive tokens). Add the character action to the opening sentence.`
      );
    }
  }

  // 6c. Supporting detail dominates primary image.
  //     If the first content noun of the prompt is a supporting-detail
  //     noun (hand / phone / sleeve / cup / etc.) AND the brief is NOT
  //     tagged INSERT / DETAIL / MACRO / OBJECT / BEH, the detail has
  //     been promoted above the actual hero image. Fire a warning.
  //     When any of those tags ARE present, the detail IS the shot and
  //     this check is silent.
  const INSERT_TAGS = new Set(["INSERT", "DETAIL", "MACRO", "OBJECT", "BEH"]);
  const tagsUpper = (args.shotTags ?? []).map((t) => t.toUpperCase());
  const insertTagPresent = tagsUpper.some((t) => INSERT_TAGS.has(t));
  if (!insertTagPresent) {
    const SUPPORTING_DETAILS = new Set([
      "hand", "hands", "palm", "palms", "finger", "fingers",
      "thumb", "thumbs", "wrist", "wrists", "knuckle", "knuckles",
      "fingernail", "fingernails",
      "phone", "screen", "button", "keyboard", "key", "keys",
      "sleeve", "sleeves", "cuff", "cuffs", "collar", "collars",
      "hem", "hems",
      "shoe", "shoes", "heel", "heels", "sock", "socks", "boot", "boots",
      "notebook", "notebooks", "pen", "pens", "paper", "papers",
      "page", "pages",
      "cup", "cups", "mug", "mugs", "glass", "bottle", "bottles",
      "tea", "coffee", "water", "spoon", "spoons", "fork", "forks",
      "knife", "knives", "watch", "watches", "ring", "rings",
      "necklace", "bracelet", "earring", "earrings", "wallet", "wallets",
      "bag", "bags", "strap", "straps", "book", "books",
      "photograph", "photo", "photos", "letter", "letters", "card", "cards",
      "candle", "candles", "ashtray", "ashtrays", "cigarette", "cigarettes",
      "lighter", "lighters", "clock", "clocks",
      "doorknob", "doorknobs", "handle", "handles", "switch", "switches",
      "lock", "locks", "latch", "latches",
    ]);
    // Walk the opening sentence's content tokens; flag if the first
    // recognizable noun is a supporting detail.
    const firstSentence = (t.split(/(?<=[.!?])\s+/)[0] ?? "").toLowerCase();
    const tokens = (firstSentence.match(/[a-z][a-z'-]*/g) ?? []).filter(
      (w) => w.length >= 3 && !FIRST_NOUN_STOP.has(w)
    );
    const detailHit = tokens.slice(0, 5).find((w) => SUPPORTING_DETAILS.has(w));
    if (detailHit) {
      issues.push(
        `Supporting detail dominates primary image (first noun "${detailHit}"). ` +
          "Tag the brief INSERT / DETAIL / MACRO / OBJECT / BEH if the detail IS the shot, or rewrite the Primary Image so the hero image leads."
      );
    }
  }

  // 7. Anti-key-art: reject publicity-still framing language regardless of
  //    intent. A prestige-drama shot should never include "centered",
  //    "heroic pose", "lit from behind", "looking into the distance".
  for (const re of KEY_ART_PATTERNS) {
    if (re.test(t)) {
      issues.push(
        "Contains key-art / publicity-still framing language. Shot must read as a prestige-drama frame, not a promotional poster."
      );
      break;
    }
  }

  // 7b. "portrait" is reserved for shots whose perspective is explicitly
  //     portrait. Otherwise it sneaks publicity-still framing back in
  //     ("close portrait frame", "portrait shot", "portrait lighting").
  //
  //     V3.7 — negation-aware: a writer-supplied disclaimer like "rather
  //     than front-on portrait" or "not a portrait" or "no portrait-style
  //     posing" is the OPPOSITE of the failure mode this rule protects
  //     against. Scan sentence-by-sentence; skip sentences where the use
  //     of "portrait" is explicitly negated.
  if (args.perspective !== "portrait") {
    const sentences = t.split(/(?<=[.!?])\s+/);
    for (const sentRaw of sentences) {
      const sent = sentRaw.toLowerCase();
      if (!/\bportrait(?:s|-?orientation|-?lighting|-style)?\b/i.test(sent)) continue;
      // Negated? "rather than portrait", "not portrait", "no portrait",
      // "avoid portrait", "instead of portrait" → safe.
      if (
        /\b(?:rather\s+than|instead\s+of|not(?:\s+a)?|no|avoid|never|without)\b[^.!?]*\bportrait/.test(
          sent
        )
      ) {
        continue;
      }
      issues.push(
        `Contains "portrait" but shot perspective is "${args.perspective ?? "non-portrait"}". The word is reserved for shots whose perspective is explicitly portrait.`
      );
      break;
    }
  }

  // 8a. First-noun check. The first content noun of the prompt must NOT
  //     be a character noun or a known cast name. The check fires for
  //     every intent EXCEPT pure character_driven; if brief.primaryImage
  //     is set, the check fires regardless of intent (the writer's
  //     Primary Image always wins).
  //
  //     V3.8 — CHAR shots are exempt. For a character action shot the
  //     first noun is correctly "woman" / "man" / cast name; the 6b
  //     content check above already ensures sentence 1 carries the
  //     Primary Image's distinctive tokens.
  const enforceFirstNoun =
    !isCharacterShot &&
    ((args.intent && args.intent !== "character_driven") ||
      !!(args.briefPrimaryImage && args.briefPrimaryImage.trim()));
  if (enforceFirstNoun) {
    const fn = firstNoun(args.text);
    if (fn) {
      const isCharacterNoun = CHARACTER_NOUNS.has(fn);
      const isCastName = (args.characterNames ?? []).some(
        (n) => n.toLowerCase().split(/\s+/).includes(fn)
      );
      if (isCharacterNoun || isCastName) {
        issues.push(
          args.briefPrimaryImage && args.briefPrimaryImage.trim()
            ? `First noun "${fn}" is a character — the brief's Primary Image is set and must lead the prompt.`
            : `First noun "${fn}" is a character — shot intent is "${args.intent}". ` +
                "The first sentence must describe the Hero Image, not the character."
        );
      }
    }
  }

  // 8aa. Authoritative Primary Image (brief-set). When the brief carries
  //      a primaryImage, the FIRST sentence must contain a recognizable
  //      chunk of it. This is the strongest of the hero-image checks.
  //
  //      V3.8 — CHAR shots are governed by 6b instead (looser threshold:
  //      at least 2 distinctive tokens anywhere in sentence 1, no order
  //      requirement). Skipping 8aa for CHAR avoids double-fail.
  if (!isCharacterShot && args.briefPrimaryImage && args.briefPrimaryImage.trim()) {
    const firstSentence = (t.split(/(?<=[.!?])\s+/)[0] ?? "").toLowerCase();
    const piTokens = args.briefPrimaryImage
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !["with", "from", "into", "that", "this", "they", "their"].includes(w))
      .slice(0, 8);
    const matched = piTokens.filter((w) => firstSentence.includes(w)).length;
    if (piTokens.length > 0 && matched < Math.min(2, piTokens.length)) {
      issues.push(
        `Primary Image not in opening sentence: "${args.briefPrimaryImage.slice(0, 100)}". ` +
          "The first sentence MUST describe the Primary Image."
      );
    }
  }

  // 8ab. Primary Image DOMINANCE. When the brief carries a primaryImage,
  //     the first sentence MUST describe ONLY the Primary Image. No
  //     character noun, no cast name, no "she/he/they". Character
  //     references may not appear until sentence 2+.
  //
  //     V3.8 — CHAR shots are exempt. The character IS the Primary Image
  //     on a character action shot; demanding sentence 1 contain no
  //     character noun was the source of the false positive that
  //     prompted this fix.
  if (!isCharacterShot && args.briefPrimaryImage && args.briefPrimaryImage.trim()) {
    const firstSentence = (t.split(/(?<=[.!?])\s+/)[0] ?? "").trim().toLowerCase();
    // Tokenize and look for ANY character marker.
    const fsTokens = firstSentence.match(/[a-z][a-z'-]*/g) ?? [];
    const castFirstNames = (args.characterNames ?? [])
      .flatMap((n) => n.toLowerCase().split(/\s+/))
      .filter((s) => s.length >= 3);
    const characterHit = fsTokens.find(
      (t) => CHARACTER_NOUNS.has(t) || castFirstNames.includes(t)
    );
    if (characterHit) {
      issues.push(
        `Primary Image present but not dominant. Character introduced before Primary Image completed (saw "${characterHit}" in the first sentence). Sentence 1 must describe ONLY the Primary Image.`
      );
    }
  }

  // 8ac. Atmosphere-first paragraph dominance. For composition / environment
  //      / transition intents, the opening paragraph (first ~3 sentences)
  //      must read ≥ 60% environment vs character before any character
  //      reference appears.
  const ATMOSPHERE_INTENTS: Set<ShotIntent> = new Set([
    "composition_driven",
    "environment_driven",
    "transition_driven",
  ]);
  if (args.intent && ATMOSPHERE_INTENTS.has(args.intent)) {
    const opening = t.split(/(?<=[.!?])\s+/).slice(0, 3).join(" ").toLowerCase();
    const words = opening.match(/[a-z][a-z'-]*/g) ?? [];
    const ENV_VOCAB = new Set<string>([
      "window", "glass", "rain", "light", "lights", "darkness", "dawn",
      "dusk", "night", "sodium", "fog", "mist", "smoke", "shadow",
      "concrete", "asphalt", "road", "street", "city", "wilderness",
      "foliage", "branch", "branches", "leaf", "leaves", "mountain",
      "sky", "horizon", "interior", "exterior", "frame", "framing",
      "reflection", "silhouette", "negative", "space", "threshold",
      "palette", "lens", "aspect", "ratio", "static", "tracking",
      "dolly", "pan", "lit", "lighting", "amber", "blue", "grey",
      "green", "ambient", "atmosphere", "atmospheric", "pre-dawn",
      "dissolving", "fading", "passing", "moving", "anamorphic",
    ]);
    const castFirstNames2 = (args.characterNames ?? [])
      .flatMap((n) => n.toLowerCase().split(/\s+/))
      .filter((s) => s.length >= 3);
    let env = 0;
    let cast = 0;
    let firstCharIdx = -1;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (ENV_VOCAB.has(w)) env++;
      else if (CHARACTER_NOUNS.has(w) || castFirstNames2.includes(w)) {
        cast++;
        if (firstCharIdx === -1) firstCharIdx = i;
      }
    }
    const total = env + cast;
    if (total >= 8) {
      const ratio = env / total;
      if (ratio < 0.6) {
        issues.push(
          `Atmosphere-first paragraph too character-heavy (${Math.round(ratio * 100)}% environment vs ${Math.round((1 - ratio) * 100)}% character). Environment must occupy at least 60% of the opening paragraph before any character reference.`
        );
      }
      // Also: when env < 4 hits, character is showing up too early.
      if (firstCharIdx >= 0 && firstCharIdx < 6 && env < 4) {
        issues.push(
          "Character reference appears before the environment is established. Build the world first."
        );
      }
    }
  }

  // 8ad. Brief-write-time interpretive warnings. If the validator had to
  //      strip interpretive language from the source brief, surface a
  //      single rolled-up issue so the writer knows the brief was the
  //      problem (not the prompt). Detailed phrases are on brief.interpretiveWarnings.
  if ((args.interpretiveWarnings ?? []).length > 0) {
    const sample = (args.interpretiveWarnings ?? []).slice(0, 3).join("; ");
    issues.push(
      `Brief contains interpretation instead of photography (${args.interpretiveWarnings!.length} phrase(s) stripped at write time): ${sample}${args.interpretiveWarnings!.length > 3 ? "; …" : ""}`
    );
  }

  // 8b. Hero-image dominance. For non-character / non-dialogue intents, the
  //    Hero Image must surface in the first two sentences AND occupy a
  //    meaningful share of the prompt (≥ 30% of word count loosely tied
  //    to image / environment / framing vocabulary).
  if (args.heroImageMustDominate && args.heroImage) {
    const firstTwo = t.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    // Pick the most distinctive 2–4 token phrase from the heroImage and
    // require its presence in the opening two sentences.
    const heroTokens = args.heroImage
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4 && !["with", "from", "into", "that", "this"].includes(w))
      .slice(0, 6);
    const matched = heroTokens.filter((w) => firstTwo.toLowerCase().includes(w)).length;
    if (heroTokens.length > 0 && matched < Math.min(2, heroTokens.length)) {
      issues.push(
        `Hero Image not present in opening: "${args.heroImage.slice(0, 80)}…". ` +
          "The Hero Image must surface in the first two sentences."
      );
    }
  }

  // V3.2 — Eyeline-missing warning. Close-up / eye-level / character-
  // driven shots where the brief did NOT specify an eyeline AND the
  // prompt body doesn't mention the eyeline get a warning. The default-
  // observational rule already enforces no-direct-lens; this warning
  // tells the writer to anchor the eyeline so the shot reads on screen.
  const directGazeMode =
    args.cameraAwareness === "direct_to_camera" ||
    args.cameraAwareness === "POV_character" ||
    args.cameraAwareness === "phone_selfie" ||
    args.cameraAwareness === "video_call" ||
    args.cameraAwareness === "confession_camera" ||
    args.cameraAwareness === "surveillance_camera";
  // Skip the entire eyeline check on invisible / insert shots — there's
  // no character to anchor an eyeline on.
  if (!directGazeMode && !args.invisible) {
    const f = (args.frame ?? "").toLowerCase();
    const cf = (args.cameraFraming ?? "").toLowerCase();
    const closeOrEyeLevel =
      /close[- ]?up|ecu|extreme close|cu\b|eye[- ]?level/.test(f) ||
      /close[- ]?up|ecu|extreme close|cu\b|eye[- ]?level/.test(cf) ||
      args.perspective === "portrait" ||
      args.intent === "character_driven" ||
      args.intent === "dialogue_driven";
    const hasEyelineField = (args.eyeline ?? "").trim().length > 0;
    const promptMentionsEyeline =
      /\beye(line|s)?\b|\boff[- ]?camera\b|\boff[- ]?frame\b|\blooks?\s+(toward|down|away|past)\b|\bnot\s+(into|at)\s+the\s+lens\b/i.test(
        args.text
      );
    if (closeOrEyeLevel && !hasEyelineField && !promptMentionsEyeline) {
      issues.push(
        "Eyeline missing — prompt may cause direct camera gaze. Set the brief's eyeline field or rewrite so the subject's eyeline is motivated off-camera."
      );
    }
  }

  // V3.5 — Hero Image / Shot Priority. When the brief declares a
  // heroSubject (and especially when this is an INSERT shot), the
  // OPENING 40% of the prompt must mention the hero subject more times
  // than any single forbidden supporting detail. Stops "supporting
  // detail dominates primary image" failures cleanly: now keyed off the
  // explicit hero subject, not a noun-heuristic.
  const heroSubject = (args.heroSubject ?? "").trim().toLowerCase();
  if (heroSubject) {
    const stripped = args.text.replace(/--ar\s+\S+|--stylize\s+\S+/g, "");
    const words = stripped.split(/\s+/).filter(Boolean);
    const cutoff = Math.max(8, Math.floor(words.length * 0.4));
    const opening = words.slice(0, cutoff).join(" ").toLowerCase();
    const countOf = (n: string) => {
      const re = new RegExp(`\\b${n.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}s?\\b`, "gi");
      const m = opening.match(re);
      return m ? m.length : 0;
    };
    const heroCount = countOf(heroSubject);
    // If hero is missing in the opening, fail outright.
    if (heroCount === 0) {
      issues.push(
        `Hero subject "${heroSubject}" missing from the opening 40% of the prompt. The first ~${cutoff} words must establish the hero.`
      );
    } else {
      // Any forbidden detail that appears more than the hero in the
      // opening 40% means the supporting detail is dominating.
      const forbiddens = args.forbiddenDominantDetails ?? [];
      for (const f of forbiddens) {
        const n = f.trim().toLowerCase();
        if (!n) continue;
        const c = countOf(n);
        if (c > heroCount) {
          issues.push(
            `Supporting detail "${n}" appears ${c}× vs hero "${heroSubject}" ${heroCount}× in the opening 40%. The hero must dominate.`
          );
        }
      }
    }
  }

  // V3.3 — Phone Insert Mode warnings.
  if (args.phoneInsertMode && args.phoneInsertMode !== "none") {
    const hasText = (args.phoneScreenText ?? "").trim().length > 0;
    if (!hasText) {
      issues.push(
        "Verbatim screen text required — phone insert mode is set but the brief's phoneScreenText field is empty. The model will otherwise invent message text."
      );
    }
    // Phone-insert shots must NOT lead with a character clause; the
    // phone screen is the hero.
    const first = (args.text.split(/(?<=[.!?])\s+/)[0] ?? "").toLowerCase();
    if (/^(a\s+(young\s+)?woman|a\s+(young\s+)?man|maya|she\s+|he\s+)/i.test(first)) {
      issues.push(
        "Phone insert opens with a character clause. The phone screen must be the first noun in the prompt."
      );
    }
  }

  // V4.5 — Continuity surfacing. Verifies the LLM actually expressed
  // the cast bible and location bible in the prompt body. Without this
  // check the model treats the bibles as constraints to respect but
  // not as content to express — Maya's wardrobe gets elided to "a
  // figure" and Maya's bedroom collapses to "the bedroom".

  // V4.5a — character abstraction ban. On character-visible shots, the
  // body must not call the principal "a figure" / "a person" /
  // "someone" / "the protagonist" — the cast bible exists so the
  // shot has a named, wardrobe-locked subject.
  if (!args.invisible) {
    const ABSTRACT_OPENINGS = [
      /\b(?:a|an|the)\s+(?:lone\s+|solitary\s+)?figure\b/i,
      /\b(?:a|an|the)\s+person\b/i,
      /\bsomeone\b/i,
      /\b(?:a|an|the)\s+(?:lone\s+)?silhouette\b/i,
      /\bthe\s+protagonist\b/i,
      /\bthe\s+(?:main\s+)?character\b/i,
      /\bthe\s+subject\b/i,
    ];
    for (const re of ABSTRACT_OPENINGS) {
      if (re.test(args.text)) {
        issues.push(
          `Character abstracted to "${(args.text.match(re) ?? [""])[0]}". The cast bible provides a named, wardrobe-locked subject — use the character's name or a wardrobe-locked descriptor (e.g. "shoulder-length dark brown hair, pale grey sleep shirt") instead.`
        );
        break;
      }
    }
  }

  // V4.5b — wardrobe / identity surfacing. The cast bible's
  // consistency prompt carries distinctive wardrobe / hair / accessories
  // (extracted at compose time into castWardrobeTokens). The body must
  // contain ≥ 2 of them so continuity persists shot-to-shot.
  if (!args.invisible && (args.castWardrobeTokens?.length ?? 0) >= 4) {
    const body = args.text.toLowerCase();
    const matched = (args.castWardrobeTokens ?? []).filter((t) =>
      body.includes(t)
    ).length;
    if (matched < 2) {
      const sample = (args.castWardrobeTokens ?? []).slice(0, 6).join(", ");
      issues.push(
        `Cast bible not surfaced (${matched} / ≥ 2 wardrobe-identity tokens present). Add details from the cast bible to the body: ${sample}…`
      );
    }
  }

  // V4.5c — location / production design surfacing. The Location
  // Bible + Visual World Rules carry specific room geometry, palette,
  // material, lighting practical details (extracted into
  // locationTokens). The body must contain ≥ 2 of them so the
  // prompt feels like THIS specific room and not "a bedroom".
  if ((args.locationTokens?.length ?? 0) >= 4) {
    const body = args.text.toLowerCase();
    const matched = (args.locationTokens ?? []).filter((t) =>
      body.includes(t)
    ).length;
    if (matched < 2) {
      const sample = (args.locationTokens ?? []).slice(0, 6).join(", ");
      issues.push(
        `Production design not surfaced (${matched} / ≥ 2 location / palette / material tokens present). Anchor the prompt in THIS specific room — add specifics from the Location Bible / Visual World Rules: ${sample}…`
      );
    }
  }

  // V4.6a — Art-dressing forbidden-drift gate. Negation-aware (Stage 3.1)
  // — a phrase wrapped in "no X" / "without X" / "avoid X" / "not X" /
  // "never X" / "no additional X" is the OPPOSITE of drift. We split
  // the prompt body into clauses and skip any clause that explicitly
  // negates the forbidden phrase.
  if ((args.forbiddenDressing?.length ?? 0) > 0) {
    // Split on commas, periods, semicolons, em-dashes — clause boundaries.
    const clauses = args.text
      .toLowerCase()
      .split(/[.;,——]| - /)
      .map((c) => c.trim())
      .filter(Boolean);
    const hits: string[] = [];
    for (const phrase of args.forbiddenDressing ?? []) {
      const p = phrase.toLowerCase().trim();
      if (!p) continue;
      const re =
        p.includes(" ") || p.length > 12
          ? new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
          : new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i");
      let drifted = false;
      for (const clause of clauses) {
        if (!re.test(clause)) continue;
        // Negation guard — accept "no X", "without X", "avoid X",
        // "not X", "never X", "no additional X", "no extra X".
        const negated =
          /\b(?:no|without|avoid|not|never|none|free of|no\s+(?:additional|extra|further|other))\b[^.]*\b/i.test(
            clause
          ) && new RegExp(`\\b(?:no|without|avoid|not|never|no\\s+additional|no\\s+extra)\\b[^.]*?${re.source}`, "i").test(clause);
        if (!negated) {
          drifted = true;
          break;
        }
      }
      if (drifted) hits.push(phrase);
    }
    if (hits.length > 0) {
      issues.push(
        `Art-dressing drift — prompt introduces forbidden item(s) from the Location Bible's setDressing.forbiddenDressing list: ${hits.slice(0, 5).join("; ")}.`
      );
    }
  }

  // V4.6b — Wardrobe-by-episode gate (Stage 2). When the cast bible has
  // wardrobeByEpisode[N] / hmuByEpisode[N] for THIS shot's episode, the
  // prompt body must surface at least 2 distinctive tokens drawn from
  // those structured blocks. Replaces / sharpens the V4.5b cast wardrobe
  // check whenever per-episode data exists.
  if (!args.invisible && (args.episodeWardrobeTokens?.length ?? 0) >= 4) {
    const body = args.text.toLowerCase();
    const matched = (args.episodeWardrobeTokens ?? []).filter((t) =>
      body.includes(t)
    ).length;
    if (matched < 2) {
      const sample = (args.episodeWardrobeTokens ?? []).slice(0, 6).join(", ");
      issues.push(
        `Episode wardrobe/HMU not surfaced (${matched} / ≥ 2 EP-specific tokens present). Add this episode's wardrobe + HMU details from the cast bible: ${sample}…`
      );
    }
  }

  // V4.7 — Visible Canon enforcement (Stage 3.1). For EACH visible
  // element on the brief, AT LEAST ONE distinctive canon token from
  // that element's approved descriptor must surface in the prompt.
  // This catches the case where the LLM elides a visible element
  // entirely (e.g. doesn't mention the nightstand at all on a clock
  // insert) or replaces specific canon ("dark walnut") with a generic
  // word ("wood").
  if ((args.visibleCanonRequirements?.length ?? 0) > 0) {
    const body = args.text.toLowerCase();
    const misses: string[] = [];
    for (const req of args.visibleCanonRequirements ?? []) {
      if (req.tokens.length === 0) continue;
      const matched = req.tokens.filter((t) => body.includes(t));
      if (matched.length === 0) {
        misses.push(
          `"${req.label}" (needed any of: ${req.tokens.slice(0, 4).join(", ")})`
        );
      }
    }
    if (misses.length > 0) {
      issues.push(
        `Visible Canon — ${misses.length} visible element(s) not surfaced with approved canon detail: ${misses.slice(0, 4).join("; ")}${misses.length > 4 ? "…" : ""}`
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

// --- Composer entry point --------------------------------------------------

export async function composePrompt(input: ComposerInput): Promise<ComposerOutput> {
  const {
    brief,
    model,
    profile,
    ingredients,
    productionRules,
    notes,
    durationSec,
    aspectRatio,
    castLibrary,
    continuityDirective,
    visibleCanonRequirements,
    canonReferences,
  } = input;

  const invisible = characterIsInvisible(brief);
  // Cast resolution priority (Stage 2):
  //   1. Per-episode wardrobeByEpisode[N] + hmuByEpisode[N] when the
  //      brief carries an episodeNumber AND the bible has matching
  //      entries. This is the most specific signal — the writer has
  //      explicitly approved this character's look for THIS episode.
  //   2. Fall back to the flat characterConsistencyPrompt (project-level).
  //   3. Fall back to compressed extraction from the brief itself.
  //
  // Voice-only / text-only characters are forced invisible so we never
  // generate a body for them (Daniel in EP01).
  const epKey =
    brief.episodeNumber != null ? String(brief.episodeNumber) : null;
  const castLine = invisible
    ? "No visible character performance; environment / transition shot only."
    : brief.characters
        .map((c) => {
          const vb = castLibrary?.get(c.name.toUpperCase());
          if (vb?.presenceType === "voice_only" || vb?.presenceType === "text_only") {
            return "";
          }
          // Stage-2 per-episode block, when the bible has it.
          const epW = epKey ? vb?.wardrobeByEpisode?.[epKey] : undefined;
          const epH = epKey ? vb?.hmuByEpisode?.[epKey] : undefined;
          if (epW || epH) {
            const parts: string[] = [c.name];
            if (epH?.hairCondition) parts.push(epH.hairCondition);
            if (epH?.makeupState) parts.push(epH.makeupState);
            if (epH?.faceMarks) parts.push(epH.faceMarks);
            if (epW?.top) parts.push(epW.top);
            if (epW?.bottom) parts.push(epW.bottom);
            if (epW?.accessories) parts.push(epW.accessories);
            if (epW?.footwear) parts.push(epW.footwear);
            // Anchor the base identity with the consistency prompt so the
            // model still gets project-level locks (build, posture, etc.).
            if (vb?.consistencyPrompt && vb.consistencyPrompt.trim()) {
              parts.push(vb.consistencyPrompt.trim());
            }
            return parts.filter(Boolean).join(" — ");
          }
          if (vb?.consistencyPrompt && vb.consistencyPrompt.trim()) {
            return vb.consistencyPrompt.trim();
          }
          return compressCharacter(c.name, c.description, c.wardrobe);
        })
        .filter(Boolean)
        .join("; ");
  // Reference image URLs for any visible characters that have one. These
  // are surfaced to the LLM as a hint and threaded into image-to-video
  // prompts downstream (Midjourney --cref, Kling/Runway/Luma reference).
  // Prefer the writer-approved canonical URL over the in-flight candidate.
  const characterReferenceImages = invisible
    ? []
    : brief.characters
        .map((c) => {
          const entry = castLibrary?.get(c.name.toUpperCase());
          const url = entry?.approvedReferenceImageUrl || entry?.referenceImageUrl;
          return url ? { name: c.name, url } : null;
        })
        .filter((x): x is { name: string; url: string } => x !== null);

  // V3.1 — structured reference metadata. The UI uses this to surface
  // per-platform copy buttons (Midjourney --cref · Kling Element ID ·
  // Runway image-to-video) without having to re-parse the prompt prose.
  const referenceMetadata: PromptReferenceMetadata = {
    characters: invisible
      ? []
      : brief.characters
          .map((c) => {
            const entry = castLibrary?.get(c.name.toUpperCase());
            if (!entry) return null;
            const imageUrl =
              entry.approvedReferenceImageUrl ?? entry.referenceImageUrl ?? null;
            const klingElementId = entry.klingElementId ?? null;
            const multiAngle = entry.klingReferenceImages ?? [];
            // If the character has NO reference of any kind, omit it from
            // the metadata so the UI doesn't surface an empty card.
            if (!imageUrl && !klingElementId && multiAngle.length === 0) return null;
            return {
              name: c.name,
              platform: entry.referencePlatform ?? null,
              imageUrl,
              klingElementId,
              klingElementName: entry.klingElementName ?? null,
              multiAngle,
            };
          })
          .filter(
            (x): x is PromptReferenceMetadata["characters"][number] => x !== null
          ),
    // Stage 4 — pass through the engine-resolved approved canon refs.
    canonReferences: (canonReferences ?? []).length > 0 ? canonReferences : undefined,
  };

  const prefer = (productionRules?.prefer ?? []).slice(0, 6);
  const avoid = (productionRules?.avoid ?? []).slice(0, 6);

  // Cinematography-first decision via the Shot Intent Classifier. Done
  // BEFORE the LLM so we hand the model an explicit intent, composition
  // weight, character weight, and a verbatim opening directive.
  const classification = classifyShotIntent(brief);
  const intent = classification.intent;
  const visualFrame = classification.frame;
  const clauseOrder = INTENT_ORDER[intent].join(" → ");
  const openingRule = openingDirective(classification);

  // Visual hierarchy: Hero Image, Hero Subject, Secondary Elements.
  // The Hero Image must occupy ≥ 50% of the prompt's visual attention
  // for every intent except character_driven / dialogue_driven.
  //
  // If the brief carries an explicit primaryImage (written by the shotlist
  // agent or the writer), that's the authoritative Hero Image — use it
  // verbatim. Otherwise derive from frame + motif + location.
  const derived = extractVisualHierarchy(brief, classification);
  const hierarchy: VisualHierarchy = brief.primaryImage?.trim()
    ? { ...derived, heroImage: brief.primaryImage.trim() }
    : derived;

  // Shot perspective: observational by default for SELVAJE-style prestige
  // drama. Overrides come from brief cues (POV / handheld / dream / memory).
  const perspective = chooseShotPerspective(brief, classification, prefer);
  const perspectiveRule = PERSPECTIVE_DIRECTIVE[perspective];

  // Map the 6-intent classification to the binary lead strategy the
  // readiness gate uses for its first-sentence check. Composition,
  // transition, environment, and action shots must NOT open with a
  // character portrait; dialogue + character shots may.
  const leadStrategy: LeadStrategy =
    intent === "composition_driven" || intent === "transition_driven"
      ? "composition"
      : intent === "environment_driven" || intent === "action_driven"
      ? "environment"
      : "character";

  // Whether the Hero Image must dominate the prompt (≥ 50% attention).
  const heroImageDominant =
    intent !== "character_driven" && intent !== "dialogue_driven";

  // ----------------------------------------------------------------------
  // Camera-awareness / eyeline. Default is observational — the camera is
  // a hidden observer, characters never look into the lens. Exceptions
  // (direct_to_camera, POV_character, phone_selfie, video_call,
  // confession_camera, surveillance_camera) must be explicitly declared
  // on the brief.
  //
  // The default fixes a recurring failure mode where close-up / eye-
  // level shots produced direct-to-lens performances even when the scene
  // didn't call for it (e.g. EP01 SH01: "Maya looks into the lens"
  // despite the brief saying she's reacting to the phone buzz).
  // ----------------------------------------------------------------------
  type CameraAwareness =
    | "observational_default"
    | "direct_to_camera"
    | "POV_character"
    | "surveillance_camera"
    | "phone_selfie"
    | "video_call"
    | "confession_camera";
  const cameraAwareness: CameraAwareness =
    (brief.cameraAwareness as CameraAwareness | undefined) ?? "observational_default";
  const directGazeAllowed =
    cameraAwareness === "direct_to_camera" ||
    cameraAwareness === "POV_character" ||
    cameraAwareness === "phone_selfie" ||
    cameraAwareness === "video_call" ||
    cameraAwareness === "confession_camera" ||
    cameraAwareness === "surveillance_camera";
  const eyelineText = (brief.eyeline ?? "").trim();
  const eyelineDirective = invisible
    ? ""
    : directGazeAllowed
    ? `CAMERA AWARENESS — DIRECT GAZE PERMITTED (mode: ${cameraAwareness.replace(/_/g, " ")}). ${
        cameraAwareness === "POV_character"
          ? "This shot is the POV of another character; the subject may meet the camera as if meeting their eyes."
          : cameraAwareness === "phone_selfie"
          ? "Selfie / vlog framing — subject addresses the lens directly."
          : cameraAwareness === "video_call"
          ? "Video call framing — subject's gaze on the lens is read as eye contact with the other party."
          : cameraAwareness === "confession_camera"
          ? "Confessional / interview framing — subject speaks toward the lens."
          : cameraAwareness === "surveillance_camera"
          ? "Surveillance framing — subject may or may not register the camera; treat the lens as a fixed sentinel."
          : "Direct-to-camera performance permitted on this shot."
      }`
    : [
        "CAMERA AWARENESS — OBSERVATIONAL (default).",
        "The camera is a hidden observer. The subject must NOT look into",
        "the lens. The subject's eyeline must stay off-camera, motivated",
        "by the scene action (phone, door, window, off-frame sound, etc.).",
        "Do NOT produce a direct-to-lens performance.",
        "Do NOT produce selfie / vlog / influencer / confession framing.",
        "Do NOT have the subject acknowledge or address the camera.",
        eyelineText
          ? `Eyeline this shot: ${eyelineText}`
          : "No eyeline specified on brief — anchor the subject's eyeline off-camera to the strongest motivated source in the scene (phone, doorway, off-frame movement, sound source).",
      ].join("\n");

  // Close-up / eye-level shots get a defensive camera-angle nudge unless
  // the brief explicitly authorized a direct-to-camera mode. This avoids
  // the default "Maya looks dead-center into the lens" failure mode.
  const isCloseOrEyeLevel = (() => {
    const f = (brief.frame ?? "").toLowerCase();
    const cf = (brief.cameraFraming ?? "").toLowerCase();
    return (
      /close[- ]?up|ecu|extreme close|cu\b|eye[- ]?level/.test(f) ||
      /close[- ]?up|ecu|extreme close|cu\b|eye[- ]?level/.test(cf) ||
      perspective === "portrait"
    );
  })();
  const angleNudge =
    !invisible && isCloseOrEyeLevel && !directGazeAllowed
      ? [
          "CAMERA ANGLE — close-up / eye-level shot, observational mode.",
          "Place the camera off-axis to break any default direct-stare framing.",
          "Choose ONE of: three-quarter angle · over-the-shoulder · side-",
          "observational angle · slight off-axis position · eyeline off-",
          "frame toward the motivated action source. Lens may be eye-level,",
          "but the subject's face must not square to the lens.",
        ].join("\n")
      : "";

  // ----------------------------------------------------------------------
  // V3.3 — Phone Insert Mode. When the brief declares one of the six
  // phone modes the composer enforces a literal-screen rendering: tight
  // crop on the screen, verbatim text only, minimal UI chrome, no
  // invented notifications or fake app icons, no surrounding room
  // unless explicitly opted in. The mode also seeds the negative prompt
  // with the common phone-render failure modes (fake notifications,
  // glowing app grid, blurry illegible text, etc.).
  // ----------------------------------------------------------------------
  type PhoneInsertMode =
    | "none"
    | "lock_screen"
    | "text_thread"
    | "incoming_call"
    | "outgoing_call"
    | "typing_screen"
    | "photo_attachment_screen";
  const phoneInsertMode: PhoneInsertMode =
    (brief.phoneInsertMode as PhoneInsertMode | undefined) ?? "none";
  const phoneActive = phoneInsertMode !== "none";
  const phoneScreenText = (brief.phoneScreenText ?? "").trim();
  const phoneShowSurroundings = brief.phoneShowSurroundings === true;
  const PHONE_MODE_DIRECTIVE: Record<Exclude<PhoneInsertMode, "none">, string[]> = {
    lock_screen: [
      "Render an iPhone-style LOCK SCREEN: large central clock display at",
      "top, single notification banner below it. No app icons, no widget",
      "grid, no music controls, no flashlight/camera shortcuts. Background",
      "is a plain dark or muted lock-screen wallpaper.",
    ],
    text_thread: [
      "Render an iPhone-style MESSAGING APP screenshot. Contact name in",
      "the top header rendered EXACTLY as specified. Message bubbles",
      "aligned correctly (incoming left, outgoing right). Standard system",
      "font, no emoji unless the verbatim text includes them, no read",
      "receipts unless specified.",
    ],
    incoming_call: [
      "Render an iPhone-style INCOMING CALL screen: contact name + call",
      "label ('mobile' / 'iPhone') centered, large round Accept and",
      "Decline buttons at the bottom. No keypad, no remind-me, no",
      "message-reply quick buttons unless specified.",
    ],
    outgoing_call: [
      "Render an iPhone-style OUTGOING / IN-PROGRESS CALL screen: contact",
      "name at top, 'Calling…' or a running timer below, mute / keypad /",
      "speaker / FaceTime / contacts / end-call buttons in a 2x3 grid.",
      "Status bar normal.",
    ],
    typing_screen: [
      "Render an iPhone-style MESSAGING THREAD with the on-screen keyboard",
      "visible at the bottom. Text-input field above the keyboard shows",
      "the cursor and any verbatim in-progress text. Typing indicator",
      "(three dots) only if the brief specifies it.",
    ],
    photo_attachment_screen: [
      "Render an iPhone-style messaging thread with a PHOTO ATTACHMENT",
      "expanded to fill most of the message column. The attached image",
      "must read as a photograph, NOT as a fake UI screenshot of another",
      "app. Caption / send button only if specified.",
    ],
  };
  const phoneInsertDirective = phoneActive
    ? [
        "PHONE INSERT MODE — non-negotiable.",
        `Mode: ${phoneInsertMode.toUpperCase().replace(/_/g, " ")}.`,
        ...PHONE_MODE_DIRECTIVE[phoneInsertMode as Exclude<PhoneInsertMode, "none">],
        "",
        "GLOBAL PHONE-INSERT RULES:",
        "  • The phone screen is the HERO of the frame. Tight crop.",
        "  • On-screen text MUST be legible. Sharp UI rendering. No motion blur.",
        "  • Render ONLY the UI elements the mode requires above — nothing else.",
        "  • Do NOT invent extra notifications, banners, widgets, or app icons.",
        "  • Do NOT invent prior message history beyond what the verbatim text",
        "    specifies. The thread shows the verbatim text and nothing more.",
        "  • Hand / thumb is SECONDARY: at most a partial fingertip at the",
        "    edge if a tap is being shown; never centered, never dominant.",
        phoneShowSurroundings
          ? "  • Surroundings: lightly visible (room, bedding, etc.) per the brief."
          : "  • Surroundings: NONE. No room, no bedding, no body, no face — frame is filled by the phone screen.",
        "  • Screen glow is the dominant light source.",
        phoneScreenText
          ? `  • Verbatim screen text (render EXACTLY as written, no paraphrase):\n    """\n    ${phoneScreenText.replace(/\n/g, "\n    ")}\n    """`
          : "  • Verbatim screen text was NOT supplied — invent NOTHING. Use",
        phoneScreenText
          ? ""
          : "    a placeholder rendering with the contact name only and no",
        phoneScreenText ? "" : "    fabricated message text.",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // Fix #1 — Writer Steering Directive. When the writer/supervisor
  // supplies regen notes, promote them to a TOP-OF-SYSTEM-PROMPT block
  // that explicitly outranks every other rule below. Burying notes inside
  // the userPayload JSON (as `writerSteering`) lets the LLM treat them as
  // soft hints; this block makes them a binding directive.
  const writerSteeringBlock =
    notes && notes.trim()
      ? [
          "WRITER STEERING — HIGHEST PRIORITY:",
          "The writer/supervisor has issued explicit steering for THIS regeneration.",
          "These instructions OUTRANK every other composition rule below — they",
          "represent a human override of the default composition pipeline.",
          "",
          "Verbatim steering notes:",
          `>>> ${notes.trim()} <<<`,
          "",
          "Apply these notes in ORDER, even when they contradict other rules below.",
          "If a steering note conflicts with another directive (word count, hero image,",
          "clause order, etc.), the steering note wins. If you cannot honor a steering",
          "note while keeping the output filmable, mention the conflict in usageNotes —",
          "but still try the steering note first.",
          "",
          "================================================================",
          "",
        ]
      : [];

  const system = [
    ...writerSteeringBlock,
    "You are the PROMPT COMPOSER for an AI-assisted cinematic production pipeline.",
    "You convert a structured Master Shot Brief into ONE clean, model-ready prompt the",
    "writer can copy directly into the target platform. The brief is the source of truth.",
    "",
    "HARDEST RULE — FILMABLE-ONLY:",
    "Final prompts must contain ONLY filmable information. Never:",
    "  • Profession (therapist, surgeon, cop, journalist, …).",
    "  • Psychology / inner state (grief, trauma, perceptive, observant as trait, restraint as feeling, haunted).",
    "  • Relationships, backstory, dates ('eighteen months out', 'after the loss', 'her daughter's death').",
    "  • Story context ('knows the truth', 'in mourning', 'the most perceptive observer').",
    "If something is not visible on screen, it does NOT belong in the prompt.",
    "Visible attributes ARE allowed (age, gender presentation, build, hair, eyes, skin, wardrobe, posture).",
    "",
    "SECOND HARDEST RULE — SHOT INTENT CLASSIFIER:",
    `This shot's intent has been classified as: ${intent.toUpperCase().replace(/_/g, " ")}.`,
    `Reason: ${classification.reason}.`,
    `Composition Weight: ${classification.compositionWeight}  /  Character Weight: ${classification.characterWeight}.`,
    "",
    `Required clause order for this intent: ${clauseOrder}.`,
    "Compose the prompt in that order. Do not skip clauses. Do not invert.",
    "",
    "FORBIDDEN OPENINGS unless the intent is character_driven or dialogue_driven:",
    "  • 'A woman in her [age] …'",
    "  • 'A man [doing] …'",
    "  • 'Character …' / 'The protagonist …'",
    "  • Generic character-portrait phrasing of any kind.",
    "",
    "Composition Weight signals (what counts as a strong visual image):",
    "  window · glass · reflection · silhouette · shadow · doorway · frame ·",
    "  mirror · negative space · foreground/background separation · reveal ·",
    "  threshold · POV · OTS · arch · curtain · foliage / smoke / mist veil.",
    "If Composition Weight > Character Weight (as above), the prompt MUST",
    "begin with the image, not the person. The character enters as a placed",
    "figure inside the frame.",
    "",
    perspective === "portrait"
      ? ""
      : `BANNED WORD — "portrait": this shot's perspective is "${perspective}", not portrait. Do NOT use "portrait" anywhere in the output (no "close portrait frame", "portrait shot", "portrait lighting"). Use "close-up", "medium shot", "framing", or "lens" instead.`,
    perspective === "portrait" ? "" : "",
    openingRule,
    "",
    "VISUAL HIERARCHY — non-negotiable:",
    `  Primary Image    : ${hierarchy.heroImage || "(derive from environment + frame)"}`,
    `  Hero Subject     : ${hierarchy.heroSubject || "(none — environment shot)"}`,
    `  Secondary        : ${hierarchy.secondary.join("; ") || "(none)"}`,
    brief.primaryImage?.trim()
      ? `  → The Primary Image is set on the brief: "${brief.primaryImage.trim()}"`
      : "",
    brief.primaryImage?.trim()
      ? "  → THE FIRST SENTENCE OF THE PROMPT MUST CONTAIN ONLY THE PRIMARY"
      : "",
    brief.primaryImage?.trim()
      ? "    IMAGE. No character noun, no cast first name, no 'she/he/they',"
      : "",
    brief.primaryImage?.trim()
      ? "    no 'A woman / A man / The character / The protagonist'."
      : "",
    brief.primaryImage?.trim()
      ? "  → Character references may not appear until sentence 2 or later."
      : "",
    brief.primaryImage?.trim()
      ? "  → For atmosphere-first shots, environment must occupy at least 60%"
      : "",
    brief.primaryImage?.trim()
      ? "    of the opening paragraph before any character is introduced."
      : "",
    brief.primaryImage?.trim()
      ? "  → Open with the Primary Image verbatim, then expand the same image"
      : "",
    brief.primaryImage?.trim()
      ? "    with sensory texture in the same sentence."
      : "",
    "",
    "PRIMARY IMAGE — FIRST SENTENCE RULE:",
    heroImageDominant
      ? "  → The FIRST SENTENCE of the prompt MUST describe the Hero Image."
      : "  → The Hero Subject may anchor the prompt; the Hero Image still grounds it.",
    heroImageDominant
      ? "  → The FIRST NOUN of the prompt MUST NOT be 'woman', 'man', 'character',"
      : "",
    heroImageDominant
      ? "    'person', 'figure', 'protagonist', or a cast member's first name."
      : "",
    heroImageDominant
      ? "  → Character description may not appear until AFTER the Hero Image is"
      : "",
    heroImageDominant
      ? "    established (typically sentence 2 or later)."
      : "",
    "",
    "Example Hero Images (for shape — match the spirit, not the words):",
    "  • Rear-window arrival : 'city lights dissolving through rain-hazed glass.'",
    "  • Pool shot           : 'a clothed woman at the edge of a luxury pool she",
    "                          refuses to enter.' (subject embedded inside image)",
    "  • Cloud-forest shot   : 'figures partially obscured by mist and foliage.'",
    "",
    "  → Priority: Hero Image → Composition → Environment → Character → Props.",
    "  → Never collapse the shot into a 'subject in location' description.",
    "  → The audience should remember the IMAGE first and the character second.",
    "",
    `SHOT PERSPECTIVE: ${perspective.toUpperCase()}`,
    perspectiveRule,
    "",
    "ANTI-KEY-ART TEST:",
    "If the generated image could be mistaken for a Netflix key-art poster",
    "(hero centered, lit from behind, looking heroically into the distance,",
    "promotional symmetry), the prompt FAILS. The generated image must read",
    "as a frame extracted from a prestige limited series episode — layered,",
    "off-center, observational.",
    "",
    "OBSERVABLE-BEHAVIOR RULE — non-negotiable:",
    "Describe only what a camera can record. No interpretation. No emotional",
    "labels. No screenplay-analysis adjectives. The model infers emotion",
    "FROM the image; we do not tell it the emotion.",
    "",
    "FORBIDDEN INTERPRETIVE LANGUAGE (never use these or similar):",
    "  • effortful calm / clinical stillness / composed silence",
    "  • expression withheld / withheld expression / unreadable face",
    "  • control worn like clothing / wears X like Y",
    "  • restrained / precise / composed / measured / guarded as inner states",
    "  • emotionally restrained / internally conflicted",
    "  • watchful stillness / quiet intensity",
    "  • observational framing / non-promotional / prestige-drama / key-art",
    "  • stoic gaze / impassive face / inscrutable expression",
    "",
    "REPLACE WITH OBSERVABLE BEHAVIOR. Examples:",
    "  bad : 'effortful calm'                  good: 'hands remain open on her thighs'",
    "  bad : 'expression withheld'             good: 'eyes fixed on the passing darkness'",
    "  bad : 'clinical stillness'              good: 'she does not move'",
    "  bad : 'composed restraint'              good: 'shoulders square, breathing slow'",
    "  bad : 'watchful intensity'              good: 'her gaze tracks the doorway'",
    "  bad : 'wears control like a coat'       good: 'jaw set, hands folded in her lap'",
    "",
    "If you cannot photograph it, do not write it.",
    "",
    // V3.4 — Continuity Department directive. When the scene's slugline
    // matches a Location Bible (and any locked props are referenced),
    // the engine pre-rendered the locked-geometry / camera-safe / forbidden-
    // angle / eyeline / lighting / prop blocks for us. We hand them to the
    // LLM verbatim as the dominant constraint set.
    (continuityDirective ?? "").trim() ? continuityDirective : "",
    // V3.2 — eyeline / camera-awareness. Default-observational rule
    // injected on every shot unless the brief explicitly overrides via
    // cameraAwareness. Stops the "character stares into the lens"
    // failure mode in close-up / eye-level shots.
    eyelineDirective,
    angleNudge,
    // V3.3 — Phone Insert Mode. When the brief declares a phone-screen
    // mode this becomes the dominant directive: literal-screen rendering,
    // verbatim text only, no invented UI clutter.
    phoneInsertDirective,
    eyelineDirective || angleNudge || phoneInsertDirective ? "" : "",
    // V4.5 — CONTINUITY SURFACING. Without this rule the LLM treats the
    // directive above as a constraint to RESPECT but not as content to
    // EXPRESS. The model elides Maya's wardrobe / hair / accessories
    // into "a figure", and elides Maya's Bedroom's wood-grain nightstand
    // / cool neutral palette / lived-in texture into "the bedroom". The
    // bibles end up invisible to the camera even though they're loaded
    // into the system prompt.
    //
    // Solution: explicitly require the LLM to surface at least 2
    // distinctive tokens from each bible block in the prompt body.
    "CONTINUITY SURFACING — non-negotiable:",
    "The prompt body MUST express continuity, not merely respect it.",
    "",
    !invisible
      ? "  CHARACTER (cast bible) — when the cast line below carries wardrobe / hair / identity details, the prompt body MUST include AT LEAST TWO distinctive details verbatim or as a faithful paraphrase (e.g. 'pale grey sleep shirt', 'shoulder-length dark brown hair tousled from sleep', 'thin gold wedding band'). 'A figure' / 'a person' / 'someone' / 'the protagonist' / a bare pronoun is FORBIDDEN as the character descriptor. Use the character's name OR a wardrobe-locked descriptor."
      : "",
    "",
    (continuityDirective ?? "").trim()
      ? "  LOCATION (Location Bible + Visual World Rules) — the prompt body MUST include AT LEAST TWO distinctive specifics from the bible above (named room / specific furniture / material / palette / texture / lighting practical). Generic 'the bedroom' / 'a kitchen' / 'a room' is FORBIDDEN when a Location Bible is present — anchor the prompt in THIS specific room."
      : "",
    "",
    "If a bible is in the system prompt but its details do not appear in your output, your prompt is wrong. The bible exists so the camera renders the SAME room and the SAME character across every shot.",
    "",
    "OTHER RULES FOR THE PROMPT BODY (the string you'll put in the `finalPrompt` JSON field):",
    "• The `finalPrompt` value must be a polished cinematic paragraph (or a comma-list for image models like Midjourney).",
    "• NEVER include raw field labels in the `finalPrompt` value ('Camera:', 'Subject:', 'Environment:').",
    "• If no character is visible in this shot, OMIT CAST ENTIRELY. Open with the environment / camera POV.",
    "• Never end a clause with a dangling preposition + period ('observer in .', 'moment of .', 'to her .').",
    "  Every sentence must finish with a real noun phrase, not a fragment.",
    "• Honor PREFER / AVOID rules silently (don't print them in the body).",
    `• ALWAYS include aspect ratio (${aspectRatio}) and${durationSec ? ` duration (~${durationSec}s)` : ""} as plain phrases in the body — the writer needs them inline.`,
    "• Match the target model's style guide below.",
    "",
    "STYLE GUIDE FOR THIS MODEL:",
    STYLE_GUIDE[model] ?? STYLE_GUIDE.generic_video,
    "",
    // Fix #4 — Unambiguous output contract. The previous wording ("Output
    // a polished cinematic paragraph" up top + "Return ONLY JSON" at the
    // bottom) let the LLM emit a paragraph and skip the JSON wrapper.
    // extractJSON then threw "No JSON found in model output" and the
    // composer silently fell back to the deterministic template.
    "================================================================",
    "OUTPUT FORMAT — STRICT (this is the response contract):",
    "================================================================",
    "",
    "Your ENTIRE response must be a single JSON object — nothing before, nothing after.",
    "No prose. No commentary. No markdown fences. No code fences. No leading whitespace.",
    "The FIRST character of your response must be `{` and the LAST character must be `}`.",
    "",
    "The JSON object MUST have exactly these three keys:",
    "",
    "  • `finalPrompt`  (string)  — the polished cinematic paragraph (or comma-list",
    "                                for image models). This is the only place the",
    "                                cinematic prose belongs. DO NOT emit it outside",
    "                                the JSON wrapper.",
    "  • `negativePrompt` (string|null) — a concise comma-list of things to avoid",
    "                                when the model supports negatives; null/omit",
    "                                otherwise.",
    "  • `usageNotes`   (string[]) — 1–3 short plain-English lines for the writer",
    "                                (e.g. \"Copy this into Luma.\").",
    "",
    "EXAMPLE of a correctly formatted response (note: the entire response is JSON):",
    "{",
    '  "finalPrompt": "Rain-hazed window glass dissolves the city lights into liquid bokeh. A woman in a pale grey sleep shirt, shoulder-length dark brown hair tousled from sleep, sits upright in INT. MAYA\'S BEDROOM — NIGHT. Cool neutral palette, wood-grain nightstand visible in soft focus. MS / 35mm / static. Aspect 9:16, ~4s.",',
    '  "negativePrompt": "blurry, low resolution, distorted face, text, watermark",',
    '  "usageNotes": ["Copy this into Veo.", "Subject\'s eyeline stays off-camera."]',
    "}",
    "",
    "If you cannot honor all the rules above, do your best inside `finalPrompt` and",
    "note the conflict in `usageNotes` — but STILL respond with the JSON object.",
    "",
    "================================================================",
    "TAIL RESTATEMENT — these are the rules the LLM most often violates;",
    "they are restated here because instructions at the END of a long prompt",
    "carry more weight in practice. Obey them on every regeneration:",
    "================================================================",
    "",
    "1. The first character of your response is `{`. The last is `}`. Nothing else.",
    "2. The `finalPrompt` value contains the polished prose. The prose does NOT",
    "   appear outside the JSON wrapper.",
    `3. The \`finalPrompt\` value must be ≤ 220 words (≤ 60 for Pika).`,
    heroImageDominant
      ? "4. The FIRST SENTENCE of `finalPrompt` describes ONLY the Primary Image."
      : "4. The Hero Subject may anchor the prompt; the Hero Image still grounds it.",
    heroImageDominant
      ? "   The first noun is NOT 'woman' / 'man' / 'character' / 'person' / 'figure'."
      : "",
    "5. No key-art / publicity-still framing language anywhere in `finalPrompt`.",
    "6. If approved canon (DP brief, Director brief, location bible) is in the",
    "   system prompt above, at least two distinctive specifics from each MUST",
    "   appear in `finalPrompt`. 'A figure / a person / the bedroom / a room' is",
    "   FORBIDDEN when canon is loaded.",
    ...(notes && notes.trim()
      ? [
          "7. WRITER STEERING at the top of this system prompt outranks every rule",
          "   here. If a steering note conflicts with rules 3–6, the steering wins.",
        ]
      : []),
  ].join("\n");

  // Filmable-only payload. For invisible-character shots we DROP cast,
  // performance, dialogue, and any story-context fields entirely so the
  // LLM has nothing to leak from. For visible-character shots we still
  // pass the pre-compressed cast line (allowlist-stripped) — never the
  // raw character.description from the brief.
  const userPayload: Record<string, unknown> = {
    targetModel: profile.modelName,
    visibility: invisible ? "no_character_visible" : "character_visible",
    shotIntent: intent,
    shotPerspective: perspective,
    // V3.2 — eyeline + camera awareness as structured fields so the LLM
    // can't miss them. The system prompt also enforces them in prose.
    cameraAwareness,
    eyeline:
      eyelineText ||
      (invisible
        ? undefined
        : directGazeAllowed
        ? undefined
        : "Subject's eyeline stays off-camera, motivated by the scene action; no direct-to-lens gaze."),
    // V3.3 — phone insert structured fields. LLM treats these as the
    // dominant fact when present.
    phoneInsertMode: phoneActive ? phoneInsertMode : undefined,
    phoneScreenText: phoneActive ? phoneScreenText || undefined : undefined,
    phoneShowSurroundings: phoneActive ? phoneShowSurroundings : undefined,
    leadStrategy,
    visualFrame: visualFrame ?? undefined,
    compositionWeight: classification.compositionWeight,
    characterWeight: classification.characterWeight,
    clauseOrder: INTENT_ORDER[intent],
    primaryImage: brief.primaryImage?.trim() || undefined,
    heroImage: hierarchy.heroImage || undefined,
    heroSubject: hierarchy.heroSubject || undefined,
    secondaryElements: hierarchy.secondary.length ? hierarchy.secondary : undefined,
    heroImageMustDominate: heroImageDominant,
    // The seven photographable fields — composer prefers these over legacy.
    cameraSees: brief.cameraSees?.trim() || undefined,
    frame:
      brief.frame?.trim() ||
      [brief.cameraFraming, brief.lensSuggestion, brief.cameraMovement]
        .filter(Boolean)
        .join(", ") ||
      undefined,
    light:
      brief.light?.trim() ||
      [brief.lighting, brief.colorPalette].filter(Boolean).join("; ") ||
      undefined,
    texture:
      brief.texture?.trim() ||
      [brief.visualMotif, brief.productionDesign].filter(Boolean).join("; ") ||
      undefined,
    lockedDetails:
      brief.lockedDetails?.trim() ||
      [
        (brief.props ?? []).join(", "),
        brief.continuityNotes,
      ].filter(Boolean).join("; ") ||
      undefined,
    location: brief.location,
    timeOfDay: brief.timeOfDay,
    action: brief.action,
    aspectRatio,
    durationSec,
    outputType: brief.outputType,
    prefer,
    avoid,
    writerSteering: notes ?? "",
    // emotionalBeat is allowed as a single tonal adjective only — pass
    // the raw value through the same sanitizer the output uses so any
    // forbidden bio words ("grief", "perceptive") are dropped before
    // the LLM ever sees them.
    tonalCue: sanitize(brief.emotionalBeat ?? "").text || undefined,
  };
  if (!invisible) {
    userPayload.cast = castLine;
    userPayload.performance = sanitize(brief.performanceDirection ?? "").text || undefined;
    userPayload.dialogue = brief.dialogue?.trim() ? brief.dialogue.trim() : undefined;
    if (characterReferenceImages.length > 0) {
      userPayload.characterReferenceImages = characterReferenceImages;
    }
    // V3.1 — hand the LLM a Kling references block alongside the URL
    // hints. The LLM doesn't put IDs into the prose (they're metadata),
    // but knowing they exist lets it avoid re-describing the character
    // from scratch and lean on identity locking.
    const klingHints = referenceMetadata.characters.filter(
      (r) => r.klingElementId || r.multiAngle.length > 0
    );
    if (klingHints.length > 0) {
      userPayload.klingReferences = klingHints.map((r) => ({
        name: r.name,
        platform: r.platform,
        klingElementId: r.klingElementId,
        klingElementName: r.klingElementName,
        multiAngle: r.multiAngle,
      }));
    }
  }
  // Drop undefined keys so the LLM doesn't see empty fields it might pad.
  for (const k of Object.keys(userPayload)) {
    if (userPayload[k] === undefined || userPayload[k] === "") delete userPayload[k];
  }

  // Fix #2 — Track WHY the fallback ran so we can surface it on
  // `readiness.issues` instead of silently saving a canon-stripped prompt.
  let llmError: string | null = null;
  let parsed: { finalPrompt?: string; negativePrompt?: string; usageNotes?: string[] } = {};
  try {
    const res = await callLLM({
      model: config.SCENE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
      ],
      temperature: 0.5,
      maxTokens: 900,
    });
    try {
      parsed = extractJSON(res.text) as typeof parsed;
    } catch (jsonErr) {
      llmError = `LLM returned non-JSON output (${(jsonErr as Error).message.slice(0, 80)}).`;
      parsed = {};
    }
  } catch (callErr) {
    // The LLM call itself failed (network, auth, rate-limit, timeout).
    llmError = `LLM call failed: ${(callErr as Error).message.slice(0, 120)}.`;
    parsed = {};
  }
  // Track whether the LLM produced anything usable. Used both to record
  // the fallback in readiness and to gate downstream warnings.
  const llmProducedFinal =
    typeof parsed.finalPrompt === "string" && parsed.finalPrompt.trim().length > 0;
  if (!llmProducedFinal && !llmError) {
    llmError = "LLM returned an empty finalPrompt.";
  }

  // Fix #3 — Pass continuity directive + writer notes into the fallback
  // so approved canon (location bible, props, DP brief, Director brief)
  // and writer steering survive on the deterministic path.
  const rawFinal = llmProducedFinal
    ? (parsed.finalPrompt as string).trim()
    : composeFallback({
        brief, model, ingredients, castLine, invisible, durationSec, aspectRatio,
        continuityDirective, notes,
      });

  let { text: finalPrompt, issues: sanitizeIssues } = sanitize(rawFinal);
  // Whether we actually rendered from the deterministic fallback (either
  // because the LLM failed/returned empty, or because the sanitizer
  // stripped the LLM output below the recovery threshold).
  let usedFallback = !llmProducedFinal;

  // If the sanitizer dropped every sentence (the LLM's output was almost
  // entirely banned content), recover from the deterministic fallback
  // composer so the writer at least sees a workable starting point.
  // Word-count threshold: < 8 words means we have basically nothing left.
  if (finalPrompt.replace(/--ar\s+\S+|--stylize\s+\S+/g, "").trim().split(/\s+/).filter(Boolean).length < 8) {
    const fallbackText = composeFallback({
      brief, model, ingredients, castLine, invisible, durationSec, aspectRatio,
      continuityDirective, notes,
    });
    const fb = sanitize(fallbackText);
    if (fb.text.split(/\s+/).filter(Boolean).length > finalPrompt.split(/\s+/).filter(Boolean).length) {
      finalPrompt = fb.text;
      usedFallback = true;
      sanitizeIssues = [
        ...sanitizeIssues,
        "LLM output was dropped by the sanitizer; used deterministic fallback.",
      ];
    }
  }

  // Midjourney suffix guard. The model output must always end with the
  // --ar and --stylize flags so the prompt is copy-ready. If the LLM
  // omitted them (or the sanitizer dropped the sentence that carried
  // them), append from the resolved aspectRatio + the profile's stylize
  // default (80 unless the profile overrides).
  if (model === "midjourney") {
    if (!/--ar\s+\d/i.test(finalPrompt)) {
      const ar = (aspectRatio || "16:9").replace(/\s+/g, "");
      finalPrompt = `${finalPrompt.replace(/[.\s]+$/, "")} --ar ${ar}`;
    }
    if (!/--stylize\s+\d/i.test(finalPrompt)) {
      const styleMatch = (profile.preferredPromptStructure ?? "").match(/--stylize\s+(\d{1,4})/i);
      const styleVal = styleMatch ? styleMatch[1] : "80";
      finalPrompt = `${finalPrompt} --stylize ${styleVal}`;
    }
  }

  // V3.2 — even when the LLM produced a negative prompt, ensure the no-
  // lens-gaze bans are present on observational shots. The LLM often
  // returns a short negative list missing them; we append silently.
  // V3.3 — same defensive pad for Phone Insert Mode bans.
  const observationalCamera = !invisible && !directGazeAllowed;
  let negativePromptRaw: string | undefined =
    typeof parsed.negativePrompt === "string" && parsed.negativePrompt.trim()
      ? parsed.negativePrompt.trim()
      : profile.negativePromptSupport
      ? defaultNegative(model, brief, {
          observationalCamera,
          phoneInsert: phoneActive,
        })
      : undefined;
  if (negativePromptRaw && phoneActive) {
    const lower = negativePromptRaw.toLowerCase();
    const needed: string[] = [];
    if (!/illegible|blurry\s+phone|blurry\s+screen/.test(lower)) {
      needed.push("illegible screen text", "blurry phone screen");
    }
    if (!/fake\s+notification|extra\s+notification/.test(lower)) {
      needed.push("fake notifications", "extra notification banners");
    }
    if (!/invented\s+message|fabricated\s+message/.test(lower)) {
      needed.push("invented message history", "fabricated message content");
    }
    if (!/app\s+icon|widget/.test(lower)) {
      needed.push("app icon grid", "home screen widgets");
    }
    if (!phoneShowSurroundings && !/human\s+face|reflection\s+of\s+face/.test(lower)) {
      needed.push(
        "human face in frame",
        "reflection of face in screen",
        "human body in frame"
      );
    }
    if (needed.length > 0) {
      negativePromptRaw = `${negativePromptRaw}, ${needed.join(", ")}`;
    }
  }
  if (negativePromptRaw && observationalCamera) {
    const lower = negativePromptRaw.toLowerCase();
    const needed: string[] = [];
    if (!/look(ing)?\s+into\s+(the\s+)?(camera|lens)/.test(lower)) {
      needed.push("looking into the lens", "looking into camera");
    }
    if (!/direct\s+eye\s+contact/.test(lower)) {
      needed.push("direct eye contact with camera");
    }
    if (!/selfie/.test(lower)) needed.push("selfie framing");
    if (!/vlog|influencer/.test(lower)) needed.push("vlog delivery");
    if (!/acknowledging\s+the\s+lens|address(ing)?\s+the\s+camera/.test(lower)) {
      needed.push("character acknowledging the lens");
    }
    if (needed.length > 0) {
      negativePromptRaw = `${negativePromptRaw}, ${needed.join(", ")}`;
    }
  }
  const negativePrompt = negativePromptRaw
    ? sanitize(negativePromptRaw).text || undefined
    : undefined;

  const usageNotes = Array.isArray(parsed.usageNotes)
    ? parsed.usageNotes.filter((s): s is string => typeof s === "string" && s.trim().length > 0).slice(0, 3)
    : defaultUsageNotes(model, brief, invisible);

  // V4.5 — pull distinctive tokens from the cast line (wardrobe / hair /
  // accessories) and from the continuity directive (location bible +
  // visual world rules) so the readiness gate can verify the LLM
  // surfaced them. extractContinuityTokens dedupes, strips stopwords,
  // and keeps tokens ≥ 5 chars (so "the", "her", "and" never qualify).
  const castWardrobeTokens =
    !invisible && castLine && !castLine.startsWith("No visible character")
      ? extractContinuityTokens(castLine)
      : [];
  const locationTokens = (continuityDirective ?? "").trim()
    ? extractContinuityTokens(continuityDirective ?? "")
    : [];

  // V4.6 (Stage 2) — pull forbidden-dressing phrases out of the resolved
  // continuity (location bible) and per-episode wardrobe tokens out of
  // the cast bible. Both are derived directly from the structured data,
  // so the readiness gate stays in sync as the bibles evolve.
  const forbiddenDressing: string[] = [];
  const continuityForbiddenMatch = (continuityDirective ?? "").match(
    /FORBIDDEN DRESSING[^\n]*\n([\s\S]*?)(?:\n\n|$)/
  );
  if (continuityForbiddenMatch) {
    const block = continuityForbiddenMatch[1];
    for (const line of block.split("\n")) {
      const m = line.match(/•\s*(.+?)\s*$/);
      if (m) forbiddenDressing.push(m[1]);
    }
  }
  const episodeWardrobeTokens: string[] = [];
  if (!invisible && brief.episodeNumber != null) {
    const epKey2 = String(brief.episodeNumber);
    for (const c of brief.characters) {
      const vb = castLibrary?.get(c.name.toUpperCase());
      const w = vb?.wardrobeByEpisode?.[epKey2];
      const h = vb?.hmuByEpisode?.[epKey2];
      if (!w && !h) continue;
      const blob = [
        w?.top,
        w?.bottom,
        w?.accessories,
        w?.footwear,
        h?.hairCondition,
        h?.makeupState,
        h?.faceMarks,
      ]
        .filter(Boolean)
        .join(" ");
      episodeWardrobeTokens.push(...extractContinuityTokens(blob));
    }
  }

  const r = readiness({
    text: finalPrompt,
    negative: negativePrompt,
    model,
    durationSec,
    aspectRatio,
    leadStrategy,
    visualFrame,
    intent,
    perspective,
    heroImage: hierarchy.heroImage,
    heroImageMustDominate: heroImageDominant,
    characterNames: brief.characters.map((c) => c.name),
    briefPrimaryImage: brief.primaryImage?.trim() || undefined,
    interpretiveWarnings: brief.interpretiveWarnings ?? [],
    shotTags: (brief.shotTags ?? []) as string[],
    cameraAwareness,
    eyeline: eyelineText || undefined,
    frame: brief.frame,
    cameraFraming: brief.cameraFraming,
    phoneInsertMode,
    phoneScreenText: phoneScreenText || undefined,
    heroSubject: brief.heroSubject,
    forbiddenDominantDetails: brief.forbiddenDominantDetails,
    castWardrobeTokens,
    locationTokens,
    invisible,
    forbiddenDressing,
    episodeWardrobeTokens,
    visibleCanonRequirements,
  });
  // Surface sanitizer drops to the writer (capped) so they know the
  // composer had to strip something before it became copyable.
  if (sanitizeIssues.length > 0) {
    r.issues.push(...sanitizeIssues.slice(0, 5));
    r.ok = false;
  }

  // Fix #2 — surface the silent fallback explicitly. Without this, the
  // PromptVersion got saved with no canon, no DP brief, no writer notes,
  // and no visible warning. Now the supervisor board / readiness gate
  // sees a hard blocker like "LLM call failed — DP brief and steering
  // notes were NOT applied; regenerate."
  if (usedFallback) {
    const reason = llmError ?? "LLM output was unusable.";
    const hadCanon =
      ((continuityDirective ?? "").trim().length > 0) ||
      ((brief as Record<string, unknown>).dpBrief != null) ||
      ((brief as Record<string, unknown>).directorBrief != null);
    const hadNotes = !!notes && notes.trim().length > 0;
    const lost: string[] = [];
    if (hadCanon) lost.push("approved DP / Director / continuity briefs");
    if (hadNotes) lost.push("writer steering notes");
    const lostStr = lost.length > 0
      ? ` Best-effort fallback rendered — ${lost.join(" + ")} may not have fully landed; regenerate to apply them properly.`
      : "";
    r.issues.unshift(
      `Composer fell back to deterministic template (${reason}).${lostStr}`
    );
    r.ok = false;
  }

  return {
    finalPrompt,
    negativePrompt,
    usageNotes,
    readiness: r,
    referenceMetadata,
  };
}

// Deterministic fallback so the system degrades gracefully when the LLM is
// unavailable. Produces a paragraph form already compressed and with the
// composer rules pre-applied — no labels, no biography.
function composeFallback(args: {
  brief: MasterShotBrief;
  model: ModelKey;
  ingredients: Record<string, string>;
  castLine: string;
  invisible: boolean;
  durationSec?: number;
  aspectRatio: string;
  /** Fix #3 — Approved continuity (location bible + props + DP brief +
   *  Director brief). Concatenated at the top of the fallback so canon
   *  doesn't vanish when the LLM is unreachable. */
  continuityDirective?: string;
  /** Fix #3 — Writer steering notes for this regeneration. Surfaced as
   *  the leading directive of the fallback so they actually shape the
   *  prompt on the deterministic path. */
  notes?: string;
}): string {
  const { brief, model, castLine, invisible, durationSec, aspectRatio, continuityDirective, notes } = args;
  const env = [brief.location, brief.timeOfDay].filter(Boolean).join(", ");
  const camera = [brief.cameraFraming, brief.lensSuggestion, brief.cameraMovement]
    .filter(Boolean)
    .join(" / ");
  const atmosphere = [brief.lighting, brief.colorPalette, brief.visualMotif]
    .filter(Boolean)
    .join("; ");

  // Tone is allowed only if it survives the sanitizer (single adjective,
  // no forbidden bio words). shotPurpose / storyBeat are NEVER used as
  // copy — they are creative intent, not filmable.
  const tone = sanitize(brief.emotionalBeat ?? "").text;

  // Fix #3 — Pull the verbatim DP / Director brief blocks out of the
  // continuity directive. The directive is a multi-block string that
  // already labels them; we extract and surface the labelled body so the
  // deterministic prompt actually carries the approved canon.
  const dpBriefBlock = extractLabelledBlock(continuityDirective, "DP BRIEF");
  const dirBriefBlock = extractLabelledBlock(continuityDirective, "DIRECTOR'S BLOCKING BRIEF");
  // Location + visible canon block — anything in the continuity directive
  // that isn't already covered by DP / Director extraction. Keep concise
  // so we don't blow the 220-word ceiling.
  const continuitySummary = summarizeContinuity(continuityDirective, {
    excludeLabels: ["DP BRIEF", "DIRECTOR'S BLOCKING BRIEF"],
  });

  const steeringPrefix = notes && notes.trim()
    ? `Writer steering for this regeneration: ${notes.trim()}.`
    : "";

  if (model === "midjourney") {
    // Comma list — append canon as terse phrases.
    const parts = [
      invisible ? env : castLine,
      env,
      brief.cameraFraming,
      brief.lensSuggestion,
      brief.lighting,
      brief.colorPalette ? `${brief.colorPalette} palette` : "",
      tone,
      // Canon tail — kept compact for image models.
      continuitySummary,
      dpBriefBlock,
      dirBriefBlock,
      steeringPrefix ? `(per writer: ${(notes ?? "").trim()})` : "",
    ]
      .filter(Boolean)
      .join(", ");
    return `${parts} --ar ${aspectRatio.replace("/", ":")} --stylize 250`;
  }
  if (model === "pika") {
    const subj = invisible ? "environment shot" : castLine;
    return [subj, brief.action ?? "", tone, atmosphere, continuitySummary, dpBriefBlock]
      .filter(Boolean)
      .join(", ");
  }

  // Paragraph-form fallback. No label prefixes, no bio.
  const subjectClause = invisible
    ? `Environment / transition shot in ${env}.`
    : `${castLine}. ${brief.action ?? ""}`.trim();
  return [
    steeringPrefix,
    subjectClause,
    invisible ? "" : env ? `Set in ${env}.` : "",
    continuitySummary ? `Approved set: ${continuitySummary}.` : "",
    dirBriefBlock ? `Director's blocking: ${dirBriefBlock}.` : "",
    dpBriefBlock ? `DP brief: ${dpBriefBlock}.` : "",
    atmosphere ? `${atmosphere}.` : "",
    camera ? `${camera}.` : "",
    tone ? `Restrained tonal feel: ${tone}.` : "",
    `Aspect ${aspectRatio}${durationSec ? `, ~${durationSec}s` : ""}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Pull the body of a "[LABEL …]\n…\n" block out of the multi-block
 *  continuity directive. Returns "" if the label isn't present. Used by
 *  composeFallback to surface DP / Director briefs on the deterministic
 *  path. The directive's writer (engine.ts:695–704) wraps blocks as
 *  `[LABEL — APPROVED CANON, OBEY VERBATIM]\n<body>\n\n`. */
function extractLabelledBlock(directive: string | undefined, label: string): string {
  if (!directive) return "";
  const re = new RegExp(`\\[${label.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}[^\\]]*\\]\\s*([\\s\\S]*?)(?=\\n\\s*\\[|$)`);
  const m = directive.match(re);
  if (!m) return "";
  // Keep the body compact — strip empty lines and trim. Cap length so the
  // fallback prompt doesn't blow the model's word ceiling.
  const body = m[1].trim().replace(/\s+/g, " ");
  return body.length > 400 ? body.slice(0, 397).trimEnd() + "…" : body;
}

/** Compact one-line summary of any non-labelled continuity content
 *  (location bible details, visible canon block). Skips already-extracted
 *  labels so we don't double-paste. */
function summarizeContinuity(
  directive: string | undefined,
  opts: { excludeLabels: string[] }
): string {
  if (!directive) return "";
  let s = directive;
  for (const label of opts.excludeLabels) {
    const re = new RegExp(`\\[${label.replace(/[-/\\^$*+?.()|[\\]{}]/g, "\\$&")}[^\\]]*\\][\\s\\S]*?(?=\\n\\s*\\[|$)`, "g");
    s = s.replace(re, "");
  }
  // Strip all remaining bracketed labels — keep just the body text.
  s = s.replace(/\[[^\]]+\]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return "";
  // Cap to keep the fallback prompt under word ceilings.
  return s.length > 300 ? s.slice(0, 297).trimEnd() + "…" : s;
}

function defaultNegative(
  model: ModelKey,
  brief: MasterShotBrief,
  opts?: { observationalCamera?: boolean; phoneInsert?: boolean }
): string {
  const generic = [
    "blurry",
    "low resolution",
    "distorted face",
    "extra fingers",
    "deformed hands",
    "text",
    "watermark",
    "logo",
  ];
  if (brief.outputType === "video") generic.push("morphing", "jumpcut", "teleport");
  if (model === "kling" || model === "pika") generic.push("oversaturated colors");
  // V3.2 — observational default. When the brief does NOT explicitly
  // request direct-to-camera / POV / selfie / video call / confession /
  // surveillance framing, append the no-lens-gaze bans so the negative
  // prompt blocks the common failure mode of subjects staring into the
  // lens on a close-up.
  if (opts?.observationalCamera) {
    generic.push(
      "direct eye contact with camera",
      "looking into the lens",
      "looking into camera",
      "portrait-style posing",
      "selfie framing",
      "influencer delivery",
      "vlog delivery",
      "character acknowledging the lens",
      "addressing the camera",
      "fourth wall break"
    );
  }
  // V3.3 — phone insert bans. Locks out the common phone-render failure
  // modes: invented notifications, fake app icons, blurry screen text,
  // wrong app aesthetic, oversized hands, body / face in frame when
  // the writer asked for a pure phone insert.
  if (opts?.phoneInsert) {
    generic.push(
      "blurry phone screen",
      "illegible screen text",
      "fake notifications",
      "extra notification banners",
      "invented message history",
      "fabricated message content",
      "app icon grid",
      "home screen widgets",
      "decorative emoji not specified",
      "rainbow chat bubbles",
      "stylised messaging app",
      "fictional messaging app UI",
      "light-mode UI when dark-mode requested",
      "Android UI when iPhone requested",
      "oversized hand",
      "thumb dominating frame",
      "two hands holding phone unless specified",
      "human face in frame",
      "human body in frame",
      "reflection of face in screen",
      "ring light glare",
      "studio lighting on the phone",
      "advertising mockup aesthetic",
      "product photography lighting"
    );
  }
  return generic.join(", ");
}

function defaultUsageNotes(model: ModelKey, brief: MasterShotBrief, invisible: boolean): string[] {
  const notes: string[] = [];
  const MODEL_COPY: Partial<Record<ModelKey, string>> = {
    luma: "Copy this into Luma.",
    kling: "Copy this into Kling.",
    veo: "Copy this into Flow / Veo.",
    runway: "Copy this into Runway.",
    pika: "Copy this into Pika.",
    midjourney: "Copy this into Midjourney.",
  };
  if (MODEL_COPY[model]) notes.push(MODEL_COPY[model]!);
  if (invisible) notes.push("No visible character performance; environment-only.");
  else if (!(brief.dialogue ?? "").trim()) notes.push("No dialogue or lip-sync needed.");
  if ((brief.shotTags ?? []).includes("ENV")) notes.push("Environment-heavy shot — atmosphere first.");
  if ((brief.shotTags ?? []).includes("TRANS")) notes.push("Transition shot.");
  return notes.slice(0, 3);
}
