// Pure, LLM-free analysis over per-scene Emotional Intelligence reports.
//
// Everything here is deterministic aggregation of data the scorer already
// returns, so it is free to run and benefits every screenplay equally. The
// functions are intentionally SCOPE-AGNOSTIC: they take an arbitrary array of
// scored scenes, so the identical code can run at scene, episode, or season
// level once episodic orchestration arrives. Nothing here hard-codes a single
// pilot (no fixed act boundaries or scene counts).

export type EiDim =
  | "truth"
  | "subtext"
  | "wound"
  | "behavior"
  | "tension"
  | "powerShift";

export const DIM_LABELS: Record<EiDim, string> = {
  truth: "Truth",
  subtext: "Subtext",
  wound: "Wound",
  behavior: "Behavior",
  tension: "Tension",
  powerShift: "Power",
};

// Mirrors backend DIMENSION_WEIGHTS — kept here so the UI can explain why a
// dimension counts more or less. Truth/Subtext/Behavior are load-bearing.
export const DIM_WEIGHTS: Record<EiDim, number> = {
  truth: 1.5,
  subtext: 1.3,
  behavior: 1.3,
  wound: 1.0,
  tension: 1.0,
  powerShift: 0.7,
};

import {
  analyzeSceneTurn,
  classifySceneJob,
  diagnoseTension,
  TENSION_SOURCE_LABEL,
  SCENE_JOB_LABEL,
  type SceneTurn,
  type SceneJob,
} from "./turnDetection";

const DIMS: EiDim[] = [
  "truth",
  "subtext",
  "wound",
  "behavior",
  "tension",
  "powerShift",
];

export interface AnalyzedScene {
  order: number;
  slugline: string;
  overall: number;
  weak: boolean;
  rewriteInstructions: string[];
  scores: Record<EiDim, { value: number; reason: string; available: boolean }>;
  match?: {
    detectedCharacters: string[];
    resolvedCharacters: string[];
    woundsMatched: string[];
    tensionsMatched: number;
  };
  /** Scene body (Fountain) — powers the lexical turn detector when present. */
  fountain?: string;
  /** Authored Turn from the scene plan (for turn-alignment). */
  authoredTurn?: string | null;
}

// ---------------------------------------------------------------------------
// Guided-fix pass registry (item 5). EI diagnoses; these describe the targeted
// agent pass a writer can CHOOSE to run. The instruction seeds proposeSceneFix
// — nothing is rewritten until the writer reviews the diff and applies it.
// ---------------------------------------------------------------------------

export type PassKey = "tension" | "subtext" | "behavior" | "dialogue" | "scene";

export interface PassDef {
  key: PassKey;
  label: string;
  /** Builds the instruction seeded into the propose-fix flow. */
  instruction: (ctx: { characters?: string[] }) => string;
}

const chars = (ctx: { characters?: string[] }) =>
  ctx.characters && ctx.characters.length
    ? ctx.characters.join(" and ")
    : "the characters";

export const PASSES: Record<PassKey, PassDef> = {
  tension: {
    key: "tension",
    label: "Run Tension Pass",
    instruction: (ctx) =>
      `Run a Tension pass on this scene: surface what is unsaid between ${chars(
        ctx
      )}. Add a charge neither will name but both feel, and let the power balance shift by the end. Do not state feelings outright.`,
  },
  subtext: {
    key: "subtext",
    label: "Run Subtext Pass",
    instruction: () =>
      "Run a Subtext pass: replace on-the-nose or explanatory dialogue with deflection, displacement, or a physical action that reveals the emotion sideways.",
  },
  behavior: {
    key: "behavior",
    label: "Run Behavior Pass",
    instruction: (ctx) =>
      `Run a Behavior pass: give ${chars(
        ctx
      )} stage business that contradicts or undercuts what they say. Show emotion through action, not statement.`,
  },
  dialogue: {
    key: "dialogue",
    label: "Run Dialogue Pass",
    instruction: (ctx) =>
      `Run a Dialogue pass: differentiate each voice (${chars(
        ctx
      )}) — rhythm, vocabulary, and what each avoids saying — so the scene stops reading flat.`,
  },
  scene: {
    key: "scene",
    label: "Run Scene Pass",
    instruction: () =>
      "Run a Scene pass: re-examine this scene's purpose and cause/effect. Make sure it turns — someone enters with leverage, someone leaves with it.",
  },
};

