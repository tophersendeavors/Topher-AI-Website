import { z } from "zod";

// ---------------------------------------------------------------------------
// Emotional Intelligence Layer — schemas shared by backend agents and the UI.
//
// Five collaborating agents (Emotional Truth, Subtext, Character Wound,
// Behavior, Relationship Tension) each contribute to a scene's
// `SceneEmotionalState`. The state contains the ten required fields:
//   emotional entry state · emotional exit state · hidden want · visible want
//   fear · contradiction · subtext · behavioral tells · power shift
//   relationship shift
// ---------------------------------------------------------------------------

// =============================================================================
// Per-scene emotional state — the canonical artifact this layer produces.
// =============================================================================

export const SceneEmotionalState = z.object({
  /** Reference to script_scenes.id (optional in agent IO; required at write). */
  sceneRef: z.string().uuid().optional(),

  emotionalEntryState: z.string().min(1),
  emotionalExitState: z.string().min(1),

  hiddenWant: z.string().min(1),
  visibleWant: z.string().min(1),

  fear: z.string().min(1),
  contradiction: z.string().min(1),
  subtext: z.string().min(1),

  behavioralTells: z.array(z.string()).default([]),

  powerShift: z.string().min(1),
  relationshipShift: z.string().min(1),

  /** 0..1 — how emotionally credible the scene plays (Emotional Truth). */
  truthScore: z.number().min(0).max(1).optional(),

  /** Direct-explanation violations the validator caught on this scene. */
  directnessViolations: z
    .array(
      z.object({
        line: z.number().int().nonnegative(),
        text: z.string(),
        pattern: z.string(),
        severity: z.enum(["info", "warn", "critical"]),
      })
    )
    .default([]),
});
export type SceneEmotionalState = z.infer<typeof SceneEmotionalState>;

// =============================================================================
// Character wound — produced by the Character Wound agent.
// =============================================================================

export const WoundKind = z.enum([
  "abandonment",
  "betrayal",
  "shame",
  "loss",
  "failure",
  "rejection",
  "injustice",
  "powerlessness",
  "engulfment",
  "custom",
]);
export type WoundKind = z.infer<typeof WoundKind>;

export const CharacterWound = z.object({
  characterId: z.string().uuid().optional(),
  kind: WoundKind.default("custom"),
  /** The formative event or pattern that created the wound. */
  wound: z.string().min(1),
  /** Specific fear the wound produces. */
  fear: z.string().min(1),
  /** Need the character actually has but can't ask for. */
  unmetNeed: z.string().min(1),
  /** Sentence/scene/topic that triggers the shame response. */
  shameTrigger: z.string().min(1),
  /** The defense system the character uses to avoid the wound. */
  defenses: z.array(z.string()).min(1),
  /** Notes on how it surfaces in behavior (filled by Behavior agent). */
  behavioralSignatures: z.array(z.string()).default([]),
});
export type CharacterWound = z.infer<typeof CharacterWound>;

// =============================================================================
// Relationship tension — produced by the Relationship Tension agent.
// =============================================================================

export const RelationshipTension = z.object({
  relationshipId: z.string().uuid().optional(),
  aId: z.string().uuid().optional(),
  bId: z.string().uuid().optional(),

  /** What is unsaid between them, distilled to one sentence. */
  unsaid: z.string().min(1),
  /** The emotional history that created the unsaid (1–3 sentences). */
  history: z.string().min(1),
  /** Who currently holds the power, and in what register. */
  currentPower: z.string().min(1),
  /** How fragile / volatile the tension is right now (0..1). */
  tensionScore: z.number().min(0).max(1),
  /** Concrete moves each could make that would shift the dynamic. */
  pressurePoints: z.array(z.string()).default([]),
});
export type RelationshipTension = z.infer<typeof RelationshipTension>;

// =============================================================================
// Subtext rewrite — produced by the Subtext agent.
// =============================================================================

export const SubtextRewrite = z.object({
  /** The original (often on-the-nose) line. */
  original: z.string(),
  /** The replacement line. Indirect, layered, ideally visual when possible. */
  rewritten: z.string(),
  /** What the new line is actually saying underneath. */
  meaning: z.string(),
  /** Why the original was too direct. */
  reason: z.string(),
});
export type SubtextRewrite = z.infer<typeof SubtextRewrite>;

// =============================================================================
// Behavioral translation — produced by the Behavior agent.
// =============================================================================

export const BehaviorBeat = z.object({
  character: z.string(),
  /** The stated emotion that's being replaced. */
  statedEmotion: z.string(),
  /** Physical behavior / micro-action / silence / contradiction. */
  behavior: z.string(),
  /** Kind of behavioral move. */
  kind: z.enum([
    "physical_action",
    "avoidance",
    "contradiction",
    "silence",
    "micro_tell",
    "deflection",
    "displacement",
    "ritual",
  ]),
});
export type BehaviorBeat = z.infer<typeof BehaviorBeat>;

export const BehaviorTranslation = z.object({
  fountain: z.string(),
  beats: z.array(BehaviorBeat).default([]),
});
export type BehaviorTranslation = z.infer<typeof BehaviorTranslation>;

// =============================================================================
// Emotional truth report — produced by the Emotional Truth agent.
// =============================================================================

export const EmotionalTruthReport = z.object({
  truthScore: z.number().min(0).max(1),
  causeEffect: z.array(
    z.object({
      cause: z.string(),
      effect: z.string(),
      credible: z.boolean(),
      note: z.string(),
    })
  ),
  state: SceneEmotionalState,
  /** Violations the scene should be rejected for unless `allowStylistic`. */
  rejections: z
    .array(
      z.object({
        kind: z.enum([
          "direct_emotion",
          "unmotivated_reaction",
          "missing_contradiction",
          "exposition_emotion",
          "feelings_as_dialogue",
        ]),
        severity: z.enum(["info", "warn", "critical"]),
        note: z.string(),
        line: z.number().int().nonnegative().optional(),
        text: z.string().optional(),
      })
    )
    .default([]),
});
export type EmotionalTruthReport = z.infer<typeof EmotionalTruthReport>;

// =============================================================================
// Directness validator output (heuristic, runs without an LLM).
// =============================================================================

export const DirectnessViolation = z.object({
  line: z.number().int().nonnegative(),
  text: z.string(),
  pattern: z.string(),
  severity: z.enum(["info", "warn", "critical"]),
});
export type DirectnessViolation = z.infer<typeof DirectnessViolation>;

export interface DirectnessReport {
  violations: DirectnessViolation[];
  /** True if the scene should be rejected based on critical-violation count. */
  shouldReject: boolean;
}
