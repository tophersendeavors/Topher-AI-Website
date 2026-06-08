// Master Shot Brief source-strict validator. After the shotlist agent
// generates a brief, this classifies each field against the approved
// source — scene fountain + project bibles — and downgrades anything that
// isn't supported. In source-strict mode the strip moves speculative
// content into nonCanonNotes so the writer never loses an idea, but the
// main fields stay buyer-grade.
//
// Mirrors the relationship sourceStrict pattern: layered defense, plain
// rules, no fancy LLM auditor here (the brief is field-by-field — keyword
// containment is sufficient).

import type { MasterShotBrief } from "./types.js";

export type Confidence =
  | "source_confirmed"
  | "conservative_inference"
  | "speculative"
  | "not_enough_source";

/** Fields the validator inspects + classifies. */
const TEXTUAL_FIELDS = [
  "location",
  "timeOfDay",
  "action",
  "performanceDirection",
  "dialogue",
  "lighting",
  "colorPalette",
  "productionDesign",
  "visualMotif",
  "continuityNotes",
  "safetyNotes",
  "shotPurpose",
  "storyBeat",
  "emotionalBeat",
] as const;

/** Fields that are arrays of short tokens; treated specially. */
const TOKEN_LIST_FIELDS = ["props", "referenceAssets"] as const;

/** Fields that are structural / pipeline metadata (always source_confirmed
 *  when set by the writer or inferred safely from spec).
 *
 *  V3.6 — shotTags moved here. INSERT / OBJECT / BEH / TRANS etc. are
 *  production category tags, not screenplay content; classifying them as
 *  "speculative because not in fountain text" was a false positive. They
 *  count as source_confirmed whenever the writer (or the auto-builder)
 *  sets them, regardless of whether the literal word "INSERT" appears in
 *  the screenplay. */
const STRUCTURAL_FIELDS = [
  "aspectRatio",
  "durationSec",
  "outputType",
  "cameraFraming",
  "lensSuggestion",
  "cameraMovement",
  "shotTags",
] as const;

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split a phrase into "distinctive" tokens — content nouns / adjectives
 * worth checking for source presence. Stop-words and ultra-short tokens
 * are dropped so "the" / "and" / "a" don't tip every field into
 * source_confirmed.
 */
