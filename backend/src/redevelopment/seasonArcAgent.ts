// R4 — Season One Arc Redesign Agent.
//
// Generates 8 episodes for Season One in a single LLM call so the arc
// reads as a cohesive design — episode N's plant lands in episode M.
// Anchored on the approved R1 Brief, the approved R2 bibles, and the
// approved R3 Protocol modules.
//
// Output is PROPOSED — sits under `redevelopmentPasses[].seasonArc`.
// Nothing flows to the live season until a Phase 3 Promote action.

import { callLLM, extractJSON } from "../llm/provider.js";
import { auditAndRepairSeasonArc } from "./validators.js";
import type {
  AuditReport,
  RedevBrief,
  RedevCharacterBible,
  RedevProtocolModule,
  RedevSeasonArcEpisode,
} from "./types.js";

const SYSTEM_PROMPT = [
  "You are redesigning Season One of a Prestige TV series. Eight",
  "episodes. You are NOT writing screenplays. You are designing the",
  "season's architecture: which Protocol module pressures which",
  "character; which truth surfaces in which episode; what each episode",
  "plants for later episodes to pay off; how the mysteries progress.",
  "",
  "================================================================",
  "ARCHITECTURE — sent in the user payload below; honor every part:",
  "================================================================",
  "",
  "  • `seriesNewCorePrinciple` — the load-bearing principle.",
  "  • `seriesProtocolPhilosophy` — HOW the Protocol works. Cliffhangers",
  "    come from what the exercises REVEAL, not from the exercises.",
  "  • `seriesSolanoRule` — Solano is not a fraud. The Protocol works.",
  "    The danger is truth, not deception. Never end an episode on a",
  "    'reveal Solano is lying' beat.",
  "  • `seriesNewSeasonQuestion` — the question the season is testing.",
  "    Every episode must materially advance the answer.",
  "  • `seriesPrimaryMystery` / `seriesSecondaryMystery` — load-bearing",
  "    mysteries. Track them across the eight episodes.",
  "  • `seriesAudiencePromise` — what the audience is waiting to",
  "    understand. The season must deliver that understanding by",
  "    episode 8 (or set it up for season 2).",
  "  • `seriesForbiddenTones` — hard bans for the show's texture.",
  "  • `characterBibles` — approved R2 architecture for each principal.",
  "    Each character's arc across the season must materially track",
  "    their `seasonRevelation` and `finalChoice` from the bible.",
  "  • `protocolModules` — approved R3 modules. Each episode SHOULD",
  "    name one module as its primary mechanism (some episodes may use",
  "    two — name both if so). Do not invent modules; only use names",
  "    from the supplied list.",
  "",
  "================================================================",
  "DESIGN PRINCIPLES:",
  "================================================================",
  "",
  "  • Each episode is about a TRUTH the Protocol pressures, not about",
  "    a plot incident. Frame each episode by the truth that becomes",
  "    unavoidable, then design action around it.",
  "  • Character collisions matter more than character-to-Solano scenes.",
  "    Episodes should escalate inter-guest collision.",
  "  • Cliffhangers come from what the exercises REVEAL. The cliffhanger",
  "    of episode N is a discovery, not a stunt.",
  "  • Audience should be allowed to constantly reassess what they",
  "    believe about each character and about Selvaje itself.",
  "  • Respect priority-timing notes. If a character bible says a reveal",
  "    lands episode 6 or 7, do NOT spoil it earlier. Do plant for it.",
  "  • The 'episode 1 plant' field is the SPECIFIC thing the pilot",
  "    must establish for THIS episode's beats to land. Be concrete.",
  "    'A seed of distrust between Margot and Solano' is vague. 'Margot",
  "    notices the absence of a clock in the meeting room, and we",
  "    silently agree she's the kind of person who would' is specific.",
  "",
  "================================================================",
  "AVOID:",
  "================================================================",
  "",
  "  • Twists that exist only for surprise. Every reveal must emerge",
  "    from Protocol pressure on a character's avoidance strategy.",
  "  • Resolving the season's central question before episode 8.",
  "  • An episode 8 finale that closes everything — leave one or two",
  "    unhealed truths so a season 2 can build on them.",
  "  • Pilot exposure of late-season reveals (Paul's texting reveal is",
  "    explicitly architected for episode 6 or 7 — do not surface it",
  "    earlier even if it's tempting).",
  "  • Generic 'they confront their issues' phrasing.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have one key: `episodes`, an array of EXACTLY 8 objects.",
  "Each episode object MUST have these nine keys, all strings except `number`:",
  "  number                  (integer: 1..8)",
  "  title                   (working title — evocative, not generic)",
  "  theme                   (the truth this episode pressures — 1–2 sentences)",
  "  protocolModule          (name from `protocolModules` list; or two names if applicable)",
  "  characterBreakthrough   (which character's strategy cracks, and HOW it shows)",
  "  characterCollision      (which two principals collide, and over what — specific)",
  "  mysteryProgression      (what advances on primaryMystery / secondaryMystery)",
  "  revelation              (the perspective shift — what audience now sees differently)",
  "  cliffhanger             (what the episode's exercise REVEALS, not a stunt)",
  "  episode1Plant           (the specific thing the pilot must establish for THIS to land)",
  "",
  "Each string is 2–5 sentences. Specific. Anchored to characters and",
  "modules from the user payload by NAME.",
].join("\n");

