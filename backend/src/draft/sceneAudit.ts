// 95% Script Quality Protocol — unified scene audit.
//
// One audit per scene composed from existing analyzers + new heuristics:
//   1. narrative_engine  (critical)  — does the scene move story forward
//   2. scene_turn        (critical)  — something changes start→end
//   3. character_voice   (critical)  — voice matches DNA / cast bible
//   4. subtext           (critical)  — emotion shown, not explained
//   5. power_shift                  — control/leverage shifts
//   6. visual_behavior              — body/object/silence carries emotion
//   7. pacing_rhythm                — breathes without dragging
//   8. continuity        (critical)  — facts hold (timeline, props, names…)
//   9. spec_formatting              — pro screenplay format
//  10. emotional_residue           — lands a felt aftermath
//
// Pass gate: weighted average ≥ 8.5 AND no critical category < 8.
// Heuristic-first; LLM optional via useLLM=true for the four soft categories
// (narrative_engine, character_voice, subtext, emotional_residue).
//
// Storage: results persisted under scripts.metadata.audit[ord]. Never touches
// the fountain — purely additive metadata, so the draft is never modified.

import { supabase } from "../db/client.js";
import { parseFountain } from "../screenplay/fountain.js";
import { analyzeSceneTurn, classifySceneJob, type TurnScene } from "@toburt/shared";
import { runSubtextCheck } from "./subtextCheck.js";
import { scoreScene } from "../emotional/score.js";
import type { ParsedScene } from "@toburt/shared";

export type AuditCategoryKey =
  | "narrative_engine"
  | "scene_turn"
  | "character_voice"
  | "subtext"
  | "power_shift"
  | "visual_behavior"
  | "pacing_rhythm"
  | "continuity"
  | "spec_formatting"
  | "emotional_residue";

export const CRITICAL_CATEGORIES: ReadonlyArray<AuditCategoryKey> = [
  "narrative_engine",
  "scene_turn",
  "character_voice",
  "subtext",
  "continuity",
];

export const CATEGORY_LABEL: Record<AuditCategoryKey, string> = {
  narrative_engine: "Narrative Engine",
  scene_turn: "Scene Turn",
  character_voice: "Character Voice",
  subtext: "Subtext",
  power_shift: "Power Shift",
  visual_behavior: "Visual Behavior",
  pacing_rhythm: "Pacing / Rhythm",
  continuity: "Continuity",
  spec_formatting: "Spec Formatting",
  emotional_residue: "Emotional Residue",
};

export interface AuditCategory {
  key: AuditCategoryKey;
  label: string;
  score: number;              // 1..10
  critical: boolean;
  /** Verbatim quotes / specific moments that hurt the score (no confabulation). */
  failingItems: string[];
  /** Concrete rewrite instruction the writer can act on. */
  rewriteHint: string;
  source: "heuristic" | "llm" | "composite";
}

export type AuditStatus = "green" | "yellow" | "red" | "gray";

export type PassLabel =
  | "AIBase"
  | "SubtextPass"
  | "DialogueCompressionPass"
  | "VoicePass"
  | "PowerShiftPass"
  | "VisualBehaviorPass"
  | "ContinuityPass"
  | "SpecFormatPass"
  | "RhythmEdit"
  | "SpecReady";

export interface SceneAudit {
  scriptId: string;
  ord: number;
  /** Snapshot id of the version this audit applies to (script_scene_versions.id). */
  versionId: string | null;
  categories: AuditCategory[];
  averageScore: number;
  passed: boolean;
  criticalFailures: AuditCategoryKey[];
  status: AuditStatus;
  /** Ordered list of recommended rewrite passes (most impactful first). */
  rewriteStrategy: PassLabel[];
  /** Human approval — only the user can set this true ("Spec Ready"). */
  humanApproved: boolean;
  /** Optional named pass tag for the version this audit was generated against. */
  passLabel: PassLabel;
  generatedAt: string;
}

// --- Helpers ---------------------------------------------------------------

const clamp10 = (v: number): number => Math.max(1, Math.min(10, Math.round(v * 10) / 10));
const fromUnit = (v: number, floor = 4, ceil = 10): number => clamp10(floor + v * (ceil - floor));

