// Default model profiles. These ship as code so the system has sensible
// defaults out of the box, but every project can override any field via
// project.metadata.modelProfileOverrides[modelKey]. Capabilities change
// frequently — the override path lets the user keep guidance current
// without a redeploy.

import type { ModelKey, ModelProfile, ReliabilityScores } from "./types.js";

// Reliability scores 0..1 — the values the router actually uses. Edit per
// project to keep current as models evolve. These are intentionally
// conservative defaults; the writer is expected to revise after a few real
// generations and the system will re-route accordingly.
const SCORES = {
  veo: { motion: 0.78, character: 0.7, hands: 0.55, dialogue: 0.78, atmosphere: 0.68 },
  kling: { motion: 0.82, character: 0.55, hands: 0.45, dialogue: 0.1, atmosphere: 0.78 },
  runway: { motion: 0.7, character: 0.62, hands: 0.5, dialogue: 0.05, atmosphere: 0.66 },
  pika: { motion: 0.66, character: 0.45, hands: 0.4, dialogue: 0.05, atmosphere: 0.58 },
  luma: { motion: 0.82, character: 0.5, hands: 0.45, dialogue: 0.05, atmosphere: 0.84 },
  midjourney: { motion: 0.0, character: 0.65, hands: 0.55, dialogue: 0.0, atmosphere: 0.86 },
  generic_video: { motion: 0.6, character: 0.55, hands: 0.45, dialogue: 0.3, atmosphere: 0.6 },
  generic_image: { motion: 0.0, character: 0.55, hands: 0.5, dialogue: 0.0, atmosphere: 0.65 },
  custom: { motion: 0.6, character: 0.6, hands: 0.5, dialogue: 0.4, atmosphere: 0.6 },
} as const satisfies Record<ModelKey, ReliabilityScores>;

const VEO: ModelProfile = {
  key: "veo",
  modelName: "Google Flow / Veo",
  version: "Veo 3",
  lastUpdated: undefined,
  modelType: "hybrid",
  strengths: [
    "Cinematic camera blocking",
    "Restrained character performance",
    "Native dialogue + audio (Veo 3)",
    "Coherent ~8s narrative shots",
  ],
  weaknesses: [
    "No memory across clips — descriptors must be re-stated each shot",
    "Long dialogue rarely fits a single take",
  ],
  bestUseCases: [
    "Performance-driven scenes",
    "Cinematic blocking with a clear shot turn",
    "Lines under ~12 spoken words",
  ],
  avoidUseCases: [
    "High-action choreography requiring continuous motion across many clips",
    "Frames that need to match an existing reference exactly",
  ],
  maxPromptStyle: "verbose-cinematic",
  preferredPromptStructure:
    "[shot size] of [character with re-stated descriptor] [doing one action] in [setting], [lighting], [camera move], [lens], [mood], 16:9",
  supportedInputs: ["text_to_video", "image_to_video"],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedDurationRange: { minSec: 4, maxSec: 8 },
  motionControlNotes:
    "Camera moves work best when stated cinematically (slow dolly in, handheld, locked-off). Avoid teleportation language.",
  characterConsistencyNotes:
    "Re-state physical descriptors + wardrobe in every clip. The cast bible should be quoted verbatim.",
  dialogueOrLipSyncNotes:
    "Native dialogue supported. Keep lines short (≤12 words). Place dialogue in-shot when it fits the take.",
  safetyLimitations:
    "Google's content policy is strict — no minors in intimate / dangerous contexts; sexual content blocked; graphic violence blocked.",
  negativePromptSupport: false,
  seedOrReferenceSupport: true,
  outputNotes: "16:9 MP4 ~8s with optional native audio. Generation is queue-based.",
  reliability: SCORES.veo,
};

