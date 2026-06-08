// Location extractor — reads an episode's approved Fountain screenplay and
// returns the location continuity records the shot-brief agent needs to
// keep room layout, props, and lighting consistent across every shot.
//
// One LLM call per episode. PLANNING / CONTINUITY ONLY.

import { config } from "../config.js";
import { callLLM, extractJSON } from "../llm/provider.js";

export interface ExtractedLocation {
  /** Slug-line-style name, e.g. "MAYA'S BEDROOM". */
  name: string;
  /** "interior" | "exterior" | "mixed" */
  kind: "interior" | "exterior" | "mixed";
  /** What time of day this location appears in this episode. */
  timeOfDay: string;
  /** One-line, photographable room description. */
  roomLayout: string;
  /** Lighting — observable, source-named ("phone screen glow", "moonlight
   *  through blinds", "single overhead bulb"). */
  lighting: string;
  /**
   * Props that must remain in the same position across every shot in this
   * location. Each entry names a prop + its position.
   */
  props: Array<{ prop: string; position: string }>;
  /**
   * Specific continuity anchors required by the screenplay — these are
   * the things the camera needs to come back to (e.g. closet door, phone
   * on nightstand, smear on inside handle).
   */
  continuityAnchors: string[];
  /** Suggested camera angles available in this room — vertical (9:16). */
  cameraAngleOpportunities: string[];
  /** Free-text continuity reminders for downstream prompts. */
  continuityNotes: string;
}

export interface LocationExtractionInput {
  episodeNumber: number;
  episodeTitle: string;
  fountain: string;
  chain: {
    hook: string;
    setup: string;
    twist: string;
    cliffhanger: string;
    revealedToAudience: string;
    withheldFromAudience: string;
  };
  /** Already-known locations to reuse (verbatim name) if the screenplay
   *  refers to them again. */
  knownLocations: Array<{ name: string; kind?: string }>;
}

export interface LocationExtractionResult {
  locations: ExtractedLocation[];
  rawResponse: string;
}

export async function extractLocations(
  input: LocationExtractionInput
): Promise<LocationExtractionResult> {
  const system = [
    "You are the Location Continuity Extractor for TOBURT Studios micro-drama.",
    "Read the approved screenplay and return one record per LOCATION the",
    "scene uses (every distinct INT./EXT. slug line is a location).",
    "",
    "STRICT RULES:",
    "  • Do NOT invent props or layout details the screenplay does not name.",
    "  • Every prop must be one the screenplay (or chain context) names.",
    "  • continuityAnchors must include EVERY specific physical element",
    "    the screenplay or chain calls out (phone position, door state,",
    "    blood detail, photograph timestamp, etc.).",
    "  • cameraAngleOpportunities should be vertical-friendly (9:16) and",
    "    realistic for a phone-era thriller — handheld POV, over-the-",
    "    shoulder onto the phone screen, low-angle facing the closet, etc.",
    "    No cinematic crane / dolly / wide-establishing shots.",
    "  • Do NOT reveal anything from the WITHHELD list. The location",
    "    description must not name the closet's contents or who is inside.",
    "",
    "JSON OUTPUT ONLY. Every field below is REQUIRED for every location",
    "object — return empty string or empty array if you genuinely have",
    "nothing, but DO NOT omit any key.",
    "",
    "SCHEMA:",
    '  {',
    '    "locations": [',
    '      {',
    '        "name": "MAYA\'S BEDROOM",                       // string, slug-style uppercase',
    '        "kind": "interior",                              // "interior" | "exterior" | "mixed"',
    '        "timeOfDay": "NIGHT",                            // string',
    '        "roomLayout": "Small dark bedroom; bed faces a closet across the room; nightstand to the left of the bed.",  // string, 1-2 sentences',
    '        "lighting": "Phone screen blue glow; otherwise dark; faint moonlight from the window.",     // string',
    '        "props": [                                       // array of {prop, position} objects',
    '          { "prop": "phone", "position": "on nightstand left of bed" },',
    '          { "prop": "closet door", "position": "across the room facing the bed" }',
    '        ],',
    '        "continuityAnchors": [                           // array of strings',
    '          "phone face-up on nightstand",',
    '          "closet door closed at start"',
    '        ],',
    '        "cameraAngleOpportunities": [                    // array of strings, 9:16-friendly',
    '          "low angle POV from bed toward closet",',
    '          "over-the-shoulder on phone screen"',
    '        ],',
    '        "continuityNotes": "Bedroom stays dark across the whole episode. Phone glow is the only motivated source." // string',
    '      }',
    '    ]',
    '  }',
    "",
    "Return JSON only. No preamble, no markdown fences, no commentary.",
  ].join("\n");

  const user = [
    `Episode ${input.episodeNumber} — "${input.episodeTitle}"`,
    "",
    "CHAIN CONTEXT:",
    `  HOOK: ${input.chain.hook}`,
    `  SETUP: ${input.chain.setup}`,
    `  TWIST: ${input.chain.twist}`,
    `  CLIFFHANGER: ${input.chain.cliffhanger}`,
    `  REVEALED: ${input.chain.revealedToAudience}`,
    `  WITHHELD (forbidden to leak): ${input.chain.withheldFromAudience}`,
    "",
    input.knownLocations.length > 0
      ? "KNOWN LOCATIONS (reuse exact names):\n" +
        input.knownLocations.map((l) => `  - ${l.name}`).join("\n")
      : "KNOWN LOCATIONS: none yet",
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
    maxTokens: 2000,
  });

  let parsed: { locations?: ExtractedLocation[] } = {};
  try {
    parsed = extractJSON(r.text) as { locations?: ExtractedLocation[] };
  } catch {
    parsed = { locations: [] };
  }
  return {
    locations: parsed.locations ?? [],
    rawResponse: r.text,
  };
}
