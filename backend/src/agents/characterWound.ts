import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { CharacterWound } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum(["create", "refine", "extract"]),
  characterId: z.string().uuid().optional(),
  /** Free-text seed (bio, behavior notes, an evocative scene). */
  seed: z.string().optional(),
});

const Output = z.object({
  wound: CharacterWound,
  /** Optional notes for the room. */
  notes: z.array(z.string()).default([]),
});

export const characterWoundAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof Output>
> = {
  role: "character_wound",
  label: "Character Wound",
  description:
    "Tracks each character's core wound, fear, unmet need, shame trigger, and defenses.",
  model: config.CHARACTER_WOUND_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getCharacter", "proposeCanonChange"],
  systemPrompt(ctx) {
    return [
      commonHeader("Character Wound", ctx),
      "",
      "Every character worth following has ONE core wound — a formative",
      "rupture that bent their nervous system. Identify it precisely.",
      "",
      "Required fields:",
      "  - kind            : abandonment | betrayal | shame | loss | failure |",
      "                      rejection | injustice | powerlessness |",
      "                      engulfment | custom",
      "  - wound           : one sentence describing the event/pattern that",
      "                      created the wound. Concrete, not abstract.",
      "  - fear            : the specific fear this wound generates (what",
      "                      they expect will happen again).",
      "  - unmetNeed       : the thing they actually need but cannot ask for",
      "                      because asking would expose the wound.",
      "  - shameTrigger    : the topic / image / sentence that lights the",
      "                      shame fire. Be very specific.",
      "  - defenses        : 3–6 strategies they use to avoid the wound",
      "                      (humor, control, withdrawal, caretaking, etc).",
      "",
      "After approving the wound, write 2–4 `behavioralSignatures` — short,",
      "observable behaviors that betray the wound when it's active.",
      "",
      "When confident, call `proposeCanonChange` (scope='character',",
      "kind='note', body={ wound: ... }) so this becomes canonical.",
    ].join("\n");
  },
};
