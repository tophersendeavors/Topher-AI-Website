import { supabase } from "../db/client.js";
import { runAgent } from "../agents/runner.js";
import { emotionalTruthAgent } from "../agents/emotionalTruth.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { validateSceneDirectness } from "../screenplay/emotionalValidator.js";
import { parseFountain } from "../screenplay/fountain.js";
import { buildNameResolver, getEmotionalMetadataStatus } from "./metadata.js";
import { estimateCost } from "../llm/pricing.js";
import { config } from "../config.js";
import type { ParsedScene } from "@toburt/shared";

export type Dimension =
  | "truth"
  | "subtext"
  | "wound"
  | "behavior"
  | "tension"
  | "powerShift";

export interface DimensionScore {
  value: number;          // 0..1
  reason: string;         // short, screenwriter-grade
  /** False = dimension is N/A for this scene (excluded from the overall). */
  available: boolean;
}

/**
 * Not every dimension matters equally to whether a scene *works*. Truth,
 * Subtext and Behavior are the craft load-bearers; Power is a useful signal
 * but a weaker proxy for quality, so it counts less. Wound/Tension sit in the
 * middle. Weights only ever apply to AVAILABLE dimensions — the average is
 * re-normalised over whatever applied, so N/A dimensions never tilt the score.
 */
export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  truth: 1.5,
  subtext: 1.3,
  behavior: 1.3,
  wound: 1.0,
  tension: 1.0,
  powerShift: 0.7,
};

/** Weighted mean of the dimensions that applied (available === true). */
export function weightedAvailableAvg(
  entries: Array<{ dimension: Dimension; value: number; available: boolean }>
): number {
  let weighted = 0;
  let weight = 0;
  for (const e of entries) {
    if (!e.available) continue;
    const w = DIMENSION_WEIGHTS[e.dimension];
    weighted += e.value * w;
    weight += w;
  }
  return weight ? weighted / weight : 0;
}

export interface SceneScoreReport {
  sceneId: string | null;
  order: number;
  slugline: string;
  scores: Record<Dimension, DimensionScore>;
  overall: number;
  weak: boolean;
  rewriteInstructions: string[];
  /** Confidence: how many of the 6 dimensions actually applied to this scene. */
  dimensionsScored: number;
  dimensionsTotal: number;
  /** True when at least one resolved character had a tracked wound/tension. */
  metadataApplied: boolean;
  /** Estimated USD cost of the LLM call for this scene (0 if heuristic-only). */
  llmCost: number;
  /** Scene body (Fountain) — lets the client run the lexical turn detector. */
  fountain: string;
  /** Authored Turn from the scene plan (Goal / Conflict / Turn), if present. */
  authoredTurn: string | null;
  /** Scene-character matching detail (powers the debug panel). */
  match: {
    detectedCharacters: string[];
    resolvedCharacters: string[];
    woundsMatched: string[];
    tensionsMatched: number;
  };
}

export interface ScriptScoreReport {
  scriptId: string;
  overall: number;
  weakSceneCount: number;
  scenes: SceneScoreReport[];
  /** Setup / debug readout so the score is trustworthy. */
  debug: {
    woundsLoaded: boolean;
    tensionsLoaded: boolean;
    scenesScoredWithMetadata: number;
    cached: boolean;
    setupRequired: boolean;
    missingWounds: string[];
  };
}

/**
 * Score one scene across all six EI dimensions. Heuristics produce a
 * baseline; the Emotional Truth agent's structured output overrides where
 * it has stronger signal (truth, powerShift, subtext, behavior).
 */
