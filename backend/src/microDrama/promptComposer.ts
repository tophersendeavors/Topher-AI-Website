// Micro-drama prompt composer — Stage 5 tier guard.
//
// The existing prompt composer / router / per-model adapters at
// backend/src/draft/aiPrompts/ default to CINEMA sizing (16:9, longer
// clips, prestige-style prose). They do not currently read projectType
// at runtime. Rather than retrofit those three big files for the
// micro-drama tier, this composer produces a focused, vertical-drama
// ready prompt directly from a Master Shot Brief + the episode's
// continuity records (cast + location).
//
// One LLM call per shot, producing a single output prompt + the
// negative-prompt list. Aspect ratio is locked to 9:16. Duration is
// constrained to 3–5 seconds. Continuity anchors are quoted verbatim
// into the prompt so Maya looks the same across every clip and the
// bedroom layout never drifts.

import { config } from "../config.js";
import { callLLM, extractJSON } from "../llm/provider.js";
import type { ExtractedCharacter } from "./castExtractor.js";
import type { ExtractedLocation } from "./locationExtractor.js";

export interface MicroDramaPromptInput {
  /** A Master Shot Brief from the auto-build agent (we accept anything
   *  with the 7 photographable fields + ord/shotIndex). */
  brief: {
    id?: string;
    primaryImage: string;
    cameraSees: string;
    frame: string;
    light: string;
    texture: string;
    lockedDetails: string;
    action: string;
    /** Optional fields the brief sometimes carries. */
    dialogue?: string;
    shotPurpose?: string;
    emotionalBeat?: string;
  };
  /** Cast records for characters visible in this shot. */
  cast: ExtractedCharacter[];
  /** The location continuity record for this shot. */
  location: ExtractedLocation;
  /** Chain withheld string — appended to negative prompts. */
  withheldFromAudience: string;
  /** Target clip duration in seconds (3-5). */
  durationSec: number;
}

export interface MicroDramaPromptOutput {
  /** The model-ready vertical-drama prompt. Single paragraph. */
  prompt: string;
  /** Things the model must NOT render (withheld content + tier defaults). */
  negativePrompt: string;
  /** Always 9:16 for micro-drama. */
  aspectRatio: "9:16";
  /** 3-5 seconds for this tier. */
  durationSec: number;
  rawResponse: string;
}

export async function composeMicroDramaPrompt(
  input: MicroDramaPromptInput
): Promise<MicroDramaPromptOutput> {
  const duration = Math.max(3, Math.min(5, input.durationSec));

  // The locked-style block makes Maya / Maya's Bedroom look the SAME across
  // every shot regardless of which beat we're rendering. The model reads
  // these verbatim — never paraphrase.
  const castLockedBlock = input.cast
    .map((c) => {
      const dnc = c.doNotChangeTraits.join("; ");
      return `${c.name} — locked: ${c.visualDescription}. Wardrobe: ${c.wardrobe}. Anchors: ${dnc}.`;
    })
    .join("\n");

  const locationLockedBlock =
    `${input.location.name} — locked: ${input.location.roomLayout}. ` +
    `Lighting: ${input.location.lighting}. ` +
    `Props (positions fixed): ${input.location.props.map((p) => `${p.prop} (${p.position})`).join("; ")}. ` +
    `Continuity anchors: ${input.location.continuityAnchors.join("; ")}.`;

  const system = [
    "You are the Micro Drama Vertical Prompt Composer for TOBURT Studios.",
    "Convert a Master Shot Brief into ONE model-ready prompt for AI video",
    "generation (Kling / Pika / Runway / Luma — vertical 9:16, 3-5 second clip).",
    "",
    "OUTPUT FORMAT (JSON only):",
    "  { \"prompt\": string, \"negativePrompt\": string }",
    "",
    "PROMPT REQUIREMENTS:",
    "  • Single paragraph. No labels (no 'Camera:', 'Subject:', etc.).",
    "  • Aspect: vertical 9:16. State it explicitly in the prompt body.",
    "  • Duration: 3-5 seconds. State it explicitly.",
    "  • Style: realistic phone-era thriller, handheld feel, naturalistic",
    "    light, not cinematic. No establishing shots, no crane moves, no",
    "    sweeping camera, no slow motion unless the brief asks for it.",
    "  • Open the prompt with the primary image as the literal first noun.",
    "  • Quote the cast and location LOCKED descriptions verbatim into the",
    "    prompt. This is what makes Maya look the same shot to shot.",
    "  • If the action involves a phone screen, name what's on the screen.",
    "  • Avoid 'cinematic', 'epic', 'blockbuster', 'movie poster', or any",
    "    cinema-vocabulary.",
    "",
    "NEGATIVE PROMPT REQUIREMENTS:",
    "  • Comma-separated list of things to exclude.",
    "  • Start with the global micro-drama exclusions: 'horizontal 16:9,",
    "    cinematic crane shot, wide establishing shot, slow motion, lens",
    "    flare, blockbuster lighting, movie poster framing'.",
    "  • Append anything from the WITHHELD list that must not appear",
    "    on-screen this episode.",
    "  • Append any character from the cast block NOT visible in this",
    "    shot (so the model doesn't accidentally render them).",
  ].join("\n");

  const user = [
    "═══ SHOT BRIEF ═══",
    `PRIMARY IMAGE: ${input.brief.primaryImage}`,
    `CAMERA SEES: ${input.brief.cameraSees}`,
    `FRAME: ${input.brief.frame}`,
    `LIGHT: ${input.brief.light}`,
    `TEXTURE: ${input.brief.texture}`,
    `LOCKED DETAILS: ${input.brief.lockedDetails}`,
    `ACTION: ${input.brief.action}`,
    input.brief.dialogue ? `DIALOGUE: ${input.brief.dialogue}` : "",
    input.brief.emotionalBeat ? `EMOTIONAL BEAT: ${input.brief.emotionalBeat}` : "",
    "",
    "═══ CAST — LOCKED DESCRIPTIONS (quote verbatim) ═══",
    castLockedBlock,
    "",
    "═══ LOCATION — LOCKED DESCRIPTION (quote verbatim) ═══",
    locationLockedBlock,
    "",
    "═══ DO NOT REVEAL THIS EPISODE ═══",
    input.withheldFromAudience || "(nothing withheld)",
    "",
    `═══ CLIP TARGETS ═══`,
    `  Aspect: 9:16 vertical`,
    `  Duration: ${duration} seconds`,
    "",
    "Return JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  const r = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.4,
    maxTokens: 1200,
  });

  let parsed: { prompt?: string; negativePrompt?: string } = {};
  try {
    parsed = extractJSON(r.text) as { prompt?: string; negativePrompt?: string };
  } catch {
    parsed = {};
  }

  return {
    prompt: parsed.prompt?.trim() ?? "",
    negativePrompt: parsed.negativePrompt?.trim() ?? "",
    aspectRatio: "9:16",
    durationSec: duration,
    rawResponse: r.text,
  };
}
