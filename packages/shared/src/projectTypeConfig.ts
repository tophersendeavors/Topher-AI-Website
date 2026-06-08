// Project-type adapter (see docs/PROJECT_TYPE_ADAPTERS.md).
//
// The 12-stage Guided Production Workflow is universal. Format-specific
// behavior lives here. Any code that needs to branch on project type
// should call `resolveProjectTypeConfig()` rather than checking
// `projectType === "micro_drama"` inline.

import type { ProjectType, ProjectKind } from "./agents";
// ProjectType and ProjectKind are the canonical shared types — re-imported
// from ./agents to avoid duplicate exports through the barrel.

/** Where Stage 1 (Script Approved) reads its approval signal from on
 *  `scripts.metadata`. Each variant is a distinct shape; the workflow
 *  resolver picks the right one for the project. */
export type ScriptApprovalSource =
  | "micro_drama_approval" // scripts.metadata.microDramaApproval.status
  | "draft_approval";       // scripts.metadata.draftApproval.status

export interface Stage1Deliverable {
  key: string;
  label: string;
  description?: string;
}

export interface ProjectTypeConfig {
  /** Production mode shorthand — used in copy + reports. */
  label: string;
  /** Which `scripts.metadata` field signals script-approved. */
  scriptApprovalSource: ScriptApprovalSource;
  /** Plain-language stage 1 deliverables shown in the workflow. */
  stage1Deliverables: Stage1Deliverable[];
  /** Default aspect ratio for video prompts (used by composer). */
  defaultAspectRatio: "9:16" | "16:9" | "2.39:1" | "1:1";
  /** Whether episodes are required for this format. */
  requiresEpisodes: boolean;
  /** Which recommended-next-step branch to dispatch into. */
  recommendedNextStepBranch: "micro_drama" | "prestige";
}

export const PROJECT_TYPE_CONFIGS: Record<ProjectType, ProjectTypeConfig> = {
  micro_drama: {
    label: "Micro Drama",
    scriptApprovalSource: "micro_drama_approval",
    stage1Deliverables: [
      {
        key: "approval",
        label: "Screenplay approved by writer",
        description: "The locked draft is signed off and downstream departments may build on it.",
      },
      {
        key: "chain",
        label: "Story spine present (hook · setup · twist · cliffhanger)",
        description: "The 4-beat micro-drama chain is fully populated.",
      },
    ],
    defaultAspectRatio: "9:16",
    requiresEpisodes: true,
    recommendedNextStepBranch: "micro_drama",
  },
  prestige_series: {
    label: "Prestige Series",
    scriptApprovalSource: "draft_approval",
    stage1Deliverables: [
      {
        key: "approval",
        label: "Screenplay approved by writer",
        description: "The locked draft is signed off and downstream departments may build on it.",
      },
    ],
    defaultAspectRatio: "2.39:1",
    requiresEpisodes: true,
    recommendedNextStepBranch: "prestige",
  },
  mini_series: {
    label: "Mini Series",
    scriptApprovalSource: "draft_approval",
    stage1Deliverables: [
      {
        key: "approval",
        label: "Screenplay approved by writer",
        description: "The locked draft is signed off and downstream departments may build on it.",
      },
    ],
    defaultAspectRatio: "16:9",
    requiresEpisodes: true,
    recommendedNextStepBranch: "prestige",
  },
};

/** Resolve a `ProjectTypeConfig` from raw project fields. Falls back to
 *  `prestige_series` (the safe long-form default) when neither
 *  `projectType` nor `kind` indicates a known type. */
export function resolveProjectTypeConfig(
  projectType: string | null | undefined,
  kind?: string | null | undefined
): ProjectTypeConfig {
  if (projectType && projectType in PROJECT_TYPE_CONFIGS) {
    return PROJECT_TYPE_CONFIGS[projectType as ProjectType];
  }
  // Kind-only fallback. Micro-drama is identified by metadata.projectType
  // exclusively; kind alone never resolves to micro.
  if (kind === "miniseries") return PROJECT_TYPE_CONFIGS.mini_series;
  return PROJECT_TYPE_CONFIGS.prestige_series;
}

/** Test whether a script's metadata indicates Stage 1 should auto-approve.
 *  Uses the config's `scriptApprovalSource` so micro reads
 *  `microDramaApproval` and other types read `draftApproval`. */
export function isScriptApprovedForProduction(
  scriptMetadata: Record<string, unknown> | null | undefined,
  config: ProjectTypeConfig
): { approved: boolean; approvedAt: string | null } {
  const meta = scriptMetadata ?? {};
  if (config.scriptApprovalSource === "micro_drama_approval") {
    const m = meta.microDramaApproval as
      | { status?: string; approvedAt?: string }
      | undefined;
    if (m?.status === "approved") {
      return { approved: true, approvedAt: m.approvedAt ?? null };
    }
    return { approved: false, approvedAt: null };
  }
  // draft_approval
  const m = meta.draftApproval as
    | { status?: string; approvedAt?: string }
    | undefined;
  if (m?.status === "approved") {
    return { approved: true, approvedAt: m.approvedAt ?? null };
  }
  return { approved: false, approvedAt: null };
}

/** For Stage 1's "story spine / treatment present" check. Returns whether
 *  the secondary deliverable on Stage 1 is satisfied. */
export function isScriptSpinePresent(
  scriptMetadata: Record<string, unknown> | null | undefined,
  config: ProjectTypeConfig
): boolean {
  const meta = scriptMetadata ?? {};
  if (config.scriptApprovalSource === "micro_drama_approval") {
    const chain = meta.chainSnapshot as
      | { hook?: string; setup?: string; twist?: string; cliffhanger?: string }
      | undefined;
    return !!(chain?.hook && chain?.setup && chain?.twist && chain?.cliffhanger);
  }
  // Non-micro: the "spine" concept is the chain; for other formats the
  // only Stage 1 deliverable is the approval itself, so this isn't read.
  return true;
}
