import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import type { Agent } from "./types.js";

const Input = z.object({
  /** Full draft (Fountain) to read the arc from. */
  fountain: z.string(),
  /** Main characters to label, by full canonical name. */
  cast: z.array(z.string()),
  /** Carry-over states from earlier episodes (for episode 2+). */
  priorStates: z
    .array(z.object({ name: z.string(), endingState: z.string() }))
    .optional(),
});

const ArcEntry = z.object({
  name: z.string(),
  /** A single evocative emotional state at the character's FIRST appearance. */
  startingState: z.string(),
  /** Their emotional state by their LATEST appearance. */
  currentState: z.string(),
  /** 1–3 short notes pointing at the scenes that justify the read. */
  evidence: z.array(z.string()).default([]),
});

const Output = z.object({
  arcs: z.array(ArcEntry).default([]),
});

/**
 * Labels each main character's emotional ARC — the named state they begin in
 * versus the state they currently end in. Read-only: it never rewrites the
 * script. Reuses the `emotional_truth` role (no new AgentRole) and runs on the
 * cheaper CHARACTER_MODEL since it's a single whole-script pass.
 */
export const characterArcAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof Output>
> = {
  role: "emotional_truth",
  label: "Character Arc",
  description:
    "Names each character's starting and current emotional state to measure whether they are actually changing.",
  model: config.CHARACTER_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: [],
  systemPrompt(ctx) {
    return [
      commonHeader("Character Arc", ctx),
      "",
      "You measure whether a character is actually CHANGING across a script —",
      "not merely appearing. For each character in the `cast`, read their",
      "scenes in order and name:",
      "",
      "  - startingState : one evocative emotional state at their FIRST",
      "                    appearance. A single noun or short phrase, e.g.",
      "                    'Grief', 'Control', 'Wary hope'. NOT a sentence.",
      "  - currentState  : their emotional state by their LATEST appearance,",
      "                    in the same compact form, e.g. 'Territoriality',",
      "                    'Dominance'. If unchanged, repeat the state.",
      "  - evidence      : 1–3 very short notes citing the scenes that justify",
      "                    the read (e.g. 'Scene 1: freezes at the door').",
      "",
      "Use states that are SPECIFIC to this story, not generic labels. Two",
      "characters should rarely share the same word. Only label characters who",
      "actually appear in the draft; skip any you cannot ground in a scene.",
      "",
      "If `priorStates` is provided, those are where each character ENDED the",
      "previous episode. Use that as their `startingState` for this episode",
      "unless the script clearly resets it — arcs accumulate across the season.",
      "",
      "Return ONLY a JSON `result` of this exact shape:",
      "{",
      '  "result": {',
      '    "arcs": [',
      '      { "name": "...", "startingState": "...", "currentState": "...",',
      '        "evidence": ["...", "..."] }',
      "    ]",
      "  }",
      "}",
    ].join("\n");
  },
};
