import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { RelationshipTension } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum(["map", "scene_pass", "refine"]),
  relationshipId: z.string().uuid().optional(),
  aId: z.string().uuid().optional(),
  bId: z.string().uuid().optional(),
  /** Optional scene context (Fountain) for `scene_pass`. */
  sceneFountain: z.string().optional(),
});

const Output = z.object({
  tension: RelationshipTension,
  /** For `scene_pass`, the agent describes how this scene shifts the dynamic. */
  sceneEffect: z
    .object({
      before: z.string(),
      after: z.string(),
      powerShift: z.string(),
      relationshipShift: z.string(),
    })
    .optional(),
});

export const relationshipTensionAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof Output>
> = {
  role: "relationship_tension",
  label: "Relationship Tension",
  description:
    "Tracks what is unsaid between characters and how the emotional history affects each scene.",
  model: config.RELATIONSHIP_TENSION_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getCharacter", "getRelationship"],
  systemPrompt(ctx) {
    return [
      commonHeader("Relationship Tension", ctx),
      "",
      "Every two-character scene is a negotiation, even when it pretends not",
      "to be. Your job is to surface what's UNSAID and how the scene moves",
      "the power balance.",
      "",
      "For each pair you analyze, produce a `RelationshipTension` with:",
      "  - unsaid          : one sentence. The thing neither of them will",
      "                      say but both are aware of.",
      "  - history         : 1–3 sentences. The emotional history that made",
      "                      that sentence undeliverable.",
      "  - currentPower    : who currently holds what kind of power",
      "                      (informational, moral, financial, sexual,",
      "                      structural). Power is rarely symmetrical.",
      "  - tensionScore    : 0..1 — how close it is to rupture this scene.",
      "  - pressurePoints  : 3–5 concrete moves that would shift the dynamic.",
      "",
      "For `scene_pass`, also produce `sceneEffect`: how the scene changed",
      "the relationship from before to after, and the exact `powerShift` /",
      "`relationshipShift` that should appear on the scene's emotional state.",
      "",
      "Return ONLY a JSON `result` of this exact shape (the tension MUST be",
      "under the `tension` key — not `relationship`):",
      "{",
      '  "result": {',
      '    "tension": {',
      '      "unsaid": "...",',
      '      "history": "...",',
      '      "currentPower": "...",',
      '      "tensionScore": 0.0,',
      '      "pressurePoints": ["...", "..."]',
      "    }",
      "  }",
      "}",
    ].join("\n");
  },
};
