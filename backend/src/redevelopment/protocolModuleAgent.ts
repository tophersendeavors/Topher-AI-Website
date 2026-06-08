// R3 — Protocol Module Engine Agent.
//
// Generates one Protocol module's ten-field design from:
//   • the approved R1 Brief (audience promise, core principle,
//     protocol philosophy, Solano rule, forbidden tones, mystery)
//   • the approved R2 character bibles (so the module can be designed
//     to PRESSURE the specific avoidance strategies the writers'
//     room actually committed to — not generic "stress")
//   • the module's name + a 1-line showrunner seed describing the
//     exercise's surface behavior
//
// The result is a structured ten-field module — purpose, psychological
// target, the avoidance behavior the module strips away, the somatic
// exercise, visual execution, dramatic risks, which characters it
// affects most, the truth it pressures, possible episode placement,
// and the module's name.
//
// Like R2, this is a PROPOSED revision — nothing flows into live canon
// until a Phase 3 Promote action. The module sits under
// `redevelopmentPasses[].protocolModules[]`.

import { callLLM } from "../llm/provider.js";
import { randomUUID } from "crypto";
import type {
  AuditReport,
  RedevBrief,
  RedevCharacterBible,
  RedevProtocolModule,
} from "./types.js";

// =============================================================================
// CHARACTER INCLUSION RULES
// =============================================================================
//
// The agent kept writing certain characters into the module body but leaving
// them off `affectedCharacterNames`. This happens most with quiet-avoidance
// characters (Claire's ritualized grief reads as "less verbally active" so
// the LLM forgets to credit her even when the module is built to attack her
// territory).
//
// The rule: if any of a character's `territoryKeywords` appears in the
// module's dramaticRisks / truthPressured / visualExecution / purpose /
// physicalSomaticExercise, that character MUST be in
// `affectedCharacterNames`. Both the system prompt AND a post-generation
// validator enforce this.
//
// To add a new character's rules, append to the array. Keep the keyword
// list specific — common words like "she" or "feels" would over-trigger.
// IMPORTANT: keep this list in sync with the frontend mirror in
// `RedevelopmentPage.tsx` (CHARACTER_INCLUSION_RULES). Both sides need
// to detect the same pattern: server auto-adds, frontend surfaces
// warnings on already-generated modules.

export interface CharacterInclusionRule {
  characterName: string;
  reason: string;
  territoryKeywords: string[];
}

export const CHARACTER_INCLUSION_RULES: CharacterInclusionRule[] = [
  {
    characterName: "Claire Beaumont",
    reason:
      "Claire's avoidance is ritualized grief and Marcus-preservation; she avoids ordinary aliveness because healing feels like betrayal. When a module attacks ritual, physical aliveness, grief maintenance, ordinary pleasure, being witnessed outside grief, usefulness as an exit, or controlled memory, Claire is in the affected set.",
    territoryKeywords: [
      "Claire",
      "Marcus",
      "grief ritual",
      "ritualized grief",
      "ritual",
      "memorializing",
      "memorial",
      "remembering",
      "memory of",
      "preserving the",
      "preservation",
      "aliveness",
      "alive",
      "laughter",
      "laughing",
      "ordinary pleasure",
      "ordinary joy",
      "ordinary life",
      "betrayal of",
      "healing feels",
      "widow",
      "mourning",
      "anniversary",
      "shrine",
      "keepsake",
      "useful",
      "usefulness",
      "purposefulness",
      "caretaking the dead",
      "speaking for someone",
      "speaking on behalf",
    ],
  },
];

/** Case-insensitive substring scan. Returns the list of keywords that
 *  matched anywhere in the supplied haystack (purpose + body fields). */
function matchTriggers(
  haystack: string,
  keywords: string[]
): string[] {
  const lower = haystack.toLowerCase();
  return keywords.filter((kw) => lower.includes(kw.toLowerCase()));
}

/** Run inclusion rules over a generated module. Auto-adds any character
 *  whose territory keywords appear in the module body but who is missing
 *  from `affectedCharacterNames`. Returns the (possibly amended) module
 *  + a list of validator notes for the UI to surface. */