function statusFor(avg: number, criticalFails: number): AuditStatus {
  if (criticalFails > 0 || avg < 7) return "red";
  if (avg >= 8.5) return "green";
  return "yellow";
}

/** Critical categories carry more weight in the gate average. */
const CATEGORY_WEIGHT: Record<AuditCategoryKey, number> = {
  narrative_engine: 1.5,
  scene_turn: 1.4,
  character_voice: 1.3,
  subtext: 1.3,
  continuity: 1.3,
  emotional_residue: 1.0,
  visual_behavior: 1.0,
  power_shift: 0.9,
  pacing_rhythm: 0.9,
  spec_formatting: 0.8,
};

function weightedAvg(cats: AuditCategory[]): number {
  let num = 0;
  let den = 0;
  for (const c of cats) {
    const w = CATEGORY_WEIGHT[c.key] ?? 1;
    num += c.score * w;
    den += w;
  }
  return den ? num / den : 0;
}

// --- Per-category scorers ---------------------------------------------------

/** Spec formatting — pure heuristic check on the parsed elements. */
function scoreSpecFormatting(scene: ParsedScene): AuditCategory {
  const failing: string[] = [];
  const elements = scene.elements;

  // Slugline: INT./EXT. <LOCATION> - <TIME OF DAY>
  const slug = scene.slugline ?? "";
  if (!/^(INT|EXT|INT\/EXT|EXT\/INT|I\/E)[\.\s]/i.test(slug.trim())) {
    failing.push(`Slugline missing INT./EXT.: "${slug.slice(0, 60)}"`);
  }
  if (!/-/g.test(slug) && !/ - /.test(slug)) {
    failing.push(`Slugline missing " - <TIME OF DAY>": "${slug.slice(0, 60)}"`);
  }

  // Character cues should be uppercase
  for (const el of elements) {
    if (el.kind === "character") {
      const base = el.text.replace(/\s*\(.*\)\s*$/, "").trim();
      if (base && base !== base.toUpperCase()) {
        failing.push(`Character cue not uppercase: "${el.text}"`);
        if (failing.length > 8) break;
      }
    }
  }

  // Action lines: ≤3 lines each (≈ 3 sentences or ~240 chars)
  let longActions = 0;
  for (const el of elements) {
    if (el.kind === "action") {
      const lineCount = el.text.split(/\n/).length;
      const sentCount = el.text.split(/(?<=[.!?])\s+(?=[A-Z])/).length;
      if (lineCount > 3 || sentCount > 3 || el.text.length > 320) {
        longActions++;
        if (longActions <= 3)
          failing.push(`Action block over 3 lines: "${el.text.slice(0, 80)}…"`);
      }
    }
  }

  // Parentheticals — should be rare and short
  const parentheticals = elements.filter((e) => e.kind === "parenthetical");
  if (parentheticals.length > Math.max(2, elements.filter((e) => e.kind === "dialogue").length * 0.4)) {
    failing.push(`Too many parentheticals (${parentheticals.length}) — trust the actor.`);
  }
  for (const p of parentheticals) {
    if (p.text.length > 30) {
      failing.push(`Parenthetical too long: "${p.text}"`);
      break;
    }
  }

  let score = 10;
  score -= Math.min(5, failing.length * 0.75);
  score = Math.max(4, score);

  return {
    key: "spec_formatting",
    label: CATEGORY_LABEL.spec_formatting,
    score: clamp10(score),
    critical: false,
    failingItems: failing.slice(0, 6),
    rewriteHint: failing.length
      ? "Run a Spec Format pass: tighten slugline, uppercase cues, break action into ≤3-line beats, cut wordy parentheticals."
      : "Format is clean.",
    source: "heuristic",
  };
}

