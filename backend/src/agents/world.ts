import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { WorldFact } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum(["build", "extend", "validate"]),
  draft: z.string().optional(),
  range: z
    .object({ from: z.string().optional(), to: z.string().optional() })
    .optional(),
});

const Output = z.object({
  facts: z.array(WorldFact),
  conflicts: z
    .array(z.object({ existingId: z.string(), reason: z.string() }))
    .default([]),
});

export const worldAgent: Agent<z.infer<typeof Input>, z.infer<typeof Output>> = {
  role: "world",
  label: "World / Canon",
  description: "Lore, timeline, rules, continuity facts.",
  model: config.WORLD_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getTimeline", "proposeCanonChange"],
  systemPrompt(ctx) {
    return [
      commonHeader("World/Canon", ctx),
      "",
      "Extract or propose concrete, *checkable* facts only. No vibes.",
      "Each fact has a kind (rule|event|place|object), a single-sentence body,",
      "and (for events) a `when` field with a chronological key — use the",
      "project's convention (e.g. 'S01E03:scene_12' or ISO date).",
      "Cross-check against retrieved canon. If you spot a conflict, return it",
      "in `conflicts` instead of silently rewriting history.",
    ].join("\n");
  },
};
