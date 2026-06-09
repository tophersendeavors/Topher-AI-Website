// Sound / Music / Atmosphere Bible — types.
//
// Storage:
//   • Episode bibles            → projects.metadata.soundBibles[episodeId]
//   • Character sound signatures → characters.*.metadata.visualBible
//                                  .soundSignatureByEpisode[episodeId]
//   • Location sound signatures  → projects.metadata.locationBibles[locKey]
//                                  .soundSignatureByEpisode[episodeId]
//
// No DB migration — everything sits in existing jsonb columns. Mirrors the
// PropBible / LocationBible pattern.

/** Top-level Sound Bible for a single episode. Keyed by episodeId at
 *  `projects.metadata.soundBibles[episodeId]`. */
export interface SoundBible {
  episodeId: string;
  /** Monotonic — increments on every save. */
  version: number;
  /** Whole-bible approval — set when the writer says "ship this." */
  approvedAt: string | null;
  approvedBy: string | null;
  /** Provenance for the audit trail. */
  sourceScriptId: string | null;
  sourceDraftNumber: number | null;
  sourceWasLocked: boolean;
  updatedAt: string;
  createdAt: string;

  // §1
  episodeSoundIdentity: EpisodeSoundIdentity;

  // §2 — keyed by script_scenes.ord
  scenes: Record<string, SoundSceneBreakdown>;

  // §3 — episode-scoped motif registry
  motifs: SoundMotif[];

  // §4-5 — embedded summary projections of character & location signatures.
  //         Authoritative copies live on `characters` rows and on each
  //         locationBible; the bible holds the per-episode block here so
  //         every read of the SoundBible carries the full episode picture
  //         without N extra round-trips.
  characterSignatures: Record<string, CharacterSoundSignature>;
  locationSignatures: Record<string, LocationSoundSignature>;

  // §6
  musicGuidance: MusicGuidance;
}

// ---------------------------------------------------------------------------
// §1 — Episode identity
// ---------------------------------------------------------------------------

export interface EpisodeSoundIdentity {
  /** Overall approach: how this episode sounds, in one paragraph. */
  sonicPhilosophy: string;
  /** When silence is required and why. */
  silenceRules: string[];
  /** When score must back off. */
  musicRestraintRules: string[];
  /** Atmosphere palette — ambient bed signatures across the episode. */
  atmospherePalette: string[];
  /** Motif IDs that recur across this episode (refs into motifs[]). */
  recurringMotifIds: string[];
  /** How sound carries emotion — observable behaviour-of-sound, not vibes. */
  emotionalUseOfSound: string;
  /** Never-do list — the sound clichés that break the show's voice. */
  forbiddenSoundCliches: string[];
  /** Per-section approval — composer reads this section only when set. */
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

// ---------------------------------------------------------------------------
// §2 — Per-scene breakdown
// ---------------------------------------------------------------------------

export interface SoundSceneBreakdown {
  ord: number;
  sceneHeading: string;
  locationKey: string | null; // normalised LocationBible key
  timeOfDay: string | null;

