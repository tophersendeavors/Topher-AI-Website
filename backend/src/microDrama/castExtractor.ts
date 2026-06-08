// Cast extractor — reads an episode's approved Fountain screenplay and
// returns the character continuity records needed by the shot-brief agent.
// One LLM call per episode. PLANNING / CONTINUITY ONLY. Does not invent
// characters that aren't in the screenplay.
//
// Output shape mirrors the existing `characters` table + the V2 Visual
// Bible structure that lives under `characters.metadata.visualBible`. The
// route layer is responsible for the upsert.

import { config } from "../config.js";
import { callLLM, extractJSON } from "../llm/provider.js";

export interface ExtractedCharacter {
  name: string;
  /** "principal" if they have on-screen presence; "voice_or_text" if they
   *  only appear through phone screens, voicemails, etc. */
  presence: "principal" | "voice_or_text";
  // ---- top-level character record fields (mapped to columns) ----
  /** One short phrase, e.g. "Grieving widow pulled into a surveillance nightmare". */
  archetype: string;
  /** Role label, usually "principal" | "voice / text" | "supporting" — what
   *  the route layer writes into the `role` column. */
  role: string;
  /** Multi-line biography. PRINCIPALS only — set to "" for voice_or_text. */
  biography: string;
  /** The character's external goal this episode. PRINCIPALS only. */
  want: string;
  /** The character's internal/growth need across the season. PRINCIPALS only. */
  need: string;
  /** Their fatal flaw or self-sabotaging tendency. PRINCIPALS only. */
  flaw: string;
  /** Voice notes — how they speak. */
  voiceNotes: string;
  // ---- DNA fields (mapped to metadata.dna) ----
  coreWound: string;
  publicMask: string;
  privateFear: string;
  speechCadence: string;
  howLies: string;
  showsVulnerability: string;
  behavioralTics: string[];
  emotionalTriggers: string[];
  defensiveStrategies: string[];
  avoidsSaying: string[];
  // ---- visual / continuity fields (mapped to metadata.visualBible) ----
  ageRange: string;
  /** Free-text photographable visual canon — the production-ready paragraph. */
  visualCanon: string;
  /** Array of observable movement patterns. */
  movementCanon: string[];
  /** Production-ready prompt that locks the character's look across shots. */
  characterConsistencyPrompt: string;
  /** What the character is wearing this episode. */
  wardrobe: string;
  /** Hard anchors that MUST remain identical across every shot. */
  doNotChangeTraits: string[];
  /** Free-text "do not do this with this character" guidance, used as a
   *  hard negative for AI video / image prompts. */
  negativeContinuity: string;
}

export interface CastExtractionInput {
  episodeNumber: number;
  episodeTitle: string;
  /** Fountain of the approved screenplay. */
  fountain: string;
  /** Chain snapshot — gives the agent context about what's withheld. */
  chain: {
    hook: string;
    setup: string;
    twist: string;
    cliffhanger: string;
    revealedToAudience: string;
    withheldFromAudience: string;
  };
  /** Already-known cast (e.g. from prior episodes). The agent SHOULD
   *  reuse names verbatim when the screenplay refers to them. */
  knownCast: Array<{ name: string; role?: string }>;
}

export interface CastExtractionResult {
  characters: ExtractedCharacter[];
  rawResponse: string;
}

