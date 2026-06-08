import { z } from "zod";
import { config } from "../config.js";
import { commonHeader } from "./prompts.js";
import { ContinuityIssue } from "@toburt/shared";
import type { Agent } from "./types.js";

const Input = z.object({
  scope: z.object({
    scriptId: z.string().uuid().optional(),
    episodeId: z.string().uuid().optional(),
    seasonId: z.string().uuid().optional(),
  }),
  /** Full Fountain text of the draft. Pass directly to avoid tool round-trips. */
  draftFountain: z.string().optional(),
  /** Per-scene metadata so the agent can reference scenes by ord. */
  sceneIndex: z
    .array(
      z.object({
        ord: z.number().int(),
        slugline: z.string(),
        characters: z.array(z.string()).default([]),
      })
    )
    .optional(),
  /** How much to report: strict (critical only), standard (+warn), supervisor (all). */
  mode: z.enum(["strict", "standard", "supervisor"]).optional(),
});

const Output = z.object({ issues: z.array(ContinuityIssue) });

export const continuityAgent: Agent<z.infer<typeof Input>, z.infer<typeof Output>> = {
  role: "continuity",
  label: "Continuity",
  description: "Wardrobe, locations, timeline conflicts.",
  model: config.CONTINUITY_MODEL,
  inputSchema: Input,
  outputSchema: Output,
  toolNames: ["retrieveCanon", "getTimeline", "getRelationship", "tagSceneEntities"],
  systemPrompt(ctx) {
    return [
      commonHeader("Continuity", ctx),
      "",
      "The `draftFountain` in input is the ONLY authoritative text. Analyze",
      "ONLY what is written there. Do NOT cite character names, locations, or",
      "facts from retrieved canon/drafts or memory — those may be stale",
      "snapshots. If a name appears consistently in draftFountain, it is",
      "consistent, full stop. Every issue you raise must quote or reference",
      "text that is literally present in draftFountain.",
      "Use `sceneIndex` to reference scenes by ord (e.g. `[\"3\"]` not a UUID).",
      "",
      "Return ONLY a JSON `result` of shape:",
      "{",
      '  "issues": [',
      '    {',
      '      "kind": "wardrobe" | "location" | "timeline" | "relationship" | "prop",',
      '      "severity": "info" | "warn" | "critical",',
      '      "sceneIds": ["<ord1>", "<ord2>", ...],',
      '      "note": "<one sentence describing the conflict>",',
      '      "suggestedFix": "<one sentence actionable fix>",',
      '      "evidence": ["<exact verbatim quote copied from draftFountain>", "<a second quote from the OTHER scene that conflicts>"]',
      "    },",
      "    ...",
      "  ]",
      "}",
      "",
      "EVIDENCE IS MANDATORY AND VERIFIED. Every issue MUST include `evidence`:",
      "at least one exact, verbatim string copied character-for-character from",
      "draftFountain (not paraphrased, not reconstructed). A downstream filter",
      "discards any issue whose evidence is not found literally in the draft.",
      "If you cannot quote the draft to prove an issue, DO NOT raise it. Never",
      "cite a name, line, or detail you cannot copy verbatim from the text.",
      "",
      "SEVERITY — classify every issue into exactly one bucket:",
      "• `critical` = CRITICAL CONTRADICTION: the draft directly contradicts",
      "  itself. Examples: wrong character name, conflicting phone/voicemail",
      "  display, impossible timeline, a character uses a prop they could not",
      "  have, a location/room mismatch that breaks scene logic.",
      "• `warn` = CONTINUITY WARNING: may confuse the reader/viewer but does",
      "  NOT break the story. Examples: unclear elapsed time, prop movement not",
      "  shown on screen, ambiguous location transition, a missing day marker.",
      "• `info` = WATCHLIST / intentional-confirmation: likely deliberate;",
      "  don't belabor it. Examples: a repeated visual motif, a repeated room",
      "  setup, a character reaching for an absent object, wardrobe that looks",
      "  intentional, minor service logistics (e.g. where someone got tea).",
      "",
      "REPORTING MODE — honor the `mode` field in the input:",
      "• \"strict\"  → report ONLY `critical` contradictions. Omit warn/info.",
      "• \"standard\" → report `critical` + `warn`. Omit info.",
      "• \"supervisor\" → report everything, including `info` watchlist items.",
      "If no mode is given, behave as \"standard\".",
      "Do not pad the list — only raise issues that fit the active mode.",
      "Always propose a `suggestedFix` that's one short sentence.",
      "",
      "Skip stylistic critiques — those belong to the Script Doctor. Stay in",
      "lane: physical / wardrobe / location / time / character-fact",
      "consistency.",
    ].join("\n");
  },
};