export function enforceCharacterInclusion(
  m: RedevProtocolModule
): { module: RedevProtocolModule; validatorNotes: InclusionNote[] } {
  const haystack = [
    m.purpose,
    m.psychologicalTarget,
    m.avoidanceBehaviorStripped,
    m.physicalSomaticExercise,
    m.visualExecution,
    m.dramaticRisks,
    m.truthPressured,
  ]
    .filter(Boolean)
    .join("\n");

  const existing = new Set(m.affectedCharacterNames.map((n) => n.toLowerCase()));
  const notes: InclusionNote[] = [];
  let amended: string[] = [...m.affectedCharacterNames];

  for (const rule of CHARACTER_INCLUSION_RULES) {
    if (existing.has(rule.characterName.toLowerCase())) continue;
    const hits = matchTriggers(haystack, rule.territoryKeywords);
    if (hits.length === 0) continue;
    // Trigger fired — auto-add.
    amended = [...amended, rule.characterName];
    notes.push({
      type: "auto_included_character",
      characterName: rule.characterName,
      triggeredBy: hits.slice(0, 6),
      reason: rule.reason,
    });
  }

  return {
    module: { ...m, affectedCharacterNames: amended },
    validatorNotes: notes,
  };
}

export interface InclusionNote {
  type: "auto_included_character";
  characterName: string;
  /** The territory keywords that fired the inclusion. Capped at 6 so
   *  the UI hint stays readable. */
  triggeredBy: string[];
  reason: string;
}

