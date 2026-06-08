// R8 — Character Voice & Scene Life Pass — plan generator (Pass 1 of 2).
//
// R8 does NOT touch the approved R1-R7 architecture. It diagnoses
// targeted voice / scene-life opportunities in the promoted R7 draft so
// the showrunner can review + approve before the apply pass (R8 Pass 2)
// generates the polished Fountain text.
//
// Inputs: the promoted R7 draft Fountain + approved R6 guardrails +
// approved R5 strategy. Output is a structured plan only — no screenplay
// text.

import { callLLM, extractJSON } from "../llm/provider.js";
import type {
  AuditReport,
  RedevR6GuardrailsBundle,
  RedevR8VoicePolishCategory,
  RedevR8VoicePolishItem,
  RedevR8VoicePolishSeverity,
  RedevPilotStrategy,
  RedevCharacterBible,
} from "./types.js";
import { auditAndRepairR8VoicePolishPlan } from "./validators.js";

const VALID_CATEGORIES: RedevR8VoicePolishCategory[] = [
  "dialogue_naturalness",
  "character_voice",
  "emotional_tension",
  "scene_rhythm",
  "subtext_moment",
  "behavioral_de_repetition",
];

const VALID_SEVERITY: RedevR8VoicePolishSeverity[] = ["high", "medium", "low"];

