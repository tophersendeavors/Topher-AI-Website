import { supabase } from "../db/client.js";
import { runAgent } from "../agents/runner.js";
import { emotionalTruthAgent } from "../agents/emotionalTruth.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { validateSceneDirectness } from "../screenplay/emotionalValidator.js";
import { parseFountain } from "../screenplay/fountain.js";
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
}

export interface SceneScoreReport {
  sceneId: string | null;
  order: number;
  slugline: string;
  scores: Record<Dimension, DimensionScore>;
  overall: number;
  weak: boolean;
  rewriteInstructions: string[];
}

export interface ScriptScoreReport {
  scriptId: string;
  overall: number;
  weakSceneCount: number;
  scenes: SceneScoreReport[];
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

  // Character-name → id heuristic: scene.characters carries name strings.
  const projChars = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", args.projectId);
  const nameToId = new Map<string, string>(
    (projChars.data ?? []).map((c) => [c.name.toLowerCase(), c.id])
  );
  const sceneCharIds = scene.characters
    .map((n) => nameToId.get(n.toLowerCase()))
    .filter((x): x is string => !!x);

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
  // LLM key, network), the heuristics carry the report.
  let llmTruth: number | undefined;
  let llmReasons: Partial<Record<Dimension, string>> = {};
  let llmPowerShiftScore: number | undefined;

  if (useLLM) {
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
      }, ctx);
      llmTruth = run.output.truthScore;
      llmReasons = {
        truth: shortReason(run.output.causeEffect),
        subtext: run.output.state.subtext
          ? `subtext: "${truncate(run.output.state.subtext, 80)}"`
          : undefined,
        powerShift: run.output.state.powerShift
          ? `power: ${truncate(run.output.state.powerShift, 80)}`
          : undefined,
      };
      // Power shift score: if the agent named a concrete shift (not "TBD"
      // / "n/a"), treat it as a credible 0.8; else fall back to heuristic.
      const ps = (run.output.state.powerShift ?? "").toLowerCase();
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
      reason:
        llmReasons.truth ??
        (criticalCount > 0
          ? `${criticalCount} on-the-nose violation(s) drag credibility down.`
          : "Heuristic baseline (no directness flags)."),
    },
    subtext: {
      value: subtextScore,
      reason:
        llmReasons.subtext ??
        (criticalCount + warnCount === 0
          ? "No directness flags — dialogue is doing real work."
          : `${criticalCount} critical, ${warnCount} warn directness flag(s).`),
    },
    wound: {
      value: woundScore,
      reason:
        sceneCharIds.length === 0
          ? "No tagged characters in this scene."
          : woundScore === 1
            ? "All present characters have tracked wounds."
            : `${Math.round(woundScore * sceneCharIds.length)} of ${sceneCharIds.length} present characters have a tracked wound.`,
    },
    behavior: {
      value: behaviorScore,
      reason:
        action.length === 0
          ? "No action lines — the scene is dialogue-only."
          : `Action ratio ${action.length}/${totalLines}.`,
    },
    tension: {
      value: tensionScore,
      reason:
        sceneCharIds.length < 2
          ? "Solo scene — no inter-character tension to score."
          : tensionScore === 0
            ? "No tracked tension between the present characters."
            : `Avg tracked tension ${tensionScore.toFixed(2)}.`,
    },
    powerShift: {
      value: llmPowerShiftScore ?? heuristicPowerShift,
      reason:
        llmReasons.powerShift ??
        (hasLateAction
          ? "Late-scene action suggests an on-screen turn."
          : "No clear ending action — power shift unclear."),
    },
  };

  const overall = avg(Object.values(scores).map((s) => s.value));
  const weak = overall < 0.55 || criticalCount > 1;

  return {
    sceneId: args.sceneId,
    order: scene.order,
    slugline: scene.slugline,
    scores,
    overall,
    weak,
    rewriteInstructions: weak ? buildInstructions(scores, criticalCount) : [],
  };
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
}): Promise<ScriptScoreReport> {
  const parsed = parseFountain(args.fountain);

  // Map script_scenes ids by order for linking.
  const { data: sceneRows } = await supabase
    .from("script_scenes")
    .select("id, ord")
    .eq("script_id", args.scriptId);
  const orderToId = new Map<number, string>(
    (sceneRows ?? []).map((r) => [r.ord, r.id])
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
      })
    );
  }

  return {
    scriptId: args.scriptId,
    overall: scenes.length ? avg(scenes.map((s) => s.overall)) : 0,
    weakSceneCount: scenes.filter((s) => s.weak).length,
    scenes,
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
  if (scores.wound.value < 0.4) {
    out.push(
      "Open the Character Wound agent for each character in this scene. Without a tracked wound the scene's reactions can't be calibrated."
    );
  }
  if (scores.behavior.value < 0.4) {
    out.push(
      "Add visible behavior — give each character a piece of stage business that contradicts (or undercuts) what they're saying."
    );
  }
  if (scores.tension.value < 0.4) {
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
