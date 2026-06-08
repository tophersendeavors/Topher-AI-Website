// R6 Pass 1 — Pilot Rewrite Plan Generator.
//
// Reads the existing EP01 draft + approved R1-R5 architecture + R6
// guardrails and produces a structured scene-by-scene rewrite PLAN.
// The plan is NOT screenplay text; it's a list of scene-level decisions
// (keep / revise / move / merge / cut / add) with change notes and the
// architectural targets each scene serves.
//
// Pass 2 (not yet built) will execute the approved plan by generating
// Fountain text for revise/add scenes; keep/move scenes copy verbatim.

import { callLLM, extractJSON } from "../llm/provider.js";
import {
  loadExistingPilotContext,
  type ExistingPilotContext,
} from "./pilotStrategyAgent.js";
import { auditAndRepairR6RewritePlan } from "./validators.js";
import { normalizeR6Guardrails } from "./types.js";
import type {
  AuditReport,
  RedevBrief,
  RedevCharacterBible,
  RedevPilotStrategy,
  RedevProtocolModule,
  RedevR6GuardrailsBundle,
  RedevR6Guardrail,
  RedevR6RewriteAction,
  RedevR6RewriteScenePlan,
  RedevR6RewriteTarget,
  RedevSeasonArcEpisode,
} from "./types.js";

const VALID_ACTIONS: RedevR6RewriteAction[] = [
  "keep",
  "revise",
  "move",
  "merge",
  "cut",
  "add",
];

const VALID_TARGETS: RedevR6RewriteTarget[] = [
  "surrender_execution",
  "nadia_elena_plant",
  "paul_phone_driving_plant",
  "margot_professional_structure",
  "claire_ritualized_grief",
  "dean_usefulness",
  "solano_certainty",
  "archive_room",
  "photograph_wall",
  "final_blended_hook",
];

const SYSTEM_PROMPT = [
  "You are producing PASS 1 of a two-pass pilot rewrite for a Prestige TV",
  "series. PASS 1 is a STRUCTURAL PLAN — a scene-by-scene list of decisions.",
  "PASS 2 (later) will execute your approved plan by generating actual",
  "screenplay text. Your job is NOT to write screenplay text. Your job is",
  "to decide what happens to every scene in the pilot.",
  "",
  "================================================================",
  "INPUTS (in the user payload):",
  "================================================================",
  "",
  "  • `existingPilot.scenes` — current EP01 scene-by-scene with ord +",
  "    slugline + summary. Every existing scene needs a decision.",
  "  • `r5Strategy` — approved Pilot Strategy: what must change, what",
  "    must remain, new seeds to plant, old beats to remove, final hook",
  "    options. Treat this as locked policy.",
  "  • `r6Guardrails` — approved R6 protection contracts: per-character",
  "    plants / do-NOT-reveal / do-NOT-do / execution rule, plus the",
  "    global rewrite rule and Global Plants. ABSOLUTELY MANDATORY.",
  "  • `seriesArchitecture` — R1 principles, R2 bibles, R3 protocol",
  "    modules, R4 season arc. Use as context; do not contradict.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT JSON:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have two keys:",
  "",
  "  approachSummary  (string, 1–3 sentences) — the overall philosophy",
  "                   of the rewrite, citing the engine and the hook.",
  "",
  "  plan             (array) — one entry per scene decision, ORDER MATTERS.",
  "                   Each entry has these fields:",
  "",
  '    existingSceneOrd  (integer | null) — ord from existingPilot.scenes,',
  '                      or null when action is "add".',
  '    action            ("keep" | "revise" | "move" | "merge" | "cut" |',
  '                       "add")',
  "    newSlugline       (string) — required for revise/add; the new",
  "                      slug after revision or for the inserted scene.",
  "    insertAfterOrd    (integer) — required for add/move; the ord this",
  "                      scene anchors after in the new pilot.",
  "    mergeIntoOrd      (integer) — required for merge; the ord this",
  "                      scene merges into.",
  "    changeNotes       (string, 1–3 sentences) — what specifically",
  "                      changes about this scene in the new version,",
  "                      in showrunner language. NOT screenplay text.",
  "    targets           (string[]) — ARCHITECTURAL TARGETS this scene",
  "                      serves. Use only these tokens:",
  "                        surrender_execution,",
  "                        nadia_elena_plant,",
  "                        paul_phone_driving_plant,",
  "                        margot_professional_structure,",
  "                        claire_ritualized_grief,",
  "                        dean_usefulness,",
  "                        solano_certainty,",
  "                        archive_room,",
  "                        photograph_wall,",
  "                        final_blended_hook",
  "    serves            (string[]) — character names from R2 (full",
  "                      names; e.g. \"Paul Beaumont\") whose contract",
  "                      this scene primarily honors.",
  "    satisfiesPlants   (string[]) — Global Plants this scene lands",
  "                      (quote the relevant Global Plant text).",
  "",
  "================================================================",
  "DESIGN PRINCIPLES — apply when choosing actions:",
  "================================================================",
  "",
  "  • EVERY existing scene MUST appear in the plan exactly once. Use",
  "    `cut` if it should not be in the new version.",
  "  • Use `revise` when the scene's place in the pilot stays but its",
  "    content must change (new plants, new framing, new execution).",
  "  • Use `move` when the scene's content stays but its position shifts.",
  "  • Use `merge` when two scenes' beats consolidate into one.",
  "  • Use `add` SPARINGLY — only when an R5 plant or R6 architectural",
  "    target has no existing scene that can carry it.",
  "  • Every ARCHITECTURAL TARGET listed above MUST appear in the",
  "    `targets` array of at least ONE scene. The audit will fail if a",
  "    target has no scene serving it.",
  "  • The pilot must END on the final_blended_hook target (Option A +",
  "    Option C blended: bodies after Surrender → transparent case →",
  "    Paul's body responding to the notification chime).",
  "  • The PROTOCOL DRIVER for the pilot is SURRENDER. Make sure",
  "    surrender_execution appears in at least one scene's targets.",
  "",
  "================================================================",
  "PROTECTIONS — absolute, non-negotiable:",
  "================================================================",
  "",
  "  • Paul's late-season reveal (texting, accident responsibility,",
  "    timestamp evidence, Paul's guilt) MUST NOT appear in any scene.",
  "    Plant unease only.",
  "  • Elena is Nadia's sister — do NOT reveal the sister relationship",
  "    in the pilot. Plant Elena as absence / object / fact only.",
  "  • Solano is NOT a fraud, liar, or manipulator. Frame her as",
  "    UNSETTLINGLY CERTAIN.",
  "  • No flashbacks, no confession circles, no therapy exposition, no",
  "    cheap thriller twist.",
  "  • Wounds are INTERNAL ARCHITECTURE — never explained in the pilot.",
  "    Plant avoidance behaviors only.",
  "",
  "================================================================",
  "AVOID:",
  "================================================================",
  "",
  "  • Screenplay-style text in changeNotes. No FADE IN, INT./EXT.,",
  "    parentheticals, or character dialogue. Plan-level prose only.",
  "  • Skipping an existing scene's decision. Every scene needs an entry.",
  "  • Using `targets` tokens not in the canonical list above.",
].join("\n");