const SYSTEM_PROMPT = [
  "You are designing one Protocol module for a Prestige TV series",
  "redevelopment pass. The Protocol is the show's central mechanism for",
  "pressuring truth into characters by stripping away their avoidance",
  "behaviors. You are NOT writing screenplay scenes. You are NOT polishing",
  "a draft. You are designing a single exercise that, when performed in",
  "the show's world, attacks a specific avoidance behavior.",
  "",
  "================================================================",
  "ARCHITECTURE — these fields are sent in the user payload below;",
  "every module you design must serve them:",
  "================================================================",
  "",
  "  • `seriesNewCorePrinciple` — the engine principle.",
  "  • `seriesProtocolPhilosophy` — HOW the engine works mechanically.",
  "    The Protocol attacks the strategy, not the wound. The body reveals",
  "    what the mind avoids. Cliffhangers come from what the exercises",
  "    reveal — not from the exercises themselves.",
  "  • `seriesSolanoRule` — Solano is not a fraud, not a cult leader,",
  "    the Protocol actually works. Never design a module that implies",
  "    deception. The danger is truth, not manipulation.",
  "  • `seriesForbiddenTones` — HARD bans. The Protocol must not feel",
  "    like hypnosis, magic, supernatural, psychedelics every episode,",
  "    or generic therapy. It must feel scientifically plausible,",
  "    emotionally terrifying, visually cinematic.",
  "  • `seriesPrimaryMystery` / `seriesSecondaryMystery` — mysteries the",
  "    season tracks. Modules may seed reveals but never force them too",
  "    early.",
  "  • `characterBibles` — array of the approved R2 character bibles.",
  "    Each has avoidanceStrategy + protocolVulnerability fields. Your",
  "    module must be designed to put pressure on SPECIFIC characters'",
  "    avoidance strategies — name them in affectedCharacterNames.",
  "",
  "================================================================",
  "DESIGN PRINCIPLES — apply to every field:",
  "================================================================",
  "",
  "  • Modules attack BEHAVIORS, not feelings. 'A 48-hour silence",
  "    exercise' is a behavior attack. 'A guided meditation on grief'",
  "    is generic therapy — forbidden.",
  "  • The somatic / physical exercise must be filmable. A director",
  "    can stage it. The audience can see it happen.",
  "  • Visual execution: what does the camera see? Be specific.",
  "    'Six chairs in a circle in a white-walled room, no clock, no",
  "    distractions' is filmable. 'Participants explore their inner",
  "    landscape' is not.",
  "  • Dramatic risks: name what could go wrong inside the exercise",
  "    in a way that the audience would feel — not 'they could get",
  "    upset.'  Specific: 'A guest could break the silence and force",
  "    the group to restart day one. A guest could weaponize the",
  "    pairing to expose another guest. A guest could refuse and the",
  "    Protocol has no enforcement mechanism — they simply lose access",
  "    to the next module.'",
  "  • Truth pressured: the specific kind of truth this module forces",
  "    to the surface (not 'their pain' — be specific to the show:",
  "    'whose love each character has actually been refusing to receive',",
  "    'who has been speaking on someone else's behalf', etc.).",
  "  • Affected characters: name the 2-4 R2 characters whose specific",
  "    avoidance strategy this module most directly attacks. Pull names",
  "    from the characterBibles list — do not invent characters.",
  "  • Episode placement: a phrase, not a number. 'Mid-season once",
  "    trust has fractured', 'Early — before relationships have formed',",
  "    'Late — once silence has already broken at least one guest'.",
  "",
  "================================================================",
  "AVOID — common failure modes:",
  "================================================================",
  "",
  "  • Generic therapy language ('a safe space to share', 'emotional",
  "    release', 'sit with discomfort').",
  "  • Mystical / spiritual framing (chakras, energy, breathwork as",
  "    spiritual, 'unlocking the unconscious').",
  "  • Modules that REQUIRE Solano to manipulate or deceive. The",
  "    Protocol works without trickery. Solano sets the structure;",
  "    the guests' own behavior produces the breakthrough.",
  "  • Resolving a character's arc inside one module. A module ATTACKS",
  "    a strategy; the breakthrough emerges across episodes.",
  "  • Reveals that pre-empt late-season character beats from the R2",
  "    bibles (see `priorityTimingNotes` if present).",
  "",
  "================================================================",
  "CHARACTER INCLUSION RULES — non-negotiable:",
  "================================================================",
  "",
  "Some characters have QUIET avoidance strategies (ritual, withholding,",
  "preservation, restraint). It is easy to write them into the module's",
  "dramatic risks / truth pressured / visual execution body and then",
  "forget to credit them in `affectedCharacterNamesCsv`. Do not do this.",
  "",
  "If you mention ANY of the keywords below in ANY body field, the",
  "associated character MUST appear in your CSV:",
  "",
  ...CHARACTER_INCLUSION_RULES.map((rule) =>
    [
      `  • ${rule.characterName}`,
      `    Reason: ${rule.reason}`,
      `    Keywords (any of these triggers inclusion):`,
      `      ${rule.territoryKeywords.map((k) => `"${k}"`).join(", ")}`,
    ].join("\n")
  ),
  "",
  "Before you respond, RE-READ your dramaticRisks, truthPressured,",
  "visualExecution, purpose, and physicalSomaticExercise. If any of the",
  "keywords above appears, that character is in the CSV. No exceptions.",
  "A post-generation validator will catch and auto-add missing characters,",
  "but you should still get this right at write time.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have these nine string keys:",
  "  purpose                   (2–3 sentences)",
  "  psychologicalTarget       (the specific avoidance type the module attacks)",
  "  avoidanceBehaviorStripped (the BEHAVIOR removed, written as a behavior)",
  "  physicalSomaticExercise   (the staged action — filmable, specific)",
  "  visualExecution           (what the camera sees — production design + blocking)",
  "  dramaticRisks             (what can go wrong in-fiction; specific to the show)",
  "  truthPressured            (the specific kind of truth surfaced)",
  "  possibleEpisodePlacement  (a phrase — early/mid/late + condition)",
  "  affectedCharacterNamesCsv (comma-separated list of 2–4 character names from the bibles)",
  "",
  "Each value is 2–5 sentences (except affectedCharacterNamesCsv which is a CSV).",
  "Specific. Filmable. Anchored to the R1 architecture and the R2 bibles.",
].join("\n");

export interface GenerateProtocolModuleArgs {
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  moduleName: string;
  /** Short showrunner description of the module's surface behavior —
   *  e.g. "48 hours, no talking. Behavior replaces speech." */
  showrunnerSeed?: string;
  /** Optional steering for THIS regeneration. */
  notes?: string;
}

