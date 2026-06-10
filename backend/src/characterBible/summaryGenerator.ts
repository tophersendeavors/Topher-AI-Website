// Character Bible executive summary generator. Reads the project's
// characters + approved relationships and produces a tight 2-3 sentence,
// pitch-ready blurb of the ensemble. Descriptive prose only — no IDs, no
// field labels, no bullet lists.

import { callLLM, extractJSON } from "../llm/provider.js";
import type { Character, Relationship } from "@toburt/shared";

export interface SummaryGenInput {
  projectTitle: string;
  characters: Character[];
  relationships: Relationship[];
}

/** Pull the human-readable relationship line, preferring an approved
 *  buyer-facing summary, then core tension, then nature. */
function relLine(r: Relationship, nameOf: (id: string) => string): string | null {
  const f = ((r.metadata as Record<string, unknown> | null)?.fields ?? {}) as Record<string, unknown>;
  const approved = String(f.approvalStatus ?? "") === "approved";
  if (!approved) return null;
  const a = nameOf(r.a_id);
  const b = nameOf(r.b_id);
  const detail =
    (typeof f.buyerSummary === "string" && f.buyerSummary.trim()) ||
    (typeof f.coreTension === "string" && f.coreTension.trim()) ||
    (typeof r.tension === "string" && r.tension?.trim()) ||
    (typeof r.nature === "string" && r.nature?.trim()) ||
    "";
  if (!a || !b || !detail) return null;
  return `${a} ↔ ${b}: ${detail}`;
}

export async function generateCharacterBibleExecutiveSummary(
  input: SummaryGenInput
): Promise<string> {
  const { projectTitle, characters, relationships } = input;
  if (characters.length === 0) {
    throw new Error("No characters yet — add the cast before generating an executive summary.");
  }

  const nameOf = (id: string) => characters.find((c) => c.id === id)?.name ?? "";

  const castBlock = characters
    .map((c) =>
      [
        `- ${c.name}${c.role ? ` (${c.role})` : ""}${c.archetype ? ` — ${c.archetype}` : ""}`,
        c.wants ? `    wants: ${c.wants}` : "",
        c.needs ? `    needs: ${c.needs}` : "",
        c.flaw ? `    flaw: ${c.flaw}` : "",
        c.biography ? `    bio: ${c.biography.slice(0, 280)}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    )
    .join("\n");

  const relLines = relationships
    .map((r) => relLine(r, nameOf))
    .filter((x): x is string => !!x)
    .slice(0, 8);

  const sys = [
    "You are a development executive writing the one-paragraph cast summary",
    "for a series bible. Produce a tight EXECUTIVE SUMMARY of the ensemble:",
    "EXACTLY 2-3 sentences. Pitch-ready, present tense, plain prose.",
    "",
    "Rules:",
    "- Capture the ensemble and the central dramatic engine between them —",
    "  not a list of every character.",
    "- Name only the few characters who carry the spine of the show.",
    "- No bullet points, no field labels, no IDs, no headings.",
    "- Do not invent facts not supported by the cast/relationship notes.",
    "- 2-3 sentences. Never more than 3.",
    "",
    'Return JSON shaped EXACTLY as: { "summary": string }',
  ].join("\n");

  const user = [
    `SERIES: ${projectTitle}`,
    "",
    "CAST:",
    castBlock,
    "",
    relLines.length ? "APPROVED RELATIONSHIPS:" : "APPROVED RELATIONSHIPS: (none approved yet)",
    ...relLines,
  ].join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    maxTokens: 400,
  });

  const parsed = extractJSON<{ summary?: unknown }>(res.text);
  const summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary) throw new Error("Generator returned an empty summary.");
  return summary;
}
