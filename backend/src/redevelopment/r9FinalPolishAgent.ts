// R9 — Final Hook & Emotional Anchor Pass — plan generator (Pass 1 of 2).
//
// R9 is the FINAL automated rewrite pass for Episode 1. It does NOT
// touch R1–R8 architecture and does NOT rewrite the pilot from
// scratch. It reads the R8-promoted Draft 4 and proposes plan-level
// edits across five tightly-scoped lenses:
//
//   1. margot_emotional_anchor — one private, controlled emotional
//      crack tied to the unlabeled file. Behavior, not exposition.
//      No Cass reveal. No grief speech.
//   2. archive_visual_mystery — one stronger visual plant when Solano
//      enters the archive room. No Elena reveal, no sister reveal,
//      no "younger version of someone" clue.
//   3. sound_design — strengthen recurring motifs (recorder click/hum,
//      rain, jungle, howler monkeys, transparent case lock, silence,
//      notification chime).
//   4. pacing_economy — trim or tighten 1-2 pages by reducing repeated
//      behavioral beats (especially canopy / thermal pools / repeated
//      observing gestures). All core plants preserved.
//   5. final_hook_polish — keep the transparent case / Paul phone /
//      chime ending; strengthen with one restrained extra beat (e.g.
//      the chime repeating softly and Paul's fingers moving once,
//      then stopping). No reveal of texting / accident / timestamp /
//      guilt.

import { callLLM, extractJSON } from "../llm/provider.js";
import type {
  AuditReport,
  RedevR6GuardrailsBundle,
  RedevR9FinalPolishCategory,
  RedevR9FinalPolishItem,
  RedevR9FinalPolishSeverity,
  RedevPilotStrategy,
  RedevCharacterBible,
} from "./types.js";
import { auditAndRepairR9FinalPolishPlan } from "./validators.js";

const VALID_CATEGORIES: RedevR9FinalPolishCategory[] = [
  "margot_emotional_anchor",
  "archive_visual_mystery",
  "sound_design",
  "pacing_economy",
  "final_hook_polish",
];

const VALID_SEVERITY: RedevR9FinalPolishSeverity[] = ["high", "medium", "low"];