export async function generateProtocolModule(
  args: GenerateProtocolModuleArgs & {
    /** Other modules in the same pass — used by the distinctness check
     *  in the audit pipeline. */
    siblingModules?: RedevProtocolModule[];
  }
): Promise<{
  module: RedevProtocolModule;
  validatorNotes: InclusionNote[];
  audit: AuditReport;
}> {
  // Build a compact summary of each character bible so the agent can
  // anchor the module on the specific avoidance strategies the writers
  // approved — not generic stress.
  const characterBibles = args.characterBibles
    .filter((b) => !!b.approvedAt) // only approved bibles count
    .map((b) => ({
      name: b.characterName,
      avoidanceStrategy: b.proposed.avoidanceStrategy,
      protocolVulnerability: b.proposed.protocolVulnerability,
      coreWound: b.proposed.coreWound,
    }));

  const userPayload: Record<string, unknown> = {
    seriesNewCorePrinciple: args.brief.newCorePrinciple || undefined,
    seriesProtocolPhilosophy: args.brief.protocolPhilosophy || undefined,
    seriesSolanoRule: args.brief.solanoRule || undefined,
    seriesForbiddenTones: args.brief.forbiddenTones || undefined,
    seriesPrimaryMystery: args.brief.primaryMystery || undefined,
    seriesSecondaryMystery: args.brief.secondaryMystery || undefined,
    seriesAudiencePromise: args.brief.audiencePromise || undefined,
    seriesMustNotChange: args.brief.mustNotChange || undefined,
    characterBibles: characterBibles.length > 0 ? characterBibles : undefined,
    moduleName: args.moduleName,
    showrunnerSeed: args.showrunnerSeed || undefined,
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
      maxTokens: 1800,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`Protocol module generation failed: ${(err as Error).message}`);
  }

  let parsed: Record<string, string> = {};
  try {
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Protocol module LLM returned non-JSON output: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  // Split the agent's CSV of character names. Defensively normalize
  // and de-duplicate.
  const csv = typeof parsed.affectedCharacterNamesCsv === "string"
    ? parsed.affectedCharacterNamesCsv
    : "";
  const affectedCharacterNames = Array.from(
    new Set(
      csv
        .split(/[,;\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    )
  );

  const rawModule: RedevProtocolModule = {
    id: randomUUID(),
    name: args.moduleName,
    purpose: typeof parsed.purpose === "string" ? parsed.purpose.trim() : "",
    psychologicalTarget:
      typeof parsed.psychologicalTarget === "string"
        ? parsed.psychologicalTarget.trim()
        : "",
    avoidanceBehaviorStripped:
      typeof parsed.avoidanceBehaviorStripped === "string"
        ? parsed.avoidanceBehaviorStripped.trim()
        : "",
    physicalSomaticExercise:
      typeof parsed.physicalSomaticExercise === "string"
        ? parsed.physicalSomaticExercise.trim()
        : "",
    visualExecution:
      typeof parsed.visualExecution === "string"
        ? parsed.visualExecution.trim()
        : "",
    dramaticRisks:
      typeof parsed.dramaticRisks === "string" ? parsed.dramaticRisks.trim() : "",
    affectedCharacterNames,
    truthPressured:
      typeof parsed.truthPressured === "string"
        ? parsed.truthPressured.trim()
        : "",
    possibleEpisodePlacement:
      typeof parsed.possibleEpisodePlacement === "string"
        ? parsed.possibleEpisodePlacement.trim()
        : "",
    approvedAt: null,
  };

  // Full Generate → Audit → Repair → Validate loop. The audit pipeline:
  //   1. Runs CHARACTER_INCLUSION_RULES (auto-adds missing characters).
  //   2. Rewrites personal-tool leakage as Protocol-issued materials.
  //   3. Flags Solano-as-fraud language, Paul late-reveal leaks,
  //      therapy/mystical drift, direct-wound asks, and module-overlap
  //      with siblings — all as warnings the UI surfaces.
  // The audit report flows back to the client and renders in the
  // "Generation Quality Check" panel on the module card.
  const audit = (await import("./validators.js")).auditAndRepairProtocolModule({
    module: rawModule,
    brief: args.brief,
    characterBibles: args.characterBibles,
    siblingModules: args.siblingModules,
  });
  // Build the legacy validatorNotes payload for any existing UI that
  // still reads it. The audit's character-inclusion repairs are the
  // same data in a different shape — keep both for backward compat.
  const validatorNotes: InclusionNote[] = audit.audit.repairs
    .filter((r) => r.checkId === "r3_character_inclusion")
    .map((r) => {
      // Pull the character name out of the description we wrote above.
      // ("Added <name> to affected characters because the module …")
      const m = r.description.match(/^Added\s+(.+?)\s+to\s+affected/);
      return {
        type: "auto_included_character" as const,
        characterName: m?.[1] ?? "(unknown)",
        triggeredBy: [],
        reason: r.description,
      };
    });
  return {
    module: audit.module,
    validatorNotes,
    audit: audit.audit,
  };
}
