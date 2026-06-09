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

/** Shot/prompt pipeline configuration. Drives the shotlist agent's
 *  directive block, the per-shot prompt composer choice, and prompt
 *  steering. Read by autoBuildBriefs, composeShotPrompt, and the
 *  production pipeline runner instead of inline `projectType` checks. */
export interface ShotPolicy {
  /** Default aspect ratio for new briefs and prompts. */
  defaultAspectRatio: "9:16" | "16:9" | "2.39:1" | "1:1";
  /** Default per-shot duration in seconds. */
  defaultDurationSec: number;
  /** Minimum allowed per-shot duration in seconds. */
  minDurationSec: number;
  /** Maximum allowed per-shot duration in seconds. */
  maxDurationSec: number;
  /** Coverage density tells the shotlist agent how many shots to produce
   *  per scene. minimal = 2-4, standard = 4-7, comprehensive = 6-10. */
  coverageDensity: "minimal" | "standard" | "comprehensive";
  /** Verbatim directive block appended to the shotlist agent's system
   *  prompt. Empty string means no extra steering. */
  shotlistDirectives: string;
  /** Which per-shot composer to use:
   *    "generic"        → backend/src/draft/aiPrompts/composer.ts
   *                        (multi-model, cinematic, variable duration)
   *    "vertical_micro" → backend/src/microDrama/promptComposer.ts
   *                        (9:16, 3-5s, vertical-only)
   *  Adapter routes can branch on this string without naming the project
   *  type. */
  composerKey: "generic" | "vertical_micro";
  /** Subjects/objects the prompt agent should prioritize visually. */
  promptCharacterFocus: string[];
  /** Things the prompt agent should avoid (negative-prompt seed). */
  promptAvoidList: string[];
  /** True when the project type uses the micro-drama production pipeline
   *  (episode chain → vertical prompts). Drives feature gates that today
   *  do bare `projectType === "micro_drama"` string compares. */
  isMicroDramaTier: boolean;
}

export interface ProjectTypeConfig {
  /** Production mode shorthand — used in copy + reports. */
  label: string;
  /** Which `scripts.metadata` field signals script-approved. */
  scriptApprovalSource: ScriptApprovalSource;
  /** Plain-language stage 1 deliverables shown in the workflow. */
  stage1Deliverables: Stage1Deliverable[];
  /** Default aspect ratio for video prompts (used by composer).
   *  @deprecated Read `shotPolicy.defaultAspectRatio` instead. Kept for
   *  backward compat with existing callers; the two values are always
   *  identical. */
  defaultAspectRatio: "9:16" | "16:9" | "2.39:1" | "1:1";
  /** Whether episodes are required for this format. */
  requiresEpisodes: boolean;
  /** Which recommended-next-step branch to dispatch into. */
  recommendedNextStepBranch: "micro_drama" | "prestige";
  /** Shot/prompt pipeline configuration — drives every place that used
   *  to inline-branch on projectType. */
  shotPolicy: ShotPolicy;
}

// ---------------------------------------------------------------------------
// ShotPolicy presets per project type
// ---------------------------------------------------------------------------

/** Verbatim copy of the directive block that previously lived inline in
 *  `backend/src/draft/aiPrompts/autoBuild.ts`. Now driven by config. */
const MICRO_DRAMA_SHOTLIST_DIRECTIVES = [
  "MICRO-DRAMA MODE — retention-first rules:",
  "• Vertical format. aspectRatio defaults to 9:16.",
  "• Prioritize faces, eyes, hands, phones, text messages, voice notes,",
  "  objects, doors, photographs. Tag these shots INSERT / BEH / CHAR.",
  "• AVOID wide establishing shots, large crowds, long exposition,",
  "  expensive environments, complex dialogue.",
  "• Clip length 3–5 seconds. Single beat per shot. No multi-action takes.",
  "• Every scene must contribute to the episode's HOOK / TWIST /",
  "  CLIFFHANGER pull — if a shot doesn't move retention, cut it.",
  "",
].join("\n");

/** Cinematic prestige TV — restrained coverage, no viral language. */
const PRESTIGE_SHOTLIST_DIRECTIVES = [
  "PRESTIGE SERIES MODE — cinematic restraint:",
  "• Widescreen format. aspectRatio defaults to 2.39:1.",
  "• Standard coverage per scene: establishing → master → singles → inserts.",
  "  4–7 shots per scene unless the scene is structurally larger.",
  "• Clip length 4–8 seconds; allow longer takes when motion is low.",
  "• Allow longer dialogue takes when the writing supports it.",
  "• Do NOT optimize for retention spikes. The episode pulls the viewer",
  "  through its narrative, not through visual gimmicks. No vertical",
  "  framing, no short-form social-platform vocabulary.",
  "",
].join("\n");

const FEATURE_SHOTLIST_DIRECTIVES = [
  "FEATURE FILM MODE — cinematic, theatrical pacing:",
  "• Widescreen format. aspectRatio defaults to 2.39:1.",
  "• Coverage may be looser — 3–6 shots per scene; the camera can hold.",
  "• Clip length 5–10 seconds; longer takes when blocking + motion permit.",
  "• Prioritize composition, performance, and atmosphere over coverage count.",
  "• Theatrical scale acceptable (establishing shots, wide vistas).",
  "• No vertical / TikTok / Reels framing.",
  "",
].join("\n");