const KLING: ModelProfile = {
  key: "kling",
  modelName: "Kling",
  modelType: "hybrid",
  strengths: [
    "Dynamic cinematic motion",
    "Stylized realism",
    "Strong physical action + atmospheric shots",
    "Image-to-video where the source is provided",
  ],
  weaknesses: [
    "Subtle performance can read overly heightened",
    "Face consistency across clips is unreliable",
  ],
  bestUseCases: [
    "Action beats",
    "Atmospheric reveals (rain, mist, smoke)",
    "Image-to-video animation of a reference frame",
  ],
  avoidUseCases: [
    "Long dialogue scenes",
    "Restraint-first prestige drama beats",
  ],
  maxPromptStyle: "concise-action",
  preferredPromptStructure:
    "Subject: <character + look>. Action: <one strong verb>. Camera: <move>. Setting: <where>. Lighting/atmosphere: <mood>. Negative: <what to exclude>.",
  supportedInputs: ["text_to_video", "image_to_video"],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedDurationRange: { minSec: 5, maxSec: 10 },
  motionControlNotes:
    "Best when a single strong motion is named — 'turns slowly', 'breaks into a run', 'collapses to her knees'.",
  characterConsistencyNotes:
    "Image-to-video with a reference frame keeps wardrobe/look stable; text-only drifts.",
  dialogueOrLipSyncNotes:
    "No native dialogue. Keep speech off-camera (V.O.) or imply.",
  safetyLimitations:
    "Public policy refuses sexual content + violence against minors; other graphic content varies. Implications and aftermath generally pass.",
  negativePromptSupport: true,
  seedOrReferenceSupport: true,
  outputNotes: "Best in 16:9 or 9:16 vertical. 5–10s clips.",
  reliability: SCORES.kling,
};

const RUNWAY: ModelProfile = {
  key: "runway",
  modelName: "Runway (Gen-3 Alpha)",
  modelType: "hybrid",
  strengths: [
    "Controlled cinematic shots",
    "Image-to-video with reference image",
    "Stylized commercials / fashion / music-video aesthetics",
    "Strong visual transitions",
  ],
  weaknesses: [
    "Dialogue not supported",
    "Loses character likeness across long sequences",
  ],
  bestUseCases: [
    "Image-to-video where a key frame already exists",
    "Stylized poetic / surreal beats",
    "Tight 4–10s storytelling shots",
  ],
  avoidUseCases: [
    "Heavy dialogue beats",
    "Story-context-heavy prompts (Runway prefers tight visual prompts)",
  ],
  maxPromptStyle: "image-led",
  preferredPromptStructure:
    "Composition: <framing>. Subject: <character + texture>. Motion: <one clear motion>. Light: <quality>. Mood: <feel>. Camera: <move>.",
  supportedInputs: ["text_to_video", "image_to_video"],
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:5"],
  supportedDurationRange: { minSec: 4, maxSec: 10 },
  motionControlNotes:
    "Motion brush + camera control supported when using the editor. Text prompts: name ONE motion.",
  characterConsistencyNotes:
    "Use a reference image; the text-only mode produces a fresh face every clip.",
  dialogueOrLipSyncNotes: "No native dialogue.",
  safetyLimitations:
    "Runway content policy: no sexual content; graphic violence limited; real-person likeness restrictions.",
  negativePromptSupport: false,
  seedOrReferenceSupport: true,
  outputNotes: "Up to 10s clips. 16:9 / 9:16 most common.",
  reliability: SCORES.runway,
};

const PIKA: ModelProfile = {
  key: "pika",
  modelName: "Pika",
  modelType: "hybrid",
  strengths: [
    "Fast generations",
    "Stylized, social-friendly beats",
    "Transformations + surreal effects",
  ],
  weaknesses: [
    "Less control over precise camera moves",
    "Short clip length",
    "Not ideal for restraint",
  ],
  bestUseCases: [
    "Short visual transitions",
    "Stylized concept beats",
    "Surreal transformations (object morph, dream)",
  ],
  avoidUseCases: [
    "Long performance shots",
    "Realistic prestige drama",
  ],
  maxPromptStyle: "concise-action",
  preferredPromptStructure:
    "<subject> <action>, <style>, <mood>",
  supportedInputs: ["text_to_video", "image_to_video"],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedDurationRange: { minSec: 3, maxSec: 5 },
  motionControlNotes: "Keep motion description short. Strong style cue beats long instruction.",
  characterConsistencyNotes: "Not Pika's strong suit — use image-to-video when a frame matters.",
  dialogueOrLipSyncNotes: "No native dialogue.",
  safetyLimitations: "Standard content policy restricts sexual / graphic violence content.",
  negativePromptSupport: true,
  seedOrReferenceSupport: true,
  outputNotes: "3–5s clips. Best for social-format vertical.",
  reliability: SCORES.pika,
};

