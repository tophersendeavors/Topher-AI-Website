// Relationship quality check. After the agent drafts a relationship, this
// scores it 1–10 on eight axes and tells the writer whether to accept or
// regenerate. Tone-aware (SELVAJE-style restraint), source-grounded, and
// CHEAP — runs on the existing copy, not against the full project.

import { callLLM, extractJSON } from "../../llm/provider.js";
import { config } from "../../config.js";
import { supabase } from "../../db/client.js";
import type { RelationshipDraft } from "./generator.js";

export type QualityAxis =
  | "story_relevance"
  | "character_accuracy"
  | "subtext_strength"
  | "power_dynamic_clarity"
  | "emotional_cost"
  | "scene_usefulness"
  | "pitch_usefulness"
  | "tone_alignment";

export const QUALITY_AXIS_LABEL: Record<QualityAxis, string> = {
  story_relevance: "Story relevance",
  character_accuracy: "Character accuracy",
  subtext_strength: "Subtext strength",
  power_dynamic_clarity: "Power dynamic clarity",
  emotional_cost: "Emotional cost",
  scene_usefulness: "Usefulness for scene generation",
  pitch_usefulness: "Usefulness for pitch deck",
  tone_alignment: "Tone alignment",
};

const ALL_AXES: QualityAxis[] = [
  "story_relevance",
  "character_accuracy",
  "subtext_strength",
  "power_dynamic_clarity",
  "emotional_cost",
  "scene_usefulness",
  "pitch_usefulness",
  "tone_alignment",
];

export type QualityRecommendation =
  | "accept"
  | "accept_with_notes"
  | "regenerate"
  | "regenerate_with_notes";

export interface RelationshipQualityResult {
  scores: Record<QualityAxis, number>;
  overall: number;
  recommendation: QualityRecommendation;
  /** One short sentence: what's working. */
  strengths: string;
  /** One short sentence: what to fix on a regen. */
  improvement: string;
  /** Concrete note the writer can paste into "Regenerate with notes". */
  suggestedNote?: string;
  reviewedAt: string;
}

function clamp(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 5;
  return Math.max(1, Math.min(10, Math.round(v)));
}

/**
 * Run the quality check on a stored relationship. Pulls just enough source
 * context (project tone + a couple of character lines) to ground the
 * scoring — no full manifest read.
 */