const PASS_FOR_DIMENSION: Record<EiDim, PassKey> = {
  truth: "scene",
  subtext: "subtext",
  wound: "behavior",
  behavior: "behavior",
  tension: "tension",
  powerShift: "scene",
};

// ---------------------------------------------------------------------------
// Dimension averages
// ---------------------------------------------------------------------------

export interface DimStat {
  dimension: EiDim;
  label: string;
  avg: number;
  /** How many scenes this dimension actually applied to. */
  n: number;
}

export function dimensionStats(scenes: AnalyzedScene[]): DimStat[] {
  return DIMS.map((d) => {
    const vals = scenes
      .map((s) => s.scores[d])
      .filter((x) => x && x.available)
      .map((x) => x.value);
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    return { dimension: d, label: DIM_LABELS[d], avg, n: vals.length };
  });
}

// ---------------------------------------------------------------------------
// Analysis confidence (item 3)
// ---------------------------------------------------------------------------

export interface Confidence {
  level: "low" | "medium" | "high";
  sceneCount: number;
  factors: {
    metadataCoverage: number;
    woundCoverage: number;
    tensionCoverage: number;
    characterParticipation: number;
  };
}

export function buildConfidence(scenes: AnalyzedScene[]): Confidence {
  const n = scenes.length;
  const frac = (pred: (s: AnalyzedScene) => boolean) =>
    n ? scenes.filter(pred).length / n : 0;
  const woundCoverage = frac((s) => (s.match?.woundsMatched.length ?? 0) > 0);
  const tensionCoverage = frac((s) => (s.match?.tensionsMatched ?? 0) > 0);
  const characterParticipation = frac(
    (s) => (s.match?.resolvedCharacters.length ?? 0) > 0
  );
  const metadataCoverage = frac(
    (s) =>
      (s.match?.woundsMatched.length ?? 0) > 0 ||
      (s.match?.tensionsMatched ?? 0) > 0
  );

  let level: Confidence["level"] = n < 6 ? "low" : n <= 15 ? "medium" : "high";
  // Thin coverage erodes trust regardless of scene count.
  if ((metadataCoverage < 0.5 || characterParticipation < 0.5) && level === "high")
    level = "medium";
  if ((metadataCoverage < 0.3 || characterParticipation < 0.3) && level === "medium")
    level = "low";

  return {
    level,
    sceneCount: n,
    factors: {
      metadataCoverage,
      woundCoverage,
      tensionCoverage,
      characterParticipation,
    },
  };
}

// ---------------------------------------------------------------------------
// Insights — strengths + actionable weaknesses (items 1-prep, 2)
// ---------------------------------------------------------------------------

export interface SceneRef {
  order: number;
  slugline: string;
  overall: number;
}

export interface Weakness {
  dimension: EiDim;
  label: string;
  avg: number;
  affectedScenes: number[];
  characters: string[];
  suggestedPass: PassKey;
}

export interface Insights {
  strengths: string[];
  weaknesses: Weakness[];
  standoutScenes: SceneRef[];
  weakScenes: SceneRef[];
  topDimensions: DimStat[];
  bottomDimensions: DimStat[];
}

const WEAK_DIM_THRESHOLD = 0.55;
const SCENE_DIM_LOW = 0.5;