interface AgentInputs {
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  seasonArc: RedevSeasonArcEpisode[];
  pilotStrategy: RedevPilotStrategy;
  guardrails: RedevR6GuardrailsBundle;
  existingPilot: ExistingPilotContext;
}

function buildUserPayload(args: AgentInputs): Record<string, unknown> {
  const approvedBibles = args.characterBibles
    .filter((b) => !!b.approvedAt)
    .map((b) => ({
      name: b.characterName,
      coreWound: b.proposed.coreWound,
      avoidanceStrategy: b.proposed.avoidanceStrategy,
      seasonRevelation: b.proposed.seasonRevelation,
    }));
  const approvedModules = args.protocolModules
    .filter((m) => !!m.approvedAt)
    .map((m) => ({
      name: m.name,
      purpose: m.purpose,
      truthPressured: m.truthPressured,
    }));

  const payload: Record<string, unknown> = {
    seriesArchitecture: {
      corePrinciple: args.brief.newCorePrinciple || undefined,
      protocolPhilosophy: args.brief.protocolPhilosophy || undefined,
      solanoRule: args.brief.solanoRule || undefined,
      audiencePromise: args.brief.audiencePromise || undefined,
      forbiddenTones: args.brief.forbiddenTones || undefined,
      seasonQuestion: args.brief.newSeasonQuestion || undefined,
      characterBibles: approvedBibles.length > 0 ? approvedBibles : undefined,
      protocolModules: approvedModules.length > 0 ? approvedModules : undefined,
      seasonArcEp1Plants: args.seasonArc.map((e) => ({
        episode: e.number,
        plant: e.episode1Plant,
      })),
    },
    r5Strategy: {
      whatMustChange: args.pilotStrategy.whatMustChange,
      whatMustRemain: args.pilotStrategy.whatMustRemain,
      newSeedsToPlant: args.pilotStrategy.newSeedsToPlant,
      oldBeatsToRemove: args.pilotStrategy.oldBeatsToRemove,
      characterIntroAdjustments: args.pilotStrategy.characterIntroAdjustments,
      protocolPhilosophyMoments: args.pilotStrategy.protocolPhilosophyMoments,
      mysteryPlants: args.pilotStrategy.mysteryPlants,
      characterArcPlants: args.pilotStrategy.characterArcPlants,
      finalHookOptions: args.pilotStrategy.finalHookOptions,
    },
    r6Guardrails: {
      globalRule: args.guardrails.globalRule,
      globalPlants: args.guardrails.globalPlants ?? [],
      perCharacter: args.guardrails.perCharacter,
    },
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
  };
  return payload;
}

