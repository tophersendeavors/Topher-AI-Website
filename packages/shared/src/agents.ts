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
};

// ---------------------------------------------------------------------------
// Project & memory enums (kept here for cross-import convenience)
// ---------------------------------------------------------------------------

export const PROJECT_KINDS = ["feature", "pilot", "miniseries", "short", "series"] as const;
export type ProjectKind = (typeof PROJECT_KINDS)[number];

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
  themes: z.array(z.string()),
});
export type LoglinePack = z.infer<typeof LoglinePack>;

export const Treatment = z.object({
  title: z.string(),
  premise: z.string(),
  worldStatement: z.string(),
  protagonists: z.array(
    z.object({ name: z.string(), role: z.string(), summary: z.string() })
  ),
  acts: z.array(
    z.object({
      number: z.number().int(),
      goal: z.string(),
      turn: z.string(),
      summary: z.string(),
    })
  ),
  themes: z.array(z.string()),
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
  act1: z.string(),
  act2: z.string(),
  act3: z.string(),
});
export type CharacterArc = z.infer<typeof CharacterArc>;

export const CharacterBible = z.object({
  id: z.string().optional(),
  name: z.string(),
  archetype: z.string(),
  role: z.string(),
  biography: z.string(),
  wants: z.string(),
  needs: z.string(),
  flaw: z.string(),
  voice: z.object({
    vocabulary: z.string(),
    rhythm: z.string(),
    tells: z.array(z.string()),
  }),
  arc: CharacterArc,
  relationships: z
    .array(
      z.object({ other: z.string(), nature: z.string(), tension: z.string() })
    )
    .optional(),
});
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