const LUMA: ModelProfile = {
  key: "luma",
  modelName: "Luma Dream Machine",
  modelType: "hybrid",
  strengths: [
    "Realistic camera movement",
    "Environment-heavy + atmospheric shots",
    "Smooth dolly / crane / orbit moves",
    "Image-to-video",
  ],
  weaknesses: [
    "Character performance is generic",
    "No native dialogue",
  ],
  bestUseCases: [
    "Establishing shots",
    "Architectural / environment fly-throughs",
    "Image-to-video of a still frame",
  ],
  avoidUseCases: [
    "Dialogue scenes",
    "Subtle facial performance",
  ],
  maxPromptStyle: "image-led",
  preferredPromptStructure:
    "Camera: <path>. Subject: <what>. Environment: <where + depth>. Lighting: <quality>. Atmosphere: <feel>.",
  supportedInputs: ["text_to_video", "image_to_video"],
  supportedAspectRatios: ["16:9", "9:16"],
  supportedDurationRange: { minSec: 5, maxSec: 5 },
  motionControlNotes:
    "Best at camera-motion-led shots: 'slow dolly through', 'orbit around', 'pull back to reveal'.",
  characterConsistencyNotes: "Use an input image to keep the look stable.",
  dialogueOrLipSyncNotes: "No native dialogue.",
  safetyLimitations: "Standard content policy — no graphic / sexual content.",
  negativePromptSupport: false,
  seedOrReferenceSupport: true,
  outputNotes: "5s clips. 16:9 standard; 9:16 vertical supported.",
  reliability: SCORES.luma,
};

const MIDJOURNEY: ModelProfile = {
  key: "midjourney",
  modelName: "Midjourney",
  modelType: "image",
  strengths: [
    "Concept art + key art",
    "Production design + mood boards",
    "Poster frames + character reference art",
  ],
  weaknesses: [
    "Stills only — no motion",
    "Hands + small text imperfect",
  ],
  bestUseCases: [
    "Character / wardrobe / set reference",
    "Poster frames",
    "Color script frames",
  ],
  avoidUseCases: ["Video shots", "Sequential continuity by text alone"],
  maxPromptStyle: "key-art",
  preferredPromptStructure:
    "<subject>, <composition>, <style>, <lighting>, <lens>, <production design>, <color palette>, <mood> --ar <ratio> --stylize <0-1000>",
  supportedInputs: ["text_to_image"],
  supportedAspectRatios: ["16:9", "21:9", "9:16", "1:1", "4:5", "2:3"],
  supportedDurationRange: null,
  motionControlNotes:
    "No motion. Avoid camera-move language unless you want it interpreted as composition.",
  characterConsistencyNotes:
    "Use --cref + --sref or the Character Reference workflow. Text alone drifts.",
  dialogueOrLipSyncNotes: "N/A — still images.",
  safetyLimitations: "Strict on real-person likeness, gore, sexual content.",
  negativePromptSupport: false,
  seedOrReferenceSupport: true,
  outputNotes: "Use --ar for aspect ratio. --stylize 100–400 reads cinematic.",
  reliability: SCORES.midjourney,
};

const GENERIC_VIDEO: ModelProfile = {
  key: "generic_video",
  modelName: "Generic Video Model",
  modelType: "video",
  strengths: ["Universal fallback"],
  weaknesses: ["No model-specific tuning"],
  bestUseCases: ["When the target model isn't in the list"],
  avoidUseCases: [],
  maxPromptStyle: "verbose-cinematic",
  preferredPromptStructure:
    "<shot size> of <subject + descriptor> <action> in <setting>, <lighting>, <camera move>, <mood>, <aspect ratio>, <duration>",
  supportedInputs: ["text_to_video", "image_to_video"],
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:5"],
  supportedDurationRange: { minSec: 3, maxSec: 10 },
  motionControlNotes: "Name one continuous motion.",
  characterConsistencyNotes: "Re-state descriptors per shot.",
  dialogueOrLipSyncNotes: "If the target model supports it, include in-shot.",
  safetyLimitations: "Defer to the host platform's policy.",
  negativePromptSupport: true,
  seedOrReferenceSupport: true,
  outputNotes: "Clean cinematic prompt usable with most platforms.",
  reliability: SCORES.generic_video,
};