export async function qualityCheckRelationship(
  relationshipId: string
): Promise<RelationshipQualityResult> {
  const { data: rel, error } = await supabase
    .from("relationships")
    .select("project_id, a_id, b_id, metadata")
    .eq("id", relationshipId)
    .single();
  if (error) throw error;
  const f =
    (((rel.metadata as Record<string, unknown> | null)?.fields ?? {}) as Record<string, unknown>) ?? {};
  const draft: RelationshipDraft = {
    nature: f.nature as string | undefined,
    aWants: f.aWants as string | undefined,
    bWants: f.bWants as string | undefined,
    aWithholds: f.aWithholds as string | undefined,
    bWithholds: f.bWithholds as string | undefined,
    coreTension: f.coreTension as string | undefined,
    powerDynamic: f.powerDynamic as string | undefined,
    emotionalCost: f.emotionalCost as string | undefined,
    dramaticFunction: f.dramaticFunction as string | undefined,
    buyerSummary: f.buyerSummary as string | undefined,
    internalNotes: f.internalNotes as string | undefined,
  };

  const { data: proj } = await supabase
    .from("projects")
    .select("title, tone, showrunner_notes")
    .eq("id", rel.project_id)
    .maybeSingle();
  const { data: chars } = await supabase
    .from("characters")
    .select("id, name, role, biography")
    .in("id", [rel.a_id, rel.b_id]);
  const aChar = (chars ?? []).find((c) => c.id === rel.a_id);
  const bChar = (chars ?? []).find((c) => c.id === rel.b_id);

  const dump = (label: string, v?: string) =>
    v && v.trim() ? `  ${label}: ${v.trim()}` : null;
  const draftDump = [
    dump("type", draft.nature),
    dump("A wants", draft.aWants),
    dump("B wants", draft.bWants),
    dump("A withholds", draft.aWithholds),
    dump("B withholds", draft.bWithholds),
    dump("core tension", draft.coreTension),
    dump("power dynamic", draft.powerDynamic),
    dump("emotional cost", draft.emotionalCost),
    dump("dramatic function", draft.dramaticFunction),
    dump("buyer summary", draft.buyerSummary),
    dump("internal notes", draft.internalNotes),
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    "You are the RELATIONSHIP QUALITY auditor for an AI-assisted prestige TV",
    "writers' room. Score the supplied relationship copy 1–10 on each axis.",
    "Be conservative: 8+ means buyer-ready; 5–7 means usable with notes;",
    "≤4 means regenerate. Award high scores ONLY when the copy is specific,",
    "concrete, restrained, and clearly tied to the show's tone.",
    "",
    "Axes (use these exact keys in your JSON):",
    "  story_relevance — does it actually drive the show's spine?",
    "  character_accuracy — does it sound like THESE two characters?",
    "  subtext_strength — is the engine implied rather than stated?",
    "  power_dynamic_clarity — is leverage / shift named with specificity?",
    "  emotional_cost — is there a real cost named for each character?",
    "  scene_usefulness — could a writer hand this to a scene agent?",
    "  pitch_usefulness — would a buyer respond to the buyer summary?",
    "  tone_alignment — does it match the project's tone + restraint?",
    "",
    "Return ONLY JSON: {",
    `  "scores": { ${ALL_AXES.map((k) => `"${k}": <1-10>`).join(", ")} },`,
    '  "strengths": "<one-sentence praise>",',
    '  "improvement": "<one-sentence fix>",',
    '  "suggestedNote": "<a paste-ready Regenerate-with-notes instruction; omit if score is high>"',
    "}",
  ].join("\n");

  const user = [
    `Project: ${(proj?.title as string) ?? "Untitled"}`,
    proj?.tone ? `Tone: ${(proj.tone as string[]).join(", ")}` : "",
    proj?.showrunner_notes
      ? `Showrunner notes:\n${(proj.showrunner_notes as string).slice(0, 600)}`
      : "",
    "",
    `Pair: ${aChar?.name ?? "A"} ↔ ${bChar?.name ?? "B"}`,
    aChar?.role ? `${aChar.name} role: ${aChar.role}` : "",
    bChar?.role ? `${bChar.name} role: ${bChar.role}` : "",
    "",
    "Relationship copy under review:",
    draftDump || "(empty — recommend regenerate)",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    maxTokens: 700,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    throw new Error("Quality check did not return usable JSON.");
  }
  const raw = (parsed.scores as Record<string, unknown> | undefined) ?? {};
  const scores = {} as Record<QualityAxis, number>;
  for (const a of ALL_AXES) scores[a] = clamp(raw[a]);
  // Heavier weight on the load-bearing axes (relevance, subtext, tone, pitch).
  const weights: Record<QualityAxis, number> = {
    story_relevance: 1.4,
    character_accuracy: 1.2,
    subtext_strength: 1.3,
    power_dynamic_clarity: 1.0,
    emotional_cost: 1.0,
    scene_usefulness: 1.1,
    pitch_usefulness: 1.2,
    tone_alignment: 1.2,
  };
  let num = 0;
  let den = 0;
  for (const a of ALL_AXES) {
    num += scores[a] * weights[a];
    den += weights[a];
  }
  const overall = Math.round((num / den) * 10) / 10;

  const note = typeof parsed.suggestedNote === "string" ? parsed.suggestedNote.trim() : "";
  const recommendation: QualityRecommendation =
    overall >= 8.5
      ? "accept"
      : overall >= 7
      ? "accept_with_notes"
      : note
      ? "regenerate_with_notes"
      : "regenerate";

  return {
    scores,
    overall,
    recommendation,
    strengths: (parsed.strengths as string) ?? "",
    improvement: (parsed.improvement as string) ?? "",
    suggestedNote: note || undefined,
    reviewedAt: new Date().toISOString(),
  };
}
