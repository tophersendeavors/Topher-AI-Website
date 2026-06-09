// Shared types for the Production Hub.

export type ProductionHubSectionStatus =
  | "missing"
  | "partial"
  | "approved"
  | "locked"
  | "complete";

export interface ProductionHubSection {
  status: ProductionHubSectionStatus;
  detail: string;
}

export interface ProductionHubShotListSection extends ProductionHubSection {
  approvedCount: number;
  totalCount: number;
}

export interface ProductionHubEpisodeRow {
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scriptId: string | null;
  scriptDraftNumber: number | null;
  lockedWritingDraft: boolean;
  readinessPct: number;
  sections: {
    screenplay: ProductionHubSection;
    characters: ProductionHubSection;
    locations: ProductionHubSection;
    props: ProductionHubSection;
    soundBible: ProductionHubSection;
    shotList: ProductionHubShotListSection;
    aiVideoPrompts: ProductionHubSection;
    trailerPack: ProductionHubSection;
    packageReady: ProductionHubSection;
  };
}

export interface ProductionHubSummary {
  episodeCount: number;
  lockedScripts: number;
  approvedSoundBibles: number;
  approvedShotLists: number;
  generatedTrailers: number;
  packagesReady: number;
  overallReadinessPct: number;
}

export interface ProductionHubResponse {
  projectId: string;
  projectTitle: string | null;
  projectType: string;
  pitchStatus: ProductionHubSectionStatus;
  pitchDetail: string;
  rows: ProductionHubEpisodeRow[];
  summary: ProductionHubSummary;
}
