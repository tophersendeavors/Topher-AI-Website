// Canon auditor. Phrase-matching catches the LLM's direct repeats; this
// second LLM pass catches the REPHRASED inventions — the same idea written
// in softer words ("she is already in her notes" → "her name has surfaced
// in journalistic shorthand").
//
// Process:
//   1. Split each generated field into sentences.
//   2. Ask the LLM to classify EVERY sentence against the source manifest:
//        source_confirmed     — the source manifest directly says this
//        conservative_inference — fair emotional / thematic extrapolation
//        speculative_canon    — a specific past/future/off-screen event
//                               not in source
//   3. Keep only sentences classified source_confirmed or
//      conservative_inference. Move speculative_canon to non-canon Internal
//      Notes (the existing quarantine).
//   4. Return a per-field confidence level so the UI can label fields.

import { callLLM, extractJSON } from "../../llm/provider.js";
import { config } from "../../config.js";
import type { RelationshipDraft } from "./generator.js";
import type { StrictRemoval } from "./sourceStrict.js";

export type CanonVerdict =
  | "source_confirmed"
  | "conservative_inference"
  | "speculative_canon";

export type FieldConfidence = CanonVerdict;

const MAIN_FIELDS: (keyof RelationshipDraft)[] = [
  "nature",
  "aWants",
  "bWants",
  "aWithholds",
  "bWithholds",
  "coreTension",
  "powerDynamic",
  "emotionalCost",
  "dramaticFunction",
  "buyerSummary",
];

function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface SentenceJob {
  field: keyof RelationshipDraft;
  index: number;
  sentence: string;
}

interface AuditEntry {
  id: number;
  verdict: CanonVerdict;
  reason: string;
}

export interface AuditResult {
  /** Cleaned draft — speculative sentences stripped from main fields. */
  cleaned: RelationshipDraft;
  /** Sentences moved to non-canon notes. */
  removed: StrictRemoval[];
  /** Per-field confidence (worst verdict among that field's kept sentences). */
  fieldConfidence: Partial<Record<keyof RelationshipDraft, FieldConfidence>>;
}

/**
 * Run the canon auditor. ONE LLM call per relationship (not per sentence).
 * Returns the cleaned draft + the list of speculative sentences to move to
 * non-canon notes + per-field confidence.
 *
 * Cost-sensitive: low temperature, capped tokens, conservative model.
 */
