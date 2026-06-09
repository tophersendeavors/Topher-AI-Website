// Music generation layer for the Sound Bible.
//
// The Sound Bible is canonical. Music prompts are DERIVED from the
// approved canon. They live at projects.metadata.soundBibles[episodeId]
// .musicPack and are tool-agnostic — adapters render to Suno, Udio,
// composer briefs, and future targets without changing the canonical
// shape.
//
// Approval contract:
//   • episodeSoundtrack is generated only when episodeSoundIdentity is
//     approved.
//   • Each scenePrompt[ord] is generated only when the SoundBible's
//     scene row for that ord is approved AND music isn't forbidden.
//   • trailer is generated only when musicGuidance is approved.
//   • motifFragments are generated only when the relevant motif rules
//     hold (motif id resolves; bible.motifs is non-empty).

/** Tool-agnostic abstract music prompt. Adapters serialise this into
 *  Suno / Udio / Composer Brief strings. */
export interface MusicPrompt {
  /** One-sentence intent — what the cue does. */
  intent: string;
  /** Mood vocabulary (single-word OK). */
  mood: string[];
  /** BPM range as a string ("60-70 BPM"). Null when the cue is
   *  arrhythmic / drone. */
  tempoRange: string | null;
  /** Instrumentation — descriptive only, no real artist/composer names. */
  instrumentation: string[];
  /** Texture vocabulary (sparse, dense, granular, etc.). */
  texture: string[];
  /** Intensity descriptor or 0-10 string. */
  intensity: string;
  /** Target duration in seconds. Null when unconstrained. */
  durationTargetSec: number | null;
  /** loopable | one-shot | null. */
  loopability: "loopable" | "one-shot" | null;
  /** When true, downstream tools must not render any cue here. The cue
   *  exists so the writer sees the explicit "no music" decision. */
  noMusic: boolean;
  /** True when the cue must remain instrumental (default). */
  isInstrumental: boolean;
  /** True iff the writer explicitly opted into vocals. Default false. */
  includesVocals: boolean;
  /** Free-form description — descriptive style language only, no
   *  copyrighted references. Validator enforces. */
  description: string;
  /** Provenance — which canon section drove this prompt. */
  derivedFrom: MusicDerivationSource;
  /** Per-prompt approval. Composer brief copy + Suno copy buttons
   *  surface unapproved prompts but mark them as DRAFT. */
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface MusicDerivationSource {
  kind: "episode_identity" | "scene_row" | "music_guidance" | "motif_registry";
  /** scene ord when kind === "scene_row"; motif id when kind === "motif_registry". */
  ref?: string | number;
}

/** Trailer music has three duration variants + an explicit build
 *  structure (start → rise → break → final hit). */
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

/** One fragment per registered motif. Shorter than a full prompt;
 *  designed to be concatenated into a scene prompt or to be exported
 *  standalone for a producer building a motif library. */
export interface MusicMotifFragment {
  motifId: string;
  motifLabel: string;
  /** One-line Suno-ready prompt fragment. */
  prompt: string;
  mood: string[];
  instrumentation: string[];
  texture: string[];
  approvedAt: string | null;
  approvedBy: string | null;
}

/** Top-level pack stored on the bible. */
export interface MusicPromptPack {
  /** Increments on every regenerate / edit. */
  version: number;
  /** Whole-pack approval. Per-prompt approvals are independent. */
  approvedAt: string | null;
  approvedBy: string | null;
  /** Provenance — was the canon driving this pack itself fully
   *  approved? Surfaced in UI as "Generated from APPROVED canon" vs
   *  "Generated partly from DRAFT canon". */
  derivedFromApprovedCanon: boolean;
  updatedAt: string;

  episodeSoundtrack: MusicPrompt | null;
  /** Keyed by script_scenes.ord. */
  scenePrompts: Record<string, MusicPrompt>;
  trailer: TrailerMusicPrompts | null;
  /** One per approved motif. */
  motifFragments: MusicMotifFragment[];
}

/** Adapter targets. The system is tool-agnostic — Suno is the first
 *  adapter, not the only one. */
export const MUSIC_ADAPTERS = ["suno", "udio", "composer_brief"] as const;
export type MusicAdapter = (typeof MUSIC_ADAPTERS)[number];

/** Music-pack export scopes — what the user is copying. */
export type MusicExportScope =
  | { kind: "episode" }
  | { kind: "scene"; ord: number }
  | { kind: "trailer"; variant: "15" | "30" | "60" | "all" }
  | { kind: "motif"; motifId: string }
  | { kind: "all" };

export function emptyMusicPromptPack(): MusicPromptPack {
  return {
    version: 0,
    approvedAt: null,
    approvedBy: null,
    derivedFromApprovedCanon: false,
    updatedAt: new Date().toISOString(),
    episodeSoundtrack: null,
    scenePrompts: {},
    trailer: null,
    motifFragments: [],
  };
}

export function emptyMusicPrompt(derivedFrom: MusicDerivationSource): MusicPrompt {
  return {
    intent: "",
    mood: [],
    tempoRange: null,
    instrumentation: [],
    texture: [],
    intensity: "",
    durationTargetSec: null,
    loopability: null,
    noMusic: false,
    isInstrumental: true,
    includesVocals: false,
    description: "",
    derivedFrom,
    approvedAt: null,
    approvedBy: null,
  };
}