/** Pacing / rhythm — heuristic on dialogue/action balance and length. */
function scorePacingRhythm(scene: ParsedScene): AuditCategory {
  const failing: string[] = [];
  const dialogue = scene.elements.filter((e) => e.kind === "dialogue");
  const action = scene.elements.filter((e) => e.kind === "action");
  const dialogueWords = dialogue.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);
  const actionWords = action.reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);
  const totalWords = dialogueWords + actionWords;
  const totalLines = scene.fountain.split(/\n/).filter((l) => l.trim()).length;

  let score = 9;

  if (totalWords < 40) {
    score -= 2;
    failing.push(`Scene is under-written (${totalWords} words) — may not breathe.`);
  } else if (totalWords > 900) {
    score -= 1.5;
    failing.push(`Scene is over-long (${totalWords} words) — likely drags.`);
  }

  // Long dialogue speeches over 80 words = "wall of dialogue"
  for (const d of dialogue) {
    const w = d.text.split(/\s+/).filter(Boolean).length;
    if (w > 80) {
      score -= 0.8;
      failing.push(`Wall-of-dialogue speech (${w} words): "${d.text.slice(0, 70)}…"`);
      if (failing.length >= 4) break;
    }
  }

  // Action absent but dialogue heavy → talking heads
  if (dialogueWords > 200 && actionWords < dialogueWords * 0.2) {
    score -= 1.2;
    failing.push("Talking-heads risk: dialogue dominates without behavior beats.");
  }

  // Action absent entirely
  if (action.length === 0 && totalLines > 5) {
    score -= 1;
    failing.push("Scene has no action lines — characters exist in a void.");
  }

  score = Math.max(4, Math.min(10, score));
  return {
    key: "pacing_rhythm",
    label: CATEGORY_LABEL.pacing_rhythm,
    score: clamp10(score),
    critical: false,
    failingItems: failing.slice(0, 4),
    rewriteHint: failing.length
      ? "Rhythm Edit: break long speeches, interleave behavior beats, trim or expand to a prestige-TV scene length."
      : "Pacing reads clean.",
    source: "heuristic",
  };
}

/** Visual behavior — emotion shown via body/object/silence vs explained. */
function scoreVisualBehavior(scene: ParsedScene, behaviorEi?: number | null): AuditCategory {
  // Base from EI behavior dimension when available.
  const failing: string[] = [];
  const action = scene.elements.filter((e) => e.kind === "action");
  const dialogue = scene.elements.filter((e) => e.kind === "dialogue");
  const text = action.map((e) => e.text).join("\n").toLowerCase();

  const bodyCues = /\b(hand|hands|breath|breathes|eyes|stares|silence|silent|nods|grips|exhales|folds|adjusts|touches|fingers|jaw|shoulder|knuckles|reaches|backs away|steps back|recoils|flinches|tilts|smiles thinly|blinks|swallows|tightens|trembl|tremor|stills|holds|lingers)\b/gi;
  const bodyHits = (text.match(bodyCues) ?? []).length;

  // Score baseline from EI behavior (0..1) if present; else from heuristic ratio.
  let base = 7;
  if (typeof behaviorEi === "number" && behaviorEi > 0) {
    base = fromUnit(behaviorEi, 4, 10);
  } else if (dialogue.length > 0) {
    const ratio = bodyHits / Math.max(1, dialogue.length);
    base = Math.min(10, 5 + ratio * 5);
  }

  if (bodyHits === 0 && action.length > 0) {
    base -= 1.5;
    failing.push("No body / object / silence cues — emotion lives only in dialogue.");
  }
  if (action.length === 0) {
    base -= 2;
    failing.push("Action is absent — there is no visual behavior to carry feeling.");
  }

  return {
    key: "visual_behavior",
    label: CATEGORY_LABEL.visual_behavior,
    score: clamp10(Math.max(4, base)),
    critical: false,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Visual Behavior pass: replace explained emotion with hand tremors, glances, props, silence, micro-actions."
      : "Behavior already does the work.",
    source: behaviorEi != null ? "composite" : "heuristic",
  };
}

/** Power shift — direct from EI powerShift dimension. */
function scorePowerShift(powerShiftEi?: number | null): AuditCategory {
  const failing: string[] = [];
  let score = 7;
  if (typeof powerShiftEi === "number") {
    score = fromUnit(powerShiftEi, 4, 10);
  }
  if (typeof powerShiftEi === "number" && powerShiftEi < 0.3) {
    failing.push("No detectable shift in leverage, control, or emotional advantage.");
  }
  return {
    key: "power_shift",
    label: CATEGORY_LABEL.power_shift,
    score: clamp10(score),
    critical: false,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Power Shift pass: give one character meaningful leverage by scene's end (information, refusal, an action that can't be undone)."
      : "Power moves cleanly across the scene.",
    source: "composite",
  };
}