const SYSTEM_PROMPT = [
  "You are running R8 — the CHARACTER VOICE & SCENE LIFE PASS — on a",
  "Prestige TV pilot. R1-R7 are LOCKED. R7 has already promoted a polished",
  "pilot to a new draft. Your job is NOT to redevelop the series, NOT to",
  "rewrite the pilot, and NOT to revisit R7 polish areas. Your job is to",
  "DIAGNOSE places where the script feels engineered rather than alive,",
  "and propose voice / life-level fixes.",
  "",
  "================================================================",
  "INPUTS — locked policy you MUST honor:",
  "================================================================",
  "",
  "  • `promotedPilot.fountain` — the current R7-polished EP01 Fountain.",
  "    Read it carefully. Quote short snippets (1 line, ≤ 200 chars)",
  "    when diagnosing.",
  "  • `r6Guardrails` — per-character protection contracts + global rule.",
  "    Voice polish must NEVER violate these.",
  "  • `r2CharacterBibles` — public/private identity, core wound,",
  "    avoidance strategy, hidden truth per character. Use these to",
  "    sharpen character-specific voice. DO NOT surface wound or hidden",
  "    truth in dialogue — they remain INTERNAL ARCHITECTURE.",
  "  • `r5Strategy` — pilot strategy (engine, hook, plants).",
  "",
  "================================================================",
  "POLISH SCOPE — six locked categories, NO OTHERS:",
  "================================================================",
  "",
  "  1) dialogue_naturalness",
  "     Find lines that read theatrical, on-the-nose, or written-feeling.",
  "     Real humans pause mid-thought, change direction, leave sentences",
  "     hanging, say small words ('oh', 'I mean', 'wait'). Propose",
  "     making the line sound like someone actually saying it — not",
  "     reading it. DO NOT add exposition; trim and humanize.",
  "",
  "  2) character_voice",
  "     Find lines that could belong to any character — generic phrasings,",
  "     placeholder reactions. Reference R2 bibles: how does THIS",
  "     character speak, hedge, deflect, commit? Margot analyzes before",
  "     feeling. Dean orients to distress before it shows. Nadia scans.",
  "     Claire ritualizes. Propose voice-marked replacements.",
  "",
  "  3) emotional_tension",
  "     Find scenes where the internal stakes go flat — characters",
  "     responding to information without internal cost, conversations",
  "     that feel transactional. Propose ONE micro-beat per scene: a",
  "     held breath, a look that doesn't land, a withheld response, a",
  "     hand that starts to reach and stops. Camera-visible. No prose",
  "     about what they're feeling.",
  "",
  "  4) scene_rhythm",
  "     Find passages that drag (over-explained, repeated movement) or",
  "     rush (decisions that should land but get steamrolled). Propose",
  "     specific tightenings (cut X lines, condense to Y) or breathing",
  "     room (add one silence beat before Y so Z can land).",
  "",
  "  5) subtext_moment",
  "     Find lines where a character is SAYING what they feel directly.",
  "     Replace the said-feeling with: (a) an action that contradicts",
  "     the words, OR (b) silence that holds the room, OR (c) a line",
  "     about something tangential that lets the audience INFER the",
  "     real feeling. Subtext is what the audience hears that the",
  "     character isn't saying.",
  "",
  "  6) behavioral_de_repetition",
  "     Find the same observation made twice or three times in",
  "     different scenes (e.g. Margot is described as 'analytical' in",
  "     SC03, SC07, and SC11). Pick the strongest instance, propose",
  "     the others be cut or condensed. Repetition flattens character.",
  "",
  "================================================================",
  "ABSOLUTE PROTECTIONS — non-negotiable:",
  "================================================================",
  "",
  "  • Do NOT reveal Paul's texting / accident responsibility /",
  "    timestamp evidence / guilt.",
  "  • Do NOT reveal that Elena is Nadia's sister.",
  "  • Do NOT frame Solano as fraud / cult / con / liar / manipulator.",
  "  • Do NOT remove Surrender as the pilot engine.",
  "  • Do NOT remove the final transparent-case / Paul chime hook.",
  "  • Do NOT introduce flashbacks, confession circles, or therapy",
  "    exposition.",
  "  • Do NOT add NEW backstory or NEW exposition. Voice polish never",
  "    adds new information — it sharpens what's already on the page.",
  "  • Wounds remain INTERNAL ARCHITECTURE — never explained in dialogue.",
  "  • Do NOT introduce 'showrunner-note prose' (lines that explain what",
  "    the audience should feel — 'the audience feels', 'the room knows',",
  "    'the body understands', 'the wound is', 'the system is running').",
  "  • Do NOT turn the pilot into therapy drama or thriller.",
  "",
  "================================================================",
  "PLAN-LEVEL ONLY — NO SCREENPLAY TEXT:",
  "================================================================",
  "",
  "Output structured prose direction only. Do NOT write:",
  "  • Scene headings (INT./EXT., FADE IN, etc.)",
  "  • Dialogue between actual characters in screenplay form",
  "  • Action paragraphs in screenplay form",
  "  • Parentheticals",
  "",
  "R8 Pass 2 (apply, later) will generate the actual polished Fountain",
  "text. Your job is to diagnose + direct, not to draft.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT JSON:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. First char `{`, last `}`.",
  "No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have two keys:",
  "",
  "  approachSummary  (string, 1–3 sentences) — overall voice/life stance.",
  "                   What's the texture you're sharpening? Stay neutral",
  "                   on architecture; describe voice/life philosophy.",
  "",
  "  items            (array) — one entry per voice item. Each entry:",
  "",
  '    existingSceneOrd  (integer | null) — the ord of the scene in the',
  "                      promoted draft. null = pilot-level item (e.g. a",
  "                      cross-scene rhythm note).",
  '    existingSlugline  (string, optional) — slug of the existing scene',
  "                      (for review readability).",
  '    character         (string, optional) — character this targets',
  '                      (free text — Margot, Dean, Nadia, Claire, Paul,',
  '                      Solano, or "ensemble").',
  '    category          (one of the six locked tokens):',
  "                        dialogue_naturalness,",
  "                        character_voice,",
  "                        emotional_tension,",
  "                        scene_rhythm,",
  "                        subtext_moment,",
  "                        behavioral_de_repetition",
  '    diagnosis         (string, 1–2 sentences) — what is wrong. Quote',
  "                      the offending text briefly when useful.",
  '    fixDirection      (string, 1–3 sentences) — what to change. PLAN-',
  "                      LEVEL prose. Behavior, intent, replacement",
  "                      strategy. NOT screenplay text.",
  '    severity          (string, optional) — \"high\" / \"medium\" / \"low\"',
  '    scope             (string, optional) — \"line\" / \"beat\" / \"scene\"',
  "",
  "Aim for completeness — surface every plausible voice/life opportunity",
  "within the six categories. The showrunner will edit / drop items.",
].join("\n");

export interface GenerateR8VoicePolishPlanArgs {
  /** The promoted R7 EP01 Fountain — the voice-polish base. */
  promotedFountain: string;
  /** The promoted script's id, for plan-time provenance. */
  promotedScriptId: string;
  /** Promoted draft number, for plan-time provenance display. */
  promotedDraftNumber?: number | null;
  guardrails: RedevR6GuardrailsBundle;
  characterBibles: RedevCharacterBible[];
  pilotStrategy: RedevPilotStrategy;
  notes?: string;
}