export async function scoreScene(args: {
  projectId: string;
  scriptId: string;
  sceneId: string | null;
  scene: ParsedScene;
  characters?: string[];
  /** Set false to skip the LLM call; tests use this for the heuristic path. */
  useLLM?: boolean;
  userId?: string;
  /** Optional user priority guidance for this check. */
  notes?: string;
  /**
   * Deep-pass threshold (0..1). When set, the LLM critique runs ONLY if the
   * heuristic+metadata overall is below it — so strong scenes skip the LLM.
   */
  deepThreshold?: number;
  /** Scene plan's "Goal / Conflict / Turn" string (for turn alignment). */
  storyPurpose?: string | null;
}): Promise<SceneScoreReport> {
  const { scene } = args;
  const useLLM = args.useLLM !== false;

  // --- Heuristic foundations ----------------------------------------------
  const dialogue = scene.elements.filter((e) => e.kind === "dialogue");
  const action = scene.elements.filter((e) => e.kind === "action");
  const totalLines = Math.max(1, dialogue.length + action.length);

  const directnessReport = validateSceneDirectness(scene.fountain, {
    allowStylistic: false,
    rejectionThreshold: 99, // we only want the raw violations here
  });
  const criticalCount = directnessReport.violations.filter(
    (v) => v.severity === "critical"
  ).length;
  const warnCount = directnessReport.violations.filter(
    (v) => v.severity === "warn"
  ).length;

  // Wound / tension lookups via approved canon.
  const woundQuery = await supabase
    .from("character_wounds")
    .select("character_id")
    .eq("project_id", args.projectId)
    .eq("approved", true);
  const trackedWoundIds = new Set<string>(
    (woundQuery.data ?? []).map((r) => r.character_id as string)
  );

  const tensionQuery = await supabase
    .from("relationship_tensions")
    .select("a_id,b_id,tension_score")
    .eq("project_id", args.projectId)
    .eq("approved", true);
  const tensionRows = tensionQuery.data ?? [];

  // Character-name → id: scene cues are SHORT/UPPERCASE ("MARGOT") while the
  // cast stores full names ("Margot Ellison"). Use the fuzzy resolver so the
  // wound/tension lookups actually match (the old exact match resolved 0).
  const projChars = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", args.projectId);
  const resolveName = buildNameResolver(
    (projChars.data ?? [])
      // Drop combined/junk entries like "Claire and Paul Beaumont" so a cue
      // ("CLAIRE") resolves to the real single character, not the combo row.
      .filter((c) => !/\band\b/i.test(c.name as string))
      .map((c) => ({ id: c.id as string, name: c.name as string }))
  );
  const sceneCharIds = [
    ...new Set(
      scene.characters.map((n) => resolveName(n)).filter((x): x is string => !!x)
    ),
  ];
  const idToName = new Map<string, string>(
    (projChars.data ?? []).map((c) => [c.id as string, c.name as string])
  );
  // Matching detail for the debug panel.
  const woundsMatched = sceneCharIds
    .filter((id) => trackedWoundIds.has(id))
    .map((id) => idToName.get(id) ?? id);
  const inSceneSet = new Set(sceneCharIds);
  const tensionsMatched = tensionRows.filter(
    (r) => r.a_id && r.b_id && inSceneSet.has(r.a_id as string) && inSceneSet.has(r.b_id as string)
  ).length;

  // --- Per-dimension heuristic scores -------------------------------------
  // subtext = the inverse of directness density.
  const directnessDensity =
    (criticalCount * 1 + warnCount * 0.4) / Math.max(1, dialogue.length);
  const subtextScore = clamp(1 - directnessDensity, 0, 1);

  // behavior = ratio of action lines to dialogue lines, sigmoided.
  const behaviorScore = clamp(action.length / totalLines, 0, 1);

  // wound = % of scene characters with tracked wounds.
  const woundScore =
    sceneCharIds.length === 0
      ? 0
      : sceneCharIds.filter((id) => trackedWoundIds.has(id)).length /
        sceneCharIds.length;

  // tension = average tracked tension score among pairs in the scene.
  let tensionScore = 0;
  if (sceneCharIds.length >= 2) {
    const inScene = new Set(sceneCharIds);
    const relevant = tensionRows.filter(
      (r) =>
        r.a_id &&
        r.b_id &&
        inScene.has(r.a_id as string) &&
        inScene.has(r.b_id as string)
    );
    if (relevant.length) {
      tensionScore =
        relevant.reduce((s, r) => s + (r.tension_score ?? 0.5), 0) /
        relevant.length;
    }
  }

  // power shift: heuristic = 0.4 baseline, raised if action lines bracket
  // the dialogue (i.e. someone *does* something at the end of the scene).
  const hasLateAction =
    scene.elements.length > 2 &&
    scene.elements[scene.elements.length - 1].kind === "action";
  const heuristicPowerShift = clamp(0.4 + (hasLateAction ? 0.25 : 0), 0, 1);

  // truth (heuristic baseline) — penalized by directness, rewarded by both
  // action and dialogue being present.
  const balance = Math.min(action.length, dialogue.length) / totalLines;
  const heuristicTruth = clamp(0.55 + balance * 0.4 - criticalCount * 0.2, 0, 1);

  // --- LLM enrichment -----------------------------------------------------
  // Run Emotional Truth for the strongest fields. If the call fails (no
  // LLM key, network), the heuristics carry the report. In DEEP mode we only
  // pay for the LLM on scenes that are weak heuristically — strong scenes
  // (incl. ones that just needed wound/tension metadata) skip it entirely.
  // Wound/Tension are PRESENCE dimensions — "N/A" (not 0) when the scene has
  // no wounded character / no tracked relationship pair present. Unavailable
  // dimensions are excluded from the overall so transitional/atmosphere scenes
  // aren't penalised for something that never applied.
  const woundAvailable = woundsMatched.length > 0;
  const tensionAvailable = tensionsMatched > 0;
  const heuristicOverall = weightedAvailableAvg([
    { dimension: "truth", value: heuristicTruth, available: true },
    { dimension: "subtext", value: subtextScore, available: true },
    { dimension: "behavior", value: behaviorScore, available: true },
    { dimension: "powerShift", value: heuristicPowerShift, available: true },
    { dimension: "wound", value: woundScore, available: woundAvailable },
    { dimension: "tension", value: tensionScore, available: tensionAvailable },
  ]);
  const runLLM =
    useLLM === true &&
    (args.deepThreshold == null || heuristicOverall < args.deepThreshold);

  let llmTruth: number | undefined;
  let llmReasons: Partial<Record<Dimension, string>> = {};
  let llmPowerShiftScore: number | undefined;
  let llmCost = 0;

  if (runLLM) {
    try {
      const ctx = await hydrateContext({
        projectId: args.projectId,
        collaborators: ["emotional_truth"],
        query: scene.slugline,
        user: args.userId ? { id: args.userId } : undefined,
      });
      const run = await runAgent(emotionalTruthAgent, {
        sceneFountain: scene.fountain,
        characters: scene.characters,
        scriptId: args.scriptId,
        allowStylistic: false,
        userNotes: args.notes,
      }, ctx, { maxToolRounds: 1, maxTokens: 4096 });
      llmCost = estimateCost(
        config.EMOTIONAL_TRUTH_MODEL,
        run.usage?.input,
        run.usage?.output
      );
      // The model frequently flattens the ten `state` fields to the top level
      // instead of nesting them under `state`. Recover both shapes.
      const raw = run.output as Record<string, unknown>;
      const nested = (raw.state ?? {}) as Record<string, unknown>;
      const pick = (k: string): string | undefined => {
        const fromState = nested[k];
        if (typeof fromState === "string" && fromState.trim()) return fromState;
        const fromTop = raw[k];
        if (typeof fromTop === "string" && fromTop.trim()) return fromTop;
        return undefined;
      };
      const causeEffect = Array.isArray(raw.causeEffect)
        ? (raw.causeEffect as unknown[])
        : [];
      llmTruth =
        typeof raw.truthScore === "number" ? (raw.truthScore as number) : undefined;
      const subtext = pick("subtext");
      const powerShift = pick("powerShift");
      llmReasons = {
        truth: shortReason(causeEffect as never),
        subtext: subtext ? `subtext: "${truncate(subtext, 80)}"` : undefined,
        powerShift: powerShift ? `power: ${truncate(powerShift, 80)}` : undefined,
      };
      const ps = (powerShift ?? "").toLowerCase();
      if (ps && !/(tbd|n\/?a|none|unchanged|no change)/.test(ps)) {
        llmPowerShiftScore = 0.85;
      }
    } catch {
      // Heuristic-only fallback (offline / stub mode).
    }
  }

  const scores: Record<Dimension, DimensionScore> = {
    truth: {
      value: llmTruth ?? heuristicTruth,
      available: true,
      reason:
        llmReasons.truth ??
        (criticalCount > 0
          ? `${criticalCount} on-the-nose violation(s) drag credibility down.`
          : "Heuristic baseline (no directness flags)."),
    },
    subtext: {
      value: subtextScore,
      available: true,
      reason:
        llmReasons.subtext ??
        (criticalCount + warnCount === 0
          ? "No directness flags — dialogue is doing real work."
          : `${criticalCount} critical, ${warnCount} warn directness flag(s).`),
    },
    wound: {
      value: woundScore,
      // N/A when no present character has a wound profile (not a low score).
      available: woundAvailable,
      reason: woundAvailable
        ? woundScore === 1
          ? "All present characters have tracked wounds."
          : `${woundsMatched.length} of ${sceneCharIds.length} present character(s) have a tracked wound.`
        : "N/A — no character with a wound profile is present in this scene.",
    },
    behavior: {
      value: behaviorScore,
      available: true,
      reason:
        action.length === 0
          ? "No action lines — the scene is dialogue-only."
          : `Action ratio ${action.length}/${totalLines}.`,
    },
    tension: {
      value: tensionScore,
      // N/A when no tracked relationship pair is present (e.g. solo scene).
      available: tensionAvailable,
      reason: tensionAvailable
        ? `Avg tracked tension ${tensionScore.toFixed(2)}.`
        : sceneCharIds.length < 2
          ? "N/A — solo scene, no inter-character tension."
          : "N/A — no tracked relationship pair is present in this scene.",
    },
    powerShift: {
      value: llmPowerShiftScore ?? heuristicPowerShift,
      available: true,
      reason:
        llmReasons.powerShift ??
        (hasLateAction
          ? "Late-scene action suggests an on-screen turn."
          : "No clear ending action — power shift unclear."),
    },
  };

  // Overall = WEIGHTED average of AVAILABLE dimensions only. Unavailable
  // wound/tension are N/A, not 0 — they neither raise nor lower the score, and
  // the weights re-normalise over whatever applied (see DIMENSION_WEIGHTS).
  const availableScores = Object.values(scores).filter((s) => s.available);
  const overall = weightedAvailableAvg(
    (Object.keys(scores) as Dimension[]).map((d) => ({
      dimension: d,
      value: scores[d].value,
      available: scores[d].available,
    }))
  );
  const dimensionsScored = availableScores.length;
  // Weak is judged on the dimensions that actually applied.
  const weak = overall < 0.55 || criticalCount > 1;
  const metadataApplied = woundAvailable || tensionAvailable;

  return {
    sceneId: args.sceneId,
    order: scene.order,
    slugline: scene.slugline,
    scores,
    overall,
    weak,
    rewriteInstructions: weak ? buildInstructions(scores, criticalCount) : [],
    dimensionsScored,
    dimensionsTotal: 6,
    metadataApplied,
    llmCost,
    fountain: scene.fountain,
    authoredTurn: parseAuthoredTurn(args.storyPurpose),
    match: {
      detectedCharacters: scene.characters,
      resolvedCharacters: sceneCharIds.map((id) => idToName.get(id) ?? id),
      woundsMatched,
      tensionsMatched,
    },
  };
}