const STOP = new Set(
  "the and a an of in on at to from with by for as is are was were be been being into onto over under near her his their its them this that these those one two three some any many several few".split(
    /\s+/
  )
);
function distinctiveTokens(phrase: string): string[] {
  return normalize(phrase)
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

/** How many distinctive tokens are present in the source haystack? */
function matchRatio(phrase: string, haystack: string): { ratio: number; matched: string[] } {
  const tokens = distinctiveTokens(phrase);
  if (tokens.length === 0) return { ratio: 0, matched: [] };
  const matched: string[] = [];
  for (const t of tokens) if (haystack.includes(t)) matched.push(t);
  return { ratio: matched.length / tokens.length, matched };
}

/**
 * Classify a single field's value against the source haystack.
 *   • ratio ≥ 0.6 → source_confirmed
 *   • ratio ≥ 0.3 → conservative_inference
 *   • ratio < 0.3 and value is specific → speculative
 *   • empty or generic → not_enough_source
 */
function classifyValue(value: unknown, haystack: string): Confidence {
  if (value == null || (typeof value === "string" && !value.trim())) return "not_enough_source";
  if (Array.isArray(value)) {
    if (value.length === 0) return "not_enough_source";
    // Average matchRatio across array tokens.
    let sum = 0;
    let n = 0;
    for (const v of value) {
      if (typeof v !== "string") continue;
      sum += matchRatio(v, haystack).ratio;
      n++;
    }
    const r = n ? sum / n : 0;
    if (r >= 0.6) return "source_confirmed";
    if (r >= 0.3) return "conservative_inference";
    return "speculative";
  }
  if (typeof value === "string") {
    const { ratio } = matchRatio(value, haystack);
    if (ratio >= 0.6) return "source_confirmed";
    if (ratio >= 0.3) return "conservative_inference";
    return "speculative";
  }
  return "not_enough_source";
}

export interface StrictRemoval {
  field: string;
  reason: string;
  snippet: string;
}

export interface BriefStrictResult {
  cleaned: MasterShotBrief;
  fieldConfidence: NonNullable<MasterShotBrief["fieldConfidence"]>;
  removed: StrictRemoval[];
  /** New nonCanonNotes string (prior block replaced). */
  quarantine: string;
}

/**
 * Validate a brief against source. In strict mode the caller will treat
 * speculative fields as "to remove"; in non-strict mode the caller may
 * just surface the labels.
 */
export function classifyBriefFields(
  brief: MasterShotBrief,
  sourceText: string
): { fieldConfidence: NonNullable<MasterShotBrief["fieldConfidence"]> } {
  const haystack = normalize(sourceText);
  const fc: NonNullable<MasterShotBrief["fieldConfidence"]> = {};
  for (const f of TEXTUAL_FIELDS) {
    fc[f] = classifyValue((brief as Record<string, unknown>)[f], haystack);
  }
  for (const f of TOKEN_LIST_FIELDS) {
    fc[f as keyof typeof fc] = classifyValue((brief as Record<string, unknown>)[f], haystack);
  }
  for (const f of STRUCTURAL_FIELDS) {
    const v = (brief as Record<string, unknown>)[f];
    fc[f as keyof typeof fc] = v ? "source_confirmed" : "not_enough_source";
  }
  // characters: confirmed when the names appear in source; otherwise
  // conservative inference if a cast row drove the entry.
  const charsValue = brief.characters ?? [];
  if (charsValue.length === 0) fc.characters = "not_enough_source";
  else {
    const allInSource = charsValue.every((c) =>
      haystack.includes(normalize(c.name))
    );
    fc.characters = allInSource ? "source_confirmed" : "conservative_inference";
  }
  // visualWeight: structural; always conservative inference when set.
  fc.visualWeight = brief.visualWeight ? "conservative_inference" : "not_enough_source";
  return { fieldConfidence: fc };
}

/**
 * Strict mode: strip speculative fields from the main brief and quarantine
 * them under nonCanonNotes. Writer-edited fields are preserved as-is.
 */
export function strictCleanBrief(
  brief: MasterShotBrief,
  sourceText: string
): BriefStrictResult {
  const { fieldConfidence } = classifyBriefFields(brief, sourceText);
  const userEdited = new Set(brief.userEditedFields ?? []);
  const removed: StrictRemoval[] = [];
  const cleaned: MasterShotBrief = { ...brief, fieldConfidence };

  const strip = (field: keyof MasterShotBrief, snippet: string) => {
    removed.push({
      field: String(field),
      reason: "speculative — not present in approved source",
      snippet,
    });
  };

  for (const f of TEXTUAL_FIELDS) {
    if (userEdited.has(String(f))) continue;
    if (fieldConfidence[f] !== "speculative") continue;
    const v = (cleaned as Record<string, unknown>)[f];
    if (typeof v === "string" && v.trim()) {
      strip(f as keyof MasterShotBrief, v);
      (cleaned as Record<string, unknown>)[f] = "";
    }
  }
  for (const f of TOKEN_LIST_FIELDS) {
    if (userEdited.has(String(f))) continue;
    if (fieldConfidence[f as keyof typeof fieldConfidence] !== "speculative") continue;
    const v = (cleaned as Record<string, unknown>)[f];
    if (Array.isArray(v) && v.length > 0) {
      strip(f as unknown as keyof MasterShotBrief, v.join(", "));
      (cleaned as Record<string, unknown>)[f] = [];
    }
  }

  // Build the quarantine block.
  const lines: string[] = [];
  if (removed.length > 0) {
    lines.push("Possible details — not canon");
    for (const r of removed) {
      lines.push(`• [${r.field}] ${r.snippet}`);
    }
  }
  const quarantine = lines.join("\n");

  // Merge into nonCanonNotes (replace any prior strict block).
  const priorNotes = (brief.nonCanonNotes ?? "").trim();
  const stripped = priorNotes
    .replace(/Possible details — not canon[\s\S]*?(?=\n\n[A-Z]|\n*$)/i, "")
    .trim();
  cleaned.nonCanonNotes = quarantine
    ? [stripped, quarantine].filter(Boolean).join("\n\n").trim()
    : stripped || undefined;

  return { cleaned, fieldConfidence, removed, quarantine };
}
