// Master Character Image Prompt generator.
//
// The Character Consistency Prompt (existing) is auto-injected into every
// AI VIDEO shot prompt that includes the character — it's a locked
// identity block.
//
// The Master Character Image Prompt (this file) is different. It's used
// ONCE to generate a clean reference IMAGE for the character — the photo
// the writer will save under metadata.visualBible.referenceImageUrl and
// inject into future image-to-video model calls for harder consistency.
//
// Two character types, two output shapes:
//
//   • PRINCIPALS (Maya, etc.): a single paragraph optimised for Midjourney
//     / SDXL / Flux / Sora-image with the 14 attributes the writer
//     specified (age, gender presentation, hair, face shape, skin tone if
//     specified, eye colour if specified, body type, first-episode
//     wardrobe, emotional expression, realism style, framing, lighting,
//     background, negative prompt).
//
//   • VOICE-OR-TEXT (Daniel): there is NO actor face. The "master asset"
//     is the messaging-app screenshot rendering of his text-thread
//     presence — contact card, avatar treatment, bubble style. The agent
//     produces a single paragraph optimised for image-gen models with
//     hard negatives against depicting a person.
//
// PURE PROMPT GENERATION — no writes. Caller persists.

import { config } from "../config.js";
import { callLLM, extractJSON } from "../llm/provider.js";

export interface MasterImagePromptInput {
  characterName: string;
  presence: "principal" | "voice_or_text";
  /** Existing visual canon — feeds the prompt verbatim. */
  visualCanon: string;
  /** Existing wardrobe text — feeds the prompt verbatim. */
  wardrobe: string;
  /** Existing locked traits — must be honoured. */
  doNotChangeTraits: string[];
  /** Existing movement canon — informs emotional expression. */
  movementCanon: string[];
  /** Existing negative-continuity block — feeds the negative prompt. */
  negativeContinuity: string;
  /** Episode number — informs the wardrobe context. */
  episodeNumber: number;
  /** Episode-specific wardrobe notes if any. */
  episodeWardrobeNotes?: string;
}

export interface MasterImagePromptOutput {
  /** Main prompt body, optimised for image-gen models. */
  prompt: string;
  /** Comma-separated avoid list. */
  negativePrompt: string;
  /** Recommended aspect ratio for the reference image. */
  aspectRatio: "2:3" | "3:4" | "1:1" | "9:16";
  rawResponse: string;
}

