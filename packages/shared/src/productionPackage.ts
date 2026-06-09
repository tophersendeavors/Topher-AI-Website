// Shared types for the Production Package Export.

export type ProductionPackageScope = "episode" | "project";
export type ProductionPackageWarningLevel = "info" | "warning";

export interface ProductionPackageWarning {
  section: string;
  level: ProductionPackageWarningLevel;
  message: string;
}

export interface ProductionPackageManifest {
  schemaVersion: 1;
  projectId: string;
  projectTitle: string | null;
  episodeId: string | null;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scriptId: string;
  draftNumber: number | null;
  lockedWritingDraft: boolean;
  exportedAt: string;
  scope: ProductionPackageScope;
  includedSections: string[];
  warnings: ProductionPackageWarning[];
  sourceCommitHash: string | null;
  /** Role-routed briefs (Phase D). Optional — present on episode-scoped
   *  bundles when role assignments exist. */
  roleBriefsIncluded?: boolean;
  /** Number of role assignments at export time (covers both required
   *  and optional roles). */
  roleAssignmentCount?: number;
  /** Number of distinct unassigned roles surfaced across all shots. */
  roleSkippedCount?: number;
}