/**
 * The scene plan stores purpose as "Goal / Conflict / Turn". Pull the Turn —
 * the third segment — as the authored intended turn. Returns null if absent.
 */
function parseAuthoredTurn(storyPurpose?: string | null): string | null {
  if (!storyPurpose) return null;
  const parts = storyPurpose.split(" / ").map((p) => p.trim());
  const turn = parts.length >= 3 ? parts.slice(2).join(" / ") : "";
  return turn || null;
}

/**
 * Score every scene in a script.
 */
export async function scoreScript(args: {
  projectId: string;
  scriptId: string;
  fountain: string;
  useLLM?: boolean;
  userId?: string;
  notes?: string;
}): Promise<ScriptScoreReport> {
  const parsed = parseFountain(args.fountain);

  // Map script_scenes ids + authored purpose by order for linking.
  const { data: sceneRows } = await supabase
    .from("script_scenes")
    .select("id, ord, story_purpose")
    .eq("script_id", args.scriptId);
  const orderToId = new Map<number, string>(
    (sceneRows ?? []).map((r) => [r.ord, r.id])
  );
  const orderToPurpose = new Map<number, string | null>(
    (sceneRows ?? []).map((r) => [r.ord, (r.story_purpose as string | null) ?? null])
  );

  const scenes: SceneScoreReport[] = [];
  for (const s of parsed.scenes) {
    scenes.push(
      await scoreScene({
        projectId: args.projectId,
        scriptId: args.scriptId,
        sceneId: orderToId.get(s.order) ?? null,
        scene: s,
        characters: s.characters,
        useLLM: args.useLLM,
        userId: args.userId,
        notes: args.notes,
        storyPurpose: orderToPurpose.get(s.order) ?? null,
      })
    );
  }

  const status = await getEmotionalMetadataStatus(args.projectId);
  return {
    scriptId: args.scriptId,
    overall: scenes.length ? avg(scenes.map((s) => s.overall)) : 0,
    weakSceneCount: scenes.filter((s) => s.weak).length,
    scenes,
    debug: {
      woundsLoaded: status.woundsCount > 0,
      tensionsLoaded: status.tensionsCount > 0,
      scenesScoredWithMetadata: scenes.filter((s) => s.metadataApplied).length,
      cached: false, // every run recomputes from current DB state
      setupRequired: !status.ready,
      missingWounds: status.missingWounds,
    },
  };
}