export async function generateMasterImagePrompt(
  input: MasterImagePromptInput
): Promise<MasterImagePromptOutput> {
  const isPrincipal = input.presence === "principal";

  const system = isPrincipal
    ? [
        "You are the Master Character Image Prompt generator for TOBURT",
        "Studios. You produce ONE prompt the writer will paste into",
        "Midjourney / SDXL / Flux / Sora-image to generate the canonical",
        "reference photograph for a principal character. This image will be",
        "uploaded back into the system and used as the visual seed for every",
        "subsequent AI video shot.",
        "",
        "OUTPUT JSON: { \"prompt\": string, \"negativePrompt\": string,",
        "               \"aspectRatio\": \"2:3\" | \"3:4\" }",
        "",
        "PROMPT MUST INCLUDE (in this rough order):",
        "  1. age range",
        "  2. gender presentation",
        "  3. hair colour, length, texture",
        "  4. face shape / face feel (real, lived-in vs. styled)",
        "  5. skin tone — ONLY if the existing canon specifies one. Do not",
        "     invent one if the canon is silent.",
        "  6. eye colour — ONLY if specified",
        "  7. body type",
        "  8. first-appearance wardrobe (quote verbatim from input)",
        "  9. emotional expression for the REFERENCE shot — neutral, alert,",
        "     restrained (not the dramatic peak from any single episode)",
        "  10. realism style — phone-era thriller, photographic, naturalistic,",
        "      not glamorous, not stylised",
        "  11. framing — 3/4 portrait, chest up, eye-level, single subject",
        "  12. lighting — naturalistic, cool ambient, motivated source",
        "  13. background — plain, dim, slight texture, non-distracting",
        "  14. nothing else in the frame",
        "",
        "NEGATIVE PROMPT MUST INCLUDE:",
        "  • everything from the input negativeContinuity",
        "  • everything the doNotChangeTraits explicitly excludes",
        "  • standard image-gen hygiene: cinematic crane, blockbuster lighting,",
        "    movie poster framing, glamour lighting, makeup other than the",
        "    canon specifies, styled hair, extra characters, dramatic action",
        "    pose, motion blur, lens flare, ring light, soft focus portrait",
        "",
        "Return JSON only. No preamble, no markdown fences.",
      ].join("\n")
    : [
        "You are the Master Asset Image Prompt generator for TOBURT Studios,",
        "in VOICE-OR-TEXT mode. The character has NO body and NO face in this",
        "episode — they exist only through phone screens, contact cards, and",
        "text-thread bubbles. The 'master asset' you produce is the",
        "screenshot rendering of their text presence.",
        "",
        "OUTPUT JSON: { \"prompt\": string, \"negativePrompt\": string,",
        "               \"aspectRatio\": \"9:16\" }",
        "",
        "THE PROMPT MUST PRODUCE: an iPhone-style messaging app screenshot,",
        "dark mode, with the contact's name rendered exactly as the canon",
        "specifies (all-caps, no surname), blank avatar (or letter initial",
        "only — NEVER a face), the most recent incoming-message text bubble",
        "verbatim, timestamp visible, and the clean glass-screen aesthetic.",
        "",
        "PROMPT MUST EXPLICITLY EXCLUDE: any person, any face, any body, any",
        "silhouette, any reflection of a person, any photograph of a person,",
        "any ghost, any silhouette behind the phone, any second figure.",
        "",
        "NEGATIVE PROMPT MUST INCLUDE: every variant of 'person', 'face',",
        "'body', 'man', 'human figure', 'silhouette', 'reflection of person',",
        "'photograph of person', 'profile photo on contact', 'avatar with",
        "face', 'animated typing dots', 'sound-wave indicator', 'voice",
        "memo waveform', 'emoji', 'colored chat bubbles', 'light-mode UI'.",
        "",
        "Return JSON only. No preamble, no markdown fences.",
      ].join("\n");

  const user = [
    `Character: ${input.characterName}`,
    `Presence: ${input.presence}`,
    `Episode for first-appearance wardrobe: EP${String(input.episodeNumber).padStart(2, "0")}`,
    "",
    "═══ EXISTING VISUAL CANON (do not paraphrase — quote verbatim) ═══",
    input.visualCanon || "(empty — fall back to chain-derived inferences)",
    "",
    "═══ WARDROBE (quote verbatim) ═══",
    input.wardrobe || "(empty)",
    input.episodeWardrobeNotes
      ? `\nEpisode-specific note: ${input.episodeWardrobeNotes}`
      : "",
    "",
    "═══ LOCKED DO-NOT-CHANGE TRAITS (every one must hold) ═══",
    input.doNotChangeTraits.length > 0
      ? input.doNotChangeTraits.map((t) => `  • ${t}`).join("\n")
      : "(none specified)",
    "",
    "═══ MOVEMENT CANON (informs the reference emotional read) ═══",
    input.movementCanon.length > 0
      ? input.movementCanon.map((t) => `  • ${t}`).join("\n")
      : "(none specified)",
    "",
    "═══ NEGATIVE CONTINUITY (must appear in your negativePrompt) ═══",
    input.negativeContinuity || "(none specified)",
    "",
    "Return JSON.",
  ]
    .filter(Boolean)
    .join("\n");

  const r = await callLLM({
    model: config.SHOWRUNNER_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    maxTokens: 1800,
  });

  let parsed: { prompt?: string; negativePrompt?: string; aspectRatio?: string } = {};
  try {
    parsed = extractJSON(r.text) as typeof parsed;
  } catch {
    parsed = {};
  }

  const aspectRatio = ((): MasterImagePromptOutput["aspectRatio"] => {
    const v = parsed.aspectRatio ?? "";
    if (v === "2:3" || v === "3:4" || v === "1:1" || v === "9:16") return v;
    return isPrincipal ? "2:3" : "9:16";
  })();

  return {
    prompt: parsed.prompt?.trim() ?? "",
    negativePrompt: parsed.negativePrompt?.trim() ?? "",
    aspectRatio,
    rawResponse: r.text,
  };
}