const SYSTEM_PROMPT = [
  "You are running R9 — the FINAL HOOK & EMOTIONAL ANCHOR PASS — on a",
  "Prestige TV pilot. R1-R8 are LOCKED. R8 has already promoted a polished",
  "draft (Draft 4). Your job is to produce a small, surgical plan that",
  "lands Episode 1 by sharpening five specific things WITHOUT redeveloping",
  "the series, changing episode structure, or rewriting the pilot from",
  "scratch.",
  "",
  "================================================================",
  "INPUTS — locked policy you MUST honor:",
  "================================================================",
  "",
  "  • `promotedPilot.fountain` — the R8-polished EP01 Fountain (Draft 4).",
  "    Read it carefully. Quote short snippets (≤ 200 chars) when",
  "    diagnosing.",
  "  • `r6Guardrails` — per-character protection contracts + global rule.",
  "    R9 must NEVER violate these.",
  "  • `r2CharacterBibles` — public/private identity, core wound,",
  "    avoidance strategy per character. Used for character voice only.",
  "    DO NOT surface wound or hidden truth in dialogue or action lines.",
  "  • `r5Strategy` — pilot strategy (engine, hook, plants).",
  "",
  "================================================================",
  "FIVE LENSES — these are the ONLY categories. Use exact tokens.",
  "================================================================",
  "",
  "  1) margot_emotional_anchor",
  "     Identify ONE place where Margot can have a single private,",
  "     controlled emotional crack tied to the unlabeled file. The",
  "     crack must be filmable: a hand that hesitates over the file's",
  "     edge, fingertips that smooth a corner, breath caught for one",
  "     beat, recorder paused mid-thought, a chair pushed back an inch.",
  "     ABSOLUTELY FORBIDDEN: a Cass reveal (no name, no relation, no",
  "     timeline marker), a grief speech, any dialogue that names the",
  "     loss, any prose that interprets the crack for the audience.",
  "",
  "  2) archive_visual_mystery",
  "     Identify the scene where Solano enters the archive room. Add",
  "     ONE stronger visual plant there. Allowed: a wall of participant",
  "     photos in identical frames; labeled files arranged in a system",
  "     the camera can read; a single removed frame leaving a brighter",
  "     rectangle on the wall; a covered section of shelving with a",
  "     drop cloth; a file stack with one drawer locked. ABSOLUTELY",
  "     FORBIDDEN: Elena reveal in any form (no name, no sister, no",
  "     family connection); any 'this person looks like a younger",
  "     version of X' clue; any dialogue that names what's hidden.",
  "",
  "  3) sound_design",
  "     Strengthen recurring sound motifs across the pilot. Allowed",
  "     palette: recorder click/hum, rain on canvas / canopy / tile,",
  "     jungle ambient, howler monkeys (use sparingly — placement",
  "     matters), transparent case lock click, silence (called out as",
  "     a beat), notification chime. Each item should propose ONE",
  "     additional placement or sharpen an existing one. Do NOT add",
  "     music cues or score directions — sound design is diegetic /",
  "     environmental only.",
  "",
  "  4) pacing_economy",
  "     Identify 1-2 pages of total tightening across the pilot.",
  "     Look for repeated behavioral beats — especially around the",
  "     canopy walk, the thermal pools, and repeated 'X observes Y'",
  "     gestures. Each item proposes a specific cut or condense (e.g.",
  "     'cut the second observation beat in SC07 — the first one in",
  "     SC04 already plants this'). PRESERVE every core character",
  "     plant (Margot's recorder, Nadia scanning, Claire ritual,",
  "     Dean orienting to distress, Paul half-saying things, Solano",
  "     restraint).",
  "",
  "  5) final_hook_polish",
  "     The transparent case / Paul phone / notification chime ending",
  "     STAYS. Add ONE restrained extra beat in the closing block.",
  "     Allowed: the chime repeats softly after the first; Paul's",
  "     fingers move once toward the case and then stop; the case lock",
  "     ticks audibly in the silence; one extra second of phone screen",
  "     glow inside the case. ABSOLUTELY FORBIDDEN: showing the",
  "     message; revealing texting, accident, timestamp, or guilt;",
  "     adding dialogue to the ending; cutting any existing hook beat.",
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
  "  • Do NOT add NEW backstory or NEW exposition.",
  "  • Wounds remain INTERNAL ARCHITECTURE — never explained in",
  "    dialogue or action lines.",
  "  • Do NOT introduce 'showrunner-note prose' (lines that explain",
  "    what the audience should feel — 'the audience feels', 'the",
  "    room knows', 'the body understands', 'the wound is', 'the",
  "    system is running', 'we realize', 'what this means is').",
  "  • Do NOT turn the pilot into therapy drama or thriller.",
  "  • Do NOT redevelop the series, change episode structure, or",
  "    rewrite the pilot from scratch.",
  "  • Margot remains the primary lens.",
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
  "R9 Pass 2 (apply, later) will generate the actual Draft 5 Fountain",
  "text. Your job is to diagnose + direct, not to draft.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT JSON:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. First char `{`, last `}`.",
  "No prose outside. No code fences. No commentary.",
  "",
  "  approachSummary  (string, 1–3 sentences) — overall stance for the",
  "                   final pass. Stay neutral on architecture.",
  "",
  "  items            (array) — one entry per polish item. Each entry:",
  "",
  '    existingSceneOrd  (integer | null) — the ord of the scene in the',
  '                      promoted draft. null = pilot-level (sound motif,',
  '                      closing-block hook polish, etc.).',
  '    existingSlugline  (string, optional) — slug of the existing scene.',
  '    character         (string, optional) — character this targets,',
  '                      when applicable (Margot, Solano, Paul, etc.).',
  '    category          (one of the five locked tokens):',
  "                        margot_emotional_anchor,",
  "                        archive_visual_mystery,",
  "                        sound_design,",
  "                        pacing_economy,",
  "                        final_hook_polish",
  '    diagnosis         (string, 1–2 sentences) — what is currently',
  "                      thin / missing / repeated. Quote briefly when",
  "                      useful.",
  '    fixDirection      (string, 1–3 sentences) — what to do. Filmable',
  "                      direction only: physical action, eye line,",
  "                      silence, timing, object behavior, sound.",
  '    severity          (string, optional) — \"high\" / \"medium\" / \"low\"',
  '    scope             (string, optional) — \"line\" / \"beat\" / \"scene\"',
  '                      / \"ending\" / \"motif\"',
  "",
  "Aim for compact completeness — typically 8-20 items total. Each of",
  "the five categories should appear at least once. The final_hook_polish",
  "category MUST have at least one item.",
].join("\n");