/** Coerce one raw plan entry (from the LLM) into our typed shape with
 *  defensive defaults so a malformed entry doesn't crash the pipeline. */
function normalizePlanEntry(raw: unknown): RedevR6RewriteScenePlan | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const actionRaw = typeof o.action === "string" ? o.action.toLowerCase() : "";
  if (!VALID_ACTIONS.includes(actionRaw as RedevR6RewriteAction)) {
    return null;
  }
  const targets = Array.isArray(o.targets)
    ? (o.targets as unknown[])
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter((t): t is RedevR6RewriteTarget =>
          VALID_TARGETS.includes(t as RedevR6RewriteTarget)
        )
    : undefined;
  const serves = Array.isArray(o.serves)
    ? (o.serves as unknown[])
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    : undefined;
  const satisfiesPlants = Array.isArray(o.satisfiesPlants)
    ? (o.satisfiesPlants as unknown[])
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter((s) => s.length > 0)
    : undefined;

  return {
    existingSceneOrd:
      typeof o.existingSceneOrd === "number" ? o.existingSceneOrd : null,
    existingSlugline:
      typeof o.existingSlugline === "string" ? o.existingSlugline : undefined,
    action: actionRaw as RedevR6RewriteAction,
    newSlugline:
      typeof o.newSlugline === "string" && o.newSlugline.trim()
        ? o.newSlugline.trim()
        : undefined,
    insertAfterOrd:
      typeof o.insertAfterOrd === "number" ? o.insertAfterOrd : undefined,
    mergeIntoOrd:
      typeof o.mergeIntoOrd === "number" ? o.mergeIntoOrd : undefined,
    changeNotes:
      typeof o.changeNotes === "string" ? o.changeNotes.trim() : "",
    targets,
    serves,
    satisfiesPlants,
  };
}

export interface GenerateR6RewritePlanArgs {
  projectId: string;
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  seasonArc: RedevSeasonArcEpisode[];
  pilotStrategy: RedevPilotStrategy;
  guardrails: RedevR6GuardrailsBundle;
  /** Optional steering note for this regenerate. */
  notes?: string;
}

export async function generateR6RewritePlan(
  args: GenerateR6RewritePlanArgs
): Promise<{
  plan: RedevR6RewriteScenePlan[];
  approachSummary: string;
  priorScriptId: string | null;
  audit: AuditReport;
}> {
  const existingPilot = await loadExistingPilotContext(args.projectId);

  const userPayload = buildUserPayload({
    brief: args.brief,
    characterBibles: args.characterBibles,
    protocolModules: args.protocolModules,
    seasonArc: args.seasonArc,
    pilotStrategy: args.pilotStrategy,
    guardrails: args.guardrails,
    existingPilot,
  });
  if (args.notes?.trim()) {
    (userPayload as Record<string, unknown>).writerSteeringForThisRegen =
      args.notes.trim();
  }

  let raw = "";
  try {
    const res = await callLLM({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
      ],
      temperature: 0.45,
      maxTokens: 8000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(
      `R6 rewrite plan generation failed: ${(err as Error).message}`
    );
  }

  let parsed: { plan?: unknown; approachSummary?: unknown } = {};
  try {
    parsed = extractJSON<{ plan?: unknown; approachSummary?: unknown }>(raw);
  } catch (err) {
    throw new Error(
      `R6 rewrite plan LLM returned non-JSON output: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const plan: RedevR6RewriteScenePlan[] = Array.isArray(parsed.plan)
    ? (parsed.plan as unknown[])
        .map(normalizePlanEntry)
        .filter((p): p is RedevR6RewriteScenePlan => p !== null)
    : [];
  const approachSummary =
    typeof parsed.approachSummary === "string"
      ? parsed.approachSummary.trim()
      : "";

  const audit = auditAndRepairR6RewritePlan({
    plan,
    approachSummary,
    existingScenes: existingPilot.scenes,
    guardrails: args.guardrails,
  });

  return {
    plan,
    approachSummary,
    priorScriptId: existingPilot.scriptId,
    audit,
  };
}

// Re-export so the validator can stay in one file (validators.ts) but
// agent callers don't need to know which file owns it.
export type { RedevR6Guardrail };
void normalizeR6Guardrails;
