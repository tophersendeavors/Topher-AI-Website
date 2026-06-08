import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";
import { supabase } from "../db/client.js";
import { applySceneFix } from "./sceneFix.js";
import {
  applyLineEdit,
  checkIntegrity,
  type IntegrityIssue,
} from "./applyIntegrity.js";

export type SubtextRevisionMode = "replace" | "delete";

export interface SubtextSuggestion {
  /** "Level 0 — Delete", "Level 1 — slightly indirect", etc. */
  level: string;
  /** The replacement text. EMPTY string = delete the line (Level 0). */
  text: string;
  /** True for the Level 0 delete option. */
  delete?: boolean;
}

export interface SubtextRevision {
  /** Scene ord the quote was located in (null = couldn't locate → can't apply). */
  ord: number | null;
  slugline: string | null;
  /** The exact text found in the scene (what Apply will replace/remove). */
  original: string;
  located: boolean;
  /** 0..1 — confidence in the located line (drives the UI confidence chip). */
  confidence: number;
  mode: SubtextRevisionMode;
  /** Empty for `delete`; 1 for narration/action; 2–3 levels for dialogue. */
  suggestions: SubtextSuggestion[];
  /** Why fixing this improves audience engagement. */
  impact: string;
}

const collapse = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
const stripQuotes = (s: string) => s.replace(/^["“”'']+|["“”'']+$/g, "").trim();

/**
 * Normalize text for fuzzy comparison: unify smart quotes/ellipses/dashes,
 * drop punctuation, collapse whitespace, lowercase. Screenplay formatting and
 * prior revisions shouldn't block a match.
 */
function normForMatch(s: string): string {
  return s
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/…/g, "...")
    .replace(/[—–]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 0..1 similarity between a quote and a candidate line. Substring-aware with a
 *  token Dice-coefficient fallback, so partial/paraphrased quotes still match. */
function similarity(quote: string, line: string): number {
  const a = normForMatch(quote);
  const b = normForMatch(line);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Containment (the common case: quote is the line, modulo formatting).
  if (b.includes(a) || a.includes(b)) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return 0.9 + 0.1 * ratio;
  }
  // Token Dice coefficient.
  const at = new Set(a.split(" "));
  const bt = new Set(b.split(" "));
  let inter = 0;
  for (const t of at) if (bt.has(t)) inter++;
  return (2 * inter) / (at.size + bt.size);
}

/** Best-matching non-empty line within a fountain block + its score. */
function bestLineMatch(
  fountain: string,
  quote: string
): { line: string; score: number } {
  let best = { line: "", score: 0 };
  for (const raw of fountain.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length < 2) continue;
    const score = similarity(quote, line);
    if (score > best.score) best = { line, score };
  }
  return best;
}

export interface QuoteMatch {
  ord: number | null;
  slugline: string | null;
  /** Exact text present in the scene that Apply will replace/remove. */
  original: string;
  /** 0..1 — how confident the location is. */
  confidence: number;
}

/**
 * Locate the scene + exact line for a flagged quote. Order:
 *   1. exact substring (any scene) → confidence 1.0
 *   2. fuzzy best line WITHIN the referenced scene
 *   3. fuzzy best line across ALL scenes (fallback)
 * Returns the verbatim line so Apply can replace it, plus a confidence score.
 */
async function locateQuote(
  scriptId: string,
  quote: string,
  sceneRef?: string
): Promise<QuoteMatch> {
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline, fountain")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  const rows = (scenes ?? []) as Array<{ ord: number; slugline: string; fountain: string | null }>;
  const q = stripQuotes(quote);

  // 1. Exact substring anywhere — anchor to the FULL LINE that contains it, so
  //    Apply always replaces a whole line (never a substring → no fragments).
  for (const r of rows) {
    if (r.fountain && r.fountain.includes(q)) {
      const line = r.fountain.split(/\r?\n/).find((l) => l.includes(q))?.trim() ?? q;
      return { ord: r.ord, slugline: r.slugline, original: line, confidence: 1 };
    }
  }

  // 2. Fuzzy within the REFERENCED scene first.
  let targetRows = rows;
  if (sceneRef) {
    const num = sceneRef.match(/\d+/)?.[0];
    const ref = rows.filter(
      (r) =>
        (num && r.ord === parseInt(num, 10)) ||
        (r.slugline && collapse(r.slugline).includes(collapse(sceneRef)))
    );
    if (ref.length) {
      const inScene = bestAcross(ref, q);
      if (inScene.confidence >= 0.45) return inScene;
      targetRows = rows; // fall through to global search
    }
  }

  // 3. Fuzzy across all scenes.
  const global = bestAcross(targetRows, q);
  return global;
}

