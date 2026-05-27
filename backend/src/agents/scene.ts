import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum(["draft", "refine", "transition"]),
  sceneId: z.string().uuid().optional(),
  brief: z.object({
    slugline: z.string(),
    goal: z.string(),
    conflict: z.string(),
    turn: z.string(),
    characters: z.array(z.string()),
  }),
});

const Output = z.object({
  fountain: z.string(),
  entities: z.object({
    characters: z.array(z.string()),
    locations: z.array(z.string()),
    props: z.array(z.string()),
  }),
  beats: z.array(z.string()),
});

export const sceneAgent: Agent<z.infer<typeof Input>, z.infer<typeof Output>> = {
  role: "scene",
  label: "Scene",
  description: "Scene construction & cinematic flow.",
  model: config.SCENE_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getCharacter", "tagSceneEntities"],
  systemPrompt(ctx) {
    return [
      commonHeader("Scene", ctx),
      "",
      "Write the scene as valid Fountain. Every scene must have:",
      "- a slugline (INT/EXT. LOCATION - TIME)",
      "- a clear goal, a *visible* conflict, and a TURN that changes",
      "  what the protagonist of the scene now knows/wants.",
      "- entrance & exit actions that work as transitions.",
      "Keep action lines lean and visual. Dialogue placeholders OK — the",
      "Dialogue agent will pass over this scene afterwards.",
    ].join("\n");
  },
};