/**
 * Score a SLICE of scenes (by parsed index) so the client can run the pass in
 * batches and show real progress. `useLLM=false` is the Quick pass; `useLLM`
 * with a `deepThreshold` is the Deep pass (LLM only on weak scenes). Returns
 * the batch's scene reports plus the total count + the metadata debug readout.
 */
export async function scoreScriptRange(args: {
  projectId: string;
  scriptId: string;
  fountain: string;
  fromIndex: number;
  toIndex: number;
  /** Score ONLY these scene ords (overrides the index range) — for Selected /
   *  First-3 / Low-scoring scopes. */
  orders?: number[];
  useLLM?: boolean;
  deepThreshold?: number;
  /** Budget-mode hard cap (USD) for LLM spend in THIS call. Once reached, the
   *  remaining scenes are scored heuristic-only. */
  budget?: number;
  userId?: string;
}): Promise<{
  scenes: SceneScoreReport[];
  total: number;
  cost: number;
  budgetHit: boolean;
  debug: ScriptScoreReport["debug"];
}> {
  const parsed = parseFountain(args.fountain);
  const total = parsed.scenes.length;
  const targets =
    args.orders && args.orders.length > 0
      ? parsed.scenes.filter((s) => args.orders!.includes(s.order))
      : parsed.scenes.slice(args.fromIndex, args.toIndex);

  const { data: sceneRows } = await supabase
    .from("script_scenes")
    .select("id, ord, story_purpose")
    .eq("script_id", args.scriptId);
  const orderToId = new Map<number, string>((sceneRows ?? []).map((r) => [r.ord, r.id]));
  const orderToPurpose = new Map<number, string | null>(
    (sceneRows ?? []).map((r) => [r.ord, (r.story_purpose as string | null) ?? null])
  );

  const scenes: SceneScoreReport[] = [];
  let cost = 0;
  let budgetHit = false;
  for (const s of targets) {
    // Hard stop: once the budget is reached, stop paying for the LLM.
    const overBudget = args.budget != null && cost >= args.budget;
    if (overBudget) budgetHit = true;
    const report = await scoreScene({
      projectId: args.projectId,
      scriptId: args.scriptId,
      sceneId: orderToId.get(s.order) ?? null,
      scene: s,
      characters: s.characters,
      useLLM: args.useLLM && !overBudget,
      deepThreshold: args.deepThreshold,
      userId: args.userId,
      storyPurpose: orderToPurpose.get(s.order) ?? null,
    });
    cost += report.llmCost ?? 0;
    scenes.push(report);
  }

  const status = await getEmotionalMetadataStatus(args.projectId);
  return {
    scenes,
    total,
    cost,
    budgetHit,
    debug: {
      woundsLoaded: status.woundsCount > 0,
      tensionsLoaded: status.tensionsCount > 0,
      scenesScoredWithMetadata: scenes.filter((s) => s.metadataApplied).length,
      cached: false,
      setupRequired: !status.ready,
      missingWounds: status.missingWounds,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildInstructions(
  scores: Record<Dimension, DimensionScore>,
  criticalDirectness: number
): string[] {
  const out: string[] = [];
  if (scores.truth.value < 0.5) {
    out.push(
      "Re-check cause and effect: every emotional move needs an on-screen reason. Cut emotion that the audience hasn't been set up to feel."
    );
  }
  if (scores.subtext.value < 0.5 || criticalDirectness > 0) {
    out.push(
      "Run the Subtext agent. Replace every 'I feel ___' / 'I'm ___' line with deflection, displacement, or a physical action that reveals the emotion sideways."
    );
  }
  // Only critique wound/tension when they actually applied (available) — an
  // N/A dimension is not a writing failure.
  if (scores.wound.available && scores.wound.value < 0.4) {
    out.push(
      "Open the Character Wound agent for each character in this scene. Without a tracked wound the scene's reactions can't be calibrated."
    );
  }
  if (scores.behavior.value < 0.4) {
    out.push(
      "Add visible behavior — give each character a piece of stage business that contradicts (or undercuts) what they're saying."
    );
  }
  if (scores.tension.available && scores.tension.value < 0.4) {
    out.push(
      "Invoke the Relationship Tension agent. The scene needs a sentence that NEITHER character will say but BOTH are aware of."
    );
  }
  if (scores.powerShift.value < 0.4) {
    out.push(
      "Engineer a clear power shift. Who walks in with leverage? Who walks out with it? If it's the same, the scene isn't earning its place."
    );
  }
  return out;
}

function shortReason(
  causeEffect: Array<{ cause: string; effect: string; credible: boolean; note: string }>
): string {
  if (!causeEffect?.length) return "No cause/effect data.";
  const incredible = causeEffect.filter((c) => !c.credible).length;
  if (incredible === 0) return "All cause/effect beats credible.";
  return `${incredible} of ${causeEffect.length} cause/effect beat(s) failed credibility.`;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function avg(arr: number[]) {
  return arr.length ? arr.reduce((s, n) => s + n, 0) / arr.length : 0;
}
function truncate(s: string, n: number) {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}