export function buildInsights(scenes: AnalyzedScene[]): Insights {
  const ref = (s: AnalyzedScene): SceneRef => ({
    order: s.order,
    slugline: s.slugline,
    overall: s.overall,
  });

  const stats = dimensionStats(scenes).filter((d) => d.n > 0);
  const byScore = [...stats].sort((a, b) => b.avg - a.avg);
  const topDimensions = byScore.slice(0, 2);
  const bottomDimensions = [...byScore].reverse().slice(0, 2);

  const standoutScenes = scenes
    .filter((s) => s.overall >= 0.8)
    .sort((a, b) => b.overall - a.overall)
    .slice(0, 5)
    .map(ref);

  const weakScenes = scenes
    .filter((s) => s.weak)
    .sort((a, b) => a.overall - b.overall)
    .map(ref);

  const strengths: string[] = [];
  for (const d of topDimensions) {
    if (d.avg >= 0.7) {
      strengths.push(
        `${d.label} is carrying the script (avg ${pct(d.avg)} across ${d.n} scene${plural(
          d.n
        )}).`
      );
    }
  }
  if (standoutScenes.length) {
    strengths.push(
      `${standoutScenes.length} standout scene${plural(
        standoutScenes.length
      )} (${standoutScenes
        .slice(0, 3)
        .map((s) => `#${s.order}`)
        .join(", ")}${standoutScenes.length > 3 ? "…" : ""}).`
    );
  }
  if (!strengths.length && byScore.length) {
    strengths.push(`Strongest dimension is ${byScore[0].label} (avg ${pct(byScore[0].avg)}).`);
  }

  // Actionable weaknesses: each weak dimension names the scenes it hurts, the
  // characters in those scenes, and the corrective pass to run.
  const weaknesses: Weakness[] = [];
  for (const d of bottomDimensions) {
    if (d.avg >= WEAK_DIM_THRESHOLD) continue;
    const affected = scenes.filter(
      (s) => s.scores[d.dimension]?.available && s.scores[d.dimension].value < SCENE_DIM_LOW
    );
    if (!affected.length) continue;
    const characters = uniq(
      affected.flatMap((s) => s.match?.resolvedCharacters ?? [])
    );
    weaknesses.push({
      dimension: d.dimension,
      label: d.label,
      avg: d.avg,
      affectedScenes: affected.map((s) => s.order).sort((a, b) => a - b),
      characters,
      suggestedPass: PASS_FOR_DIMENSION[d.dimension],
    });
  }

  return {
    strengths,
    weaknesses,
    standoutScenes,
    weakScenes,
    topDimensions,
    bottomDimensions,
  };
}

// ---------------------------------------------------------------------------
// Character arc health (items 1 + 4a)
// ---------------------------------------------------------------------------

export type CharacterClass =
  | "insufficient-data"
  | "low-presence"
  | "underdeveloped"
  | "static"
  | "declining"
  | "growing"
  | "strong-arc";

export const CHARACTER_CLASS_LABEL: Record<CharacterClass, string> = {
  "insufficient-data": "Insufficient Data",
  "low-presence": "Low Presence",
  underdeveloped: "Underdeveloped",
  static: "Static",
  declining: "Declining",
  growing: "Growing",
  "strong-arc": "Strong Arc",
};

export type ArcTrend = "rising" | "flat" | "falling";
export type ArcStrength = "none" | "weak" | "moderate" | "strong" | "static";

export interface CharacterHealth {
  name: string;
  presence: number;
  avgOverall: number;
  dims: Partial<Record<EiDim, number>>;
  woundUsage: number;
  /** Second-half avg minus first-half avg. */
  trend: number;
  /** Max-min overall across their scenes. */
  range: number;
  classification: CharacterClass;
  arcTrend: ArcTrend;
  arcStrength: ArcStrength;
}

const ENOUGH_SCENES = 4;

export function buildCharacterHealth(scenes: AnalyzedScene[]): CharacterHealth[] {
  const byChar = new Map<string, AnalyzedScene[]>();
  for (const s of scenes) {
    for (const name of s.match?.resolvedCharacters ?? []) {
      const arr = byChar.get(name) ?? [];
      arr.push(s);
      byChar.set(name, arr);
    }
  }

  const out: CharacterHealth[] = [];
  for (const [name, theirScenes] of byChar.entries()) {
    const ordered = [...theirScenes].sort((a, b) => a.order - b.order);
    const presence = ordered.length;
    const overalls = ordered.map((s) => s.overall);
    const avgOverall = mean(overalls);
    const range = presence ? Math.max(...overalls) - Math.min(...overalls) : 0;
    const lastOverall = overalls[overalls.length - 1] ?? 0;

    const dims: Partial<Record<EiDim, number>> = {};
    for (const d of DIMS) {
      const vals = ordered
        .map((s) => s.scores[d])
        .filter((x) => x && x.available)
        .map((x) => x.value);
      if (vals.length) dims[d] = mean(vals);
    }

    const woundHits = ordered.filter((s) =>
      (s.match?.woundsMatched ?? []).includes(name)
    ).length;
    const woundUsage = woundHits / presence;

    const mid = Math.floor(presence / 2);
    const fAvg = mean(ordered.slice(0, mid || 1).map((s) => s.overall));
    const sAvg = presence > 1 ? mean(ordered.slice(mid || 1).map((s) => s.overall)) : fAvg;
    const trend = sAvg - fAvg;

    const arcTrend: ArcTrend =
      trend >= 0.05 ? "rising" : trend <= -0.05 ? "falling" : "flat";

    let arcStrength: ArcStrength;
    if (presence < 2) arcStrength = "none";
    else if (range < 0.08) arcStrength = "static";
    else if (trend >= 0.12 && range >= 0.2 && lastOverall >= 0.65) arcStrength = "strong";
    else if (Math.abs(trend) >= 0.06 || range >= 0.15) arcStrength = "moderate";
    else arcStrength = "weak";

    // Single primary classification (item 1).
    let classification: CharacterClass;
    if (presence === 1) classification = "insufficient-data";
    else if (presence <= 3) classification = "low-presence";
    else if (avgOverall < 0.5) classification = "underdeveloped";
    else if (trend <= -0.12) classification = "declining";
    else if (trend >= 0.12 && range >= 0.2 && lastOverall >= 0.65)
      classification = "strong-arc";
    else if (trend >= 0.12) classification = "growing";
    else classification = "static"; // present & developed but not really changing

    out.push({
      name,
      presence,
      avgOverall,
      dims,
      woundUsage,
      trend,
      range,
      classification,
      arcTrend,
      arcStrength,
    });
  }

  return out.sort((a, b) => b.presence - a.presence);
}

// ---------------------------------------------------------------------------
// Scene purpose detection (item 6) — heuristic / "inferred"
// ---------------------------------------------------------------------------

export type ScenePurpose =
  | "Setup"
  | "Escalation"
  | "Revelation"
  | "Reversal"
  | "Emotional Turn"
  | "Character Deepening"
  | "Payoff"
  | "Transition";

export function classifyScenePurpose(
  s: AnalyzedScene,
  prev: AnalyzedScene | undefined,
  index: number,
  total: number
): ScenePurpose {
  const pos = total > 1 ? index / (total - 1) : 0;
  const tension = s.scores.tension;
  const tensionVal = tension?.available ? tension.value : 0;
  const power = s.scores.powerShift?.value ?? 0;
  const truth = s.scores.truth?.value ?? 0;
  const wound = s.scores.wound;
  const prevTension =
    prev && prev.scores.tension?.available ? prev.scores.tension.value : null;
  const dTension = tension?.available && prevTension != null ? tensionVal - prevTension : 0;
  const dOverall = prev ? s.overall - prev.overall : 0;

  if (power >= 0.8 && tensionVal >= 0.55) return "Reversal";
  if (truth >= 0.78 && Math.abs(dOverall) >= 0.12) return "Revelation";
  if (tension?.available && dTension >= 0.1 && tensionVal >= 0.5) return "Escalation";
  if (Math.abs(dOverall) >= 0.15) return "Emotional Turn";
  if (wound?.available && wound.value >= 0.6 && tensionVal < 0.5)
    return "Character Deepening";
  if (pos >= 0.8 && s.overall >= 0.7) return "Payoff";
  if (pos <= 0.2) return "Setup";
  if (tension?.available && tensionVal >= 0.45) return "Escalation";
  if (wound?.available) return "Character Deepening";
  return "Transition";
}

export interface ScenePurposeEntry {
  order: number;
  purpose: ScenePurpose;
}

export function scenePurposes(scenes: AnalyzedScene[]): ScenePurposeEntry[] {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  return ordered.map((s, i) => ({
    order: s.order,
    purpose: classifyScenePurpose(s, ordered[i - 1], i, ordered.length),
  }));
}

// ---------------------------------------------------------------------------
// Heatmap (cells) + pacing diagnostics (zones) (items 7)
// ---------------------------------------------------------------------------

export type SceneFlag =
  | "weak"
  | "standout"
  | "low-tension"
  | "exposition"
  | "repeated";

export interface HeatCell {
  order: number;
  slugline: string;
  overall: number;
  flags: SceneFlag[];
  purpose: ScenePurpose;
  /** The job this scene performs (drives purpose-aware grading). */
  job: SceneJob;
  /** Multi-axis dramatic-turn read for this scene (Tier 1 detector). */
  turn: SceneTurn;
}

export function buildHeatmap(scenes: AnalyzedScene[]): { cells: HeatCell[] } {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const purposes = scenePurposes(ordered);
  const total = ordered.length;
  const cells: HeatCell[] = ordered.map((s, i) => {
    const flags: SceneFlag[] = [];
    if (s.weak) flags.push("weak");
    if (s.overall >= 0.8) flags.push("standout");
    const subtext = s.scores.subtext;
    const behavior = s.scores.behavior;
    if (subtext?.available && subtext.value < 0.5 && behavior.value < 0.4)
      flags.push("exposition");
    const tension = s.scores.tension;
    if (tension?.available && tension.value < 0.4) flags.push("low-tension");
    const job = classifySceneJob(s, ordered[i - 1], i, total);
    return {
      order: s.order,
      slugline: s.slugline,
      overall: s.overall,
      flags,
      purpose: purposes[i].purpose,
      job,
      turn: analyzeSceneTurn(s, ordered[i - 1], job),
    };
  });

  // Repeated beats: adjacent same-location scenes with near-identical profiles.
  for (let i = 0; i < ordered.length - 1; i++) {
    const a = ordered[i];
    const b = ordered[i + 1];
    if (sceneLocation(a.slugline) !== sceneLocation(b.slugline)) continue;
    if (profileDistance(a, b) < 0.07) {
      cells[i].flags.push("repeated");
      cells[i + 1].flags.push("repeated");
    }
  }

  return { cells };
}

export type PacingKind =
  | "low-tension"
  | "exposition"
  | "repeated"
  | "setup-cluster"
  | "escalation-gap"
  | "payoff-drought";

export interface PacingZone {
  kind: PacingKind;
  label: string;
  fromOrder: number;
  toOrder: number;
}

export function buildPacing(scenes: AnalyzedScene[]): { zones: PacingZone[] } {
  const { cells } = buildHeatmap(scenes);
  const zones: PacingZone[] = [];

  collectRuns(cells, (c) => c.flags.includes("low-tension")).forEach((run) => {
    if (run.length >= 2)
      zones.push(zone("low-tension", `Low-tension stretch (${run.length} scenes)`, run));
  });
  collectRuns(cells, (c) => c.flags.includes("exposition")).forEach((run) => {
    if (run.length >= 2)
      zones.push(zone("exposition", `Exposition cluster (${run.length} scenes)`, run));
  });
  collectRuns(cells, (c) => c.purpose === "Setup").forEach((run) => {
    if (run.length >= 3)
      zones.push(zone("setup-cluster", `Setup-heavy stretch (${run.length} scenes)`, run));
  });

  // Repeated beats (each adjacent pair becomes its own zone).
  for (let i = 0; i < cells.length - 1; i++) {
    if (cells[i].flags.includes("repeated") && cells[i + 1].flags.includes("repeated")) {
      zones.push({
        kind: "repeated",
        label: `Possible repeated beat (#${cells[i].order} ≈ #${cells[i + 1].order})`,
        fromOrder: cells[i].order,
        toOrder: cells[i + 1].order,
      });
    }
  }

  // Turn gap: a long run of scenes that are MEANT to turn but don't. Scenes
  // whose job isn't built to turn (reflection, dread, transition, setup,
  // mystery) are excluded — they're quiet by design, not a pacing problem.
  collectRuns(
    cells,
    (c) => c.turn.detected.level === "none" && c.turn.expectsTurn
  ).forEach((run) => {
    if (run.length >= 3)
      zones.push(
        zone(
          "escalation-gap",
          `${run.length} scenes that should turn but don't — heuristic, subtle turns may be missed`,
          run
        )
      );
  });

  // Payoff drought: no Payoff in the final quarter of a reasonably long episode.
  if (cells.length >= 8) {
    const tailStart = Math.floor(cells.length * 0.75);
    const tail = cells.slice(tailStart);
    if (!tail.some((c) => c.purpose === "Payoff") && tail.length) {
      zones.push({
        kind: "payoff-drought",
        label: "Payoff drought — no payoff scene in the final act",
        fromOrder: tail[0].order,
        toOrder: tail[tail.length - 1].order,
      });
    }
  }

  return { zones };
}

