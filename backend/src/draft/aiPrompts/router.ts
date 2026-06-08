// Model router — visual-weight + reliability driven.
//
// Routing rule, in plain English:
//   For each axis in the brief's VisualWeight (environment, character,
//   atmosphere, motion, dialogue, …) take the model's RELIABILITY on that
//   axis (0..1, editable) and weight it by how much that axis matters in
//   the shot. Sum to a base score; apply tag-based + format-based bonuses;
//   subtract a penalty for any avoid-list overlap from the project's
//   production rules. Top model is the recommendation.
//
// Crucially: NO hardcoded "Kling does environments" assumptions. The
// recommendation is entirely driven by editable per-project profile +
// rules + weights. Update those — the router re-routes.

import type {
  MasterShotBrief,
  ModelKey,
  ModelProfile,
  RouterResult,
  RouterScore,
  ShotTag,
  VisualWeight,
} from "./types.js";
import { ALL_MODEL_KEYS } from "./modelProfiles.js";
import { scanForSafety } from "./safety.js";
import { recommendClipDuration } from "./clipDuration.js";
import { avoidOverlapPenalty, type ProductionRules } from "./productionRules.js";

const TAG_DEFAULT_WEIGHTS: Record<ShotTag, Partial<VisualWeight>> = {
  ENV: { environment: 40, atmosphere: 30, character: 10, cameraMovement: 15, dialogue: 0, action: 5, object: 0 },
  EXT: { environment: 40, atmosphere: 30, character: 10, cameraMovement: 15, dialogue: 0, action: 5, object: 0 },
  INT: { environment: 30, atmosphere: 20, character: 15, cameraMovement: 15, dialogue: 5, action: 5, object: 10 },
  BEH: { object: 35, character: 25, atmosphere: 10, cameraMovement: 10, action: 10, dialogue: 5, environment: 5 },
  CHAR: { character: 45, dialogue: 15, atmosphere: 10, cameraMovement: 10, action: 10, object: 5, environment: 5 },
  ACT: { action: 45, character: 20, cameraMovement: 15, atmosphere: 5, dialogue: 5, environment: 5, object: 5 },
  TRANS: { cameraMovement: 40, environment: 25, atmosphere: 20, character: 5, action: 5, dialogue: 0, object: 5 },
  PRE: { character: 20, cameraMovement: 20, action: 20, atmosphere: 10, environment: 15, dialogue: 5, object: 10 },
  VO: { character: 30, atmosphere: 25, dialogue: 20, cameraMovement: 10, environment: 10, action: 0, object: 5 },
  KEY: { character: 25, atmosphere: 25, environment: 25, cameraMovement: 0, dialogue: 0, action: 5, object: 20 },
};

/**
 * Infer a default visual weight from the brief — used when the writer
 * hasn't set one explicitly. Bias to the shot tags when present; otherwise
 * a balanced default that the writer can edit.
 */
export function inferVisualWeight(brief: MasterShotBrief): VisualWeight {
  if (brief.visualWeight) return normalizeWeights(brief.visualWeight);
  const tags = brief.shotTags ?? [];
  if (tags.length === 0) {
    return normalizeWeights({
      environment: 15,
      character: 30,
      object: 10,
      cameraMovement: 15,
      dialogue: 5,
      action: 15,
      atmosphere: 10,
    });
  }
  // Average tag templates.
  const acc: VisualWeight = {
    environment: 0,
    character: 0,
    object: 0,
    cameraMovement: 0,
    dialogue: 0,
    action: 0,
    atmosphere: 0,
  };
  for (const t of tags) {
    const w = TAG_DEFAULT_WEIGHTS[t] ?? {};
    for (const k of Object.keys(acc) as (keyof VisualWeight)[]) {
      acc[k] += (w[k] ?? 0) / tags.length;
    }
  }
  // Tiny bumps from explicit brief cues.
  if ((brief.dialogue ?? "").trim()) acc.dialogue = Math.max(acc.dialogue, 25);
  return normalizeWeights(acc);
}

function normalizeWeights(w: VisualWeight): VisualWeight {
  const total = (
    Object.values(w) as number[]
  ).reduce((a, b) => a + Math.max(0, b), 0);
  if (total <= 0) return w;
  const scale = 100 / total;
  const out: VisualWeight = {
    environment: Math.round(w.environment * scale),
    character: Math.round(w.character * scale),
    object: Math.round(w.object * scale),
    cameraMovement: Math.round(w.cameraMovement * scale),
    dialogue: Math.round(w.dialogue * scale),
    action: Math.round(w.action * scale),
    atmosphere: Math.round(w.atmosphere * scale),
  };
  return out;
}

/**
 * Project each visual-weight axis onto the model's reliability scores. The
 * `object`, `action`, and `cameraMovement` axes don't have their own
 * reliability key — they're proxied off `motion`/`hands`.
 */
function reliabilityForAxis(profile: ModelProfile, axis: keyof VisualWeight): number {
  const r = profile.reliability;
  switch (axis) {
    case "environment":
      return r.atmosphere;
    case "character":
      return r.character;
    case "object":
      return r.hands;
    case "cameraMovement":
      return r.motion;
    case "dialogue":
      return r.dialogue;
    case "action":
      return r.motion;
    case "atmosphere":
      return r.atmosphere;
  }
}

