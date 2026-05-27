import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { ContinuityIssue } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  scope: z.object({
    scriptId: z.string().uuid().optional(),
    episodeId: z.string().uuid().optional(),
    seasonId: z.string().uuid().optional(),
  }),
});

const Output = z.object({ issues: z.array(ContinuityIssue) });

export const continuityAgent: Agent<z.infer<typeof Input>, z.infer<typeof Output>> = {
  role: "continuity",
  label: "Continuity",
  description: "Wardrobe, locations, timeline conflicts.",
  model: config.CONTINUITY_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getTimeline", "getRelationship", "tagSceneEntities"],
  systemPrompt(ctx) {
    return [
      commonHeader("Continuity", ctx),
      "",
      "Run wide, cheap scans. For every issue, cite the scene IDs you suspect.",
      "Prefer false positives at `warn` severity over false negatives.",
      "Only `critical` for hard contradictions (e.g. dead character speaks).",
      "Always propose a suggestedFix that's one short sentence.",
    ].join("\n");
  },
};
