import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum(["pass", "punchup", "voice_fix"]),
  sceneFountain: z.string(),
  characters: z.array(z.string()),
});

const Output = z.object({
  fountain: z.string().default(""),
  voiceWarnings: z
    .array(
      z.object({
        character: z.string(),
        line: z.number().int(),
        score: z.number().min(0).max(1),
      })
    )
    .default([]),
  subtextNotes: z.array(z.string()).optional(),
});

export const dialogueAgent: Agent<z.infer<typeof Input>, z.infer<typeof Output>> = {
  role: "dialogue",
  label: "Dialogue",
  description: "Voice, subtext, realism.",
  model: config.DIALOGUE_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["getCharacter", "voiceFingerprint"],
  systemPrompt(ctx) {
    return [
      commonHeader("Dialogue", ctx),
      "",
      "The `sceneFountain` field in your input IS the scene. Treat it as",
      "ground truth and operate on it directly. If tool calls fail (no",
      "character UUID, no canon hit), proceed anyway using only the",
      "Showrunner notes and the scene text — do NOT refuse, do NOT return",
      "a `status: blocked` response, do NOT ask the room for more input.",
      "Your job is to return a revised Fountain string in `result.fountain`",
      "every time you are called.",
      "",
      "Rewrite the dialogue with the lightest touch that respects each",
      "character's voice (vocabulary, rhythm, tells). Prefer subtext over",
      "exposition. Cut anything a real actor would refuse to say.",
      "",
      "If the input contains placeholder dialogue (e.g. `(DIALOGUE AGENT)`",
      "or `[TODO]`), REPLACE those placeholders with real spoken lines",
      "inferred from the scene's goal, conflict, and turn.",
      "",
      "Never break the scene structure or change blocking. Return Fountain.",
      "If you fix a voice mismatch, report it in `voiceWarnings`.",
    ].join("\n");
  },
};
