import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";
import { supabase } from "../db/client.js";

export type SubtextIssue = {
  sceneRef?: string;
  quote?: string;
  problem: string;
  suggestion?: string;
  severity: "info" | "warn" | "critical";
};

export type SubtextResult = {
  checked: string;
  notesUsed: string;
  issues: SubtextIssue[];
  suggestions: string[];
  recommendedFixes: string[];
  scriptId: string;
  ranAt: string;
};

/**
 * Subtext Check — flags dialogue or action that is too direct, obvious,
 * repeated, or emotionally over-explained. NOTES ONLY: it never rewrites the
 * script. Returns the user-requested 5-part structure (what it checked, how it
 * used the user's notes, confirmed issues, optional suggestions, recommended
 * fixes) so the writer decides what to apply.
 */
export async function runSubtextCheck(
  scriptId: string,
  _user?: { id: string; name?: string },
  notes?: string
): Promise<SubtextResult> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("id, project_id, title, fountain")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  if (!script.fountain || script.fountain.trim().length < 50) {
    throw new Error(
      "Script is empty. Write at least one scene before running the Subtext Check."
    );
  }

  const { data: proj } = await supabase
    .from("projects")
    .select("showrunner_notes")
    .eq("id", script.project_id)
    .maybeSingle();

  const system = [
    "You are the Subtext analyst in the TOBURT Studios writers' room.",
    "Your job: flag dialogue or action that is TOO DIRECT, on-the-nose,",
    "obvious, repeated, or emotionally over-explained — places where a",
    "character says exactly what they feel or mean instead of revealing it",
    "indirectly through behavior, image, or implication.",
    "",
    "You DO NOT rewrite the script. You return findings only; the writer",
    "decides what to apply.",
    "",
    "Quote the offending line/action verbatim so the writer can find it.",
    "Be specific and sparing — flag real problems, not every line.",
    "",
    notes
      ? `The user gave PRIORITY NOTES for this pass. Weight them above everything else and report how you applied them:\n"""${notes}"""`
      : "No special user notes this pass — use your best judgment.",
    proj?.showrunner_notes
      ? `\n# Showrunner notes (sticky vision):\n${proj.showrunner_notes}`
      : "",
    "",
    "Return ONLY a single JSON object — no prose, no markdown fences:",
    "{",
    '  "checked": "<1-2 sentences: what you looked at and your overall read>",',
    '  "notesUsed": "<1-2 sentences: how you applied the user\'s priority notes; say \'no special notes\' if none>",',
    '  "issues": [',
    "    {",
    '      "sceneRef": "<slugline or \'Scene 3\'>",',
    '      "quote": "<the on-the-nose line or action, verbatim>",',
    '      "problem": "<why it is too direct/obvious/repeated/over-explained>",',
    '      "suggestion": "<how to make it land indirectly — guidance, NOT a rewrite>",',
    '      "severity": "info" | "warn" | "critical"',
    "    }",
    "  ],",
    '  "suggestions": ["<optional broader subtext suggestions>"],',
    '  "recommendedFixes": ["<the highest-priority changes you recommend, in order>"]',
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: config.DIALOGUE_MODEL,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `Script: ${script.title}\n\n${script.fountain}`,
      },
    ],
    temperature: 0.4,
    maxTokens: 6000,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    throw new Error(
      `Subtext Check did not return usable JSON. Try again. (first 200 chars: ${res.text.slice(0, 200)})`
    );
  }

  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
  const validSev = new Set(["info", "warn", "critical"]);
  const rawIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
  const issues: SubtextIssue[] = rawIssues
    .map((raw): SubtextIssue | null => {
      const i = (raw ?? {}) as Record<string, unknown>;
      const problem = str(i.problem) || str(i.note) || str(i.issue);
      if (!problem) return null;
      const sevRaw = String(i.severity ?? "warn").toLowerCase();
      return {
        sceneRef: str(i.sceneRef) || str(i.scene) || str(i.slugline) || undefined,
        quote: str(i.quote) || str(i.line) || undefined,
        problem,
        suggestion: str(i.suggestion) || str(i.fix) || undefined,
        severity: validSev.has(sevRaw) ? (sevRaw as SubtextIssue["severity"]) : "warn",
      };
    })
    .filter((x): x is SubtextIssue => x !== null);

  return {
    checked: str(parsed.checked) || "Reviewed the full draft for on-the-nose dialogue and over-explained emotion.",
    notesUsed: str(parsed.notesUsed) || (notes ? "Applied your notes as priority guidance." : "No special notes this pass."),
    issues,
    suggestions: strArr(parsed.suggestions),
    recommendedFixes: strArr(parsed.recommendedFixes),
    scriptId,
    ranAt: new Date().toISOString(),
  };
}