export interface GenerateSeasonArcArgs {
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  /** Optional steering for this regen. */
  notes?: string;
}

export async function generateSeasonArc(
  args: GenerateSeasonArcArgs
): Promise<{ episodes: RedevSeasonArcEpisode[]; audit: AuditReport }> {
  // Only approved bibles and approved modules count — they're the
  // architectural inputs the showrunner has signed off.
  const characterBibles = args.characterBibles
    .filter((b) => !!b.approvedAt)
    .map((b) => ({
      name: b.characterName,
      coreWound: b.proposed.coreWound,
      avoidanceStrategy: b.proposed.avoidanceStrategy,
      protocolVulnerability: b.proposed.protocolVulnerability,
      seasonRevelation: b.proposed.seasonRevelation,
      finalChoice: b.proposed.finalChoice,
    }));
  const protocolModules = args.protocolModules
    .filter((m) => !!m.approvedAt)
    .map((m) => ({
      name: m.name,
      purpose: m.purpose,
      avoidanceBehaviorStripped: m.avoidanceBehaviorStripped,
      truthPressured: m.truthPressured,
      possibleEpisodePlacement: m.possibleEpisodePlacement,
    }));

  const userPayload: Record<string, unknown> = {
    seriesNewCorePrinciple: args.brief.newCorePrinciple || undefined,
    seriesProtocolPhilosophy: args.brief.protocolPhilosophy || undefined,
    seriesSolanoRule: args.brief.solanoRule || undefined,
    seriesNewSeasonQuestion: args.brief.newSeasonQuestion || undefined,
    seriesPrimaryMystery: args.brief.primaryMystery || undefined,
    seriesSecondaryMystery: args.brief.secondaryMystery || undefined,
    seriesAudiencePromise: args.brief.audiencePromise || undefined,
    seriesForbiddenTones: args.brief.forbiddenTones || undefined,
    seriesMustNotChange: args.brief.mustNotChange || undefined,
    characterBibles: characterBibles.length > 0 ? characterBibles : undefined,
    protocolModules: protocolModules.length > 0 ? protocolModules : undefined,
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
      temperature: 0.55,
      // 8 episodes × ~9 fields × 2–5 sentences is comfortably above the
      // old 4000-token cap. 8000 leaves headroom for the JSON wrapper
      // and avoids mid-string truncation crashes.
      maxTokens: 8000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`Season arc generation failed: ${(err as Error).message}`);
  }

  // Use the shared extractJSON helper. It has a parsePartial fallback
  // that closes dangling strings / arrays so a truncated response
  // still yields a parseable JS object (with whatever episodes did
  // come through). We then pad below to 8.
  let parsed: { episodes?: unknown } = {};
  try {
    parsed = extractJSON<{ episodes?: unknown }>(raw);
  } catch (err) {
    throw new Error(
      `Season arc LLM returned non-JSON output: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  if (!Array.isArray(parsed.episodes)) {
    // Defensive: parsePartial may close the outer object but leave
    // `episodes` half-built as something other than an array. Fall
    // back to an empty list — the pad-to-8 logic below fills the rest.
    parsed = { episodes: [] };
  }

  const fields: Array<keyof RedevSeasonArcEpisode> = [
    "title",
    "theme",
    "protocolModule",
    "characterBreakthrough",
    "characterCollision",
    "mysteryProgression",
    "revelation",
    "cliffhanger",
    "episode1Plant",
  ];
  const episodes: RedevSeasonArcEpisode[] = (parsed.episodes as unknown[]).map(
    (raw, i) => {
      const obj = (raw ?? {}) as Record<string, unknown>;
      const ep = {
        number: typeof obj.number === "number" ? obj.number : i + 1,
      } as RedevSeasonArcEpisode;
      for (const f of fields) {
        const v = obj[f];
        (ep as Record<string, unknown>)[f] =
          typeof v === "string" && v.trim() ? v.trim() : "";
      }
      return ep;
    }
  );
  // Ensure exactly 8, sorted by number, numbered 1..8.
  episodes.sort((a, b) => a.number - b.number);
  while (episodes.length < 8) {
    episodes.push({
      number: episodes.length + 1,
      title: "",
      theme: "",
      protocolModule: "",
      characterBreakthrough: "",
      characterCollision: "",
      mysteryProgression: "",
      revelation: "",
      cliffhanger: "",
      episode1Plant: "",
    });
  }
  if (episodes.length > 8) episodes.length = 8;
  episodes.forEach((e, i) => (e.number = i + 1));

  // Run the Generate → Audit → Repair → Validate pipeline. The R4
  // validators catch: missing required fields, Paul reveal too early,
  // Elena not planted in EP01, Solano-as-fraud framing, vague pilot
  // plants, EP08 not answering architectural questions, approved
  // modules not used. Repairs are surfaced in `audit.repairs`; warnings
  // are surfaced in `audit.checks` for the UI to render.
  const auditResult = auditAndRepairSeasonArc({
    episodes,
    brief: args.brief,
    characterBibles: args.characterBibles,
    protocolModules: args.protocolModules,
  });
  return { episodes: auditResult.episodes, audit: auditResult.audit };
}
