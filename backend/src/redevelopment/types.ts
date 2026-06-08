// Series Redevelopment Mode — data types.
//
// A Redevelopment Pass is a parallel workflow on a Prestige Series /
// Mini Series project that lets the showrunner revise series
// architecture (character bibles, Protocol/system engine, season arc,
// pilot strategy) WITHOUT overwriting existing approved canon or drafts.
//
// Storage: `projects.metadata.redevelopmentPasses: RedevelopmentPass[]`.
// Approval of a stage writes a `proposed` payload to the pass; nothing
// touches the live project bibles or scripts until the showrunner
// explicitly Promotes a pass (Phase 3 — not yet implemented).

export type RedevStageKey =
  | "r1_brief"
  | "r2_character_bibles"
  | "r3_protocol_modules"
  | "r4_season_arc"
  | "r5_pilot_strategy"
  | "r6_pilot_rewrite"
  | "r7_pilot_polish"
  | "r8_voice_polish"
  | "r9_final_polish";

export const REDEV_STAGE_ORDER: RedevStageKey[] = [
  "r1_brief",
  "r2_character_bibles",
  "r3_protocol_modules",
  "r4_season_arc",
  "r5_pilot_strategy",
  "r6_pilot_rewrite",
  "r7_pilot_polish",
  "r8_voice_polish",
  "r9_final_polish",
];

export const REDEV_STAGE_LABEL: Record<RedevStageKey, string> = {
  r1_brief: "Redevelopment Brief",
  r2_character_bibles: "Character Bible Redevelopment",
  r3_protocol_modules: "Protocol Module Engine",
  r4_season_arc: "Season One Arc Redesign",
  r5_pilot_strategy: "Pilot Rewrite Strategy",
  r6_pilot_rewrite: "Pilot Rewrite",
  r7_pilot_polish: "Pilot Polish Pass",
  r8_voice_polish: "Character Voice & Scene Life Pass",
  r9_final_polish: "Final Hook & Emotional Anchor Pass",
};

/** Gate dependencies. Each stage may only be approved after its
 *  prerequisites are approved. The Pilot Rewrite (R6) is locked until
 *  R2 + R3 + R4 are ALL approved — the user's explicit requirement.
 *  R8 (voice/life polish) only opens once R7 has been approved AND
 *  promoted — voice work targets the R7-polished draft. R9 is the
 *  final automated rewrite pass and targets the R8-promoted Draft 4. */
export const REDEV_STAGE_DEPS: Record<RedevStageKey, RedevStageKey[]> = {
  r1_brief: [],
  r2_character_bibles: ["r1_brief"],
  r3_protocol_modules: ["r1_brief"],
  r4_season_arc: ["r2_character_bibles", "r3_protocol_modules"],
  r5_pilot_strategy: ["r4_season_arc"],
  r6_pilot_rewrite: ["r2_character_bibles", "r3_protocol_modules", "r4_season_arc", "r5_pilot_strategy"],
  r7_pilot_polish: ["r6_pilot_rewrite"],
  r8_voice_polish: ["r7_pilot_polish"],
  r9_final_polish: ["r8_voice_polish"],
};

// =============================================================================
// R1 — Redevelopment Brief
// =============================================================================

