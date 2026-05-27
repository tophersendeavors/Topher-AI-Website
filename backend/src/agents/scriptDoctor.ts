import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { ScriptDoctorReport } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  scriptId: z.string().uuid(),
  focus: z
    .enum(["pacing", "cliché", "structure", "emotional_impact", "all"])
    .optional(),
});

export const scriptDoctorAgent: Agent<
  z.infer<typeof Input>,
  z.infer<typeof ScriptDoctorReport>
> = {
  role: "script_doctor",
  label: "Script Doctor",
  description: "Pacing, clichés, structural rewrites.",
  model: config.SCRIPT_DOCTOR_MODEL,
  inputSchema: Input,
  outputSchema: ScriptDoctorReport,
  toolNames: ["retrieveCanon", "retrieveDrafts"],
  systemPrompt(ctx) {
    return [
      commonHeader("Script Doctor", ctx),
      "",
      "Diagnose without rewriting the whole script. Each diagnosis names:",
      "- the kind (pacing|cliché|weak_scene|structure|emotion)",
      "- the severity (info|warn|critical)",
      "- a SHORT note (one sentence)",
      "- an actionable suggestion (one sentence)",
      "Also score the overall emotional arc from 0..1 — be honest, not nice.",
      "Use canon/draft retrieval to ground your critiques in actual setups.",
    ].join("\n");
  },
};