function bestAcross(
  rows: Array<{ ord: number; slugline: string; fountain: string | null }>,
  quote: string
): QuoteMatch {
  let best: QuoteMatch = { ord: null, slugline: null, original: stripQuotes(quote), confidence: 0 };
  for (const r of rows) {
    const f = r.fountain ?? "";
    if (!f) continue;
    const m = bestLineMatch(f, quote);
    if (m.score > best.confidence) {
      best = { ord: r.ord, slugline: r.slugline, original: m.line, confidence: m.score };
    }
  }
  return best;
}

/**
 * Generate a targeted subtext revision for ONE flagged line. Honors the
 * Subtext Pass rules: preserve story/plot/scene purpose/character intent/
 * emotional outcome; only alter wording + exposition level; recommend DELETION
 * for narratorial over-explanation; offer 2–3 escalating implication levels for
 * over-explicit dialogue. Read-only — produces a proposal, never applies.
 */
export async function proposeSubtextRevision(args: {
  scriptId: string;
  quote: string;
  problem: string;
  sceneRef?: string;
}): Promise<SubtextRevision> {
  const { scriptId, quote, problem, sceneRef } = args;
  const loc = await locateQuote(scriptId, quote, sceneRef);

  // Scene context (the located scene's fountain) so the rewrite fits.
  let sceneText = "";
  if (loc.ord != null) {
    const { data: scene } = await supabase
      .from("script_scenes")
      .select("fountain")
      .eq("script_id", scriptId)
      .eq("ord", loc.ord)
      .maybeSingle();
    sceneText = (scene?.fountain as string) ?? "";
  }

  const system = [
    "You are a precise SUBTEXT editor in a prestige-TV writers' room. You take",
    "ONE flagged on-the-nose line and propose how to make it land indirectly.",
    "",
    "PRESERVE (never change): the story, the plot, the scene's purpose, each",
    "character's intent, and the scene's emotional outcome.",
    "You may ONLY alter: dialogue wording, narration wording, action-description",
    "wording, and the level of exposition.",
    "INCREASE: implication, ambiguity, audience participation, behavioral",
    "storytelling. DECREASE: explanation, emotional labeling, thematic",
    "annotation, narrator interpretation.",
    "",
    "Choose the MODE and ALWAYS give the writer options to compare:",
    "- NARRATORIAL OVER-EXPLANATION (thematic annotation / narrator telling the",
    '  audience what to feel or understand): set "mode":"delete" AND return',
    "  suggestions whose FIRST option is the delete option —",
    '  { "level":"Level 0 — Delete", "text":"", "delete":true } (deletion is',
    "  often best) — FOLLOWED by Level 1/2/3 indirect rewrites, so the writer",
    "  can compare deleting against keeping a tightened version.",
    '- OVER-EXPLICIT DIALOGUE: set "mode":"replace" and offer Level 1 (slightly',
    "  indirect), Level 2 (moderately indirect), Level 3 (highly subtextual).",
    '- Over-explained ACTION/exposition: "mode":"replace", 1–2 indirect rewrites.',
    "",
    "Each non-delete suggestion must be a DROP-IN replacement for the flagged",
    "text only — same speaker, same beat, same outcome. Do not add or remove",
    "characters or events.",
    "",
    "Return ONLY JSON — no prose, no fences:",
    "{",
    '  "mode": "replace" | "delete",',
    '  "suggestions": [',
    '    { "level": "Level 0 — Delete", "text": "", "delete": true },',
    '    { "level": "Level 1 — slightly indirect", "text": "..." }',
    "  ],",
    '  "impact": "<one sentence: why this lands better for the audience>"',
    "}",
  ].join("\n");

  const userMsg = [
    `FLAGGED LINE (verbatim):\n${loc.original}`,
    "",
    `WHY IT'S WEAK:\n${problem}`,
    "",
    sceneText ? `SCENE FOR CONTEXT (do not rewrite the whole scene):\n${sceneText.slice(0, 4000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: config.SUBTEXT_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: userMsg },
    ],
    temperature: 0.5,
    maxTokens: 1500,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    /* leave empty → handled below */
  }

  const mode: SubtextRevisionMode = parsed.mode === "delete" ? "delete" : "replace";
  const rawSugs = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const parsedSugs = rawSugs
    .map((s, i): SubtextSuggestion | null => {
      const o = (s ?? {}) as Record<string, unknown>;
      const isDelete =
        o.delete === true || /level\s*0|^delete|delete the line/i.test(String(o.level ?? ""));
      const text = typeof o.text === "string" ? o.text.trim() : "";
      // Keep delete options (empty text is intentional); drop empty rewrites.
      if (!isDelete && !text) return null;
      const level =
        typeof o.level === "string" && o.level.trim()
          ? o.level.trim()
          : isDelete
          ? "Level 0 — Delete"
          : `Level ${i + 1}`;
      return { level, text: isDelete ? "" : text, delete: isDelete || undefined };
    })
    .filter((x): x is SubtextSuggestion => x !== null);

  // Narration/delete proposals must always offer the delete option (Level 0).
  if (mode === "delete" && !parsedSugs.some((s) => s.delete)) {
    parsedSugs.unshift({ level: "Level 0 — Delete", text: "", delete: true });
  }
  // Delete option always first; then up to three rewrite levels.
  const dels = parsedSugs.filter((s) => s.delete).slice(0, 1);
  const rewrites = parsedSugs.filter((s) => !s.delete).slice(0, 3);
  const suggestions: SubtextSuggestion[] = [...dels, ...rewrites];

  // Located = we found a scene line we're confident enough to replace.
  const located = loc.ord != null && loc.confidence >= 0.45;

  return {
    ord: loc.ord,
    slugline: loc.slugline,
    original: loc.original,
    located,
    confidence: loc.confidence,
    mode,
    suggestions,
    impact:
      (typeof parsed.impact === "string" && parsed.impact.trim()) ||
      "Trades on-the-nose statement for implication the audience completes themselves.",
  };
}

/**
 * Apply a chosen subtext revision: replace the original line with the chosen
 * text, or remove it entirely (`delete`). Reuses applySceneFix so the prior
 * scene is snapshotted and the live draft reassembled. Never called
 * automatically — only from an explicit writer Apply.
 */
export async function applySubtextRevision(args: {
  scriptId: string;
  ord: number;
  original: string;
  /** Empty string = delete the line. */
  replacement: string;
}): Promise<{ ok: true; ord: number }> {
  const { scriptId, ord, original, replacement } = args;
  const { data: scene, error } = await supabase
    .from("script_scenes")
    .select("fountain")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (error) throw new Error(`Scene ${ord} not found.`);
  const before = (scene.fountain as string) ?? "";

  // Deterministic, line-anchored edit (no substring replace, no fuzzy guessing).
  const edit = applyLineEdit(before, original, replacement);
  if (!edit.ok) {
    if (edit.reason === "ambiguous") {
      throw new Error(
        "That exact line appears more than once in the scene, so it can't be auto-targeted safely. Edit it manually or regenerate the revision."
      );
    }
    throw new Error(
      "The flagged line no longer matches this scene (it may have been changed by an earlier edit). Regenerate the revision against the current draft."
    );
  }
  const after = edit.after!;

  // INTEGRITY GATE — never commit a corrupting change.
  const issues = checkIntegrity(before, after, original, replacement);
  const critical = issues.filter((i) => i.severity === "critical");
  if (critical.length) {
    const err = new Error(
      `Apply blocked — the result would be corrupted: ${critical.map((c) => c.detail).join("; ")}. Regenerate the revision.`
    );
    (err as Error & { issues?: IntegrityIssue[] }).issues = issues;
    throw err;
  }

  return applySceneFix({
    scriptId,
    ord,
    after,
    instruction: `Subtext pass: ${replacement.trim() ? "tightened a line for implication" : "removed an over-explained line"}`,
  });
}

export interface SubtextApplyPreview {
  ok: boolean;
  reason?: "not-found" | "ambiguous";
  ord: number;
  original: string;
  replacement: string;
  /** The full scene as it is now. */
  before: string;
  /** The full scene as it WOULD be after applying (null if it can't apply). */
  after: string | null;
  issues: IntegrityIssue[];
}

/**
 * Dry-run an apply: compute the exact resulting scene + run the integrity
 * check, WITHOUT committing. Powers the "preview → confirm" safe apply mode.
 */
export async function previewSubtextApply(args: {
  scriptId: string;
  ord: number;
  original: string;
  replacement: string;
}): Promise<SubtextApplyPreview> {
  const { scriptId, ord, original, replacement } = args;
  const { data: scene, error } = await supabase
    .from("script_scenes")
    .select("fountain")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (error) throw new Error(`Scene ${ord} not found.`);
  const before = (scene.fountain as string) ?? "";

  const edit = applyLineEdit(before, original, replacement);
  if (!edit.ok) {
    return { ok: false, reason: edit.reason, ord, original, replacement, before, after: null, issues: [] };
  }
  const after = edit.after!;
  const issues = checkIntegrity(before, after, original, replacement);
  return {
    ok: issues.every((i) => i.severity !== "critical"),
    ord,
    original,
    replacement,
    before,
    after,
    issues,
  };
}