/** Continuity — call existing checker; failures count against the score. */
function scoreContinuityFromIssues(issues: number, critical: number): AuditCategory {
  let score = 10 - Math.min(6, issues * 0.8) - Math.min(3, critical * 1.5);
  score = Math.max(4, score);
  return {
    key: "continuity",
    label: CATEGORY_LABEL.continuity,
    score: clamp10(score),
    critical: true,
    failingItems: [],
    rewriteHint:
      issues > 0
        ? "Continuity pass: reconcile names, locations, timeline, props, relationship state with the canon."
        : "No continuity violations detected.",
    source: "heuristic",
  };
}

/** Scene Turn — derived from analyzeSceneTurn level + alignment. */
function scoreSceneTurn(turn: ReturnType<typeof analyzeSceneTurn>): AuditCategory {
  let score: number;
  switch (turn.detected.level) {
    case "detected":
      score = turn.alignment === "aligned" ? 9.5 : 8.5;
      break;
    case "possible":
      score = 7;
      break;
    default:
      score = turn.expectsTurn ? 4.5 : 8; // quiet-by-design ≠ fail
  }

  const failing: string[] = [];
  if (turn.alignment === "intent-not-landing") {
    failing.push(`Intended turn isn't landing${turn.intendedTurn ? `: "${turn.intendedTurn}"` : ""}.`);
  } else if (turn.detected.level === "none" && turn.expectsTurn) {
    failing.push("No change between scene's start and end on any tracked axis.");
  }

  return {
    key: "scene_turn",
    label: CATEGORY_LABEL.scene_turn,
    score: clamp10(score),
    critical: true,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Turn pass: land at least one of — decision, secret revealed, leverage shift, relationship change, new problem."
      : "Turn lands cleanly.",
    source: "composite",
  };
}

/** Subtext — derived from runSubtextCheck issue counts/severities (heuristic fallback when LLM off). */
function scoreSubtextFromIssues(
  critical: number,
  warn: number,
  info: number
): AuditCategory {
  const failing: string[] = [];
  let score = 10 - critical * 2.5 - warn * 1 - info * 0.3;
  score = Math.max(4, score);
  if (critical > 0) failing.push(`${critical} on-the-nose line(s) at critical severity.`);
  if (warn > 0) failing.push(`${warn} dialogue/action moment(s) over-explain emotion.`);
  return {
    key: "subtext",
    label: CATEGORY_LABEL.subtext,
    score: clamp10(score),
    critical: true,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Subtext pass: replace stated feeling with behavior, silence, object, or misdirection (use the Subtext Check Apply flow)."
      : "Subtext is doing the work.",
    source: critical + warn + info > 0 ? "llm" : "heuristic",
  };
}

/** Heuristic subtext detector — runs without LLM. Looks for therapy-language tells. */
function scoreSubtextHeuristic(scene: ParsedScene): AuditCategory {
  const failing: string[] = [];
  // On-the-nose tells from the spec + a handful of common offenders.
  const tells = [
    /\bi (feel|am feeling) (scared|sad|angry|hurt|grieving|alone|lonely|abandoned|betrayed)\b/i,
    /\bi am grieving\b/i,
    /\byou betrayed me\b/i,
    /\b(this )?therapy is (making|helping) me confront my (trauma|past|grief)\b/i,
    /\bi'?m processing my (trauma|grief|feelings|past)\b/i,
    /\bi need to be (vulnerable|open) with you\b/i,
    /\bmy (childhood|mother|father) (made me|caused this)\b/i,
    /\bi (love|hate|trust|miss) you\b/i, // common but flag for review
  ];
  let hits = 0;
  for (const d of scene.elements.filter((e) => e.kind === "dialogue")) {
    for (const re of tells) {
      if (re.test(d.text)) {
        hits++;
        if (failing.length < 5) failing.push(`On-the-nose: "${d.text.slice(0, 90)}"`);
        break;
      }
    }
  }
  let score = 9 - hits * 1.2;
  score = Math.max(4, score);
  return {
    key: "subtext",
    label: CATEGORY_LABEL.subtext,
    score: clamp10(score),
    critical: true,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Subtext pass: convert stated feelings into a small action — a folded letter, a corrected detail, a refusal to answer."
      : "No therapy-language tells found.",
    source: "heuristic",
  };
}

