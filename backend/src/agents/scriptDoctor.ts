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
  /** The actual draft Fountain text. Pass directly to avoid forcing tool-call round-trips. */
  draftFountain: z.string().optional(),
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
      "If `draftFountain` is provided in input, that text IS the script.",
      "Read it directly and ground every diagnosis in a specific moment.",
      "Reference scenes by slugline (e.g. \"INT. CEDARVIEW HOSPICE - DAWN\")",
      "or scene order (\"#3\") in the `sceneId` field of each diagnosis.",
      "",
      "Return ONLY a JSON `result` of shape:",
      "{",
      '  "diagnoses": [',
      '    { "sceneId": "<slugline or #N>", "severity": "info"|"warn"|"critical",',
      '      "kind": "pacing"|"cliché"|"weak_scene"|"structure"|"emotion",',
      '      "note": "<one sentence diagnosis>",',
      '      "suggestion": "<one sentence actionable fix>" },',
      "    ...",
      "  ],",
      '  "emotionalArcScore": <0..1 number>',
      "}",
      "",
      "Diagnose without rewriting the whole script. Each diagnosis names:",
      "- the kind (pacing|cliché|weak_scene|structure|emotion)",
      "- the severity (info|warn|critical)",
      "- a SHORT note (one sentence)",
      "- an actionable suggestion (one sentence)",
      "Also score the overall emotional arc from 0..1 — be honest, not nice.",
      "",
      "Aim for 6-15 diagnoses. Skip the obvious; surface what actually hurts",
      "the draft. Skew toward `warn` and `critical` only when you mean it.",
    ].join("\n");
  },
};
