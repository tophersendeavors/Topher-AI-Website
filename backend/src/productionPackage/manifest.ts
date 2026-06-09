// Production Package — manifest schema.

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
  /** Optional GIT_COMMIT_HASH env var — null when not present. */
  sourceCommitHash: string | null;
  /** Phase D — role-routed briefs included in the bundle. Episode-only. */
  roleBriefsIncluded?: boolean;
  /** Number of role assignments at export time. */
  roleAssignmentCount?: number;
  /** Distinct unassigned role keys surfaced across all shots. */
  roleSkippedCount?: number;
}