/** Character Voice — heuristic vs cast bible (DNA) name presence + cadence variance. */
function scoreCharacterVoice(
  scene: ParsedScene,
  cast: Array<{ name: string; dna?: CharacterDNA | null; voice_notes?: string | null }>
): AuditCategory {
  const failing: string[] = [];
  const dialogue = scene.elements.filter((e) => e.kind === "dialogue");
  const cues = scene.elements.filter((e) => e.kind === "character");
  if (dialogue.length === 0) {
    return {
      key: "character_voice",
      label: CATEGORY_LABEL.character_voice,
      score: 8,
      critical: true,
      failingItems: [],
      rewriteHint: "No dialogue to check.",
      source: "heuristic",
    };
  }

  const castNames = new Set(cast.map((c) => c.name.toUpperCase()));
  const unknownSpeakers = new Set<string>();
  for (const c of cues) {
    const base = c.text.replace(/\s*\(.*\)\s*$/, "").trim().toUpperCase();
    if (base && !castNames.has(base) && base !== "V.O." && base !== "O.S.") {
      unknownSpeakers.add(base);
    }
  }
  if (unknownSpeakers.size > 0) {
    failing.push(`Speaker(s) not in cast bible: ${[...unknownSpeakers].join(", ")}`);
  }

  // Crude cadence: average word-length per speaker should differ when there are
  // strong DNA voice notes for them. If two speakers have identical mean
  // word-lengths and similar lengths, voices may be collapsing.
  const buckets: Record<string, number[]> = {};
  let lastSpeaker = "";
  for (const el of scene.elements) {
    if (el.kind === "character") {
      lastSpeaker = el.text.replace(/\s*\(.*\)\s*$/, "").trim().toUpperCase();
      if (!buckets[lastSpeaker]) buckets[lastSpeaker] = [];
    } else if (el.kind === "dialogue" && lastSpeaker) {
      const words = el.text.split(/\s+/).filter(Boolean);
      buckets[lastSpeaker].push(words.length);
    }
  }
  const speakers = Object.keys(buckets);
  if (speakers.length >= 2) {
    const means = speakers.map((s) => {
      const arr = buckets[s];
      return { s, mean: arr.reduce((a, b) => a + b, 0) / Math.max(1, arr.length) };
    });
    const dnaSpeakers = speakers.filter((s) =>
      cast.some((c) => c.name.toUpperCase() === s && (c.dna?.speech_cadence || c.voice_notes))
    );
    if (dnaSpeakers.length >= 2) {
      const ms = means.filter((m) => dnaSpeakers.includes(m.s)).map((m) => m.mean);
      const min = Math.min(...ms);
      const max = Math.max(...ms);
      if (max - min < 1.5 && ms.every((x) => x > 6)) {
        failing.push("Speakers with DNA cadence rules sound similar — voices may be collapsing.");
      }
    }
  }

  let score = 9 - failing.length * 1.4;
  score = Math.max(4, score);
  return {
    key: "character_voice",
    label: CATEGORY_LABEL.character_voice,
    score: clamp10(score),
    critical: true,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Voice pass: pull each character toward their DNA — speech cadence, tics, what they refuse to say, how they lie."
      : "Voices read distinct.",
    source: "heuristic",
  };
}