// ---------------------------------------------------------------------------
// Canonical development summary (item 8)
// ---------------------------------------------------------------------------

export interface NextAction {
  label: string;
  scenes: number[];
  characters: string[];
  pass?: PassKey;
}

export interface DevelopmentSummary {
  /** One executive framing line about where the script sits right now. */
  headline: string;
  strengths: string[];
  risks: string[];
  nextActions: NextAction[];
}

// Executive-level phrasing. The Development Summary speaks in THEMES, never in
// scene numbers — those belong to Findings. Each dimension maps to a strategic
// strength/risk statement a showrunner would say in a room.
const EXEC_STRENGTH: Record<EiDim, string> = {
  truth: "Emotionally truthful foundation",
  subtext: "Strong, consistent subtext",
  wound: "Strong wound expression",
  behavior: "Behavior-driven scenes",
  tension: "Strong interpersonal conflict",
  powerShift: "Clear power dynamics",
};
const EXEC_RISK: Record<EiDim, string> = {
  truth: "Thin emotional credibility",
  subtext: "On-the-nose emotional writing",
  wound: "Character wounds underused",
  behavior: "Under-dramatized, talky scenes",
  tension: "Weak interpersonal conflict",
  powerShift: "Scenes rarely shift power",
};

export function buildDevelopmentSummary(
  scenes: AnalyzedScene[],
  characters: CharacterHealth[],
  insights: Insights,
  pacing: { zones: PacingZone[] }
): DevelopmentSummary {
  const stats = dimensionStats(scenes);
  const statOf = (d: EiDim) => stats.find((s) => s.dimension === d);

  // Strengths (executive): the composite foundation, then up to two strong
  // dimensions phrased strategically — no scene references.
  const strengths: string[] = [];
  const foundationVals = (["truth", "subtext", "wound", "behavior"] as EiDim[])
    .map(statOf)
    .filter((s): s is DimStat => !!s && s.n > 0)
    .map((s) => s.avg);
  if (foundationVals.length && mean(foundationVals) >= 0.65) {
    strengths.push("Strong emotional foundation");
  }
  for (const s of [...stats]
    .filter((s) => s.n > 0 && s.avg >= 0.7)
    .sort((a, b) => b.avg - a.avg)) {
    if (strengths.length >= 3) break;
    const phrase = EXEC_STRENGTH[s.dimension];
    if (!strengths.includes(phrase)) strengths.push(phrase);
  }
  if (characters.some((c) => c.classification === "strong-arc")) {
    strengths.push("Characters with clear arcs");
  }

  // Risks (executive): weak dimensions + structural read, no scene references.
  const risks: string[] = [];
  for (const w of insights.weaknesses) {
    const phrase = EXEC_RISK[w.dimension];
    if (!risks.includes(phrase)) risks.push(phrase);
  }
  // Presence-based risk is suppressed at LOW confidence: with only a handful
  // of scenes scored, "low presence" is an artifact of the sample size, not a
  // real story problem. At low confidence we only count `underdeveloped`
  // (a quality signal over ≥4 of a character's scenes), never pure-count flags.
  const presenceReliable = buildConfidence(scenes).level !== "low";
  const presenceClasses: CharacterClass[] = presenceReliable
    ? ["low-presence", "underdeveloped", "insufficient-data"]
    : ["underdeveloped"];
  const thinCast = characters.filter((c) =>
    presenceClasses.includes(c.classification)
  ).length;
  if (thinCast >= 2) risks.push("Supporting cast underdeveloped");
  if (pacing.zones.some((z) => z.kind === "escalation-gap" || z.kind === "low-tension"))
    risks.push("Narrative momentum stalls");
  if (pacing.zones.some((z) => z.kind === "payoff-drought"))
    risks.push("No clear payoff yet");

  // Headline framing from the scene-purpose distribution.
  const purposes = scenePurposes(scenes).map((p) => p.purpose);
  const n = purposes.length || 1;
  const share = (p: ScenePurpose) => purposes.filter((x) => x === p).length / n;
  let headline: string;
  if (share("Setup") >= 0.4) headline = "Pilot currently focused on setup.";
  else if (n < 6) headline = "Early-stage draft — limited sample.";
  else if (share("Escalation") >= 0.35) headline = "Story is actively escalating.";
  else if (share("Transition") >= 0.4)
    headline = "Episode leans on connective/transition scenes.";
  else headline = "Balanced mix of setup, escalation, and turns.";

  const nextActions: NextAction[] = [];
  // Corrective passes for the weakest dimensions first.
  for (const w of insights.weaknesses) {
    nextActions.push({
      label: `${PASSES[w.suggestedPass].label} on Scene${plural(
        w.affectedScenes.length
      )} ${w.affectedScenes.join(", ")}`,
      scenes: w.affectedScenes,
      characters: w.characters,
      pass: w.suggestedPass,
    });
  }
  // Character-development advisories (no auto-pass).
  for (const c of characters.filter((c) => c.classification === "low-presence")) {
    nextActions.push({
      label: `Expand ${c.name}'s presence before the midpoint`,
      scenes: [],
      characters: [c.name],
    });
  }
  // Pacing advisories.
  for (const z of pacing.zones.filter(
    (z) => z.kind === "escalation-gap" || z.kind === "payoff-drought"
  )) {
    nextActions.push({
      label: `Review pacing: ${z.label}`,
      scenes: [],
      characters: [],
    });
  }

  return {
    headline,
    strengths: dedupe(strengths),
    risks: dedupe(risks),
    nextActions: nextActions.slice(0, 6),
  };
}