export interface R8VoicePolishPlanGenerationResult {
  approachSummary: string;
  items: RedevR8VoicePolishItem[];
  priorScriptId: string;
  audit: AuditReport;
}

/** Coerce one raw plan entry to a typed RedevR8VoicePolishItem. */
function normalizeItem(raw: unknown): RedevR8VoicePolishItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const category = typeof o.category === "string" ? o.category : "";
  if (!VALID_CATEGORIES.includes(category as RedevR8VoicePolishCategory)) {
    return null;
  }
  const diagnosis = typeof o.diagnosis === "string" ? o.diagnosis.trim() : "";
  const fixDirection =
    typeof o.fixDirection === "string" ? o.fixDirection.trim() : "";
  if (!diagnosis || !fixDirection) return null;
  const severityRaw = typeof o.severity === "string" ? o.severity : "";
  const severity = VALID_SEVERITY.includes(
    severityRaw as RedevR8VoicePolishSeverity
  )
    ? (severityRaw as RedevR8VoicePolishSeverity)
    : undefined;
  const scopeRaw = typeof o.scope === "string" ? o.scope : "";
  const scope: RedevR8VoicePolishItem["scope"] =
    scopeRaw === "line" || scopeRaw === "beat" || scopeRaw === "scene"
      ? scopeRaw
      : undefined;
  const character =
    typeof o.character === "string" && o.character.trim()
      ? o.character.trim()
      : undefined;
  return {
    existingSceneOrd:
      typeof o.existingSceneOrd === "number" ? o.existingSceneOrd : null,
    existingSlugline:
      typeof o.existingSlugline === "string" && o.existingSlugline.trim()
        ? o.existingSlugline.trim()
        : undefined,
    character,
    category: category as RedevR8VoicePolishCategory,
    diagnosis,
    fixDirection,
    severity,
    scope,
  };
}

export async function generateR8VoicePolishPlan(
  args: GenerateR8VoicePolishPlanArgs
): Promise<R8VoicePolishPlanGenerationResult> {
  const userPayload: Record<string, unknown> = {
    promotedPilot: {
      scriptId: args.promotedScriptId,
      draftNumber: args.promotedDraftNumber ?? undefined,
      fountain: args.promotedFountain,
    },
    r6Guardrails: {
      globalRule: args.guardrails.globalRule,
      globalPlants: args.guardrails.globalPlants ?? [],
      perCharacter: args.guardrails.perCharacter,
    },
    r2CharacterBibles: args.characterBibles
      .filter((b) => !!b.approvedAt)
      .map((b) => ({
        characterName: b.characterName,
        publicIdentity: b.proposed.publicIdentity,
        privateIdentity: b.proposed.privateIdentity,
        coreWound: b.proposed.coreWound,
        avoidanceStrategy: b.proposed.avoidanceStrategy,
      })),
    r5Strategy: {
      whatMustRemain: args.pilotStrategy.whatMustRemain,
      protocolPhilosophyMoments: args.pilotStrategy.protocolPhilosophyMoments,
      finalHookOptions: args.pilotStrategy.finalHookOptions,
    },
    writerSteeringForThisRegen: args.notes?.trim() || undefined,
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
      temperature: 0.4,
      // Voice/life passes can produce ~40-80 plan items across six
      // categories on a full pilot. Cap matches R7 generosity.
      maxTokens: 8000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(
      `R8 Voice Polish Plan LLM failed: ${(err as Error).message}`
    );
  }

  let parsed: { approachSummary?: unknown; items?: unknown } = {};
  try {
    parsed = extractJSON<{ approachSummary?: unknown; items?: unknown }>(raw);
  } catch (err) {
    throw new Error(
      `R8 Voice Polish Plan LLM returned non-JSON: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const approachSummary =
    typeof parsed.approachSummary === "string"
      ? parsed.approachSummary.trim()
      : "";
  const items: RedevR8VoicePolishItem[] = Array.isArray(parsed.items)
    ? (parsed.items as unknown[])
        .map(normalizeItem)
        .filter((i): i is RedevR8VoicePolishItem => i !== null)
    : [];

  const audit = auditAndRepairR8VoicePolishPlan({
    items,
    approachSummary,
  });

  return {
    approachSummary,
    items,
    priorScriptId: args.promotedScriptId,
    audit,
  };
}