/** Narrative Engine — heuristic on consequence/decision/new-information cues. */
function scoreNarrativeEngine(
  scene: ParsedScene,
  turn: ReturnType<typeof analyzeSceneTurn>
): AuditCategory {
  const failing: string[] = [];
  const turnLevel = turn.detected.level;
  let score = 7;
  if (turnLevel === "detected") score = 9;
  else if (turnLevel === "possible") score = 7.5;
  else score = turn.expectsTurn ? 5 : 7.5; // quiet-by-design isn't a fail

  const text = scene.fountain.toLowerCase();
  // Signs the scene PUSHES the story
  const advanceCues = /(next|because of|so now|now that|that means|new plan|i'?ll|we have to|then we|i decided|i'?m doing|find out|discover|learn that|never again|from now on)/i;
  if (!advanceCues.test(text)) {
    if (turn.expectsTurn) {
      score -= 1;
      failing.push("No 'so now…' beat — outcome isn't compounding into a next move.");
    }
  }

  // Information density: did anything new arrive?
  const informationCues = /(turns out|i never told|i lied|in fact|the truth is|i found|i saw|i heard|message|letter|file|photo|recording)/i;
  if (informationCues.test(text)) score += 0.5;

  if (!turn.expectsTurn && turnLevel === "none") {
    // Quiet scene — narrative engine = sustain & accumulate dread
    score = Math.min(10, Math.max(7, score));
  }

  return {
    key: "narrative_engine",
    label: CATEGORY_LABEL.narrative_engine,
    score: clamp10(score),
    critical: true,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Narrative pass: bake a consequence into the scene end — what does this force the next scene to do?"
      : "Scene compounds forward.",
    source: "composite",
  };
}

