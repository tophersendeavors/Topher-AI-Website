import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { EmotionalTruthReport } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  /** Scene as Fountain text. */
  sceneFountain: z.string().min(1),
  /** Characters present in the scene (ids or names). */
  characters: z.array(z.string()).default([]),
  /** Optional script context — gives the agent the script + episode arc. */
  scriptId: z.string().uuid().optional(),
  /** Whether intentional directness is permitted on this project. */
  allowStylistic: z.boolean().default(false),
});

export const emotionalTruthAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof EmotionalTruthReport>
> = {
  role: "emotional_truth",
  label: "Emotional Truth",
  description:
    "Audits every scene for believable emotional cause and effect.",
  model: config.EMOTIONAL_TRUTH_MODEL,
  inputSchema: Input,
  outputSchema: EmotionalTruthReport,
  toolNames: ["retrieveCanon", "retrieveDrafts", "getCharacter"],
  systemPrompt(ctx) {
    return [
      commonHeader("Emotional Truth", ctx),
      "",
      "Your job is to test the scene like a director's gut would. For every",
      "emotional move, identify the CAUSE (what just happened) and the EFFECT",
      "(what it triggers in the character) and judge whether that effect is",
      "*earned* by the cause given the character's wound, history, and stakes.",
      "",
      "Return ONLY a JSON `result` of EXACTLY this shape — note the ten state",
      "fields are NESTED under `state`, not at the top level:",
      "{",
      '  "truthScore": <0..1 number>,',
      '  "causeEffect": [',
      '    { "cause": "...", "effect": "...", "credible": true|false, "note": "..." },',
      "    ...",
      "  ],",
      '  "state": {',
      '    "emotionalEntryState": "...",',
      '    "emotionalExitState": "...",',
      '    "hiddenWant": "...",',
      '    "visibleWant": "...",',
      '    "fear": "...",',
      '    "contradiction": "...",',
      '    "subtext": "...",',
      '    "behavioralTells": ["...", ...],',
      '    "powerShift": "...",',
      '    "relationshipShift": "..."',
      "  },",
      '  "rejections": [',
      '    { "kind": "direct_emotion"|"unmotivated_reaction"|"missing_contradiction"|"exposition_emotion"|"feelings_as_dialogue",',
      '      "severity": "info"|"warn"|"critical", "note": "...", "line": <int?>, "text": "...?" }',
      "  ]",
      "}",
      "",
      "Every one of the ten `state` fields is required and must be a non-empty",
      "string (behavioralTells is an array). Put the cause/effect chain in the",
      "`causeEffect` array, NOT in prose.",
      "",
      "`truthScore` 0..1 — be honest, not nice. A scene where characters explain",
      "their feelings instead of dramatizing them should score below 0.4.",
      "",
      "Populate `rejections` for any scene that fails one of these tests:",
      "  - direct_emotion         : characters name their feelings",
      "  - unmotivated_reaction   : effect doesn't match the cause",
      "  - missing_contradiction  : every want and fear point the same way",
      "  - exposition_emotion     : emotion is delivered as backstory speech",
      "  - feelings_as_dialogue   : the line reads like a therapy session",
      "",
      "If the project allows stylistic directness, soften 'critical' to 'warn'",
      "for direct_emotion only — never for the other categories.",
    ].join("\n");
  },
};
