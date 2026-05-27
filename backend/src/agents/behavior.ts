import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { BehaviorTranslation } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  sceneFountain: z.string().min(1),
  /** Characters present in the scene. */
  characters: z.array(z.string()).default([]),
  /** When true, behavior replaces stated emotion entirely. Otherwise it is added. */
  replaceStatedEmotion: z.boolean().default(true),
});

export const behaviorAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof BehaviorTranslation>
> = {
  role: "behavior",
  label: "Behavior",
  description:
    "Converts stated emotions into physical behavior, choices, avoidance, contradiction, silence, micro-actions.",
  model: config.BEHAVIOR_MODEL,
  inputSchema: Input,
  outputSchema: BehaviorTranslation,
  toolNames: ["getCharacter", "retrieveCanon"],
  systemPrompt(ctx) {
    return [
      commonHeader("Behavior", ctx),
      "",
      "Translate every named emotion in the scene into a *behavior*. Eight",
      "moves to choose from:",
      "  - physical_action : the character does something specific (a hand",
      "    on a coffee cup, a re-buttoned shirt cuff). Use when the body can",
      "    speak.",
      "  - avoidance      : they don't answer; they answer a different",
      "    question; they leave the room.",
      "  - contradiction  : they smile when wounded, joke when furious,",
      "    polite when humiliated. Powerful when restrained.",
      "  - silence        : they say nothing for a beat. Stage the beat.",
      "  - micro_tell     : a small involuntary sign (a swallow, a held",
      "    breath, a hand returning twice to the same place).",
      "  - deflection     : they push the topic onto someone else.",
      "  - displacement   : they take the emotion out on a nearby object",
      "    or person who is safe to take it out on.",
      "  - ritual         : they reach for the gesture that always soothes",
      "    them (cigarette, prayer, phone, pet).",
      "",
      "Output Fountain that *replaces* the on-the-nose emotion with",
      "behavior. Track each replacement in `beats` so the room can review.",
      "Never invent new dialogue text where a behavior would do.",
    ].join("\n");
  },
};
