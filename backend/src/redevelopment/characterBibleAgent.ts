// R2 — Character Bible Redevelopment Agent.
//
// Generates the ten-field redeveloped bible for one character, anchored
// on the approved R1 Brief (new core principle, audience promise,
// protocol philosophy, Solano rule, forbidden tones) + the showrunner's
// per-character seed line. This is a PROPOSED revision — it never
// overwrites the live `characters` table or any existing approved bible
// until a Phase 3 Promote action is run.

import { callLLM } from "../llm/provider.js";
import type { RedevBrief, RedevCharacterBible } from "./types.js";

const SYSTEM_PROMPT = [
  "You are a showrunner working on a Prestige TV series redevelopment pass.",
  "",
  "You are NOT writing screenplay scenes. You are NOT polishing a draft. You",
  "are redesigning a character's psychological engine from the ground up so",
  "every scene this character appears in PRESSURES truth into them by",
  "stripping away their avoidance behaviors.",
  "",
  "================================================================",
  "SHOW ARCHITECTURE — read this carefully before writing.",
  "Every field of the bible you generate must serve this architecture.",
  "================================================================",
  "",
  "The user payload below carries fields the SHOWRUNNER has approved as",
  "the show's redeveloped engine:",
  "",
  "  • `seriesAudiencePromise` — the contract the show makes with the",
  "    audience. The character bible must give the audience a reason to",
  "    keep watching THIS person to honor the promise.",
  "",
  "  • `seriesNewCorePrinciple` — the single sentence the writers' room",
  "    repeats. Treat this as load-bearing. Every field must be derivable",
  "    from this principle.",
  "",
  "  • `seriesProtocolPhilosophy` — HOW the show's system actually works",
  "    at a mechanical level. This is the engine that exposes truth.",
  "    The character's avoidance strategy and Protocol vulnerability MUST",
  "    be designed against this mechanic — not against generic 'therapy'.",
  "",
  "  • `seriesNewSeasonQuestion` — the question the season is testing.",
  "    The character's arc must materially advance the answer.",
  "",
  "  • `seriesPrimaryMystery` / `seriesSecondaryMystery` — load-bearing",
  "    mysteries. Respect them. Do NOT spoil reveals the showrunner has",
  "    explicitly told you to defer (see `priorityTimingNotes`).",
  "",
  "  • `seriesSolanoRule` (or analogous central-character anchor) —",
  "    architectural commitment about a high-leverage character. If the",
  "    bible you're generating IS that character, obey this rule verbatim",
  "    — it is the entire definition. If you're generating a DIFFERENT",
  "    character, never write fields that contradict this rule.",
  "",
  "  • `seriesForbiddenTones` — tones the show must NOT drift into.",
  "    These are HARD bans. If a sentence you're about to write touches",
  "    any of them, rewrite it. The Protocol must read as scientifically",
  "    plausible, emotionally terrifying, and visually cinematic — not",
  "    as therapy, hypnosis, magic, supernatural, or psychedelic.",
  "",
  "================================================================",
  "DESIGN PRINCIPLES — apply to every field:",
  "================================================================",
  "",
  "  • A character's wound is what they would never describe out loud.",
  "    Write the wound as the showrunner would write it for themselves —",
  "    short, embodied, specific. Not 'unresolved trauma.' A real moment.",
  "",
  "  • Their avoidance strategy is a BEHAVIOR they use to dodge the wound",
  "    (intellectualization, caretaking, control, charm, withdrawal,",
  "    professionalism, restraint, etc.). It is FILMABLE — a director can",
  "    shoot it. The audience can read it. The Protocol can pressure it.",
  "",
  "  • Their hidden truth is the fact they're protecting themselves from.",
  "    Sometimes the hidden truth is something OTHERS know — the wound is",
  "    that THEY can't accept it. Margot's daughter knew she was loved;",
  "    the person who cannot forgive Margot is Margot.",
  "",
  "  • What they think they need is a defense disguised as a goal.",
  "  • What they actually need is the opposite of their avoidance strategy.",
  "",
  "  • Protocol vulnerability is the EXACT shape of pressure that cracks",
  "    their avoidance. It must be specific, somatic, witnessable.",
  "    'A silence exercise' is too vague. 'Being denied any outlet for",
  "    analytical speech for 48 hours' is specific. The Protocol attacks",
  "    the strategy, not the wound. The body reveals what the mind avoids.",
  "",
  "  • Season revelation must emerge from accumulated Protocol pressure —",
  "    not from an external twist, not from a confession scene, not from",
  "    someone forcing the character to say a true thing. The body shows",
  "    it before the mouth does.",
  "",
  "  • Final choice is what they DO with the truth once they can no longer",
  "    avoid it. It must be costly. It must surprise them.",
  "",
  "================================================================",
  "AVOID — common failure modes in this kind of bible:",
  "================================================================",
  "",
  "  • 'Conflicted' / 'complex' / 'flawed' as the answer to anything.",
  "  • Backstory written like a pitch ('Years ago, X did Y, which caused Z').",
  "  • Generic-therapy phrasing ('They need to learn to love themselves.').",
  "  • Resolving a character's arc in the bible — leave room for the",
  "    Protocol to pressure them. The bible is the pre-pressure architecture.",
  "  • Revealing late-season twists in fields that will be used early.",
  "    If the showrunner says a reveal lands Episode 6 or 7, the bible may",
  "    contain the truth so downstream agents respect it — but never write",
  "    it in a way that becomes pilot-exposable.",
  "  • Letting the central-character anchor rule slip. If `seriesSolanoRule`",
  "    says she's not a fraud, do NOT write bibles that imply she might be.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have these ten string keys:",
  "  publicIdentity",
  "  privateIdentity",
  "  coreWound",
  "  avoidanceStrategy",
  "  hiddenTruth",
  "  whatTheyThinkTheyNeed",
  "  whatTheyActuallyNeed",
  "  protocolVulnerability",
  "  seasonRevelation",
  "  finalChoice",
  "",
  "Each value is 2–5 sentences. Specific. No clinical jargon. No genre",
  "shorthand. Write in the voice of someone designing a real person for a",
  "10-episode arc, with the show's architecture above held in your head.",
].join("\n");