export async function auditCanon(args: {
  draft: RelationshipDraft;
  sourceManifest: string;
  aName: string;
  bName: string;
  /** Optional list of "allowed conservative inferences" the writer has
   *  pre-authorized for this project (e.g. SELVAJE: extraction, exposure,
   *  ethics of observation). The auditor treats these as background-safe. */
  allowedThematicTokens?: string[];
}): Promise<AuditResult> {
  const jobs: SentenceJob[] = [];
  for (const field of MAIN_FIELDS) {
    const raw = (args.draft as Record<string, unknown>)[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const sentences = splitSentences(raw);
    sentences.forEach((s, i) => jobs.push({ field, index: i, sentence: s }));
  }
  if (jobs.length === 0) {
    return {
      cleaned: args.draft,
      removed: [],
      fieldConfidence: {},
    };
  }

  const numbered = jobs
    .map((j, i) => `[${i}] (${String(j.field)}) ${j.sentence}`)
    .join("\n");

  const system = [
    "You are the CANON AUDITOR for a prestige TV writers' room's relationship",
    "tracker. The agent just drafted a relationship's fields; your job is to",
    "classify EVERY sentence against the APPROVED SOURCE MANIFEST.",
    "",
    "Three verdicts (use these exact tokens):",
    "  source_confirmed — the source manifest directly says this, or the",
    "    sentence is a near-paraphrase of something in source.",
    "  conservative_inference — fair emotional / thematic extrapolation from",
    "    source. Generic feelings (resentment, exhaustion, fear, loneliness,",
    "    desire to be seen), genre register, or thematic frames",
    "    (extraction vs exposure, ethics of observation, restraint) when the",
    "    pairing's role/role-pairing logically supports them.",
    "  speculative_canon — a SPECIFIC past event, specific future event,",
    "    specific off-screen relationship escalation, specific character",
    "    wound, specific sexual / marital detail, specific discovery /",
    "    aftermath beat — anything that ASSUMES facts not in source.",
    "",
    "Be strict. If a sentence implies a past event (\"already\", \"first time\",",
    "\"never\", \"source was\", \"wound from\", \"off the record\", \"discovery\",",
    "\"intimacy\", \"sexually dissatisfied\") it is SPECULATIVE unless source",
    "manifests the same claim. Generic emotion is fine; specific canon is not.",
    "",
    "Return ONLY JSON:",
    "{",
    '  "verdicts": [',
    '    { "id": <int>, "verdict": "<one of the three>", "reason": "<one short clause>" },',
    "    ...",
    "  ]",
    "}",
  ].join("\n");

  const user = [
    "APPROVED SOURCE MANIFEST (the ONLY canon):",
    args.sourceManifest,
    "",
    args.allowedThematicTokens?.length
      ? `Writer-approved thematic tokens (treat as conservative_inference when present): ${args.allowedThematicTokens.join(", ")}`
      : "",
    "",
    `PAIR: ${args.aName} ↔ ${args.bName}`,
    "",
    "Sentences to classify:",
    numbered,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.0,
    maxTokens: 1600,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    // If the auditor fails to return JSON we fall back to "speculative until
    // proven otherwise" — safer than letting invention through.
    const removed: StrictRemoval[] = jobs.map((j) => ({
      field: j.field,
      reason: "auditor returned no JSON — defaulting to speculative",
      snippet: j.sentence,
    }));
    return { cleaned: emptyDraftFromKeys(args.draft), removed, fieldConfidence: {} };
  }
  const list = Array.isArray(parsed.verdicts) ? parsed.verdicts : [];
  const byId = new Map<number, AuditEntry>();
  for (const raw of list) {
    const o = (raw ?? {}) as Record<string, unknown>;
    const id = typeof o.id === "number" ? o.id : -1;
    const verdict = String(o.verdict ?? "speculative_canon");
    const reason = typeof o.reason === "string" ? o.reason : "";
    if (id < 0) continue;
    if (
      verdict === "source_confirmed" ||
      verdict === "conservative_inference" ||
      verdict === "speculative_canon"
    ) {
      byId.set(id, { id, verdict: verdict as CanonVerdict, reason });
    }
  }

  // Rebuild fields from kept sentences; collect removals.
  const removed: StrictRemoval[] = [];
  const fieldKept = new Map<keyof RelationshipDraft, string[]>();
  const fieldVerdicts = new Map<keyof RelationshipDraft, CanonVerdict[]>();
  jobs.forEach((j, i) => {
    const v = byId.get(i);
    const verdict = v?.verdict ?? "speculative_canon";
    if (verdict === "speculative_canon") {
      removed.push({
        field: j.field,
        reason: v?.reason ? `canon auditor: ${v.reason}` : "canon auditor: speculative",
        snippet: j.sentence,
      });
      return;
    }
    const list = fieldKept.get(j.field) ?? [];
    list.push(j.sentence);
    fieldKept.set(j.field, list);
    const verdicts = fieldVerdicts.get(j.field) ?? [];
    verdicts.push(verdict);
    fieldVerdicts.set(j.field, verdicts);
  });

  // Rebuild cleaned draft. Empty fields stay empty (no stale carry-over).
  const cleaned: RelationshipDraft = { ...args.draft };
  for (const field of MAIN_FIELDS) {
    const kept = fieldKept.get(field) ?? [];
    (cleaned as Record<string, unknown>)[field] = kept.join(" ").trim();
  }
  const fieldConfidence: Partial<Record<keyof RelationshipDraft, FieldConfidence>> = {};
  for (const [field, verdicts] of fieldVerdicts.entries()) {
    // Worst verdict in the kept set defines the field's confidence (and
    // since speculative was removed, this is always confirmed or inference).
    fieldConfidence[field] = verdicts.includes("conservative_inference")
      ? "conservative_inference"
      : "source_confirmed";
  }
  return { cleaned, removed, fieldConfidence };
}

function emptyDraftFromKeys(draft: RelationshipDraft): RelationshipDraft {
  const out: RelationshipDraft = { ...draft };
  for (const k of MAIN_FIELDS) (out as Record<string, unknown>)[k] = "";
  return out;
}