const GENERIC_IMAGE: ModelProfile = {
  key: "generic_image",
  modelName: "Generic Image Model",
  modelType: "image",
  strengths: ["Universal fallback for stills"],
  weaknesses: ["No model-specific tuning"],
  bestUseCases: ["Concept frames", "Key art when target image model isn't listed"],
  avoidUseCases: [],
  maxPromptStyle: "key-art",
  preferredPromptStructure:
    "<subject>, <composition>, <style>, <lighting>, <production design>, <color palette>, <mood>, <aspect ratio>",
  supportedInputs: ["text_to_image"],
  supportedAspectRatios: ["16:9", "9:16", "1:1", "4:5"],
  supportedDurationRange: null,
  motionControlNotes: "No motion.",
  characterConsistencyNotes: "Refer to a known character bible entry.",
  dialogueOrLipSyncNotes: "N/A.",
  safetyLimitations: "Defer to the host platform's policy.",
  negativePromptSupport: true,
  seedOrReferenceSupport: true,
  outputNotes: "Clean still prompt usable with most image models.",
  reliability: SCORES.generic_image,
};

const CUSTOM: ModelProfile = {
  key: "custom",
  modelName: "Custom Model",
  modelType: "hybrid",
  strengths: [],
  weaknesses: [],
  bestUseCases: ["When the writer wants prompts in a custom format"],
  avoidUseCases: [],
  maxPromptStyle: "verbose-cinematic",
  preferredPromptStructure:
    "Define your own template in the project's modelProfileOverrides for `custom`.",
  supportedInputs: ["text_to_video", "image_to_video", "text_to_image"],
  supportedAspectRatios: ["16:9", "9:16", "1:1"],
  supportedDurationRange: null,
  motionControlNotes: "Use any structure that suits your custom pipeline.",
  characterConsistencyNotes: "User-defined.",
  dialogueOrLipSyncNotes: "User-defined.",
  safetyLimitations: "User-defined.",
  negativePromptSupport: true,
  seedOrReferenceSupport: true,
  outputNotes: "Override the template under project.metadata.modelProfileOverrides.custom.",
  reliability: SCORES.custom,
};

export const DEFAULT_MODEL_PROFILES: Record<ModelKey, ModelProfile> = {
  veo: VEO,
  kling: KLING,
  runway: RUNWAY,
  pika: PIKA,
  luma: LUMA,
  midjourney: MIDJOURNEY,
  generic_video: GENERIC_VIDEO,
  generic_image: GENERIC_IMAGE,
  custom: CUSTOM,
};

export const ALL_MODEL_KEYS: ModelKey[] = [
  "veo",
  "kling",
  "runway",
  "pika",
  "luma",
  "midjourney",
  "generic_video",
  "generic_image",
  "custom",
];

/**
 * Merge per-project overrides on top of the defaults. Any field omitted in
 * the override falls back to the default — so the writer can change just
 * "strengths" without re-typing the whole profile.
 */
export function effectiveProfiles(
  overrides?: Partial<Record<ModelKey, Partial<ModelProfile>>>
): Record<ModelKey, ModelProfile> {
  const out = {} as Record<ModelKey, ModelProfile>;
  for (const key of ALL_MODEL_KEYS) {
    const base = DEFAULT_MODEL_PROFILES[key];
    const ov = overrides?.[key] ?? null;
    if (!ov) {
      out[key] = base;
      continue;
    }
    out[key] = {
      ...base,
      ...ov,
      key, // never let override change the key
      // Deep-ish merge for the array/object fields so partial overrides work.
      strengths: ov.strengths ?? base.strengths,
      weaknesses: ov.weaknesses ?? base.weaknesses,
      bestUseCases: ov.bestUseCases ?? base.bestUseCases,
      avoidUseCases: ov.avoidUseCases ?? base.avoidUseCases,
      supportedInputs: ov.supportedInputs ?? base.supportedInputs,
      supportedAspectRatios: ov.supportedAspectRatios ?? base.supportedAspectRatios,
      supportedDurationRange:
        ov.supportedDurationRange === undefined ? base.supportedDurationRange : ov.supportedDurationRange,
      reliability: ov.reliability ? { ...base.reliability, ...ov.reliability } : base.reliability,
      userNotes: ov.userNotes ?? base.userNotes,
      version: ov.version ?? base.version,
      lastUpdated: ov.lastUpdated ?? base.lastUpdated,
      userOverride: true,
    };
  }
  return out;
}
