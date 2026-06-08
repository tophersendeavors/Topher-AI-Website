// Per-model prompt adapters. Each adapter transforms the Master Shot Brief
// (universal source of truth) into a prompt formatted for ONE target model.
//
// Hard rule: an adapter NEVER mutates the brief. The brief is passed in
// frozen-by-convention; everything the adapter produces is returned as a
// new PromptVersion.
//
// Prior feedback on this (model, project) is consumed when present so the
// adapter can lean stronger camera direction, stronger character cues, etc.

import { scanForSafety } from "./safety.js";
import { chooseDurationSec } from "./clipDuration.js";
import { composePrompt, type CastLibrary } from "./composer.js";
import type { ProductionRules } from "./productionRules.js";
import type {
  FeedbackTag,
  MasterShotBrief,
  ModelKey,
  ModelProfile,
  PromptType,
  PromptVersion,
} from "./types.js";

export interface AdapterInput {
  brief: MasterShotBrief;
  model: ModelKey;
  profile: ModelProfile;
  /** Tags aggregated across prior versions for THIS model on THIS project. */
  priorFeedback?: FeedbackTag[];
  /** Optional user steering for THIS regeneration. */
  notes?: string;
  /** Version number to assign (caller decides). */
  versionNumber: number;
  /** Project's production rules (prefer / avoid) — injected into the prompt. */
  productionRules?: ProductionRules;
  /** Visual Bible cast library — locked consistencyPrompt + reference image
   *  URL per principal. The composer prefers this over the brief's
   *  filmable-descriptor extraction when a character is in the bible. */
  castLibrary?: CastLibrary;
  /** V3.4 — Pre-rendered Continuity Department directive (Location + Prop
   *  bibles), passed through to the composer. */
  continuityDirective?: string;
  /** V4.7 — per-visible-element distinctive-token requirements. The
   *  readiness gate uses these to verify each visible element actually
   *  surfaces in the model output (no element silently elided). */
  visibleCanonRequirements?: Array<{ label: string; tokens: string[] }>;
  /** Stage 4 — approved canon references for THIS shot. Image URLs /
   *  external links / color swatches that humans have approved as
   *  canon for fields visible in this shot. The composer attaches them
   *  to PromptVersion.referenceMetadata.canonReferences so the writer
   *  can copy them into the model platform's reference slot. */
  canonReferences?: Array<{
    fieldPath: string;
    contributionId: string;
    kind: string;
    title: string;
    url: string | null;
    storage_path: string | null;
    color_hex?: string | null;
    approvedBy?: string;
    approvedAt?: string;
  }>;
}

const FEEDBACK_PROMPT_HINTS: Record<FeedbackTag, string> = {
  worked: "",
  needs_camera: "Be precise about camera move — name the lens, the speed, and where the move ends.",
  character_inconsistent:
    "Re-state every character's wardrobe, age, and one distinctive feature verbatim from the cast bible.",
  bad_motion: "Describe ONE continuous motion only; avoid teleportation language.",
  bad_face: "If the model supports image-to-video, prefer using a reference frame for the face.",
  wrong_mood: "Lead with the mood word first; the shot answers to it, not the other way around.",
  too_stylized: "Push toward realism — strip stylization adjectives; describe what a camera would see.",
  too_generic: "Add one concrete sensory detail per beat (a sound, an object, a texture).",
  safety_blocked:
    "Stage the shot via implication only — aftermath, reaction, environment — never the act itself.",
  use_as_reference: "",
};

function inferPromptType(profile: ModelProfile, brief: MasterShotBrief): PromptType {
  if (profile.modelType === "image") return "text_to_image";
  if ((brief.referenceAssets ?? []).length > 0 && profile.supportedInputs.includes("image_to_video")) {
    return "image_to_video";
  }
  if (profile.supportedInputs.includes("text_to_video")) return "text_to_video";
  if (profile.supportedInputs.includes("text_to_image")) return "text_to_image";
  return profile.supportedInputs[0] ?? "text_to_video";
}

function castBlock(brief: MasterShotBrief, restate = true): string {
  return brief.characters
    .map((c) => {
      const parts = [c.name.toUpperCase()];
      if (restate) {
        if (c.description) parts.push(`— ${c.description}`);
        if (c.wardrobe) parts.push(`(${c.wardrobe})`);
      }
      return parts.join(" ");
    })
    .join("; ");
}

function applyFeedbackHints(notes: string[], feedback?: FeedbackTag[]) {
  if (!feedback?.length) return;
  for (const t of feedback) {
    const hint = FEEDBACK_PROMPT_HINTS[t];
    if (hint) notes.push(`feedback (${t}): ${hint}`);
  }
}