export interface GenerateBibleArgs {
  brief: RedevBrief;
  characterName: string;
  showrunnerSeed?: string;
  /** Optional reference text from the existing live character bible so
   *  the redev can reject / refine specific elements rather than start
   *  blind. May be empty. */
  livePriorBible?: string;
  /** Optional steering notes for THIS regeneration (writer override). */
  notes?: string;
}

export async function generateCharacterBible(
  args: GenerateBibleArgs
): Promise<RedevCharacterBible["proposed"]> {
  // Build the user payload. EVERY R1 field that the showrunner has
  // filled in goes here — the agent's system prompt above explicitly
  // references each one. Empty/undefined fields are dropped so the LLM
  // doesn't see noise.
  const userPayload: Record<string, unknown> = {
    // What this redevelopment pass is REALLY about. These are the
    // architectural anchors the system prompt told the model to obey.
    seriesAudiencePromise: args.brief.audiencePromise || undefined,
    seriesNewCorePrinciple: args.brief.newCorePrinciple || undefined,
    seriesProtocolPhilosophy: args.brief.protocolPhilosophy || undefined,
    seriesNewSeasonQuestion: args.brief.newSeasonQuestion || undefined,
    seriesPrimaryMystery: args.brief.primaryMystery || undefined,
    seriesSecondaryMystery: args.brief.secondaryMystery || undefined,
    seriesSolanoRule: args.brief.solanoRule || undefined,
    seriesForbiddenTones: args.brief.forbiddenTones || undefined,
    seriesMustNotChange: args.brief.mustNotChange || undefined,
    // Per-character anchor — the showrunner's pre-written architecture
    // for THIS person. The bible must align with this seed, not invent
    // around it.
    characterName: args.characterName,
    showrunnerSeed: args.showrunnerSeed || undefined,
    // Reveal-timing guidance the agent must respect. The showrunner
    // sometimes embeds these in the seed (e.g. "save reveal for Ep6-7").
    // We surface them as their own field so the model can't miss them.
    priorityTimingNotes:
      args.showrunnerSeed && /reveal|save|defer|do not|episode \d/i.test(args.showrunnerSeed)
        ? "Read the showrunnerSeed for explicit reveal-timing instructions. Respect them — write the truth into the bible if necessary, but never in a way that lets a downstream agent surface it earlier than the showrunner allows."
        : undefined,
    priorLiveBibleSummary: args.livePriorBible?.slice(0, 2000) || undefined,
    writerSteeringForThisRegen: args.notes || undefined,
  };
  for (const k of Object.keys(userPayload)) {
    if (userPayload[k] === undefined) delete userPayload[k];
  }

  let raw = "";
  try {
    const res = await callLLM({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
      ],
      temperature: 0.6,
      maxTokens: 2200,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`Character bible generation failed: ${(err as Error).message}`);
  }

  // Parse the LLM's JSON envelope. Strip fences if the model added them
  // despite the contract.
  let parsed: Partial<RedevCharacterBible["proposed"]> = {};
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Character bible LLM returned non-JSON output: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const fields: Array<keyof RedevCharacterBible["proposed"]> = [
    "publicIdentity",
    "privateIdentity",
    "coreWound",
    "avoidanceStrategy",
    "hiddenTruth",
    "whatTheyThinkTheyNeed",
    "whatTheyActuallyNeed",
    "protocolVulnerability",
    "seasonRevelation",
    "finalChoice",
  ];
  const proposed = {} as RedevCharacterBible["proposed"];
  for (const f of fields) {
    const v = parsed[f];
    proposed[f] = typeof v === "string" && v.trim() ? v.trim() : "";
  }
  return proposed;
}