// ---------------------------------------------------------------------------
// Top-3 highest-impact fixes — "where I'd spend the next hour"
// ---------------------------------------------------------------------------

export interface FixOpportunity {
  order: number;
  slugline: string;
  /** Specific, diagnostic statement of the problem. */
  problem: string;
  /** Recommended targeted pass. */
  pass: PassKey;
  characters: string[];
  /** 0..1 ranking weight. */
  impact: number;
  /** Why this is worth the time. */
  why: string;
}

/**
 * Rank the single highest-impact fix per scene, then return the top 3 for the
 * whole episode. Prioritizes (1) intended turns that aren't landing, (2) weak
 * tension with a named source, (3) the weakest other dimension — so the report
 * says "fix these three" instead of "run a pass on eight scenes."
 */
export function rankFixes(scenes: AnalyzedScene[]): FixOpportunity[] {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  const perScene = new Map<number, FixOpportunity>();

  const consider = (f: FixOpportunity) => {
    const cur = perScene.get(f.order);
    if (!cur || f.impact > cur.impact) perScene.set(f.order, f);
  };

  const total = ordered.length;
  ordered.forEach((s, i) => {
    const prev = ordered[i - 1];
    const chars = s.match?.resolvedCharacters ?? [];
    const job = classifySceneJob(s, prev, i, total);
    const t = analyzeSceneTurn(s, prev, job);

    // (1) A scene built to turn that doesn't — the biggest single lift.
    if (t.alignment === "intent-not-landing") {
      consider({
        order: s.order,
        slugline: s.slugline,
        problem: t.note ?? "Intended turn isn't landing.",
        pass: "tension",
        characters: chars,
        impact: 0.85 + (1 - s.overall) * 0.15,
        why: "This scene is built to turn but currently doesn't — fixing it lifts the whole act.",
      });
    }

    // (2) Weak tension — only when tension is part of THIS scene's job. A
    // reflection/transition scene with low tension is graded as designed, not
    // failed. diagnoseTension(s, job) returns [] for jobs where it's unfair.
    const tension = s.scores.tension;
    if (tension?.available && tension.value < 0.5) {
      const sources = diagnoseTension(s, job);
      if (sources.length) {
        consider({
          order: s.order,
          slugline: s.slugline,
          problem: `Weak tension (${SCENE_JOB_LABEL[job].toLowerCase()} scene) — ${TENSION_SOURCE_LABEL[sources[0]]}`,
          pass: "tension",
          characters: chars,
          impact: 0.55 + (0.5 - tension.value),
          why: "Low tension in a scene whose job depends on it.",
        });
      }
    }

    // (3) Weakest other applicable dimension on a weak scene.
    if (s.weak) {
      const dims = dimensionStats([s]).filter(
        (d) => d.n > 0 && d.dimension !== "tension" && s.scores[d.dimension].value < 0.5
      );
      const worst = dims.sort((a, b) => a.avg - b.avg)[0];
      if (worst) {
        consider({
          order: s.order,
          slugline: s.slugline,
          problem: `Weak ${worst.label.toLowerCase()} (${Math.round(worst.avg * 100)}).`,
          pass: PASS_FOR_DIMENSION[worst.dimension],
          characters: chars,
          impact: 0.4 + (1 - s.overall) * 0.3,
          why: `${worst.label} is this scene's weakest applied dimension.`,
        });
      }
    }
  });

  return [...perScene.values()].sort((a, b) => b.impact - a.impact).slice(0, 3);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function zone(kind: PacingKind, label: string, run: HeatCell[]): PacingZone {
  return { kind, label, fromOrder: run[0].order, toOrder: run[run.length - 1].order };
}

function collectRuns<T>(items: T[], pred: (x: T) => boolean): T[][] {
  const runs: T[][] = [];
  let cur: T[] = [];
  for (const it of items) {
    if (pred(it)) cur.push(it);
    else if (cur.length) {
      runs.push(cur);
      cur = [];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

function profileDistance(a: AnalyzedScene, b: AnalyzedScene): number {
  let sum = 0;
  let n = 0;
  for (const d of DIMS) {
    const av = a.scores[d];
    const bv = b.scores[d];
    if (av?.available && bv?.available) {
      sum += Math.abs(av.value - bv.value);
      n++;
    }
  }
  return n ? sum / n : 1;
}

/** Strip INT./EXT. prefix and time-of-day suffix to compare locations. */
export function sceneLocation(slugline: string): string {
  return slugline
    .replace(/^\s*(INT\.?\/EXT\.?|INT\.?|EXT\.?|EST\.?|I\/E)\s*/i, "")
    .replace(
      /\s*[-–]\s*(DAY|NIGHT|MORNING|EVENING|DUSK|DAWN|LATER|CONTINUOUS|MOMENTS LATER).*$/i,
      ""
    )
    .trim()
    .toUpperCase();
}

function mean(arr: number[]): number {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}
function uniq(arr: string[]): string[] {
  return [...new Set(arr)];
}
function dedupe(arr: string[]): string[] {
  return [...new Set(arr)];
}
function pct(v: number): string {
  return `${Math.round(v * 100)}`;
}
function plural(n: number): string {
  return n === 1 ? "" : "s";
}
