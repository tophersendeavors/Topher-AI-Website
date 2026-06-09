import { z } from "zod";

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const AGENT_ROLES = [
  "showrunner",
  "concept",
  "character",
  "world",
  "plot",
  "scene",
  "dialogue",
  "script_doctor",
  "continuity",
  "producer",
  // -------- Emotional Intelligence Layer --------
  "emotional_truth",
  "subtext",
  "character_wound",
  "behavior",
  "relationship_tension",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_PROFILES: Record<
  AgentRole,
  { label: string; emoji: string; accent: string; description: string }
> = {
  showrunner: {
    label: "Showrunner",
    emoji: "S",
    accent: "#E94B3C",
    description: "Vision, tone, season arc. Arbitrates the room.",
  },
  concept: {
    label: "Concept",
    emoji: "C",
    accent: "#F4A300",
    description: "Loglines, hooks, premise, theme.",
  },
  character: {
    label: "Character",
    emoji: "Ch",
    accent: "#3D9970",
    description: "Bibles, arcs, voice fingerprints, relationships.",
  },
  world: {
    label: "World",
    emoji: "W",
    accent: "#2ECC71",
    description: "Lore, timeline, rules, continuity facts.",
  },
  plot: {
    label: "Plot",
    emoji: "P",
    accent: "#1E90FF",
    description: "Acts, episodes, pacing, cliffhangers.",
  },
  scene: {
    label: "Scene",
    emoji: "Sc",
    accent: "#8E44AD",
    description: "Scene construction & cinematic flow.",
  },
  dialogue: {
    label: "Dialogue",
    emoji: "D",
    accent: "#E67E22",
    description: "Voice, subtext, realism.",
  },
  script_doctor: {
    label: "Script Doctor",
    emoji: "Rx",
    accent: "#C0392B",
    description: "Pacing, clichés, structural rewrites.",
  },
  continuity: {
    label: "Continuity",
    emoji: "K",
    accent: "#16A085",
    description: "Wardrobe, locations, timeline conflicts.",
  },
  producer: {
    label: "Producer",
    emoji: "Pr",
    accent: "#7F8C8D",
    description: "Budget, feasibility, VFX, AI-gen practicality.",
  },
  // -------- Emotional Intelligence Layer --------
  emotional_truth: {
    label: "Emotional Truth",
    emoji: "♡",
    accent: "#D63384",
    description:
      "Audits every scene for believable emotional cause & effect.",
  },
  subtext: {
    label: "Subtext",
    emoji: "≈",
    accent: "#9B59B6",
    description:
      "Rewrites on-the-nose dialogue into indirect, layered exchanges.",
  },
  character_wound: {
    label: "Wound",
    emoji: "✕",
    accent: "#6E3A8B",
    description:
      "Tracks each character's core wound, fear, unmet need, shame trigger, defenses.",
  },
  behavior: {
    label: "Behavior",
    emoji: "↺",
    accent: "#0EA5E9",
    description:
      "Translates stated emotion into physical action, avoidance, silence, micro-tells.",
  },
  relationship_tension: {
    label: "Relationship",
    emoji: "↔",
    accent: "#EAB308",
    description:
      "Surfaces what's unsaid between characters and how each scene shifts it.",
  },
};

// ---------------------------------------------------------------------------
// Project & memory enums (kept here for cross-import convenience)
// ---------------------------------------------------------------------------

export const PROJECT_KINDS = ["feature", "pilot", "miniseries", "short", "series"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

// ---------------------------------------------------------------------------
// Project Type — content tier. New projects pick one of these on creation.
// Storage: projects.metadata.projectType. Defaults to "prestige_series" for
// every legacy project. Architecture must never assume prestige — every
// system reading projectType should guard for all three.
// ---------------------------------------------------------------------------

export const PROJECT_TYPES = [
  "prestige_series",
  "mini_series",
  "micro_drama",
  "feature",
  "anthology",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const PROJECT_TYPE_LABEL: Record<ProjectType, string> = {
  prestige_series: "Prestige Series",
  mini_series: "Mini Series",
  micro_drama: "Micro Drama",
  feature: "Feature Film",
  anthology: "Anthology",
};

export const PROJECT_TYPE_DESCRIPTION: Record<ProjectType, string> = {
  prestige_series:
    "30–60 minute episodes. 6–10 episodes per season. Full screenplay workflow, Character DNA, Visual Bible, Story Bible.",
  mini_series:
    "5–20 minute episodes. 4–12 episodes. Simplified production pipeline. Character DNA available.",
  micro_drama:
    "Vertical-first. 30–120 second episodes. 20–100 episodes per season. Built around cliffhangers. TikTok / Shorts / Reels native.",
  feature:
    "90–180 minute feature film. One screenplay, one workflow. Cinematic widescreen defaults, longer shots.",
  anthology:
    "Self-contained episodes that share a tonal/world premise. Each episode is its own full creative pass.",
};

// ---------------------------------------------------------------------------
// Micro Drama Bible — required when projectType === "micro_drama".
// Storage: projects.metadata.microDramaBible. Lives alongside the Story
// Bible, not inside it.
// ---------------------------------------------------------------------------

export const MICRO_DRAMA_EMOTIONS = [
  "suspense",
  "romance",
  "mystery",
  "fear",
  "curiosity",
  "shock",
  "revenge",
  "hope",
] as const;
export type MicroDramaEmotion = (typeof MICRO_DRAMA_EMOTIONS)[number];

export const MICRO_DRAMA_EPISODE_LENGTHS_SEC = [30, 45, 60, 90, 120] as const;
export type MicroDramaEpisodeLengthSec = (typeof MICRO_DRAMA_EPISODE_LENGTHS_SEC)[number];

// Suggested season lengths surfaced as quick-pick presets in the bible UI.
// The seasonLength field is a free-form positive integer — the presets are
// just shortcuts. Hard ceiling is enforced server-side (the chain generator
// clamps to 100 to keep prompts and token budgets sane).
export const MICRO_DRAMA_SEASON_LENGTHS = [5, 10, 20, 30, 50, 100] as const;
export const MICRO_DRAMA_SEASON_LENGTH_MIN = 1;
export const MICRO_DRAMA_SEASON_LENGTH_MAX = 100;
export type MicroDramaSeasonLength = number;

export interface MicroDramaBible {
  /**
   * The concept in one sentence. The thing a viewer can repeat after
   * watching the first episode.
   * Example: "Every morning she wakes up married to a different version
   * of the same man."
   */
  hook: string;
  /** Primary audience emotion the season is built around. */
  audienceEmotion: MicroDramaEmotion;
  /** Per-episode runtime target. */
  episodeLengthSec: MicroDramaEpisodeLengthSec;
  /** Episodes per season. Positive integer, 1..100. */
  seasonLength: MicroDramaSeasonLength;
  /**
   * The unresolved question that forces the viewer to watch the next
   * episode. Visible across the entire micro-drama workflow.
   * Example: "Who is posting from the missing girl's account?"
   */
  cliffhangerEngine: string;
  /**
   * Curiosity Gap — what information is intentionally withheld from the
   * audience across the season. Visible throughout development.
   * Example: "The audience never sees the husband's face until episode 7."
   */
  curiosityGap?: string;
  /**
   * Character Reveal Tracker — what the audience knows, doesn't know, and
   * believes incorrectly. Micro dramas survive on delayed reveals; the
   * tracker keeps the writer honest.
   */
  characterRevealTracker?: CharacterRevealTracker;
}

/**
 * Per-episode Micro Drama story structure. Replaces 3-act for this tier.
 *
 * Generation order:
 *   1. HOOK         — the first 1–3 seconds that prevent scrolling.
 *   2. SETUP        — what the audience learns.
 *   3. TWIST        — what changes mid-episode.
 *   4. CLIFFHANGER  — the unresolved question that ends the episode.
 *
 * Stored per-episode at episodes.metadata.microDrama.
 */
export interface MicroDramaEpisodeStructure {
  /** First 1–3 seconds. What stops the scroll. */
  hook: string;
  /** What the audience learns. */
  setup: string;
  /** What changes — the reversal mid-episode. */
  twist: string;
  /** The unresolved question that ends the episode. */
  cliffhanger: string;
}

/**
 * Cliffhanger Map — every episode's specific unanswered question. Stored
 * project-side at projects.metadata.microDrama.cliffhangerMap, keyed by
 * episode number ("1", "2", …). The per-episode cliffhanger field on
 * each episodes.metadata.microDrama.cliffhanger is the source of truth;
 * the map is a denormalised view for the season editor.
 */
export type CliffhangerMap = Record<string, string>;

/**
 * Episode Chain — the AI-generated planning row for a single episode in a
 * micro-drama season. PLANNING ONLY. No screenplay, no scenes, no dialogue,
 * no shot briefs. The chain feeds the per-episode HOOK / SETUP / TWIST /
 * CLIFFHANGER editor and the Season Retention Map.
 */
export interface MicroDramaEpisodePlan {
  episodeNumber: number;
  /** Short episode title — generator can produce one or fall back to "EP01". */
  title: string;
  /** First 1–3 seconds — what stops the scroll on this specific episode. */
  hook: string;
  /** What the audience learns this episode. */
  setup: string;
  /** What changes — the reversal mid-episode. */
  twist: string;
  /** The unresolved question that ends THIS episode. */
  cliffhanger: string;
  /** What information was given to the audience this episode. */
  revealedToAudience: string;
  /** What information was deliberately held back this episode. */
  withheldFromAudience: string;
  /**
   * Which audience-held false assumption this episode reinforces or breaks.
   * Drives the Character Reveal Tracker across the season.
   */
  falseAssumptionReinforcedOrBroken: string;
}

/**
 * Episode Chain preview — generator output before persistence. Each entry
 * carries the planning row plus the deterministic Binge Score + Viral Test
 * computed against the planning content (so the writer sees retention
 * quality BEFORE accepting the chain). Plus season-level rollup.
 */
export interface MicroDramaEpisodeChainPreviewEntry {
  plan: MicroDramaEpisodePlan;
  binge: BingeMomentumScore;
  viral: ViralTestResult;
}

export interface MicroDramaEpisodeChainPreview {
  /** Generated planning rows in episode order. */
  entries: MicroDramaEpisodeChainPreviewEntry[];
  /**
   * Season-average Binge Score, 0..100. This is the FINAL value after any
   * automatic self-revision passes.
   */
  averageBinge: number;
  /**
   * Season-average Binge Score from the very first pass — what the engine
   * produced before self-revision. Surfaced in the preview so the writer
   * can see how much the auto-revision improved the chain.
   */
  originalAverageBinge: number;
  /** Episode numbers whose viral test failed (after final revision). */
  failingEpisodes: number[];
  /** Episode numbers in the inner third of the season that scored < 50. */
  weakMiddle: number[];
  /**
   * Revision trail — one entry per revision pass actually executed, in
   * order. Each entry says what the engine saw and what it did. Empty
   * when the first pass already cleared the target.
   */
  revisionTrail: MicroDramaChainRevisionStep[];
  /**
   * Narrative Cohesion — measured SEPARATELY from Binge (surprise). Binge
   * measures retention pull; cohesion measures whether the season tells
   * ONE mystery or a soup of unrelated ones. Final state after revision.
   */
  cohesion: MicroDramaCohesion;
  /** Cohesion result from the very first pass — for original-vs-revised UX. */
  originalCohesion: MicroDramaCohesion;
}

export interface MicroDramaCohesion {
  /** 0..100 — average alignment of episodes 2..N to EP01 mystery seed. */
  cohesionScore: number;
  /**
   * 0..100 — % of episodes whose dominant question still references the
   * EP01 audience promise. Target ≥ 80%.
   */
  promiseRetentionPct: number;
  /** Distinct topical anchors introduced beyond EP01. Cap ≤ 3. */
  mysterySystemsCount: number;
  /** Major mystery layers introduced across the season. Cap ≤ 1 per 5 eps. */
  mysteryLayerCount: number;
  /** Major character reveals across the season. Cap ≤ 1 per 5 eps. */
  characterRevealCount: number;
  /** Forbidden-trope hits detected in the chain. */
  forbiddenTropeHits: Array<{
    id: string;
    label: string;
    episodes: number[];
    /**
     * Per-episode triggering substring — the exact word/phrase the detector
     * caught. Surfaced in the UI and fed back to the LLM critique so the
     * model knows what to rewrite.
     */
    matches: Array<{ episodeNumber: number; matched: string }>;
  }>;
  /** Anchor nouns flagged as "new mystery systems" — surfaced for the writer. */
  detectedAnchors: string[];
  /** True only when every cohesion gate is satisfied. */
  passes: boolean;
}

export interface MicroDramaChainRevisionStep {
  /** 1-indexed pass number for THIS revision (first revision = 1). */
  pass: number;
  /** Season-average Binge Score AFTER this pass. */
  averageBinge: number;
  /** Why the engine ran another pass. */
  reason: string;
  /** "full" = regenerated entire chain. "weak" = targeted weak-episode rewrite. */
  mode: "full" | "weak";
  /** Episode numbers that this pass attempted to fix. */
  targetedEpisodes: number[];
}

/**
 * Character Reveal Tracker — three buckets per character, project-level.
 *   • known            — what the audience knows is true about this character.
 *   • unknown          — what the audience does not yet know.
 *   • falseAssumptions — what the audience currently believes but is wrong about.
 */
export interface CharacterRevealTracker {
  [characterName: string]: {
    known: string[];
    unknown: string[];
    falseAssumptions: string[];
  };
}

/**
 * Binge Momentum Score — 0..100 per episode. Deterministic from four
 * components, each scored 0..25, summed. The viral test reads this and
 * the episode's content to decide whether the episode is approvable.
 */
export interface BingeMomentumComponents {
  hookStrength: number;       // 0..25
  curiosityGap: number;        // 0..25
  twistStrength: number;       // 0..25
  cliffhangerStrength: number; // 0..25
}

export interface BingeMomentumScore {
  /** 0..100. Floor-summed from the four components below. */
  total: number;
  components: BingeMomentumComponents;
  /** Plain-English diagnoses surfaced in the UI. */
  notes: string[];
}

/**
 * Viral Test — heuristic check on whether the episode would force the
 * viewer to keep watching. Generated per-episode after the structure is
 * approved.
 *
 * If `passes === false`, the episode is FLAGGED in the dashboard until
 * the writer rewrites the cliffhanger or twist.
 */
export interface ViralTestResult {
  passes: boolean;
  /** The yes/no question the test answers: "Would a viewer need to know
   *  what happens next?" */
  verdict: "yes" | "no" | "weak";
  /** One short line the writer can act on. */
  recommendation: string;
}

export const MEMORY_SCOPES = [
  "project",
  "season",
  "episode",
  "scene",
  "character",
  "location",
  "relationship",
] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_KINDS = [
  "fact",
  "rule",
  "arc",
  "voice",
  "wardrobe",
  "beat",
  "note",
  "draft",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

// ---------------------------------------------------------------------------
// Per-agent I/O schemas
// ---------------------------------------------------------------------------

export const ConceptInput = z.object({
  idea: z.string().min(1),
  constraints: z
    .object({
      genre: z.string().optional(),
      tone: z.string().optional(),
      length: z.string().optional(),
    })
    .optional(),
});
export type ConceptInput = z.infer<typeof ConceptInput>;

export const LoglinePack = z.object({
  loglines: z
    .array(
      z.object({
        text: z.string(),
        hook: z.string(),
        theme: z.string(),
      })
    )
    .min(1),
  premise: z.string(),
  // LLMs frequently omit auxiliary arrays even when prompted; default so the
  // output is accepted as long as the primary fields are present.
  themes: z.array(z.string()).default([]),
});
export type LoglinePack = z.infer<typeof LoglinePack>;

// Treatment — title + premise are essential; everything else defaults so a
// partial response still validates. This is the consolidated Story Foundation
// + professional Treatment document: the single source of truth the script,
// deck, lookbook and production package all build from.
export const Treatment = z.object({
  title: z.string().min(1),
  // Alternative working titles the user can pick from.
  titleOptions: z.array(z.string()).default([]),
  logline: z.string().default(""),
  // Format/genre/tone restated at the treatment level (project.kind is the
  // source for format; the agent may refine here).
  format: z.string().default(""),
  genre: z.string().default(""),
  tone: z.string().default(""),
  premise: z.string().min(1),
  shortSynopsis: z.string().default(""),
  // The full prose treatment — the meat of the document.
  treatmentProse: z.string().default(""),
  worldStatement: z.string().default(""),
  centralConflict: z.string().default(""),
  // What keeps the audience emotionally invested episode to episode.
  emotionalEngine: z.string().default(""),
  protagonists: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().default(""),
        summary: z.string().default(""),
      })
    )
    .default([]),
  acts: z
    .array(
      z.object({
        number: z.number().int(),
        goal: z.string().default(""),
        turn: z.string().default(""),
        summary: z.string().default(""),
      })
    )
    .default([]),
  endingHook: z.string().default(""),
  visualTone: z.string().default(""),
  // Only populated for series: the repeatable engine that generates stories.
  seriesEngine: z.string().default(""),
  themes: z.array(z.string()).default([]),
});
export type Treatment = z.infer<typeof Treatment>;

export const SeasonArc = z.object({
  seasonNumber: z.number().int().positive(),
  title: z.string(),
  premise: z.string(),
  throughline: z.string(),
  episodes: z.array(
    z.object({
      number: z.number().int().positive(),
      title: z.string(),
      logline: z.string(),
      tentpole: z.boolean().optional(),
    })
  ),
});
export type SeasonArc = z.infer<typeof SeasonArc>;

export const EpisodeOutline = z.object({
  episodeNumber: z.number().int().positive(),
  title: z.string(),
  logline: z.string(),
  cold_open: z.string().optional(),
  acts: z.array(
    z.object({
      number: z.number().int(),
      summary: z.string(),
      turn: z.string(),
    })
  ),
  tag: z.string().optional(),
});
export type EpisodeOutline = z.infer<typeof EpisodeOutline>;

export const BeatType = z.enum([
  "opening_image",
  "setup",
  "inciting_incident",
  "act_break",
  "midpoint",
  "all_is_lost",
  "climax",
  "resolution",
  "tag",
  "custom",
]);
export type BeatType = z.infer<typeof BeatType>;

export const BeatSheet = z.object({
  episodeNumber: z.number().int(),
  beats: z.array(
    z.object({
      order: z.number().int(),
      type: BeatType,
      body: z.string(),
      sceneHint: z.string().optional(),
    })
  ),
});
export type BeatSheet = z.infer<typeof BeatSheet>;

export const SceneSpec = z.object({
  order: z.number().int(),
  slugline: z.string(),
  intExt: z.enum(["INT", "EXT", "INT/EXT"]),
  location: z.string(),
  timeOfDay: z.string(),
  goal: z.string(),
  conflict: z.string(),
  turn: z.string(),
  characters: z.array(z.string()),
});
export type SceneSpec = z.infer<typeof SceneSpec>;

export const SceneList = z.object({
  scenes: z.array(SceneSpec),
});
export type SceneList = z.infer<typeof SceneList>;

export const CharacterArc = z.object({
  act1: z.string().default(""),
  act2: z.string().default(""),
  act3: z.string().default(""),
});
export type CharacterArc = z.infer<typeof CharacterArc>;

// CharacterBible — only `name` is required. Every other field defaults,
// inner array elements have all-optional members, and unknown LLM-invented
// keys (e.g. `age`, `occupation`) are preserved via `.passthrough()`.
//
// The system trusts the LLM's creative output and degrades gracefully.
export const CharacterBible = z
  .object({
    id: z.string().optional(),
    name: z.string().min(1),
    archetype: z.string().default(""),
    role: z.string().default(""),
    biography: z.string().default(""),
    wants: z.string().default(""),
    needs: z.string().default(""),
    flaw: z.string().default(""),
    voice: z
      .object({
        vocabulary: z.string().default(""),
        rhythm: z.string().default(""),
        tells: z.array(z.string()).default([]),
      })
      .partial()
      .default({}),
    arc: CharacterArc.partial().default({}),
    relationships: z
      .array(
        z
          .object({
            other: z.string().default(""),
            nature: z.string().default(""),
            tension: z.string().default(""),
          })
          .passthrough()
      )
      .default([]),
  })
  .passthrough();
export type CharacterBible = z.infer<typeof CharacterBible>;

export const WorldFact = z.object({
  kind: z.enum(["rule", "event", "place", "object"]),
  body: z.string(),
  when: z.string().optional(),
});
export type WorldFact = z.infer<typeof WorldFact>;

export const ContinuityIssue = z.object({
  kind: z.enum(["wardrobe", "location", "timeline", "relationship", "prop"]),
  severity: z.enum(["info", "warn", "critical"]),
  sceneIds: z.array(z.string()),
  note: z.string(),
  suggestedFix: z.string().optional(),
});
export type ContinuityIssue = z.infer<typeof ContinuityIssue>;

export const ScriptDoctorReport = z.object({
  diagnoses: z.array(
    z.object({
      sceneId: z.string().optional(),
      severity: z.enum(["info", "warn", "critical"]),
      kind: z.enum(["pacing", "cliché", "weak_scene", "structure", "emotion"]),
      note: z.string(),
      suggestion: z.string().optional(),
    })
  ),
  emotionalArcScore: z.number().min(0).max(1),
});
export type ScriptDoctorReport = z.infer<typeof ScriptDoctorReport>;

export const ProducerReport = z.object({
  estimate: z.object({
    tier: z.enum(["indie", "mid", "studio", "tentpole"]),
    reasoning: z.string(),
  }),
  flags: z.array(
    z.object({
      kind: z.enum(["vfx", "stunt", "location", "cast", "ai_gen", "weather"]),
      sceneIds: z.array(z.string()),
      note: z.string(),
      mitigation: z.string().optional(),
    })
  ),
  aiGen: z.array(
    z.object({
      sceneId: z.string(),
      suitable: z.boolean(),
      notes: z.string(),
    })
  ),
});
export type ProducerReport = z.infer<typeof ProducerReport>;

export const ShowrunnerDecision = z.object({
  decision: z.enum(["approve", "reject", "revise"]),
  rationale: z.string(),
  notes: z.array(z.string()).default([]),
});
export type ShowrunnerDecision = z.infer<typeof ShowrunnerDecision>;

// ---------------------------------------------------------------------------
// Writers Room message
// ---------------------------------------------------------------------------

export interface RoomMessage {
  id: string;
  project_id: string;
  workflow_id?: string | null;
  stage_id?: string | null;
  author_kind: "agent" | "user" | "system";
  author_role?: AgentRole | null;
  author_user_id?: string | null;
  kind: "message" | "suggestion" | "critique" | "approval" | "tool_call";
  body?: string | null;
  payload?: unknown;
  parent_id?: string | null;
  created_at: string;
}
