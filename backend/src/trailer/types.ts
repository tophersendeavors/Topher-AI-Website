// Trailer / Teaser Builder — types.
//
// Storage:
//   projects.metadata.trailerBuilder[episodeId]
//
// Reads: approved shot list (scripts.metadata.aiPrompts.briefs +
// shotListApproval), approved Sound Bible (projects.metadata.
// soundBibles[ep]), music pack trailer prompts, character/location/
// prop bibles, episode chain (micro-drama-only).
//
// Writes ONLY to project metadata. Never mutates fountain or script
// scene rows.

export type TrailerVariantKey = "teaser15" | "teaser30" | "trailer60" | "social";

export const TRAILER_VARIANT_DURATIONS: Record<TrailerVariantKey, number> = {
  teaser15: 15,
  teaser30: 30,
  trailer60: 60,
  social: 12,
};

export interface TrailerStructure {
  /** Opening image — first 1–3s. The single image that buys the next
   *  three seconds. */
  openingImage: string;
  /** Escalation — middle of the variant; what raises the stakes. */
  escalation: string;
  /** Reveal-withheld — the moment we tease but do NOT confirm. */
  revealWithheld: string;
  /** Final hook — the last frame that earns the question. */
  finalHook: string;
}

export interface TrailerBeat {
  index: number;
  durationSec: number;
  /** When set, the beat is sourced from an approved shot brief at
   *  scripts.metadata.aiPrompts.briefs[ord][shotIndex]. */
  sourceSceneOrd: number | null;
  sourceShotIndex: number | null;
  /** Whether this beat's source brief was approved at trailer-plan time.
   *  When false, the UI surfaces "using unapproved shot brief". */
  sourceApprovedAt: string | null;
  /** Composer-ready video prompt for this beat. Derived from the source
   *  brief when present; otherwise generated standalone. */
  videoPrompt: string;
  /** Optional still / key-art prompt. */
  imagePrompt: string | null;
  /** Text overlay / title-card copy. */
  textOverlay: string | null;
  /** One-line music guidance — emerges from MusicPromptPack.trailer. */
  musicFragment: string;
  /** Editorial direction — cut, hold, sting, etc. */
  editingNote: string;
  /** True iff this beat does not reveal anything in `whatNotToReveal`. */
  isWithheldSafe: boolean;
}

export interface TitleCardBeat {
  index: number;
  durationSec: number;
  text: string;
  /** Optional visual treatment — image prompt for the card. */
  imagePrompt: string;
  position: "open" | "act_break" | "end";
}

export interface TrailerPlan {
  variantKey: TrailerVariantKey;
  durationSec: number;
  approvedAt: string | null;
  approvedBy: string | null;
  structure: TrailerStructure;
  beats: TrailerBeat[];
  titleCardBeats: TitleCardBeat[];
  voDirection: string | null;
  endingButton: string;
  endingImage: string;
  whatNotToReveal: string[];
  /** One-paragraph music direction for this variant. */
  musicGuidance: string;
}

export interface TrailerPack {
  episodeId: string;
  version: number;
  approvedAt: string | null;
  approvedBy: string | null;
  /** True when every shot referenced by every beat was approved. */
  derivedFromApprovedShots: boolean;
  /** True when the Sound Bible music guidance for this episode was
   *  approved at trailer-plan time. */
  derivedFromApprovedMusic: boolean;
  updatedAt: string;
  createdAt: string;
  /** Carries the source-of-truth script id used at generation time. */
  sourceScriptId: string | null;
  /** Per-variant plans. `social` is optional; absent when the project
   *  type doesn't request it. */
  variants: {
    teaser15: TrailerPlan | null;
    teaser30: TrailerPlan | null;
    trailer60: TrailerPlan | null;
    social: TrailerPlan | null;
  };
}

export function emptyTrailerPlan(variant: TrailerVariantKey): TrailerPlan {
  return {
    variantKey: variant,
    durationSec: TRAILER_VARIANT_DURATIONS[variant],
    approvedAt: null,
    approvedBy: null,
    structure: {
      openingImage: "",
      escalation: "",
      revealWithheld: "",
      finalHook: "",
    },
    beats: [],
    titleCardBeats: [],
    voDirection: null,
    endingButton: "",
    endingImage: "",
    whatNotToReveal: [],
    musicGuidance: "",
  };
}

export function emptyTrailerPack(episodeId: string): TrailerPack {
  const now = new Date().toISOString();
  return {
    episodeId,
    version: 0,
    approvedAt: null,
    approvedBy: null,
    derivedFromApprovedShots: false,
    derivedFromApprovedMusic: false,
    updatedAt: now,
    createdAt: now,
    sourceScriptId: null,
    variants: {
      teaser15: null,
      teaser30: null,
      trailer60: null,
      social: null,
    },
  };
}