export interface RedevBrief {
  whatChanged: string;
  newCorePrinciple: string;
  newSeasonQuestion: string;
  primaryMystery: string;
  secondaryMystery: string;
  mustNotChange: string;
  /** Free text: which assets are being redeveloped — e.g. "Character
   *  bibles for Margot, Dean, Nadia, Claire, Paul, Solano; Season Arc;
   *  Pilot Episode 1 draft." */
  targetsForRedevelopment: string;
  /** The contract the show makes with the audience — what the audience
   *  is paying attention for. ("There is something you don't understand
   *  yet, and when you finally understand it, everything changes.") */
  audiencePromise?: string;
  /** How the show's system/engine actually works at a philosophical
   *  level. Not the principle (what), but the mechanism (how). For
   *  SELVAJE: "The body reveals what the mind avoids. People lie in
   *  behavior, not speech. Attack the strategy, not the wound." */
  protocolPhilosophy?: string;
  /** Architectural decision about a high-leverage character / authority
   *  figure / system anchor that EVERY downstream agent must respect.
   *  Generic across templates. For SELVAJE: "Solano is not a fraud. The
   *  Protocol actually works. The danger is truth, not deception."
   *
   *  Field name was originally `solanoRule`. Reads use
   *  `getCharacterAnchorRule(brief)` (in `briefCompat.ts`) which prefers
   *  `characterAnchorRule` and falls back to `solanoRule` for
   *  pre-refactor data. Writes should set BOTH for now until every
   *  call site migrates. */
  characterAnchorRule?: string;
  /** @deprecated use `characterAnchorRule`. Kept for backward-compat
   *  reads of approved SELVAJE passes. Do not introduce new readers
   *  of this field directly — use `getCharacterAnchorRule(brief)`. */
  solanoRule?: string;
  /** Tones/textures the show must NOT drift into. Used by every
   *  generation prompt as a hard forbidden list (e.g. hypnosis, magic,
   *  supernatural visions, generic therapy conversations). */
  forbiddenTones?: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

// =============================================================================
// R2 — Character Bible Redevelopment
// =============================================================================

export interface RedevCharacterBible {
  /** Optional link to an existing `characters` row by id. Null if this
   *  redev introduces a new character not in the live bible. */
  liveCharacterId: string | null;
  characterName: string;
  /** Ten-field structured bible from the user's R2 spec. All strings —
   *  the LLM fills them, the showrunner edits before approving. */
  proposed: {
    publicIdentity: string;
    privateIdentity: string;
    coreWound: string;
    avoidanceStrategy: string;
    hiddenTruth: string;
    whatTheyThinkTheyNeed: string;
    whatTheyActuallyNeed: string;
    protocolVulnerability: string;
    seasonRevelation: string;
    finalChoice: string;
  };
  /** Optional showrunner-supplied seed text the agent must respect when
   *  generating (e.g. "Margot hides in analysis. Must learn to feel."). */
  showrunnerSeed?: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

// =============================================================================
// R3 — Protocol Module Engine (Phase 2)
// =============================================================================

export interface RedevProtocolModule {
  id: string;
  name: string;
  purpose: string;
  psychologicalTarget: string;
  avoidanceBehaviorStripped: string;
  physicalSomaticExercise: string;
  visualExecution: string;
  dramaticRisks: string;
  affectedCharacterNames: string[];
  truthPressured: string;
  possibleEpisodePlacement: string;
  /** Persistent steering note for the next regeneration of this
   *  module. Survives reload. Editable even when the module is
   *  approved — changing the note does NOT drop approval (see the
   *  approval-preservation logic in the PUT handler). */
  steeringNote?: string;
  approvedAt: string | null;
}

// =============================================================================
// R4 — Season One Arc Redesign (Phase 2)
// =============================================================================

export interface RedevSeasonArcEpisode {
  number: number;
  title: string;
  theme: string;
  protocolModule: string;
  characterBreakthrough: string;
  characterCollision: string;
  mysteryProgression: string;
  revelation: string;
  cliffhanger: string;
  episode1Plant: string;
}

// =============================================================================
// R5 — Pilot Rewrite Strategy (Phase 3)
// =============================================================================

export interface RedevPilotStrategy {
  whatMustChange: string[];
  whatMustRemain: string[];
  newSeedsToPlant: string[];
  oldBeatsToRemove: string[];
  characterIntroAdjustments: string[];
  protocolPhilosophyMoments: string[];
  mysteryPlants: string[];
  characterArcPlants: string[];
  finalHookOptions: string[];
  /** Persistent steering note for the next Regenerate. Saving it does
   *  not drop the strategy's approval (same pattern as R3/R4). */
  steeringNote?: string;
  /** Sentinel that records which pilot script the strategy was anchored
   *  to. Lets us flag the strategy as stale when the user updates the
   *  pilot draft after the strategy was approved. Optional. */
  anchorScriptId?: string | null;
  approvedAt: string | null;
}

// =============================================================================
// R6 — Pilot Rewrite (Phase 3)
// =============================================================================

/** One scene's worth of rewrite decision. The plan is the union of
 *  these, in pilot order.
 *
 *  Action semantics:
 *    • keep   — preserve existing scene verbatim
 *    • revise — keep the scene in place, but rewrite content to land
 *               new plants / honor new guardrails (Pass 2 generates text)
 *    • move   — reorder an existing scene to a new position
 *               (specify `insertAfterOrd`)
 *    • merge  — fold this scene into another existing scene
 *               (specify `mergeIntoOrd`)
 *    • cut    — remove from the new pilot
 *    • add    — insert a new scene anchored after an existing ord
 *               (specify `insertAfterOrd` + `newSlugline`)
 *
 *  Pass 2 generates Fountain text only for `revise` and `add` actions;
 *  `keep` copies verbatim, `move` copies verbatim then repositions,
 *  `merge` folds content, `cut` drops.
 */
export type RedevR6RewriteAction =
  | "keep"
  | "revise"
  | "move"
  | "merge"
  | "cut"
  | "add";

/** Canonical SELVAJE architectural targets the pilot rewrite must hit.
 *  Each scene in the plan can declare which of these it serves; the
 *  audit verifies every target is covered by at least one scene. */
export type RedevR6RewriteTarget =
  | "surrender_execution"
  | "nadia_elena_plant"
  | "paul_phone_driving_plant"
  | "margot_professional_structure"
  | "claire_ritualized_grief"
  | "dean_usefulness"
  | "solano_certainty"
  | "archive_room"
  | "photograph_wall"
  | "final_blended_hook";

export const R6_REWRITE_TARGET_LABEL: Record<RedevR6RewriteTarget, string> = {
  surrender_execution: "Surrender execution",
  nadia_elena_plant: "Nadia / Elena plant",
  paul_phone_driving_plant: "Paul phone / driving plant",
  margot_professional_structure: "Margot professional structure",
  claire_ritualized_grief: "Claire ritualized grief",
  dean_usefulness: "Dean usefulness",
  solano_certainty: "Solano certainty",
  archive_room: "Archive room",
  photograph_wall: "Photograph wall",
  final_blended_hook: "Final blended hook (Option A + C)",
};

export interface RedevR6RewriteScenePlan {
  /** Existing scene's ord (null for `add`). */
  existingSceneOrd: number | null;
  /** Original slugline (for existing scenes — informational). */
  existingSlugline?: string;
  action: RedevR6RewriteAction;
  /** New slugline for `revise` / `add`. */
  newSlugline?: string;
  /** Ord to insert/relocate AFTER, when action is `add` or `move`. */
  insertAfterOrd?: number;
  /** Ord this scene merges INTO, when action is `merge`. */
  mergeIntoOrd?: number;
  /** Plan-level changeNotes (NOT screenplay text). What changes about
   *  this scene in the new version, in showrunner language. */
  changeNotes: string;
  /** Architectural targets this scene serves. Drives the
   *  target-coverage audit (each target must be covered ≥1 scene). */
  targets?: RedevR6RewriteTarget[];
  /** Optional: globalPlants this scene satisfies (free-text match). */
  satisfiesPlants?: string[];
  /** Optional: per-character contracts this scene serves
   *  (characterName values). */
  serves?: string[];
}

export interface RedevPilotRewrite {
  /** ID of the original script preserved as the prior version. The
   *  rewrite never overwrites this. */
  priorScriptId: string;
  /** Scene-by-scene rewrite plan (Pass 1 output). */
  plan?: RedevR6RewriteScenePlan[];
  /** Plan-level approach summary (1–3 sentences). */
  approachSummary?: string;
  /** Pass 1 approval timestamp. Independent of the final-draft
   *  approval below — the plan is approved first, then Pass 2 generates
   *  the actual scene text. */
  planApprovedAt?: string | null;
  /** Pass 2 output — full revised pilot as Fountain text. Populated
   *  when the per-scene rewrite finishes. */
  proposedDraftText: string | null;
  /** When Pass 2 generated the proposed draft. Drives stale-prompt UX
   *  if the plan is later edited after Pass 2 ran. */
  proposedDraftAt?: string | null;
  /** Per-plan-index summary of what Pass 2 did. Mirrors the plan's
   *  action set so the UI can render a kept/revised/cut/moved/added
   *  count without re-running compile. */
  sceneActionSummary?: {
    kept: number;
    revised: number;
    moved: number;
    merged: number;
    cut: number;
    added: number;
  };
  changeNotes: string[];
  /** Promoted draft id — set once the user approves Pass 2 and the
   *  new script row is created. */
  promotedScriptId?: string | null;
  promotedDraftNumber?: number | null;
  /** Final-draft approval — set once Pass 2 output is reviewed +
   *  saved as a new EP01 draft. */
  approvedAt: string | null;
}

// =============================================================================
// R7 — Pilot Polish Pass (Phase 4)
// =============================================================================
//
// R7 does NOT change the approved R1–R6 architecture. It runs targeted
// polish passes on the promoted R6 pilot draft to fix:
//   1. Surrender continuity — items surrendered publicly must not have
//      been surrendered earlier in dialogue.
//   2. Notebook / recorder object logic — surrendered items must stay
//      surrendered; characters can't reach for them later.
//   3. Dialogue polish — replace summarized prose with short, character-
//      specific dialogue in social scenes.
//   4. Showrunner-note prose — strip lines that explain what the audience
//      should feel ("The system is running"). Convert to filmable behavior
//      or cut.
//   5. EP2 hook strength — sharpen the final transparent-case / Paul
//      notification-chime ending without revealing the accident truth.
//
// R7 must NEVER violate the locked R6 protections (Paul reveal, Elena
// sister, Solano framing, Surrender engine, final hook). The R7 audit
// checks for these explicitly.

/** Five locked polish categories. The agent must use only these tokens. */
export type RedevR7PolishCategory =
  | "surrender_continuity"
  | "notebook_recorder_object_logic"
  | "dialogue_polish"
  | "showrunner_note_prose"
  | "episode_2_hook";

export const R7_POLISH_CATEGORY_LABEL: Record<RedevR7PolishCategory, string> = {
  surrender_continuity: "Surrender continuity",
  notebook_recorder_object_logic: "Notebook / recorder object logic",
  dialogue_polish: "Dialogue polish (replace summarized prose)",
  showrunner_note_prose: "Remove showrunner-note prose",
  episode_2_hook: "Strengthen Episode 2 hook",
};

export type RedevR7PolishSeverity = "high" | "medium" | "low";

/** One polish item — a targeted edit the showrunner should sign off on
 *  before Pass 2 (apply) runs. Plan-level prose only — no screenplay
 *  text. */
export interface RedevR7PolishItem {
  /** Existing scene ord in the promoted EP01 draft. null = pilot-level
   *  note (e.g. an overall ending change that spans the closing block). */
  existingSceneOrd: number | null;
  /** Original slugline (for existing scenes — informational). */
  existingSlugline?: string;
  category: RedevR7PolishCategory;
  /** What's wrong (1-2 sentences, plan-level). Quote the existing text
   *  briefly when useful (e.g. "Line: 'The system is running.'"). */
  diagnosis: string;
  /** What to change (1-3 sentences). Behavior-level direction, not
   *  screenplay text. */
  fixDirection: string;
  severity?: RedevR7PolishSeverity;
  /** Optional scope hint for the apply pass — line vs. scene vs.
   *  ending. */
  scope?: "line" | "scene" | "ending";
}

export interface RedevR7PolishPlan {
  /** The promoted R6 script id this polish targets. Frozen at plan
   *  generation time so a later promotion doesn't quietly retarget. */
  priorScriptId: string;
  /** Plan-level approach (1-3 sentences). */
  approachSummary: string;
  /** All polish items, in pilot order where possible. */
  items: RedevR7PolishItem[];
  /** Plan-stage approval. Independent of the final-draft approval —
   *  Pass 2 (apply) only runs after this is set. */
  planApprovedAt: string | null;
  // ----- Pass 2 (apply) outputs — populated later, not by this turn:
  polishedDraftText?: string | null;
  polishedDraftAt?: string | null;
  changeNotes?: string[];
  promotedScriptId?: string | null;
  promotedDraftNumber?: number | null;
  /** Final-draft approval (post-apply promotion). */
  approvedAt?: string | null;
}

// =============================================================================
// R8 — Character Voice & Scene Life Pass
// =============================================================================
//
// R8 sits on top of the R7-polished promoted draft. Its job is to make the
// script feel less engineered and more alive WITHOUT touching the locked
// architecture. Six diagnostic lenses (none of them invent backstory; all
// of them sharpen what's already on the page):
//
//   1. dialogue_naturalness — lines that read theatrical / written
//      replaced with how a real human in that scene would actually speak.
//   2. character_voice — generic lines that could belong to anyone are
//      sharpened into voice the character can own.
//   3. emotional_tension — flat scenes get a micro-beat (a held breath, a
//      look that doesn't land, a withheld response) to lift internal stakes.
//   4. scene_rhythm — dragging passages tighten; rushed ones breathe.
//   5. subtext_moment — on-the-nose lines are replaced with action that
//      contradicts the words, or silence that holds the room.
//   6. behavioral_de_repetition — the same observation said three times
//      collapses to one stronger version.
//
// R8 must NEVER violate the locked protections (Paul reveal, Elena sister,
// Solano framing, Surrender engine, final hook). It must NEVER add new
// showrunner-note prose (same rule as R7). It must NEVER reveal backstory.

/** Six locked voice/life categories. The agent must use only these tokens. */
export type RedevR8VoicePolishCategory =
  | "dialogue_naturalness"
  | "character_voice"
  | "emotional_tension"
  | "scene_rhythm"
  | "subtext_moment"
  | "behavioral_de_repetition";

export const R8_VOICE_CATEGORY_LABEL: Record<RedevR8VoicePolishCategory, string> = {
  dialogue_naturalness: "Dialogue naturalness",
  character_voice: "Character-specific voice",
  emotional_tension: "Emotional tension micro-beats",
  scene_rhythm: "Scene rhythm",
  subtext_moment: "Subtext moments",
  behavioral_de_repetition: "Remove behavioral repetition",
};

export type RedevR8VoicePolishSeverity = "high" | "medium" | "low";

/** One voice/life polish item — a targeted edit the showrunner should
 *  sign off on before R8 Pass 2 (apply) runs. Plan-level prose only —
 *  no screenplay text. */
export interface RedevR8VoicePolishItem {
  /** Existing scene ord in the promoted R7 draft. null = pilot-level
   *  note (e.g. a rhythm note that spans multiple scenes). */
  existingSceneOrd: number | null;
  /** Original slugline (for existing scenes — informational). */
  existingSlugline?: string;
  category: RedevR8VoicePolishCategory;
  /** Optional character this voice item targets (informational —
   *  helps the showrunner review by character). */
  character?: string;
  /** What's wrong (1-2 sentences, plan-level). Quote the existing text
   *  briefly when useful. */
  diagnosis: string;
  /** What to change (1-3 sentences). Behavior-level direction, not
   *  screenplay text. */
  fixDirection: string;
  severity?: RedevR8VoicePolishSeverity;
  /** Optional scope hint for the apply pass. */
  scope?: "line" | "beat" | "scene";
}

export interface RedevR8VoicePolishPlan {
  /** The promoted R7 script id this voice polish targets. Frozen at
   *  plan generation time so a later promotion doesn't quietly retarget. */
  priorScriptId: string;
  /** Plan-level approach (1-3 sentences) — overall voice/life stance. */
  approachSummary: string;
  /** All voice/life polish items, in pilot order where possible. */
  items: RedevR8VoicePolishItem[];
  /** Plan-stage approval. Pass 2 (apply) only runs after this is set. */
  planApprovedAt: string | null;
  // ----- Pass 2 (apply) outputs:
  polishedDraftText?: string | null;
  polishedDraftAt?: string | null;
  changeNotes?: string[];
  promotedScriptId?: string | null;
  promotedDraftNumber?: number | null;
  /** Final-draft approval (post-apply promotion). */
  approvedAt?: string | null;
}

// =============================================================================
// R9 — Final Hook & Emotional Anchor Pass
// =============================================================================
//
// R9 is the final automated screenplay rewrite pass for Episode 1. It
// reads the R8-promoted Draft 4 and applies five tightly-scoped lenses
// without touching architecture, structure, or core character beats:
//
//   1. margot_emotional_anchor — one private, controlled emotional crack
//      tied to the unlabeled file. Behavior, not exposition. No Cass
//      reveal. No grief speech.
//   2. archive_visual_mystery — one stronger visual plant when Solano
//      enters the archive room: photo wall, labeled files, removed
//      frame, covered section. No Elena/sister reveal. No "younger
//      version of someone" clue.
//   3. sound_design — strengthen recurring motifs: recorder click/hum,
//      rain, jungle, howler monkeys, transparent case lock, silence,
//      notification chime.
//   4. pacing_economy — trim or tighten 1-2 pages by reducing repeated
//      behavioral beats (especially canopy / thermal pools / repeated
//      observing gestures). All core plants preserved.
//   5. final_hook_polish — keep the transparent case / Paul phone /
//      chime ending; add one restrained extra beat (e.g. the chime
//      repeating softly, Paul's fingers moving once then stopping).
//      No reveal of texting / accident / timestamp / guilt.
//
// R9 must NEVER violate the locked R7/R8 protections. Draft 5 (the R9
// output) is the locked Episode 1 writing draft.

/** Five locked final-polish categories. The agent must use only these tokens. */
export type RedevR9FinalPolishCategory =
  | "margot_emotional_anchor"
  | "archive_visual_mystery"
  | "sound_design"
  | "pacing_economy"
  | "final_hook_polish";

export const R9_FINAL_CATEGORY_LABEL: Record<RedevR9FinalPolishCategory, string> = {
  margot_emotional_anchor: "Margot emotional anchor",
  archive_visual_mystery: "Archive-room visual mystery",
  sound_design: "Sound design motifs",
  pacing_economy: "Pacing economy",
  final_hook_polish: "Final hook polish",
};

export type RedevR9FinalPolishSeverity = "high" | "medium" | "low";

/** One final-polish item — same shape as R7/R8 items so the apply pass
 *  + audit pipeline can share patterns. Plan-level prose only, no
 *  screenplay text. */
export interface RedevR9FinalPolishItem {
  /** Existing scene ord in the promoted Draft 4. null = pilot-level
   *  (e.g. a sound-motif note that spans multiple scenes, or the
   *  closing-block hook polish). */
  existingSceneOrd: number | null;
  existingSlugline?: string;
  /** Optional character this item targets (informational). */
  character?: string;
  category: RedevR9FinalPolishCategory;
  diagnosis: string;
  fixDirection: string;
  severity?: RedevR9FinalPolishSeverity;
  scope?: "line" | "beat" | "scene" | "ending" | "motif";
}

export interface RedevR9FinalPolishPlan {
  /** The promoted R8 script id this final polish targets. */
  priorScriptId: string;
  /** Plan-level approach (1-3 sentences). */
  approachSummary: string;
  items: RedevR9FinalPolishItem[];
  /** Plan-stage approval. */
  planApprovedAt: string | null;
  // ----- Pass 2 (apply) outputs:
  polishedDraftText?: string | null;
  polishedDraftAt?: string | null;
  changeNotes?: string[];
  promotedScriptId?: string | null;
  promotedDraftNumber?: number | null;
  approvedAt?: string | null;
}

/** Per-character contract for R6 — what the rewrite is allowed to plant,
 *  what it must NOT reveal, what executional moves are forbidden, and
 *  the overall tone the rewrite should land. R6's system prompt MUST
 *  read these and forbid the items in `doNotReveal` / `doNotDo` outright. */
export interface RedevR6Guardrail {
  /** The character the guardrail applies to. Free text — matched
   *  case-insensitively against approved R2 bibles for display. */
  characterName: string;
  /** Beats / behaviors the pilot SHOULD plant (camera-visible). */
  plants: string[];
  /** Facts / reveals the pilot must NOT expose. */
  doNotReveal: string[];
  /** Executional moves the rewrite must NOT make (e.g. "imply guilt
   *  through dialogue or obvious reaction shots"). */
  doNotDo: string[];
  /** One-line tonal instruction (e.g. "execute unease only"). */
  executionRule: string;
}

/** Full R6 guardrail contract: per-character contracts + a global
 *  rewrite rule that applies to the whole pilot + approval state. The
 *  bundle is approved as a unit — the global rule and the per-character
 *  contracts have to be coherent together, so partial approval
 *  doesn't make sense. */
export interface RedevR6GuardrailsBundle {
  perCharacter: RedevR6Guardrail[];
  /** Whole-pilot rewrite rule. Series-level constraints (no flashbacks,
   *  no confession circles, engine is X, end on hook Y) — anything that
   *  isn't per-character. */
  globalRule: string;
  /** Pilot-level concrete plants that aren't owned by any single
   *  character (archive room, transparent case, photograph wall, etc.).
   *  Separated from per-character contracts so the per-character cards
   *  don't get polluted with architectural beats. */
  globalPlants?: string[];
  approvedAt: string | null;
}

// =============================================================================
// Pass envelope
// =============================================================================

export interface RedevelopmentPass {
  id: string;
  title: string;
  createdAt: string;
  createdBy: string;
  status: "in_progress" | "approved" | "abandoned";
  /** Which RedevProjectTemplate this pass runs against. Optional for
   *  backward-compat: passes created before the template-framework
   *  refactor have no value and are resolved as `"selvaje"` (since
   *  SELVAJE was the only pre-existing project). Use
   *  `resolveActiveTemplate(pass)` from `templates/index.ts` rather
   *  than reading this field directly. */
  redevTemplateId?: string | null;
  brief: RedevBrief | null;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  seasonArc: {
    episodes: RedevSeasonArcEpisode[];
    approvedAt: string | null;
    /** Free-text classifications for approved R3 modules that are NOT
     *  used as primary episode anchors. Format is open — the showrunner
     *  writes one paragraph per module describing whether it's a
     *  supporting/embedded beat, an alternate module, or saved for
     *  future season. The R4 audit checks that every approved-but-
     *  unused module's NAME appears in this text. */
    supportingModuleUsageNotes?: string;
    /** Persistent steering note for the next Regenerate of the whole
     *  arc. Same pattern as the R3 module's per-module steeringNote.
     *  Editable any time; saving it never drops the arc's approval. */
    steeringNote?: string;
  } | null;
  pilotStrategy: RedevPilotStrategy | null;
  pilotRewrite: RedevPilotRewrite | null;
  /** R6 guardrails bundle: per-character contracts + global rule +
   *  approval state. Older passes may have stored this as a bare
   *  `RedevR6Guardrail[]` (pre-bundle shape); readers should normalize
   *  with `normalizeR6Guardrails()`. */
  r6Guardrails?: RedevR6GuardrailsBundle | RedevR6Guardrail[];
  /** R7 Pilot Polish Pass — targeted polish on the promoted R6 draft.
   *  Plan-stage only on first build (Pass 2 / apply ships next). */
  r7Polish?: RedevR7PolishPlan | null;
  /** R8 Character Voice & Scene Life Pass — voice/life polish on the
   *  promoted R7 draft. Same two-pass shape as R7 (plan → apply). */
  r8VoicePolish?: RedevR8VoicePolishPlan | null;
  /** R9 Final Hook & Emotional Anchor Pass — final automated rewrite
   *  on the promoted R8 Draft 4. Produces Draft 5, the locked Episode 1
   *  writing draft. Same two-pass shape as R7/R8. */
  r9FinalPolish?: RedevR9FinalPolishPlan | null;
}

// =============================================================================
// Audit / Quality Check
// =============================================================================
//
// Every generation runs a deterministic post-validator. The validator
// reports which rules were checked, which fired, what was auto-repaired,
// and what the showrunner should review manually. The UI shows this as a
// "Generation Quality Check" panel so the user can see at a glance that
// the predictable rules were enforced.

export type AuditCheckId =
  // R3 — Protocol modules
  | "r3_character_inclusion"
  | "r3_tool_continuity"
  | "r3_solano_ethics"
  | "r3_paul_reveal_timing"
  | "r3_behavioral_not_therapy"
  | "r3_strategy_not_wound"
  | "r3_module_distinctness"
  // R4 — Season arc
  | "r4_episode_engine"
  | "r4_paul_timing"
  | "r4_nadia_elena_timing"
  | "r4_solano_framing"
  | "r4_pilot_plant_usefulness"
  | "r4_finale_logic"
  | "r4_approved_module_usage"
  // R5 — Pilot strategy
  | "r5_lists_populated"
  | "r5_character_coverage"
  | "r5_no_contradictions"
  | "r5_hook_options"
  | "r5_seeds_match_arc"
  | "r5_solano_framing"
  | "r5_paul_timing"
  // R5 — provenance + scope
  | "r5_pilot_draft_read"
  | "r5_architecture_used"
  | "r5_no_screenplay_pages"
  // R5 — SELVAJE-specific plant + driver checks
  | "r5_plants_filmable"
  | "r5_elena_protected"
  | "r5_archive_room_plant"
  | "r5_margot_professional_identity"
  | "r5_surrender_drives_pilot"
  // R6 — guardrail completeness + protected reveals + global rule
  | "r6_all_principals_covered"
  | "r6_each_has_plants"
  | "r6_each_has_donotreveal"
  | "r6_paul_reveal_protected"
  | "r6_elena_protected"
  | "r6_solano_rule_protected"
  | "r6_surrender_drives_pilot"
  | "r6_final_hook_direction"
  | "r6_no_screenplay_attempted"
  // R6 — contamination + global plant separation
  | "r6_no_cross_contamination"
  | "r6_global_plants_separated"
  // R7 — Polish plan
  | "r7plan_items_present"
  | "r7plan_categories_covered"
  | "r7plan_no_screenplay_text"
  | "r7plan_paul_reveal_protected"
  | "r7plan_elena_protected"
  | "r7plan_solano_framing_protected"
  | "r7plan_surrender_preserved"
  | "r7plan_final_hook_preserved"
  | "r7plan_no_architecture_drift"
  // R7 Pass 2 — applied draft
  | "r7apply_draft_changed"
  | "r7apply_paul_reveal_protected"
  | "r7apply_elena_protected"
  | "r7apply_solano_protected"
  | "r7apply_surrender_present"
  | "r7apply_final_hook_present"
  | "r7apply_no_flashbacks"
  | "r7apply_no_confession_circles"
  | "r7apply_no_therapy_exposition"
  | "r7apply_no_explanatory_replacement"
  | "r7apply_showrunner_notes_removed"
  | "r7apply_no_screenplay_drift"
  // R6 Rewrite Plan (Pass 1) — coverage + safety + scope
  | "r6plan_existing_scenes_covered"
  | "r6plan_targets_covered"
  | "r6plan_no_screenplay_text"
  | "r6plan_paul_reveal_protected"
  | "r6plan_elena_protected"
  | "r6plan_solano_framing"
  | "r6plan_surrender_present"
  | "r6plan_final_hook_present"
  // R6 Rewrite Pass 2 — full-document audit
  | "r6draft_paul_protected"
  | "r6draft_elena_protected"
  | "r6draft_solano_protected"
  | "r6draft_surrender_present"
  | "r6draft_margot_planted"
  | "r6draft_nadia_planted"
  | "r6draft_claire_planted"
  | "r6draft_dean_planted"
  | "r6draft_archive_room_planted"
  | "r6draft_photograph_wall_planted"
  | "r6draft_final_hook_present"
  | "r6draft_no_flashbacks"
  | "r6draft_no_confession_circles"
  | "r6draft_no_therapy_exposition"
  | "r6draft_no_solano_fraud_drift";

export type AuditCheckStatus = "passed" | "warning" | "auto_repaired";

export interface AuditCheck {
  id: AuditCheckId;
  label: string;
  status: AuditCheckStatus;
  /** Plain-language summary shown in the UI panel. */
  message: string;
}

export interface AuditRepair {
  /** Which rule triggered the repair. */
  checkId: AuditCheckId;
  /** Plain-language description of the change, e.g. "Added Claire
   *  Beaumont to affected characters because the module included
   *  Claire's grief ritual." */
  description: string;
}

export interface AuditReport {
  checks: AuditCheck[];
  repairs: AuditRepair[];
}

// =============================================================================
// Computed gate state
// =============================================================================

export type RedevStageStatus =
  | "locked"      // prerequisites not met
  | "available"   // can start
  | "in_progress" // payload exists, not yet approved
  | "approved";

export interface RedevPassReport {
  passId: string;
  pass: RedevelopmentPass;
  stages: Record<RedevStageKey, {
    status: RedevStageStatus;
    blockedBy: RedevStageKey[];
  }>;
}

/** Coerce whatever's stored in `pass.r6Guardrails` to the bundle shape.
 *  Older passes stored a bare `RedevR6Guardrail[]` — convert by wrapping
 *  in a bundle with empty globalRule + no approval. Null / undefined
 *  becomes an empty bundle. */
export function normalizeR6Guardrails(
  raw: RedevR6GuardrailsBundle | RedevR6Guardrail[] | null | undefined
): RedevR6GuardrailsBundle {
  if (!raw) {
    return { perCharacter: [], globalRule: "", approvedAt: null };
  }
  if (Array.isArray(raw)) {
    return { perCharacter: raw, globalRule: "", approvedAt: null };
  }
  return {
    perCharacter: raw.perCharacter ?? [],
    globalRule: raw.globalRule ?? "",
    globalPlants: raw.globalPlants ?? [],
    approvedAt: raw.approvedAt ?? null,
  };
}