/** Format-fit bonuses / penalties (still / video / aspect / duration). */
function formatBonus(
  profile: ModelProfile,
  brief: MasterShotBrief,
  reasons: string[],
  risks: string[]
): number {
  let delta = 0;
  const wantsStill = brief.outputType === "still" || (brief.shotTags ?? []).includes("KEY");
  const isImageOnly = profile.modelType === "image";
  if (wantsStill) {
    if (isImageOnly) {
      delta += 20;
      reasons.push("Still / keyframe — image model fit.");
    } else {
      delta -= 8;
      risks.push("Asked for a still but this is a video model.");
    }
  } else {
    if (isImageOnly) {
      delta -= 25;
      risks.push("Shot needs motion; this model produces stills only.");
    }
  }
  if (!profile.supportedAspectRatios.includes(brief.aspectRatio)) {
    delta -= 6;
    risks.push(`${brief.aspectRatio} not in supported aspect ratios.`);
  }
  if (profile.supportedDurationRange) {
    const { minSec, maxSec } = profile.supportedDurationRange;
    if (brief.durationSec < minSec || brief.durationSec > maxSec) {
      delta -= 5;
      risks.push(`${brief.durationSec}s outside ${minSec}–${maxSec}s.`);
    }
  }
  return delta;
}

/** Score one model. Returns 0..100 + the reasons/risks the writer should see. */
function scoreModel(
  profile: ModelProfile,
  brief: MasterShotBrief,
  weights: VisualWeight,
  rules: ProductionRules
): RouterScore {
  const reasons: string[] = [];
  const risks: string[] = [];
  let base = 0;
  // Weighted reliability — this is the heart of the router.
  for (const axis of Object.keys(weights) as (keyof VisualWeight)[]) {
    const w = weights[axis];
    if (w <= 0) continue;
    const r = reliabilityForAxis(profile, axis);
    base += r * w;
  }
  // Top contributing axis becomes the headline reason.
  const top = (Object.keys(weights) as (keyof VisualWeight)[])
    .map((a) => ({ axis: a, contribution: reliabilityForAxis(profile, a) * weights[a] }))
    .sort((a, b) => b.contribution - a.contribution);
  if (top[0]?.contribution > 0) {
    const label =
      top[0].axis === "cameraMovement"
        ? "camera movement"
        : top[0].axis === "object"
        ? "object / hand work"
        : top[0].axis;
    reasons.push(
      `${profile.modelName} reads strong on ${label} for this shot's weight.`
    );
  }

  // Format-fit bonuses (still vs video, aspect, duration).
  base += formatBonus(profile, brief, reasons, risks);

  // Avoid-list penalty: this is where the project's production rules
  // steer the router AWAY from models whose strengths conflict with the
  // showrunner's avoid list.
  const penalty = avoidOverlapPenalty(profile.strengths, rules.avoid);
  if (penalty.score > 0) {
    base -= penalty.score * 15;
    risks.push(`Conflicts with project avoid-list (${penalty.matched.slice(0, 2).join("; ")}).`);
  }

  // Custom model never auto-wins.
  if (profile.key === "custom") {
    base -= 30;
    risks.push("Custom adapter needs user-defined template before use.");
  }

  return {
    model: profile.key,
    score: Math.max(0, Math.min(100, Math.round(base))),
    reasons: reasons.slice(0, 3),
    risks: risks.slice(0, 3),
  };
}

/**
 * Public router entry. Reads the brief's visual weight (inferring from
 * tags when missing) and the project's production rules. Returns the
 * recommendation + confidence + alternatives + safety scan + duration
 * guidance.
 */
export function routeModel(
  brief: MasterShotBrief,
  profiles: Record<ModelKey, ModelProfile>,
  rules: ProductionRules = { prefer: [], avoid: [] }
): RouterResult {
  const weights = inferVisualWeight(brief);
  const board: RouterScore[] = ALL_MODEL_KEYS.map((k) =>
    scoreModel(profiles[k], brief, weights, rules)
  );
  board.sort((a, b) => b.score - a.score);
  const top = board[0];
  const secondary = board[1];
  const confidence = Math.max(
    0,
    Math.min(1, (top.score - secondary.score) / 30 + 0.4)
  );

  const safetyText = [
    brief.action,
    brief.performanceDirection ?? "",
    brief.dialogue ?? "",
    brief.continuityNotes ?? "",
    brief.shotPurpose,
    brief.storyBeat,
    brief.emotionalBeat,
    brief.safetyNotes ?? "",
  ].join(" ");
  const safety = scanForSafety(safetyText);

  const dur = recommendClipDuration(brief, profiles[top.model]);

  return {
    recommended: top.model,
    confidence,
    reason:
      top.reasons[0] ?? `Best overall match (score ${top.score}/100).`,
    alternatives: board.slice(1, 4),
    safety: safety.flagged
      ? {
          flagged: true,
          categories: safety.categories,
          suggestedAlternatives: safety.suggestedAlternatives,
        }
      : undefined,
    durationGuidance: dur,
  };
}
