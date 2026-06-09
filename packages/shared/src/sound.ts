// Shared types for the Sound / Music / Atmosphere Bible. Mirrors
// backend/src/sound/types.ts exactly — keep the two in sync.

export interface EpisodeSoundIdentity {
  sonicPhilosophy: string;
  silenceRules: string[];
  musicRestraintRules: string[];
  atmospherePalette: string[];
  recurringMotifIds: string[];
  emotionalUseOfSound: string;
  forbiddenSoundCliches: string[];
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

export interface SoundSceneBreakdown {
  ord: number;
  sceneHeading: string;
  locationKey: string | null;
  timeOfDay: string | null;
  ambientBed: string;
  keyDiegetic: string[];
  nonDiegeticMusic: string;
  silenceNotes: string | null;
  motifIds: string[];
  characterSounds: Record<string, string>;
  transitionSound: string | null;
  aiVideoPromptAudioNotes: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface SoundMotif {
  id: string;
  label: string;
  description: string;
  introducedAtSceneOrd: number | null;
  recurringAtSceneOrds: number[];
  emotionalFunction: string;
  rules: string[];
}

export interface CharacterSoundSignature {
  characterName: string;
  characterId: string | null;
  associatedSounds: string[];
  silencePattern: string;
  objectSounds: string[];
  soundDisappearance: string;
  avoidanceSignals: string[];
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

export interface LocationSoundSignature {
  locationName: string;
  locationKey: string;
  ambientBed: string;
  keyDiegeticPresent: string[];
  musicProhibited: boolean;
  anchoredMotifIds: string[];
  notes: string;
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

export interface MusicGuidance {
  scorePhilosophy: string;
  forbiddenMusicMoments: string[];
  permittedTonalUnderscoreMoments: string[];
  trailerMusicDirection: string;
  referenceStyleLanguage: string;
  emotionalRestraintRules: string[];
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

export interface SoundBible {
  episodeId: string;
  version: number;
  approvedAt: string | null;
  approvedBy: string | null;
  sourceScriptId: string | null;
  sourceDraftNumber: number | null;
  sourceWasLocked: boolean;
  /** Friendly source label e.g. "Draft 5". */
  sourceDraftLabel: string | null;
  /** djb2 hashes of the source script's fountain + scene index at the
   *  time the bible was generated. Used to detect drift. */
  sourceFountainHash: string | null;
  sourceScenesHash: string | null;
  sourceSceneCount: number | null;
  updatedAt: string;
  createdAt: string;
  episodeSoundIdentity: EpisodeSoundIdentity;
  scenes: Record<string, SoundSceneBreakdown>;
  motifs: SoundMotif[];
  characterSignatures: Record<string, CharacterSoundSignature>;
  locationSignatures: Record<string, LocationSoundSignature>;
  musicGuidance: MusicGuidance;
}

export type SoundCheckSeverity = "pass" | "warning" | "fail";
export type SoundCheckCategory =
  | "completeness"
  | "copyrighted_reference"
  | "motif_consistency"
  | "schema"
  | "approval_gate";

export interface SoundCheck {
  id: string;
  category: SoundCheckCategory;
  severity: SoundCheckSeverity;
  message: string;
  where: string;
  suggestedFix?: string;
}

export interface SoundAuditResult {
  runAt: string;
  summary: Record<SoundCheckCategory, { pass: number; warning: number; fail: number }>;
  checks: SoundCheck[];
}

export const SOUND_SECTIONS = [
  "episodeSoundIdentity",
  "scenes",
  "motifs",
  "characterSignatures",
  "locationSignatures",
  "musicGuidance",
] as const;

export type SoundSection = (typeof SOUND_SECTIONS)[number];

export interface SoundBibleSourceInfo {
  scriptId: string | null;
  scriptDraftNumber: number | null;
  scriptIsLocked: boolean;
  episodeNumber: number | null;
  episodeTitle: string | null;
  sceneCount: number;
}

/** Coverage of the SoundBible vs the current locked source draft. */
export interface SoundBibleCoverage {
  expectedOrds: number[];
  presentOrds: number[];
  missingOrds: number[];
  extraOrds: number[];
  approvedSceneCount: number;
  isFullyCovered: boolean;
}

export interface SoundBibleResponse {
  bible: SoundBible;
  source: SoundBibleSourceInfo;
  coverage: SoundBibleCoverage;
}

// ---------------------------------------------------------------------------
// Music prompt pack — derived view of the Sound Bible canon. Tool-agnostic.
// ---------------------------------------------------------------------------

export interface MusicDerivationSource {
  kind: "episode_identity" | "scene_row" | "music_guidance" | "motif_registry";
  ref?: string | number;
}

export interface MusicPrompt {
  intent: string;
  mood: string[];
  tempoRange: string | null;
  instrumentation: string[];
  texture: string[];
  intensity: string;
  durationTargetSec: number | null;
  loopability: "loopable" | "one-shot" | null;
  noMusic: boolean;
  isInstrumental: boolean;
  includesVocals: boolean;
  description: string;
  derivedFrom: MusicDerivationSource;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface TrailerMusicPrompts {
  variant15: MusicPrompt;
  variant30: MusicPrompt;
  variant60: MusicPrompt;
  buildStructure: {
    start: string;
    rise: string;
    break: string;
    finalHit: string;
  };
}

export interface MusicMotifFragment {
  motifId: string;
  motifLabel: string;
  prompt: string;
  mood: string[];
  instrumentation: string[];
  texture: string[];
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface MusicPromptPack {
  version: number;
  approvedAt: string | null;
  approvedBy: string | null;
  derivedFromApprovedCanon: boolean;
  updatedAt: string;
  episodeSoundtrack: MusicPrompt | null;
  scenePrompts: Record<string, MusicPrompt>;
  trailer: TrailerMusicPrompts | null;
  motifFragments: MusicMotifFragment[];
}

export const MUSIC_ADAPTERS = ["suno", "udio", "composer_brief"] as const;
export type MusicAdapter = (typeof MUSIC_ADAPTERS)[number];

export type MusicSlot = "episode" | "scenes" | "trailer" | "motifs";

export interface MusicPackResponse {
  pack: MusicPromptPack | null;
  canonReadiness: {
    episodeIdentityApproved: boolean;
    musicGuidanceApproved: boolean;
    approvedSceneCount: number;
    totalSceneCount: number;
    motifCount: number;
  };
}