export async function extractCast(
  input: CastExtractionInput
): Promise<CastExtractionResult> {
  const system = [
    "You are the Cast Continuity Extractor for TOBURT Studios micro-drama.",
    "Read the approved screenplay and return one fully-populated record per",
    "character who appears in it — including off-screen characters whose",
    "voice / text / phone screen presence drives the scene.",
    "",
    "PRESENCE TIERS:",
    "  • 'principal'      = physically on camera at any point in the episode",
    "  • 'voice_or_text'  = appears ONLY through phone screen, voicemail,",
    "                       recorded voice, or text — never visually as a body",
    "",
    "STRICT RULES:",
    "  • Do NOT invent characters who are not in the screenplay.",
    "  • Use the exact name (case-sensitive) the screenplay uses.",
    "  • Do NOT reveal anything from the WITHHELD list — that info is for",
    "    later episodes. Do not mention it in any field.",
    "  • Do NOT leave principal-character fields empty. If the screenplay",
    "    is sparse, infer from chain context + reveal-tracker + audience-state.",
    "    A blank field is a pipeline FAILURE — provide your best concrete",
    "    answer rooted in the source. Speculation is permitted; invention",
    "    of biographical facts contradicted by the chain is not.",
    "  • characterConsistencyPrompt: a SINGLE PARAGRAPH that quotes the",
    "    visual canon and wardrobe verbatim and locks them as the prompt",
    "    seed for AI image / video models. Treat it as the artifact a",
    "    downstream model will paste into every prompt.",
    "",
    "═══ REQUIRED FIELDS — PRINCIPAL CHARACTERS ═══",
    "Every field below MUST be populated for a 'principal'. Do not omit",
    "any key. Long-form fields below should be one paragraph minimum.",
    "",
    "  archetype                   1-line tag, e.g.",
    "                              'Grieving widow pulled into a surveillance nightmare'",
    "  role                        usually 'principal' (or 'supporting' if minor)",
    "  biography                   2-4 sentence backstory rooted in the chain.",
    "                              No facts that contradict the chain. No invented surname.",
    "  want                        external goal this episode",
    "  need                        internal/growth need across the season",
    "  flaw                        fatal flaw or self-sabotaging tendency",
    "  voiceNotes                  how they speak. Concrete cadence + tone.",
    "",
    "  coreWound                   psychological core wound. 1-2 sentences.",
    "  publicMask                  how they present to the world",
    "  privateFear                 what they fear when alone",
    "  speechCadence               sentence shape, pause behaviour, escalation pattern",
    "  howLies                     specific tactic they use to evade truth",
    "  showsVulnerability          observable behaviours when vulnerable",
    "  behavioralTics              3-7 concrete observable habits",
    "  emotionalTriggers           3-7 specific stimuli that destabilise them",
    "  defensiveStrategies         3-6 ways they protect themselves",
    "  avoidsSaying                3-5 lines they will NOT say out loud",
    "",
    "  ageRange                    e.g. 'early thirties'",
    "  visualCanon                 1-paragraph PHOTOGRAPHABLE visual description.",
    "                              Hair, face, build, presentation — observable only.",
    "                              Anchored in the screenplay, not interpretive.",
    "  movementCanon               4-8 short observable movement patterns",
    "  characterConsistencyPrompt  1-paragraph production-ready prompt that locks",
    "                              the visual canon + wardrobe verbatim",
    "  wardrobe                    every garment + accessory worn this episode.",
    "                              State the colour, fit, and item. End with full stop.",
    "  doNotChangeTraits           6-12 hard anchors that must remain identical",
    "                              across every shot",
    "  negativeContinuity          1 paragraph of 'do NOT' rules for image/video",
    "                              models (no glam, no genre cliches, no outfit changes)",
    "",
    "═══ REQUIRED FIELDS — VOICE_OR_TEXT CHARACTERS ═══",
    "These characters have NO body. Most visual fields are not applicable.",
    "Populate ONLY: name, presence, archetype, role ('voice / text'),",
    "voiceNotes (their voice/text style), visualCanon (describe how their",
    "PRESENCE is rendered — contact name, avatar, text-bubble style),",
    "characterConsistencyPrompt (locks how their text/voice rendering stays",
    "identical — UI style, contact name capitalisation, no profile photo,",
    "etc.), doNotChangeTraits (how their rendering must stay consistent),",
    "and negativeContinuity ('do not depict as a person', etc.). The other",
    "fields (biography, want, need, flaw, coreWound, …, wardrobe) should be",
    "empty strings or empty arrays.",
    "",
    "JSON OUTPUT ONLY. No preamble, no markdown fences, no commentary.",
    "Schema: { \"characters\": [ { /* ExtractedCharacter */ }, … ] }",
  ].join("\n");

  const user = [
    `Episode ${input.episodeNumber} — "${input.episodeTitle}"`,
    "",
    "CHAIN CONTEXT:",
    `  HOOK: ${input.chain.hook}`,
    `  SETUP: ${input.chain.setup}`,
    `  TWIST: ${input.chain.twist}`,
    `  CLIFFHANGER: ${input.chain.cliffhanger}`,
    `  REVEALED THIS EPISODE: ${input.chain.revealedToAudience}`,
    `  WITHHELD (forbidden to leak): ${input.chain.withheldFromAudience}`,
    "",
    input.knownCast.length > 0
      ? "KNOWN CAST (use these exact names if the screenplay refers to them):\n" +
        input.knownCast.map((c) => `  - ${c.name}${c.role ? ` (${c.role})` : ""}`).join("\n")
      : "KNOWN CAST: none yet",
    "",
    "SCREENPLAY (Fountain):",
    input.fountain,
    "",
    "Return JSON only.",
  ].join("\n");

  const r = await callLLM({
    model: config.SHOWRUNNER_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    // Larger ceiling — the per-principal payload is now ~22 fields, mostly
    // text. A 4-character cast can hit ~6000 tokens of structured output.
    maxTokens: 8000,
  });

  let parsed: { characters?: ExtractedCharacter[] } = {};
  try {
    parsed = extractJSON(r.text) as { characters?: ExtractedCharacter[] };
  } catch {
    parsed = { characters: [] };
  }
  return {
    characters: parsed.characters ?? [],
    rawResponse: r.text,
  };
}
