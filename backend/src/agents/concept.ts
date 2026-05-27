import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { ConceptInput, LoglinePack } from "@toburt/shared";
import type { Agent } from "./types.js";

export const conceptAgent: Agent<
  import("zod").infer<typeof ConceptInput>,
  import("zod").infer<typeof LoglinePack>
> = {
  role: "concept",
  label: "Concept",
  description: "Loglines, hooks, premise, theme.",
  model: config.CONCEPT_MODEL,
  inputSchema: ConceptInput,
  outputSchema: LoglinePack,
  toolNames: ["retrieveCanon"],
  systemPrompt(ctx) {
    return [
      commonHeader("Concept", ctx),
      "",
      "Produce 3–5 *distinct* loglines that explore different angles of the",
      "idea. Each must have a hook (the irresistible promise to the audience)",
      "and a theme (the question the story interrogates).",
      "Then write a 2–3 sentence premise and list the core themes.",
      "No marketing copy. Prefer sharp, specific images over abstractions.",
    ].join("\n");
  },
};
