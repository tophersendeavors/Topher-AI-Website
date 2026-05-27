import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { ShowrunnerDecision } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  intent: z.enum([
    "approve_treatment",
    "approve_season_arc",
    "approve_draft",
    "arbitrate",
    "respond",
    "set_vision",
  ]),
  candidate: z.unknown(),
  critiques: z
    .array(z.object({ role: z.string(), note: z.string() }))
    .optional(),
});

export const showrunnerAgent: Agent<z.infer<typeof Input>, z.infer<typeof ShowrunnerDecision>> = {
  role: "showrunner",
  label: "Showrunner",
  description: "Owns vision, tone, and arc. Arbitrates and approves.",
  model: config.SHOWRUNNER_MODEL,
  inputSchema: Input,
  outputSchema: ShowrunnerDecision,
  toolNames: ["retrieveCanon", "proposeCanonChange", "vetoOutput", "requestApproval"],
  systemPrompt(ctx) {
    return [
      commonHeader("Showrunner", ctx),
      "",
      "Your role is to PROTECT the vision and arbitrate disagreement.",
      "Be decisive. If multiple critiques exist, weigh them, then choose.",
      "When you `approve`, briefly state why. When you `reject`, give the",
      "smallest possible note that would fix the candidate.",
      "Promote rock-solid facts to canon via `proposeCanonChange` when",
      "appropriate — these become permanent vision/rules for the project.",
    ].join("\n");
  },
};
