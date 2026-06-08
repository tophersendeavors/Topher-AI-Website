// R5 — Pilot Rewrite Strategy Agent.
//
// Reads the approved R1-R4 architecture plus the live EP01 pilot script,
// then produces a strategic plan for rewriting the pilot to match the new
// architecture. Output is nine string-list buckets — not a script. Use the
// strategy to drive R6 (Pilot Rewrite) later.
//
// The agent is grounded in the actual EP01 draft text when one exists, so
// `whatMustChange / whatMustRemain / oldBeatsToRemove` can cite specific
// scenes. If no draft exists, the agent generates principle-level strategy.

import { supabase } from "../db/client.js";
import { callLLM, extractJSON } from "../llm/provider.js";
import { auditAndRepairPilotStrategy } from "./validators.js";
import type {
  AuditReport,
  RedevBrief,
  RedevCharacterBible,
  RedevPilotStrategy,
  RedevProtocolModule,
  RedevSeasonArcEpisode,
} from "./types.js";

const SYSTEM_PROMPT = [
  "You are the showrunner's strategy partner for rewriting the PILOT (Episode 1)",
  "of a Prestige TV series after a redevelopment pass. The series architecture",
  "(R1 brief, R2 character bibles, R3 Protocol modules, R4 season arc) has",
  "been approved. The existing pilot draft was written BEFORE this redevelopment",
  "and now needs to be revised to match the new architecture.",
  "",
  "You are NOT writing screenplay text. You are producing a STRATEGY DOCUMENT",
  "— nine prioritized lists that R6 (the actual pilot rewrite) will execute.",
  "",
  "================================================================",
  "INPUTS (in the user payload):",
  "================================================================",
  "",
  "  • seriesNewCorePrinciple, seriesProtocolPhilosophy, seriesSolanoRule,",
  "    seriesAudiencePromise, seriesForbiddenTones — the show's locked",
  "    architectural commitments. Every recommendation must honor these.",
  "  • characterBibles — approved R2 bibles. Each character's pilot intro",
  "    must read as the START of their season arc, not as a static portrait.",
  "  • protocolModules — approved R3 modules. The pilot must establish HOW",
  "    the Protocol works (the philosophy) without necessarily running a",
  "    full module — usually a fragment, an exercise, or a precept.",
  "  • seasonArc — approved R4 architecture. Look at each episode's",
  "    `episode1Plant` field; those plants are the load-bearing seeds the",
  "    pilot MUST establish for later episodes to pay off.",
  "  • existingPilot — the current EP01 draft. Each scene gives you ord,",
  "    slugline, and (when available) a canonical summary. Use these to",
  "    write CONCRETE recommendations: cite scene ords by name when you",
  "    say what must change, what must remain, what must be removed.",
  "    If `existingPilot.scenes` is empty, the pilot has no current draft",
  "    yet — write principle-level recommendations.",
  "",
  "================================================================",
  "DESIGN PRINCIPLES — every recommendation MUST satisfy:",
  "================================================================",
  "",
  "  • Respect the Solano Rule. The pilot must end with the audience feeling",
  "    that Solano is CERTAIN — not ambiguous, not maybe-a-fraud. The",
  "    danger is truth, not deception.",
  "  • Honor late-season-reveal protections. Paul's texting/reveal arc lands",
  "    around episode 6-7; the pilot may plant unease around Paul but must",
  "    NOT expose the texting reveal.",
  "  • The pilot's role is to make the AudiencePromise legible. By the end",
  "    of EP01 the audience should understand: 'something I don't understand",
  "    yet is real here, and when I understand it everything changes.'",
  "  • Every `episode1Plant` from the season arc must appear somewhere in",
  "    `newSeedsToPlant`. If a plant is already in the current draft, also",
  "    note it under `whatMustRemain` so the rewrite preserves it.",
  "  • Avoid forbidden tones from the brief.",
  "  • Recommendations should be SPECIFIC. 'Strengthen Margot's intro' is",
  "    a vague reaction; 'Margot's intro should reveal she avoids feeling",
  "    through analysis — show her diagnosing the room before she sits' is",
  "    actionable.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have these nine keys, each a STRING ARRAY of 3-8 items.",
  "Each item is 1-3 sentences. Be concrete; cite character names, module",
  "names, and (when grounded in the existing pilot) scene ords by slugline.",
  "",
  "  whatMustChange                — beats/scenes/character moments that",
  "                                  contradict the new architecture and",
  "                                  must be revised.",
  "  whatMustRemain                — beats/scenes the rewrite must KEEP",
  "                                  intact (they already serve the new",
  "                                  architecture or land season seeds).",
  "  newSeedsToPlant               — concrete plants the pilot must add so",
  "                                  later episodes pay off. MUST cover",
  "                                  every `episode1Plant` from the season",
  "                                  arc that isn't already in the draft.",
  "  oldBeatsToRemove              — specific beats currently in the pilot",
  "                                  that should be cut (they belong to the",
  "                                  prior version of the show).",
  "  characterIntroAdjustments     — per-character: how each principal's",
  "                                  pilot introduction must be tuned to",
  "                                  read as the START of their R2 arc.",
  "  protocolPhilosophyMoments     — 2-4 places where the pilot must put",
  "                                  the Protocol philosophy on screen —",
  "                                  a precept, a fragment exercise, or a",
  "                                  moment that lets the audience feel HOW",
  "                                  the Protocol works.",
  "  mysteryPlants                 — pilot-specific plants for the",
  "                                  primary/secondary mysteries from R1.",
  "  characterArcPlants            — pilot-specific plants for each",
  "                                  character's season-revelation arc.",
  "  finalHookOptions              — 2-4 distinct candidate endings for",
  "                                  the pilot, each engineered to make the",
  "                                  audience promise legible and bait EP02.",
  "                                  Number them as 'Option A: …', 'Option B: …'.",
].join("\n");

