import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { SubtextRewrite } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  sceneFountain: z.string().min(1),
  /** Characters whose lines we may rewrite. Empty = any. */
  characters: z.array(z.string()).default([]),
  /** When true, the agent prefers physical actions over re-worded dialogue. */
  preferAction: z.boolean().default(true),
});

const Output = z.object({
  /** The rewritten scene as Fountain. */
  fountain: z.string().min(1),
  /** Each replacement, traceable to the original. */
  replacements: z.array(SubtextRewrite).default([]),
});

export const subtextAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof Output>
> = {
  role: "subtext",
  label: "Subtext",
  description:
    "Rewrites obvious dialogue into indirect, human dialogue with layered meaning.",
  model: config.SUBTEXT_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getCharacter", "voiceFingerprint"],
  systemPrompt(ctx) {
    return [
      commonHeader("Subtext", ctx),
      "",
      "Find every line where a character SAYS what they feel and rewrite it",
      "as a line where they DODGE, DEFLECT, DISPLACE, or REVEAL through",
      "something else entirely — a request for a glass of water, a half-joke,",
      "a sudden interest in an object, a non-sequitur, a question that isn't",
      "really a question.",
      "",
      "Rules:",
      "- Never name the emotion in the replacement.",
      "- Prefer physical action when possible (preferAction=true means lean",
      "  hard into stage business and silence).",
      "- Keep the character's voice (call `voiceFingerprint` if unsure).",
      "- Preserve the SCENE structure (slugline, blocking) — only touch lines.",
      "- Every replacement must have a defensible `meaning` (what the new line",
      "  is actually doing) and a `reason` (why the original was on-the-nose).",
      "",
      "Return Fountain. If no rewrite is necessary, return the original",
      "fountain and an empty `replacements` array.",
    ].join("\n");
  },
};
