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
  /** When revising: the existing scene text to revise (not rewrite). */
  currentFountain: z.string().optional(),
  /** When revising: the specific note(s) this revision must address. */
  revisionNote: z.string().optional(),
  /** Canonical cast — the ONLY named characters allowed, with locked identity. */
  cast: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().optional(),
        note: z.string().optional(),
        age: z.number().nullable().optional(),
        occupation: z.string().nullable().optional(),
        backstory: z.string().nullable().optional(),
        biography: z.string().nullable().optional(),
      })
    )
    .optional(),
  /** Canonical facts established by earlier scenes that this scene must honor. */
  canonicalContext: z.string().optional(),
});

const Output = z.object({
  fountain: z.string().default(""),
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
      "LOCKED CAST: if the input includes a `cast` array, those are the ONLY",
      "named characters that may appear, and their identity is FIXED — name,",
      "age, occupation, relationships, and backstory. Use each name EXACTLY.",
      "Never invent a new named character, never rename/respell one, and never",
      "contradict a character's locked age/job/backstory. Unnamed background",
      "roles (NURSE, DRIVER, CONCIERGE) are fine. If the brief lists a name not",
      "in `cast`, map it to the closest cast member or make it unnamed",
      "background — do NOT introduce a new proper name.",
      "",
      "CANONICAL CONTEXT: if `canonicalContext` is provided, it lists facts",
      "established by earlier APPROVED scenes (timeline, locations, villa",
      "numbers, relationship states, protocol stage). This scene must be",
      "consistent with those facts — do not contradict or re-establish them.",
      "",
      "OUTPUT KEY: Return the screenplay text in `result.fountain`. The key",
      "MUST be exactly `fountain` — do not use `draft`, `text`, `script`,",
      "`screenplay`, or any other name. Downstream agents read `fountain`",
      "and only `fountain`.",
      "",
      "REVISION MODE (intent = \"refine\"): if the input contains",
      "`currentFountain`, that is the EXISTING scene. Do NOT rewrite it from",
      "scratch. Revise it to address the `revisionNote` — change ONLY what the",
      "note requires and preserve everything else verbatim (dialogue, blocking,",
      "structure, the slugline). The note may come from the Script Doctor",
      "(craft) or Continuity (wardrobe/timeline/location/relationship). Make the",
      "smallest change that resolves it. Return the full revised scene in",
      "`result.fountain`.",
      "",
      "SCENE SPEC IS BINDING. The input `brief` will contain:",
      "- `slugline` — use this exact string as the scene's slugline. Do",
      "  NOT rewrite it. Do NOT relocate the scene to a different place.",
      "- `characters` — only these named characters speak/appear. Do NOT",
      "  introduce additional named characters of your own (unnamed",
      "  background like NURSE / ORDERLY is fine).",
      "- `goal` / `conflict` / `turn` — these define what the scene must",
      "  accomplish dramatically. Hit each one.",
      "",
      "If retrieved canon mentions characters or settings from a different",
      "storyline, IGNORE them when they conflict with the brief. The brief",
      "is the contract.",
      "",
      "Every scene must have:",
      "- the slugline exactly as provided (line 1)",
      "- a clear goal, a *visible* conflict, and a TURN that changes",
      "  what the protagonist of the scene now knows/wants.",
      "- entrance & exit actions that work as transitions.",
      "Keep action lines lean and visual.",
      "",
      "DIALOGUE: write rough but real spoken lines for every character that",
      "speaks. Do NOT use literal placeholders like `(DIALOGUE AGENT)` or",
      "`[TODO]` — a downstream Dialogue agent will polish your draft lines,",
      "but it needs real lines to polish. If you don't know what the",
      "character should say, write the simplest, most direct version of",
      "what the scene's intent demands. Better a plain line than no line.",
    ].join("\n");
  },
};