function safetyForPrompt(brief: MasterShotBrief): {
  warnings: string[];
  notes: string[];
} {
  const text = [
    brief.action,
    brief.performanceDirection ?? "",
    brief.dialogue ?? "",
    brief.safetyNotes ?? "",
  ].join(" ");
  const scan = scanForSafety(text);
  if (!scan.flagged) return { warnings: [], notes: [] };
  return {
    warnings: scan.categories.map((c) => `Safety: ${c} — stage via implication, not depiction.`),
    notes: scan.suggestedAlternatives.map((s) => `compliant alt: ${s}`),
  };
}

function baseLabel(brief: MasterShotBrief, model: ModelKey, version: number): string {
  // SELVAJE_EP1_SC03_SH04_FlowPrompt_v1
  const series = (brief.projectTitle || "Untitled")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const ep = brief.episodeNumber ? `EP${brief.episodeNumber}_` : "";
  const sc = `SC${String(brief.sceneOrd).padStart(2, "0")}_`;
  const sh = `SH${String(brief.shotIndex).padStart(2, "0")}_`;
  const modelTag =
    model === "veo"
      ? "FlowPrompt"
      : model === "midjourney"
      ? "MidjourneyKeyframe"
      : `${model.charAt(0).toUpperCase()}${model.slice(1)}Prompt`;
  return `${series}_${ep}${sc}${sh}${modelTag}_v${version}`;
}

// ---------- Per-model prompt body builders ----------

type Ingredients = Record<string, string>;

function veoIngredients(b: MasterShotBrief): Ingredients {
  return {
    Composition: `${b.cameraFraming.toUpperCase()} of ${castBlock(b)}`,
    Action: b.action.trim(),
    Setting: `${b.location}, ${b.timeOfDay}. ${b.productionDesign ?? ""}`.trim(),
    Lighting: `${b.lighting}. Color: ${b.colorPalette}.`,
    Camera: `${b.cameraMovement}. Lens: ${b.lensSuggestion}.`,
    Performance: b.performanceDirection ?? "",
    Continuity: b.continuityNotes ?? "",
    Output: `${b.aspectRatio}, ~${b.durationSec}s, ${b.outputType === "still" ? "key frame" : "cinematic motion"}`,
    Dialogue: b.dialogue?.trim() ? `"${b.dialogue.trim()}"` : "",
  };
}

function klingIngredients(b: MasterShotBrief): Ingredients {
  return {
    Subject: castBlock(b),
    Action: b.action.trim(),
    Camera: b.cameraMovement,
    Setting: `${b.location}, ${b.timeOfDay}`,
    Atmosphere: `${b.lighting}. ${b.visualMotif ?? ""}`.trim(),
    Performance: b.performanceDirection ?? "",
    Output: `${b.aspectRatio}, ~${b.durationSec}s`,
  };
}

function runwayIngredients(b: MasterShotBrief): Ingredients {
  return {
    Composition: `${b.cameraFraming}, ${b.lensSuggestion}`,
    Subject: castBlock(b),
    Motion: b.action.trim(),
    Light: b.lighting,
    Mood: b.emotionalBeat,
    Camera: b.cameraMovement,
    Reference: b.referenceAssets?.length ? "supplied reference frame" : "",
  };
}

function pikaIngredients(b: MasterShotBrief): Ingredients {
  return {
    Subject: b.characters[0]?.name ?? "subject",
    Action: b.action.trim(),
    Mood: b.emotionalBeat,
    Style: b.visualMotif ?? "",
    Output: b.aspectRatio,
  };
}

function lumaIngredients(b: MasterShotBrief): Ingredients {
  return {
    Camera: `${b.cameraMovement}, ${b.lensSuggestion}`,
    Subject: castBlock(b),
    Environment: `${b.location}, ${b.timeOfDay}. ${b.productionDesign ?? ""}`.trim(),
    Lighting: b.lighting,
    Atmosphere: b.visualMotif ?? b.emotionalBeat,
    Output: `${b.aspectRatio}, ~${b.durationSec}s, smooth cinematic motion`,
  };
}

function midjourneyIngredients(b: MasterShotBrief): Ingredients {
  return {
    Subject: castBlock(b, true) || b.shotPurpose,
    Framing: b.cameraFraming,
    Style: b.visualMotif ?? "cinematic",
    Lighting: b.lighting,
    Lens: b.lensSuggestion,
    Design: b.productionDesign ?? "",
    Palette: b.colorPalette ? `${b.colorPalette} palette` : "",
    Mood: b.emotionalBeat,
    Output: `--ar ${b.aspectRatio.replace(":", ":")} --stylize 250`,
  };
}

function genericVideoIngredients(b: MasterShotBrief): Ingredients {
  return {
    Composition: `${b.cameraFraming} of ${castBlock(b)}`,
    Action: b.action.trim(),
    Setting: `${b.location}, ${b.timeOfDay}`,
    Lighting: b.lighting,
    Camera: b.cameraMovement,
    Mood: b.emotionalBeat,
    Output: `${b.aspectRatio}, ~${b.durationSec}s`,
  };
}

