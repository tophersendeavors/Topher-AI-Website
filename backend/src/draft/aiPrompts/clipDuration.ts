// Tag-aware clip-length rules.
//
// Default: 3–6s. Longer durations are gated by risk factors — the writer
// must consciously approve longer takes via brief.longerDurationApproved
// before adapters will use them.
//
// SELVAJE defaults per tag:
//   BEH 3–5  | ENV 4–8  | CHAR 3–6  | TRANS 5–7  | PRE 3–4
//
// The router/adapters consult this so durations stay honest to the
// model's reliability AND the production category.

import type { MasterShotBrief, ModelProfile, ShotTag } from "./types.js";

interface DurationBand {
  min: number;
  max: number;
  reason: string;
}

const TAG_DEFAULTS: Record<ShotTag, DurationBand> = {
  BEH: { min: 3, max: 5, reason: "Behavioural inserts read best as compact takes (3–5s)." },
  ENV: { min: 4, max: 8, reason: "Environment plates can breathe a touch longer (4–8s)." },
  CHAR: { min: 3, max: 6, reason: "Character beats: 3–6s keeps performance honest." },
  TRANS: { min: 5, max: 7, reason: "Spatial transitions need room to land (5–7s)." },
  PRE: { min: 3, max: 4, reason: "Pre-viz: short tests only (3–4s)." },
  VO: { min: 4, max: 8, reason: "VO-led beats lean longer with restrained motion." },
  KEY: { min: 0, max: 0, reason: "Keyframe / still — no clip duration." },
  ACT: { min: 3, max: 5, reason: "Action: 3–5s; avoid long continuous motion." },
  INT: { min: 4, max: 6, reason: "Interior design beats: 4–6s." },
  EXT: { min: 4, max: 8, reason: "Exterior establishing: 4–8s." },
};

const RISK_FACTORS = (
  brief: MasterShotBrief
): { risky: boolean; reasons: string[] } => {
  const reasons: string[] = [];
  const hasDialogue = (brief.dialogue ?? "").trim().length > 0;
  if (hasDialogue) reasons.push("dialogue present");
  const action = (brief.action ?? "").toLowerCase();
  const performance = (brief.performanceDirection ?? "").toLowerCase();
  if (/\b(hand|finger|grasp|grip|holding|writes?|signs?|adjusts?)\b/i.test(action + performance)) {
    reasons.push("complex hand work");
  }
  if (brief.characters.length >= 3) reasons.push("3+ characters");
  if (/\b(running|fight|chase|leap|strike|fall|tackle|collapse|crash|explod)/i.test(action)) {
    reasons.push("high-motion action");
  }
  if ((brief.cameraMovement ?? "").toLowerCase().match(/orbit|crane|tracking through|whip pan/)) {
    reasons.push("complex camera move");
  }
  return { risky: reasons.length > 0, reasons };
};

/**
 * Choose the recommended clip-duration band for a brief, by tag set + risk.
 * When tags are absent, infers from outputType + visualWeight. The hard cap
 * is the model's own supportedDurationRange — longer-than-model is never
 * recommended even if the writer approves.
 */
export function recommendClipDuration(
  brief: MasterShotBrief,
  profile?: ModelProfile
): {
  recommendedMinSec: number;
  recommendedMaxSec: number;
  reason: string;
  requiresExplicitApproval: boolean;
} {
  // Stills bypass duration entirely.
  if (brief.outputType === "still") {
    return {
      recommendedMinSec: 0,
      recommendedMaxSec: 0,
      reason: "Still / keyframe — no clip duration applies.",
      requiresExplicitApproval: false,
    };
  }

  // Combine tag-default bands. When multiple tags apply, take the union but
  // bias toward the tightest min (safer) and the SMALLEST max (more honest).
  const tags = (brief.shotTags ?? []).filter((t) => t !== "KEY");
  let band: DurationBand | null = null;
  for (const t of tags) {
    const b = TAG_DEFAULTS[t];
    if (!b || b.max === 0) continue;
    band = band
      ? {
          min: Math.max(band.min, b.min),
          max: Math.min(band.max, b.max),
          reason: `${band.reason} ${b.reason}`,
        }
      : b;
  }
  if (!band || band.max < band.min) {
    band = { min: 3, max: 6, reason: "Default 3–6s — no tag-specific guidance." };
  }

  const risk = RISK_FACTORS(brief);
  let requiresApproval = false;

  // Risk shrinks the upper bound; risky takes are clipped to 5s without
  // explicit writer approval.
  if (risk.risky) {
    const capped = Math.min(band.max, 5);
    if (capped < band.max) {
      band = {
        min: band.min,
        max: capped,
        reason: `${band.reason} Risk factors (${risk.reasons.join(", ")}) clip the upper bound — approve longer durations explicitly.`,
      };
      requiresApproval = true;
    }
  }

  // Honour the model's own supported range when known.
  if (profile?.supportedDurationRange) {
    const { minSec, maxSec } = profile.supportedDurationRange;
    band = {
      min: Math.max(band.min, minSec),
      max: Math.min(band.max, maxSec),
      reason: `${band.reason} Clamped to ${profile.modelName}'s ${minSec}–${maxSec}s range.`,
    };
  }

  // If brief requested longer than band.max and writer hasn't approved, the
  // adapter will clamp; we still report the recommended band as the truth.
  return {
    recommendedMinSec: band.min,
    recommendedMaxSec: band.max,
    reason: band.reason,
    requiresExplicitApproval: requiresApproval,
  };
}

/**
 * Clamp a brief's requested duration into the recommended band. When the
 * writer has set longerDurationApproved=true, we honour their longer
 * request up to the model's hard cap.
 */
export function chooseDurationSec(
  brief: MasterShotBrief,
  profile?: ModelProfile
): number {
  if (brief.outputType === "still") return 0;
  const rec = recommendClipDuration(brief, profile);
  const requested = brief.durationSec || 5;
  if (rec.requiresExplicitApproval && !brief.longerDurationApproved) {
    return Math.min(requested, rec.recommendedMaxSec);
  }
  const cap = profile?.supportedDurationRange?.maxSec ?? rec.recommendedMaxSec;
  return Math.max(rec.recommendedMinSec, Math.min(requested, cap));
}
