// Generation Quality Gate — runs AFTER a clip is generated and reviewed.
// The writer (or the engine, when given hints) scores 10 categories 1..10.
// Out of those, the gate computes an outcome (Accept / Accept w notes /
// Regenerate / Regenerate w revised prompt / Use as pre-viz) plus concrete
// fix instructions the prompt-revisor can act on.

import type {
  MasterShotBrief,
  ModelProfile,
  QualityCategory,
  QualityGateResult,
  QualityOutcome,
} from "./types.js";

const CATEGORY_WEIGHT: Record<QualityCategory, number> = {
  behavioral_accuracy: 1.2,
  character_consistency: 1.4,
  atmospheric_fidelity: 1.0,
  emotional_subtext: 1.2,
  edit_readiness: 1.1,
  motion_stability: 1.2,
  face_hand_quality: 1.0,
  reference_continuity: 1.0,
  prompt_adherence: 1.1,
  safety_compliance: 1.5,
};

const ALL_CATEGORIES: QualityCategory[] = [
  "behavioral_accuracy",
  "character_consistency",
  "atmospheric_fidelity",
  "emotional_subtext",
  "edit_readiness",
  "motion_stability",
  "face_hand_quality",
  "reference_continuity",
  "prompt_adherence",
  "safety_compliance",
];

function weightedAverage(scores: Record<QualityCategory, number>): number {
  let num = 0;
  let den = 0;
  for (const c of ALL_CATEGORIES) {
    const w = CATEGORY_WEIGHT[c];
    num += (scores[c] ?? 5) * w;
    den += w;
  }
  return Math.round((num / den) * 10) / 10;
}

function outcomeFor(
  scores: Record<QualityCategory, number>,
  overall: number
): QualityOutcome {
  // Safety failure (≤3) is always a hard stop — pre-viz only.
  if ((scores.safety_compliance ?? 5) <= 3) return "use_as_previz";
  // Catastrophic character drift → regenerate with revised prompt.
  if ((scores.character_consistency ?? 5) <= 3) return "regenerate_revised";
  // Two or more critical scores ≤4 → regenerate revised.
  const critical = [
    scores.behavioral_accuracy,
    scores.motion_stability,
    scores.prompt_adherence,
    scores.face_hand_quality,
  ].filter((x) => (x ?? 5) <= 4).length;
  if (critical >= 2) return "regenerate_revised";
  if (overall >= 8.5) return "accept";
  if (overall >= 7.5) return "accept_with_notes";
  if (overall >= 6) return "regenerate";
  return "regenerate_revised";
}

/**
 * Suggest concrete fixes given which categories failed. These map directly
 * to the canned fixes the user asked for (one hand motion, lower motion,
 * static camera, switch to image-to-video, etc.) — the prompt-revisor
 * appends them as "writer steering" on the next regeneration.
 */
function fixesFor(
  scores: Record<QualityCategory, number>,
  brief: MasterShotBrief,
  profile?: ModelProfile
): string[] {
  const fixes: string[] = [];
  const failing = (key: QualityCategory, threshold = 6) => (scores[key] ?? 5) < threshold;

  if (failing("face_hand_quality")) {
    fixes.push("Simplify to ONE hand motion; keep fingers visible only briefly.");
    fixes.push("Focus on posture and hands instead of facial expression.");
  }
  if (failing("motion_stability")) {
    fixes.push("Lower motion intensity — name ONE continuous motion.");
    fixes.push("Use a static or locked-off camera; avoid orbit/whip-pan.");
    fixes.push(`Shorten the clip to ${Math.max(3, Math.min(4, brief.durationSec - 2))} seconds.`);
  }
  if (failing("character_consistency")) {
    fixes.push("Lock wardrobe + lighting + posture; quote cast bible descriptors verbatim.");
    if (profile?.supportedInputs.includes("image_to_video")) {
      fixes.push("Switch to image-to-video with a reference frame for this character.");
    }
  }
  if (failing("atmospheric_fidelity")) {
    fixes.push("Add organic texture / natural imperfection / cinematic grain.");
    fixes.push("Re-state environment cues (mist, paper, glass) in the prompt body.");
  }
  if (failing("emotional_subtext")) {
    fixes.push("Replace any stated emotion with one small physical act (a folded letter, a refusal).");
  }
  if (failing("prompt_adherence")) {
    fixes.push("Trim the prompt — keep one subject + one action + one camera move.");
  }
  if (failing("reference_continuity") && (brief.referenceAssets ?? []).length === 0) {
    fixes.push("Provide a reference frame and switch to image-to-video.");
  }
  if (failing("edit_readiness")) {
    fixes.push("Use a clean cut-in / cut-out — no morph at the head or tail.");
  }
  if ((scores.face_hand_quality ?? 5) <= 4 && (scores.character_consistency ?? 5) <= 5) {
    fixes.push("Use a keyframe first (Midjourney / image model), then animate.");
  }

  return Array.from(new Set(fixes)).slice(0, 6);
}

export interface GateInput {
  brief: MasterShotBrief;
  profile?: ModelProfile;
  scores: Partial<Record<QualityCategory, number>>;
  notes?: string;
}

/**
 * Run the quality gate against a generated clip's review scores. Missing
 * scores default to 5 (neutral) so partial reviews still produce an outcome.
 */
export function runQualityGate(input: GateInput): QualityGateResult {
  const scores = {} as Record<QualityCategory, number>;
  for (const c of ALL_CATEGORIES) {
    const raw = input.scores[c];
    scores[c] = typeof raw === "number" ? Math.max(1, Math.min(10, raw)) : 5;
  }
  const overall = weightedAverage(scores);
  const outcome = outcomeFor(scores, overall);
  const fixes =
    outcome === "accept" ? [] : fixesFor(scores, input.brief, input.profile);
  return {
    scores,
    overall,
    outcome,
    fixes,
    notes: input.notes,
    reviewedAt: new Date().toISOString(),
  };
}