function genericImageIngredients(b: MasterShotBrief): Ingredients {
  return {
    Subject: castBlock(b) || b.shotPurpose,
    Framing: b.cameraFraming,
    Lighting: b.lighting,
    Lens: b.lensSuggestion,
    Palette: b.colorPalette ? `${b.colorPalette} palette` : "",
    Mood: b.emotionalBeat,
    Aspect: b.aspectRatio,
  };
}

function customIngredients(b: MasterShotBrief): Ingredients {
  return {
    Subject: castBlock(b),
    Action: b.action ?? "",
    Setting: `${b.location}, ${b.timeOfDay}`,
    Lighting: b.lighting ?? "",
    Camera: b.cameraMovement ?? "",
    Lens: b.lensSuggestion ?? "",
    Aspect: b.aspectRatio ?? "",
    Duration: String(b.durationSec ?? ""),
    Mood: b.emotionalBeat ?? "",
    Dialogue: b.dialogue ?? "",
  };
}

function buildIngredients(model: ModelKey, brief: MasterShotBrief): Ingredients {
  switch (model) {
    case "veo":
      return veoIngredients(brief);
    case "kling":
      return klingIngredients(brief);
    case "runway":
      return runwayIngredients(brief);
    case "pika":
      return pikaIngredients(brief);
    case "luma":
      return lumaIngredients(brief);
    case "midjourney":
      return midjourneyIngredients(brief);
    case "generic_video":
      return genericVideoIngredients(brief);
    case "generic_image":
      return genericImageIngredients(brief);
    case "custom":
      return customIngredients(brief);
  }
}

/**
 * Run the adapter for one (brief, model). The brief is treated as immutable;
 * the returned PromptVersion is the only artifact.
 *
 * Pipeline: adapter builds structured "ingredients" → composer polishes them
 * into a model-ready paragraph → readiness gate inspects the final output
 * before returning.
 */
export async function adaptPrompt(input: AdapterInput): Promise<PromptVersion> {
  const { brief, model, profile, priorFeedback, notes, versionNumber, productionRules, castLibrary } = input;
  const promptType = inferPromptType(profile, brief);
  const ingredients = buildIngredients(model, brief);

  const adapterNotes: string[] = [];
  if (notes && notes.trim()) adapterNotes.push(`writer steering: ${notes.trim()}`);
  applyFeedbackHints(adapterNotes, priorFeedback);

  const safety = safetyForPrompt(brief);
  if (safety.warnings.length) adapterNotes.push(...safety.notes);

  // Duration: route through the tag-aware chooser (3–6s default, per-tag
  // overrides, risk-factor clamping, model hard cap). Stills are 0 / unused.
  const duration =
    brief.outputType === "still"
      ? undefined
      : chooseDurationSec(brief, profile) || undefined;
  if (duration != null && brief.durationSec && duration < brief.durationSec) {
    adapterNotes.push(
      `Clip clamped to ${duration}s (brief requested ${brief.durationSec}s — risk factors or model cap).`
    );
  }

  const aspect = profile.supportedAspectRatios.includes(brief.aspectRatio)
    ? brief.aspectRatio
    : profile.supportedAspectRatios[0] ?? brief.aspectRatio;

  // Compose the final, model-ready paragraph. The composer:
  //   • compresses character bios into surface descriptors;
  //   • applies the per-model style guide;
  //   • silently honors prefer/avoid rules (without printing them inline);
  //   • sanitizes truncated fragments before returning;
  //   • returns a readiness verdict.
  const composed = await composePrompt({
    brief,
    model,
    profile,
    ingredients,
    productionRules,
    notes,
    durationSec: duration,
    aspectRatio: aspect,
    castLibrary,
    continuityDirective: input.continuityDirective,
    visibleCanonRequirements: input.visibleCanonRequirements,
    canonReferences: input.canonReferences,
  });

  // Drop negative prompts on models that don't support them.
  const negativePrompt = profile.negativePromptSupport ? composed.negativePrompt : undefined;

  const now = new Date().toISOString();
  return {
    versionId: `v${versionNumber}`,
    versionLabel: baseLabel(brief, model, versionNumber),
    model,
    promptType,
    mainPrompt: composed.finalPrompt,
    negativePrompt,
    aspectRatio: aspect,
    durationSec: duration,
    inputMode: promptType,
    notes: [
      `${profile.modelName} — ${profile.maxPromptStyle} structure.`,
      profile.dialogueOrLipSyncNotes,
      profile.characterConsistencyNotes,
      ...adapterNotes,
    ].filter(Boolean),
    safetyWarnings: safety.warnings,
    sourceBriefId: brief.id,
    createdAt: now,
    updatedAt: now,
    approved: false,
    adapterIngredients: ingredients,
    usageNotes: composed.usageNotes,
    readiness: composed.readiness,
    referenceMetadata: composed.referenceMetadata,
  };
}