/** Up to N scenes, summarized for grounding. Heavier than the whole script
 *  but lighter than dumping fountain text. */
const MAX_PILOT_SCENES = 50;

export interface PilotSceneSummary {
  ord: number;
  slugline: string;
  canonicalSummary: string | null;
}

export interface ExistingPilotContext {
  scriptId: string | null;
  draftNumber: number | null;
  scenes: PilotSceneSummary[];
}

/** Load the project's CURRENT pilot script and scene summaries (if any).
 *
 *  Strategy:
 *    1. Find the EP01 episode for the project (lowest `number` >= 1).
 *    2. Find the current script for that episode (`current = true`).
 *    3. Pull scene summaries (ord + slugline + canonical_summary).
 *
 *  Falls back gracefully to an empty `scenes` list if any step has no
 *  data — R5 still runs, just at the principle level. */
export async function loadExistingPilotContext(
  projectId: string
): Promise<ExistingPilotContext> {
  // Step 1: find the lowest-numbered episode for the project.
  const { data: eps } = await supabase
    .from("episodes")
    .select("id, number")
    .eq("project_id", projectId)
    .order("number", { ascending: true })
    .limit(1);
  const ep = eps?.[0];
  if (!ep) {
    return { scriptId: null, draftNumber: null, scenes: [] };
  }

  // Step 2: find the current script for that episode.
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, draft_number, current")
    .eq("project_id", projectId)
    .eq("episode_id", ep.id)
    .eq("current", true)
    .limit(1);
  const script = scripts?.[0];
  if (!script) {
    return { scriptId: null, draftNumber: null, scenes: [] };
  }

  // Step 3: pull scene summaries.
  const { data: rows } = await supabase
    .from("script_scenes")
    .select("ord, slugline, canonical_summary")
    .eq("script_id", script.id)
    .order("ord", { ascending: true })
    .limit(MAX_PILOT_SCENES);
  const scenes: PilotSceneSummary[] = (rows ?? []).map((r) => ({
    ord: (r.ord as number) ?? 0,
    slugline: ((r.slugline as string) ?? "").trim(),
    canonicalSummary:
      typeof r.canonical_summary === "string" && r.canonical_summary.trim()
        ? r.canonical_summary.trim()
        : null,
  }));

  return {
    scriptId: script.id as string,
    draftNumber: (script.draft_number as number) ?? null,
    scenes,
  };
}

export interface GeneratePilotStrategyArgs {
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  seasonArc: RedevSeasonArcEpisode[];
  existingPilot: ExistingPilotContext;
  /** Optional steering for this regen. */
  notes?: string;
}