  /** Ambient bed — the constant audio underneath everything. */
  ambientBed: string;
  /** Key diegetic sounds — what the camera "hears" in-world. */
  keyDiegetic: string[];
  /** Non-diegetic music guidance — score direction for this scene. */
  nonDiegeticMusic: string;
  /** Silence / no-music notes for this scene. */
  silenceNotes: string | null;
  /** Motif IDs present in this scene (refs into motifs[]). */
  motifIds: string[];
  /** Character-linked sounds, keyed by character display name. */
  characterSounds: Record<string, string>;
  /** Transition sound opportunity in or out of this scene. */
  transitionSound: string | null;
  /** Audio note injected into AI video prompts (Veo audio field, Kling
   *  background sound, etc.). One short sentence. */
  aiVideoPromptAudioNotes: string | null;
  /** Per-scene approval — composer reads ONLY approved scene rows. */
  approvedAt: string | null;
  approvedBy: string | null;
}

// ---------------------------------------------------------------------------
// §3 — Motifs
// ---------------------------------------------------------------------------

export interface SoundMotif {
  /** Slug, e.g. "recorder_click", "rain_off_canopy". */
  id: string;
  label: string;
  description: string;
  introducedAtSceneOrd: number | null;
  recurringAtSceneOrds: number[];
  /** Emotional/dramatic function — what the motif tells the audience. */
  emotionalFunction: string;
  rules: string[];
}

// ---------------------------------------------------------------------------
// §4 — Character sound signature (per-episode)
// ---------------------------------------------------------------------------

export interface CharacterSoundSignature {
  /** Character display name. */
  characterName: string;
  /** Optional id (uuid) — present when resolved against the characters table. */
  characterId: string | null;
  /** Sounds the character is associated with. */
  associatedSounds: string[];
  /** Their silence pattern — when they go quiet and what that means. */
  silencePattern: string;
  /** Object sounds the character handles — what objects they touch + how
   *  those objects sound. */
  objectSounds: string[];
  /** When the character's sound layer disappears entirely. */
  soundDisappearance: string;
  /** How sound reveals their avoidance / evasion behaviour. */
  avoidanceSignals: string[];
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

// ---------------------------------------------------------------------------
// §5 — Location sound signature (per-episode)
// ---------------------------------------------------------------------------

export interface LocationSoundSignature {
  /** Display name as written in screenplay sluglines. */
  locationName: string;
  /** Normalised key into projects.metadata.locationBibles. */
  locationKey: string;
  ambientBed: string;
  keyDiegeticPresent: string[];
  /** True when score must NEVER play in this location. */
  musicProhibited: boolean;
  /** Motif IDs anchored to this location (refs into motifs[]). */
  anchoredMotifIds: string[];
  notes: string;
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

// ---------------------------------------------------------------------------
// §6 — Music guidance
// ---------------------------------------------------------------------------

export interface MusicGuidance {
  /** Score philosophy in one paragraph. */
  scorePhilosophy: string;
  /** Moments where music is forbidden — e.g. "any scene with Solano
   *  silent", "the open of every episode". */
  forbiddenMusicMoments: string[];
  /** Moments where tonal underscore is permitted — minimal and rare. */
  permittedTonalUnderscoreMoments: string[];
  /** Trailer music direction — different from in-episode score. */
  trailerMusicDirection: string;
  /** Descriptive style language ONLY. No copyrighted titles, no composer
   *  names, no "in the style of [X]" references. Validator enforces. */
  referenceStyleLanguage: string;
  /** Emotional restraint rules. */
  emotionalRestraintRules: string[];
  sectionApprovedAt: string | null;
  sectionApprovedBy: string | null;
}

// ---------------------------------------------------------------------------
// Validator / audit
// ---------------------------------------------------------------------------

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
  /** Field path the issue is anchored to ("scenes.5.ambientBed"). */
  where: string;
  /** One-line writer-facing remediation when known. */
  suggestedFix?: string;
}

export interface SoundAuditResult {
  runAt: string;
  summary: Record<SoundCheckCategory, { pass: number; warning: number; fail: number }>;
  checks: SoundCheck[];
}

// ---------------------------------------------------------------------------
// Section enum — used by per-section regen routes
// ---------------------------------------------------------------------------

export const SOUND_SECTIONS = [
  "episodeSoundIdentity",
  "scenes",
  "motifs",
  "characterSignatures",
  "locationSignatures",
  "musicGuidance",
] as const;

export type SoundSection = (typeof SOUND_SECTIONS)[number];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function emptyEpisodeSoundIdentity(): EpisodeSoundIdentity {
  return {
    sonicPhilosophy: "",
    silenceRules: [],
    musicRestraintRules: [],
    atmospherePalette: [],
    recurringMotifIds: [],
    emotionalUseOfSound: "",
    forbiddenSoundCliches: [],
    sectionApprovedAt: null,
    sectionApprovedBy: null,
  };
}

export function emptyMusicGuidance(): MusicGuidance {
  return {
    scorePhilosophy: "",
    forbiddenMusicMoments: [],
    permittedTonalUnderscoreMoments: [],
    trailerMusicDirection: "",
    referenceStyleLanguage: "",
    emotionalRestraintRules: [],
    sectionApprovedAt: null,
    sectionApprovedBy: null,
  };
}

export function emptySoundBible(episodeId: string): SoundBible {
  const now = new Date().toISOString();
  return {
    episodeId,
    version: 0,
    approvedAt: null,
    approvedBy: null,
    sourceScriptId: null,
    sourceDraftNumber: null,
    sourceWasLocked: false,
    updatedAt: now,
    createdAt: now,
    episodeSoundIdentity: emptyEpisodeSoundIdentity(),
    scenes: {},
    motifs: [],
    characterSignatures: {},
    locationSignatures: {},
    musicGuidance: emptyMusicGuidance(),
  };
}
