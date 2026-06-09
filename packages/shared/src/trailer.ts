// Shared types for the Trailer / Teaser Builder. Mirrors
// backend/src/trailer/types.ts.

export type TrailerVariantKey = "teaser15" | "teaser30" | "trailer60" | "social";

export interface TrailerStructure {
  openingImage: string;
  escalation: string;
  revealWithheld: string;
  finalHook: string;
}

export interface TrailerBeat {
  index: number;
  durationSec: number;
  sourceSceneOrd: number | null;
  sourceShotIndex: number | null;
  sourceApprovedAt: string | null;
  videoPrompt: string;
  imagePrompt: string | null;
  textOverlay: string | null;
  musicFragment: string;
  editingNote: string;
  isWithheldSafe: boolean;
}

export interface TitleCardBeat {
  index: number;
  durationSec: number;
  text: string;
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
  musicGuidance: string;
}

export interface TrailerPack {
  episodeId: string;
  version: number;
  approvedAt: string | null;
  approvedBy: string | null;
  derivedFromApprovedShots: boolean;
  derivedFromApprovedMusic: boolean;
  updatedAt: string;
  createdAt: string;
  sourceScriptId: string | null;
  variants: {
    teaser15: TrailerPlan | null;
    teaser30: TrailerPlan | null;
    trailer60: TrailerPlan | null;
    social: TrailerPlan | null;
  };
}

export interface TrailerSourceInfo {
  projectType: string;
  projectTypeLabel: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scriptId: string | null;
  scriptDraftNumber: number | null;
  scriptIsLocked: boolean;
  approvedShotCount: number;
  totalShotCount: number;
  approvedMusic: boolean;
  approvedSonicPhilosophy: boolean;
  hasEpisodeChain: boolean;
  whatNotToReveal: string[];
}

export interface TrailerPackResponse {
  pack: TrailerPack;
  source: TrailerSourceInfo;
}

export const TRAILER_VARIANTS: TrailerVariantKey[] = [
  "teaser15",
  "teaser30",
  "trailer60",
  "social",
];
