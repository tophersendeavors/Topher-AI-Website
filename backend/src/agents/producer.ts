import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { ProducerReport } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  scriptId: z.string().uuid(),
  budgetTier: z.enum(["indie", "mid", "studio", "tentpole"]).optional(),
  /** Full Fountain text of the draft. Pass directly to avoid tool round-trips. */
  draftFountain: z.string().optional(),
  /** Per-scene metadata so the agent references scenes by ord. */
  sceneIndex: z
    .array(
      z.object({
        ord: z.number().int(),
        slugline: z.string(),
        characters: z.array(z.string()).default([]),
      })
    )
    .optional(),
});

export const producerAgent: Agent<z.infer<typeof Input>, z.infer<typeof ProducerReport>> = {
  role: "producer",
  label: "Producer",
  description: "Budget, feasibility, VFX, AI-gen practicality.",
  model: config.PRODUCER_MODEL,
  inputSchema: Input,
  outputSchema: ProducerReport,
  toolNames: ["retrieveDrafts", "tagSceneEntities"],
  systemPrompt(ctx) {
    return [
      commonHeader("Producer", ctx),
      "",
      "If `draftFountain` is provided in input, that text IS the draft.",
      "Use `sceneIndex` to reference scenes by ord (e.g. `[\"3\"]`).",
      "",
      "Return ONLY a JSON `result` of shape:",
      "{",
      '  "estimate": { "tier": "indie"|"mid"|"studio"|"tentpole", "reasoning": "<1-2 sentences>" },',
      '  "flags": [',
      '    { "kind": "vfx"|"stunt"|"location"|"cast"|"ai_gen"|"weather",',
      '      "sceneIds": ["<ord>", ...], "note": "<one sentence>",',
      '      "mitigation": "<one sentence cheaper alternative>" },',
      "    ...",
      "  ],",
      '  "aiGen": [ { "sceneId": "<ord>", "suitable": true|false, "notes": "<why>" }, ... ]',
      "}",
      "",
      "Reason about the script's *production reality*. Identify the scenes",
      "that drive budget, risk, or AI-generation suitability.",
      "Tier estimate:",
      "  indie  = <$3M, contained settings, small cast",
      "  mid    = $3–30M, moderate VFX/locations",
      "  studio = $30–100M, heavy VFX/stunts",
      "  tentpole = $100M+, world-scale VFX or extensive locations",
      "For each scene, list AI-gen suitability: contained, character-light",
      "scenes are good candidates; emotional close-ups currently are not.",
    ].join("\n");
  },
};