export interface GenerateR9FinalPolishPlanArgs {
  promotedFountain: string;
  promotedScriptId: string;
  promotedDraftNumber?: number | null;
  guardrails: RedevR6GuardrailsBundle;
  characterBibles: RedevCharacterBible[];
  pilotStrategy: RedevPilotStrategy;
  notes?: string;
}

export interface R9FinalPolishPlanGenerationResult {
  approachSummary: string;
  items: RedevR9FinalPolishItem[];
  priorScriptId: string;
  audit: AuditReport;
}

function normalizeItem(raw: unknown): RedevR9FinalPolishItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const category = typeof o.category === "string" ? o.category : "";
  if (!VALID_CATEGORIES.includes(category as RedevR9FinalPolishCategory)) {
    return null;
  }
  const diagnosis = typeof o.diagnosis === "string" ? o.diagnosis.trim() : "";
  const fixDirection =
    typeof o.fixDirection === "string" ? o.fixDirection.trim() : "";
  if (!diagnosis || !fixDirection) return null;
  const severityRaw = typeof o.severity === "string" ? o.severity : "";
  const severity = VALID_SEVERITY.includes(
    severityRaw as RedevR9FinalPolishSeverity
  )
    ? (severityRaw as RedevR9FinalPolishSeverity)
    : undefined;
  const scopeRaw = typeof o.scope === "string" ? o.scope : "";
  const scope: RedevR9FinalPolishItem["scope"] =
    scopeRaw === "line" ||
    scopeRaw === "beat" ||
    scopeRaw === "scene" ||
    scopeRaw === "ending" ||
    scopeRaw === "motif"
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
    category: category as RedevR9FinalPolishCategory,
    diagnosis,
    fixDirection,
    severity,
    scope,
  };
}

export async function generateR9FinalPolishPlan(
  args: GenerateR9FinalPolishPlanArgs
): Promise<R9FinalPolishPlanGenerationResult> {
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
      temperature: 0.35,
      // Tight plan — typically 8-20 items. Match R7 cap.
      maxTokens: 6000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(
      `R9 Final Polish Plan LLM failed: ${(err as Error).message}`
    );
  }

  let parsed: { approachSummary?: unknown; items?: unknown } = {};
  try {
    parsed = extractJSON<{ approachSummary?: unknown; items?: unknown }>(raw);
  } catch (err) {
    throw new Error(
      `R9 Final Polish Plan LLM returned non-JSON: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const approachSummary =
    typeof parsed.approachSummary === "string"
      ? parsed.approachSummary.trim()
      : "";
  const items: RedevR9FinalPolishItem[] = Array.isArray(parsed.items)
    ? (parsed.items as unknown[])
        .map(normalizeItem)
        .filter((i): i is RedevR9FinalPolishItem => i !== null)
    : [];

  const audit = auditAndRepairR9FinalPolishPlan({
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