const ANTHOLOGY_SHOTLIST_DIRECTIVES = [
  "ANTHOLOGY EPISODE MODE — self-contained, tonal consistency optional:",
  "• Widescreen format. aspectRatio defaults to 16:9.",
  "• Standard coverage per scene; treat each episode as its own creative pass.",
  "• Clip length 4–8 seconds.",
  "• Recurring world / tonal cues may surface but are not required per shot.",
  "",
].join("\n");

const MICRO_DRAMA_SHOT_POLICY: ShotPolicy = {
  defaultAspectRatio: "9:16",
  defaultDurationSec: 4,
  minDurationSec: 3,
  maxDurationSec: 5,
  coverageDensity: "minimal",
  shotlistDirectives: MICRO_DRAMA_SHOTLIST_DIRECTIVES,
  composerKey: "vertical_micro",
  promptCharacterFocus: [
    "faces",
    "eyes",
    "hands",
    "phones",
    "text messages",
    "voice notes",
    "doors",
    "photographs",
  ],
  promptAvoidList: [
    "wide establishing shot",
    "large crowd",
    "expensive environment",
    "complex dialogue",
    "cinematic crane",
    "horizontal 16:9",
    "movie poster framing",
  ],
  isMicroDramaTier: true,
};

const PRESTIGE_SHOT_POLICY: ShotPolicy = {
  defaultAspectRatio: "2.39:1",
  defaultDurationSec: 6,
  minDurationSec: 3,
  maxDurationSec: 10,
  coverageDensity: "standard",
  shotlistDirectives: PRESTIGE_SHOTLIST_DIRECTIVES,
  composerKey: "generic",
  promptCharacterFocus: [],
  promptAvoidList: [
    "vertical 9:16",
    "TikTok",
    "Reels",
    "Shorts",
    "viral hook",
    "phone-screen close-up insert chain",
  ],
  isMicroDramaTier: false,
};

const MINI_SERIES_SHOT_POLICY: ShotPolicy = {
  ...PRESTIGE_SHOT_POLICY,
  defaultAspectRatio: "16:9",
  defaultDurationSec: 5,
  maxDurationSec: 8,
};

const FEATURE_SHOT_POLICY: ShotPolicy = {
  defaultAspectRatio: "2.39:1",
  defaultDurationSec: 7,
  minDurationSec: 3,
  maxDurationSec: 12,
  coverageDensity: "comprehensive",
  shotlistDirectives: FEATURE_SHOTLIST_DIRECTIVES,
  composerKey: "generic",
  promptCharacterFocus: [],
  promptAvoidList: [
    "vertical 9:16",
    "TikTok",
    "Reels",
    "Shorts",
    "viral hook",
  ],
  isMicroDramaTier: false,
};

const ANTHOLOGY_SHOT_POLICY: ShotPolicy = {
  defaultAspectRatio: "16:9",
  defaultDurationSec: 5,
  minDurationSec: 3,
  maxDurationSec: 9,
  coverageDensity: "standard",
  shotlistDirectives: ANTHOLOGY_SHOTLIST_DIRECTIVES,
  composerKey: "generic",
  promptCharacterFocus: [],
  promptAvoidList: ["vertical 9:16", "TikTok", "Reels", "Shorts"],
  isMicroDramaTier: false,
};

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
    shotPolicy: MICRO_DRAMA_SHOT_POLICY,
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
    shotPolicy: PRESTIGE_SHOT_POLICY,
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
    shotPolicy: MINI_SERIES_SHOT_POLICY,
  },
  feature: {
    label: "Feature Film",
    scriptApprovalSource: "draft_approval",
    stage1Deliverables: [
      {
        key: "approval",
        label: "Screenplay approved by writer",
        description: "The locked screenplay is signed off and downstream departments may build on it.",
      },
    ],
    defaultAspectRatio: "2.39:1",
    requiresEpisodes: false,
    recommendedNextStepBranch: "prestige",
    shotPolicy: FEATURE_SHOT_POLICY,
  },
  anthology: {
    label: "Anthology",
    scriptApprovalSource: "draft_approval",
    stage1Deliverables: [
      {
        key: "approval",
        label: "Episode screenplay approved by writer",
        description: "Each anthology episode is a self-contained creative pass; the writer approves per episode.",
      },
    ],
    defaultAspectRatio: "16:9",
    requiresEpisodes: true,
    recommendedNextStepBranch: "prestige",
    shotPolicy: ANTHOLOGY_SHOT_POLICY,
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

/** Resolve a `ShotPolicy` from raw project fields. Convenience wrapper
 *  around `resolveProjectTypeConfig().shotPolicy`. */
export function resolveShotPolicy(
  projectType: string | null | undefined,
  kind?: string | null | undefined
): ShotPolicy {
  return resolveProjectTypeConfig(projectType, kind).shotPolicy;
}

/** True iff the project is the micro-drama tier — replaces bare
 *  `projectType === "micro_drama"` string compares throughout the
 *  backend. Reads `shotPolicy.isMicroDramaTier` so future configurations
 *  (e.g. a "social_clip" variant) don't have to add a new string. */
export function isMicroDramaProject(
  projectType: string | null | undefined,
  kind?: string | null | undefined
): boolean {
  return resolveProjectTypeConfig(projectType, kind).shotPolicy.isMicroDramaTier;
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