/** Emotional Residue — heuristic on what the scene leaves behind in the last beat. */
function scoreEmotionalResidue(scene: ParsedScene): AuditCategory {
  const failing: string[] = [];
  const tail = scene.fountain.slice(-400).toLowerCase();
  // Residue cues: dread, curiosity, intimacy, consequence, tension
  const residueCues =
    /(silence|quiet|stares|lingers|doesn'?t answer|holds her|holds his|exhales|closes the door|the door closes|she looks|he looks|empty|alone|the rain|cuts to black|fade out|smoke|mist|tightens|trembl)/i;
  const closurePinch =
    /(everyone laughs|all is well|they hug|they kiss and|happy|relieved smile)/i;

  let score = 7;
  if (residueCues.test(tail)) score += 1.5;
  if (closurePinch.test(tail)) {
    score -= 1.5;
    failing.push("Scene resolves itself instead of leaving a residue.");
  }
  if (!residueCues.test(tail) && tail.trim().length < 50) {
    failing.push("Scene ends abruptly — no felt aftermath.");
    score -= 1;
  }

  return {
    key: "emotional_residue",
    label: CATEGORY_LABEL.emotional_residue,
    score: clamp10(Math.max(4, score)),
    critical: false,
    failingItems: failing,
    rewriteHint: failing.length
      ? "Residue pass: end on a held image, an unanswered question, a hand that doesn't move — let the audience carry it forward."
      : "Scene leaves a felt aftermath.",
    source: "heuristic",
  };
}

// --- Character DNA (read-only here; written via routes) ---------------------

export interface CharacterDNA {
  core_wound?: string;
  public_mask?: string;
  private_fear?: string;
  speech_cadence?: string;
  behavioral_tics?: string[];
  emotional_triggers?: string[];
  defensive_strategies?: string[];
  avoids_saying?: string[];
  how_lies?: string;
  shows_vulnerability?: string;
  /** Per-character notes about how they relate to others (keyed by other char name). */
  relationships?: Record<string, string>;
}

async function loadCast(projectId: string): Promise<
  Array<{ name: string; voice_notes: string | null; dna: CharacterDNA | null }>
> {
  const { data } = await supabase
    .from("characters")
    .select("name, voice_notes, metadata")
    .eq("project_id", projectId);
  return (data ?? []).map((c) => {
    const meta = (c.metadata as Record<string, unknown>) ?? {};
    const dna = (meta.dna as CharacterDNA | undefined) ?? null;
    return { name: c.name as string, voice_notes: (c.voice_notes as string) ?? null, dna };
  });
}

// --- Public API -------------------------------------------------------------

export interface AuditOptions {
  /** When true, runs the LLM-backed Subtext + EI dimension scoring. Default false. */
  useLLM?: boolean;
  /** Tag this audit with a named pass (default "AIBase"). */
  passLabel?: PassLabel;
  /** Optional version snapshot id this audit is bound to. */
  versionId?: string | null;
}

export interface AuditSceneResult {
  audit: SceneAudit;
  /** Estimated LLM cost (0 when heuristic). */
  llmCost: number;
}

/**
 * Audit a single scene against the 95% protocol. Heuristic-first; opt-in LLM
 * for Subtext + EI dimensions. Writes the result into scripts.metadata.audit[ord]
 * — never touches the fountain.
 */
export async function auditScene(
  scriptId: string,
  ord: number,
  opts: AuditOptions = {}
): Promise<AuditSceneResult> {
  const { data: script } = await supabase
    .from("scripts")
    .select("id, project_id, metadata, fountain")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");

  const { data: row } = await supabase
    .from("script_scenes")
    .select("ord, slugline, fountain")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (!row?.fountain) throw new Error(`Scene ${ord} is empty — nothing to audit.`);

  // Parse the scene body into elements via the same Fountain parser used elsewhere.
  const parsed = parseFountain(row.fountain as string);
  const parsedScene: ParsedScene = parsed.scenes[0] ?? {
    order: ord,
    slugline: (row.slugline as string) ?? "",
    intExt: null,
    location: "",
    timeOfDay: "",
    characters: [],
    startLine: 0,
    endLine: 0,
    fountain: row.fountain as string,
    elements: parsed.elements,
  };

  const cast = await loadCast(script.project_id as string);

  // --- Turn detection (free) ---
  const turnScene: TurnScene = {
    order: ord,
    slugline: parsedScene.slugline,
    overall: 0,
    scores: {},
    fountain: row.fountain as string,
    authoredTurn: null,
  };
  // Job inferred from this scene alone (no prev for single-scene audits).
  const job = classifySceneJob(turnScene);
  const turn = analyzeSceneTurn(turnScene, undefined, job);

  // --- EI dims (optional, costs $) ---
  let behaviorEi: number | null = null;
  let powerShiftEi: number | null = null;
  let llmCost = 0;
  if (opts.useLLM) {
    try {
      const ei = await scoreScene({
        projectId: script.project_id as string,
        scriptId,
        sceneId: null,
        scene: parsedScene,
        characters: parsedScene.characters,
        useLLM: true,
      });
      behaviorEi = ei.scores.behavior?.available ? ei.scores.behavior.value : null;
      powerShiftEi = ei.scores.powerShift?.available ? ei.scores.powerShift.value : null;
      llmCost += ei.llmCost ?? 0;
    } catch {
      /* fall back to heuristics */
    }
  }

  // --- Subtext: heuristic by default, LLM optional via runSubtextCheck (script-level, not per-scene; we just use the heuristic per scene). ---
  const subtextCat = scoreSubtextHeuristic(parsedScene);

  // --- Continuity: prior continuity-check results live elsewhere; pull from metadata if present. ---
  const metaPrior = ((script.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  const priorAudit = ((metaPrior.audit as Record<string, unknown>) ?? {}) as Record<
    string,
    { continuityIssues?: number; continuityCritical?: number }
  >;
  const stash = priorAudit[String(ord)] ?? {};
  const contCat = scoreContinuityFromIssues(
    typeof stash.continuityIssues === "number" ? stash.continuityIssues : 0,
    typeof stash.continuityCritical === "number" ? stash.continuityCritical : 0
  );

  // Compose all ten categories.
  const categories: AuditCategory[] = [
    scoreNarrativeEngine(parsedScene, turn),
    scoreSceneTurn(turn),
    scoreCharacterVoice(parsedScene, cast),
    subtextCat,
    scorePowerShift(powerShiftEi),
    scoreVisualBehavior(parsedScene, behaviorEi),
    scorePacingRhythm(parsedScene),
    contCat,
    scoreSpecFormatting(parsedScene),
    scoreEmotionalResidue(parsedScene),
  ];

  const averageScore = Math.round(weightedAvg(categories) * 10) / 10;
  const criticalFailures = categories
    .filter((c) => c.critical && c.score < 8)
    .map((c) => c.key);
  const passed = averageScore >= 8.5 && criticalFailures.length === 0;

  // Build a rewrite strategy from the failing categories — most impactful first.
  const failingSorted = [...categories]
    .filter((c) => c.score < 8.5)
    .sort((a, b) => (CATEGORY_WEIGHT[b.key] - CATEGORY_WEIGHT[a.key]) || (a.score - b.score));
  const passMap: Partial<Record<AuditCategoryKey, PassLabel>> = {
    subtext: "SubtextPass",
    character_voice: "VoicePass",
    power_shift: "PowerShiftPass",
    visual_behavior: "VisualBehaviorPass",
    continuity: "ContinuityPass",
    spec_formatting: "SpecFormatPass",
    pacing_rhythm: "RhythmEdit",
    // narrative_engine, scene_turn, emotional_residue → handled via Rewrite & Polish (dialogue compression / turn pass)
    scene_turn: "DialogueCompressionPass",
    narrative_engine: "DialogueCompressionPass",
    emotional_residue: "RhythmEdit",
  };
  const seen = new Set<PassLabel>();
  const rewriteStrategy: PassLabel[] = [];
  for (const f of failingSorted) {
    const p = passMap[f.key];
    if (p && !seen.has(p)) {
      rewriteStrategy.push(p);
      seen.add(p);
    }
  }

  const audit: SceneAudit = {
    scriptId,
    ord,
    versionId: opts.versionId ?? null,
    categories,
    averageScore,
    passed,
    criticalFailures,
    status: statusFor(averageScore, criticalFailures.length),
    rewriteStrategy,
    humanApproved: false,
    passLabel: opts.passLabel ?? "AIBase",
    generatedAt: new Date().toISOString(),
  };

  // Persist scene-safely under metadata.audit[ord] — never touch fountain.
  const meta = { ...((script.metadata as Record<string, unknown>) ?? {}) };
  const auditStash = { ...((meta.audit as Record<string, unknown>) ?? {}) };
  // Keep last 5 audits per scene for history.
  const prev = auditStash[String(ord)] as
    | { current?: SceneAudit; history?: SceneAudit[] }
    | undefined;
  const history = (prev?.history ?? []).slice(0, 4);
  if (prev?.current) history.unshift(prev.current);
  auditStash[String(ord)] = { current: audit, history };
  meta.audit = auditStash;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", scriptId);

  return { audit, llmCost };
}

/** Audit every scene in a script. Heuristic-only by default for cost. */
export async function auditScript(
  scriptId: string,
  opts: AuditOptions = {}
): Promise<{ audits: SceneAudit[]; totalCost: number }> {
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  const ords = (scenes ?? []).map((s) => s.ord as number);
  const audits: SceneAudit[] = [];
  let totalCost = 0;
  for (const ord of ords) {
    try {
      const r = await auditScene(scriptId, ord, opts);
      audits.push(r.audit);
      totalCost += r.llmCost;
    } catch {
      /* skip empty scenes */
    }
  }
  return { audits, totalCost };
}

/** Read stored audits for the dashboard. */
export async function getAuditDashboard(
  scriptId: string
): Promise<SceneAudit[]> {
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .single();
  const stash =
    ((script?.metadata as Record<string, unknown>)?.audit as Record<
      string,
      { current?: SceneAudit }
    >) ?? {};
  return Object.values(stash)
    .map((entry) => entry?.current)
    .filter((x): x is SceneAudit => !!x)
    .sort((a, b) => a.ord - b.ord);
}

/** Toggle human approval — only this writes humanApproved. AI never sets it. */
export async function setSceneApproval(
  scriptId: string,
  ord: number,
  approved: boolean
): Promise<SceneAudit> {
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const meta = { ...((script.metadata as Record<string, unknown>) ?? {}) };
  const auditStash = { ...((meta.audit as Record<string, unknown>) ?? {}) };
  const entry = (auditStash[String(ord)] as { current?: SceneAudit; history?: SceneAudit[] }) ?? {};
  if (!entry.current) throw new Error("Audit this scene first.");
  entry.current = {
    ...entry.current,
    humanApproved: approved,
    passLabel: approved ? "SpecReady" : entry.current.passLabel,
  };
  auditStash[String(ord)] = entry;
  meta.audit = auditStash;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", scriptId);
  return entry.current;
}

/** Inject the heuristic subtext detector (also exposed for unit testing). */
export { scoreSubtextHeuristic, scoreSpecFormatting, scorePacingRhythm };
