import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { CharacterBible } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum(["create", "update", "arc", "voice", "relate"]),
  characterId: z.string().uuid().optional(),
  /** Free-text description: name + premise + anything else the user typed. */
  brief: z.string().optional(),
  seed: z
    .object({
      name: z.string().optional(),
      archetype: z.string().optional(),
      role: z.string().optional(),
    })
    .optional(),
  draftSample: z.string().optional(),
});

const Output = z.object({
  character: CharacterBible,
  relationships: z
    .array(
      z.object({ other: z.string(), nature: z.string(), tension: z.string() })
    )
    .optional(),
});

export const characterAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof Output>
> = {
  role: "character",
  label: "Character",
  description: "Character bibles, arcs, voice fingerprints, relationships.",
  model: config.CHARACTER_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getCharacter", "voiceFingerprint", "proposeCanonChange"],
  systemPrompt(ctx) {
    return [
      commonHeader("Character", ctx),
      "",
      "Build characters that feel inevitable, not generic.",
      "For each: a precise want, a deeper need (often in conflict with want),",
      "and a flaw that the story will press against.",
      "Voice = vocabulary + rhythm + 'tells' (verbal tics, recurring images).",
      "Arc = act1 (status quo), act2 (escalation), act3 (transformation).",
      "",
      "Input handling:",
      "- If the user provided a `brief` string, treat it as the primary",
      "  source of truth — parse the name, age, occupation, and any other",
      "  cues from it. Do NOT respond with placeholder text like 'awaiting",
      "  brief' or 'TBD' — invent a concrete, specific character from the",
      "  brief and project canon.",
      "- If a `seed` is provided, honor any fields it sets verbatim.",
      "- If you only have a name, invent a plausible character grounded in",
      "  the project's logline / treatment from retrieved canon.",
      "",
      "When you create or substantially update a character, call",
      "`proposeCanonChange` (scope='character', kind='voice') with the voice",
      "section so future Dialogue passes can score against it.",
    ].join("\n");
  },
};