const STRATEGY_KEYS: Array<keyof RedevPilotStrategy> = [
  "whatMustChange",
  "whatMustRemain",
  "newSeedsToPlant",
  "oldBeatsToRemove",
  "characterIntroAdjustments",
  "protocolPhilosophyMoments",
  "mysteryPlants",
  "characterArcPlants",
  "finalHookOptions",
];

export async function generatePilotStrategy(
  args: GeneratePilotStrategyArgs
): Promise<{
  strategy: Omit<RedevPilotStrategy, "approvedAt">;
  audit: AuditReport;
}> {
  // Only approved bibles + approved modules carry architectural weight.
  const characterBibles = args.characterBibles
    .filter((b) => !!b.approvedAt)
    .map((b) => ({
      name: b.characterName,
      coreWound: b.proposed.coreWound,
      avoidanceStrategy: b.proposed.avoidanceStrategy,
      seasonRevelation: b.proposed.seasonRevelation,
      finalChoice: b.proposed.finalChoice,
    }));
  const protocolModules = args.protocolModules
    .filter((m) => !!m.approvedAt)
    .map((m) => ({
      name: m.name,
      purpose: m.purpose,
      psychologicalTarget: m.psychologicalTarget,
    }));
  const seasonArc = args.seasonArc.map((e) => ({
    number: e.number,
    title: e.title,
    theme: e.theme,
    protocolModule: e.protocolModule,
    episode1Plant: e.episode1Plant,
  }));

  const userPayload: Record<string, unknown> = {
    seriesNewCorePrinciple: args.brief.newCorePrinciple || undefined,
    seriesProtocolPhilosophy: args.brief.protocolPhilosophy || undefined,
    seriesSolanoRule: args.brief.solanoRule || undefined,
    seriesAudiencePromise: args.brief.audiencePromise || undefined,
    seriesPrimaryMystery: args.brief.primaryMystery || undefined,
    seriesSecondaryMystery: args.brief.secondaryMystery || undefined,
    seriesForbiddenTones: args.brief.forbiddenTones || undefined,
    seriesMustNotChange: args.brief.mustNotChange || undefined,
    characterBibles: characterBibles.length > 0 ? characterBibles : undefined,
    protocolModules: protocolModules.length > 0 ? protocolModules : undefined,
    seasonArc: seasonArc.length > 0 ? seasonArc : undefined,
    existingPilot: {
      hasDraft: args.existingPilot.scriptId !== null,
      draftNumber: args.existingPilot.draftNumber ?? undefined,
      scenes:
        args.existingPilot.scenes.length > 0
          ? args.existingPilot.scenes.map((s) => ({
              ord: s.ord,
              slugline: s.slugline,
              summary: s.canonicalSummary ?? undefined,
            }))
          : undefined,
    },
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
      // Nine arrays × 3-8 items × 1-3 sentences is well under 8k. Keeping
      // the cap matches R4 and leaves headroom for the JSON envelope.
      maxTokens: 8000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`Pilot strategy generation failed: ${(err as Error).message}`);
  }

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON<Record<string, unknown>>(raw);
  } catch (err) {
    throw new Error(
      `Pilot strategy LLM returned non-JSON output: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  // Coerce each expected key into a string[] of trimmed non-empty items.
  const strategy: Omit<RedevPilotStrategy, "approvedAt"> = {
    whatMustChange: [],
    whatMustRemain: [],
    newSeedsToPlant: [],
    oldBeatsToRemove: [],
    characterIntroAdjustments: [],
    protocolPhilosophyMoments: [],
    mysteryPlants: [],
    characterArcPlants: [],
    finalHookOptions: [],
  };
  for (const k of STRATEGY_KEYS) {
    const v = parsed[k];
    if (Array.isArray(v)) {
      strategy[k] = v
        .map((x) => (typeof x === "string" ? x.trim() : ""))
        .filter((s) => s.length > 0);
    }
  }

  const audit = auditAndRepairPilotStrategy({
    strategy,
    brief: args.brief,
    characterBibles: args.characterBibles,
    seasonArc: args.seasonArc,
    protocolModules: args.protocolModules.map((m) => ({
      name: m.name,
      approvedAt: m.approvedAt,
    })),
    context: {
      pilotDraftRead: args.existingPilot.scriptId !== null,
      pilotDraftNumber: args.existingPilot.draftNumber,
      pilotSceneCount: args.existingPilot.scenes.length,
    },
  });

  return { strategy, audit };
}
