// R7 Polish Pass — plan generator.
//
// R7 does NOT touch the approved R1-R6 architecture. It diagnoses
// targeted polish opportunities in the PROMOTED EP01 draft so the
// showrunner can review + approve before the polish text is generated
// in a future Pass 2.
//
// Inputs: the promoted EP01 Fountain + approved R5 strategy +
// approved R6 guardrails + approved R6 Pass 1 plan. Output is a
// structured plan only — no screenplay text.

import { callLLM, extractJSON } from "../llm/provider.js";
import type {
  AuditReport,
  RedevR6GuardrailsBundle,
  RedevR6RewriteScenePlan,
  RedevR7PolishCategory,
  RedevR7PolishItem,
  RedevR7PolishSeverity,
  RedevPilotStrategy,
} from "./types.js";
import { auditAndRepairR7PolishPlan } from "./validators.js";

const VALID_CATEGORIES: RedevR7PolishCategory[] = [
  "surrender_continuity",
  "notebook_recorder_object_logic",
  "dialogue_polish",
  "showrunner_note_prose",
  "episode_2_hook",
];

const VALID_SEVERITY: RedevR7PolishSeverity[] = ["high", "medium", "low"];

const SYSTEM_PROMPT = [
  "You are running R7 — the PILOT POLISH PASS — on a Prestige TV pilot.",
  "The series architecture (R1 brief, R2 bibles, R3 modules, R4 arc,",
  "R5 strategy, R6 guardrails, R6 Pass 1 plan, R6 Pass 2 rewrite) is",
  "LOCKED. R6 has already promoted a rewritten pilot to a new draft.",
  "Your job is NOT to redevelop the series and NOT to rewrite the pilot",
  "from scratch. Your job is to DIAGNOSE targeted polish opportunities",
  "in the promoted draft and propose plan-level fixes.",
  "",
  "================================================================",
  "INPUTS — locked policy you MUST honor:",
  "================================================================",
  "",
  "  • `promotedPilot.fountain` — the current EP01 Fountain. Read it",
  "    carefully. Quote brief snippets when diagnosing (1 short line).",
  "  • `r6Guardrails` — per-character protection contracts + global",
  "    rule + global plants. Polish must NEVER violate these.",
  "  • `r6Pass1Plan` — the structural plan that produced the promoted",
  "    draft. Use it as context for understanding scene intent.",
  "  • `r5Strategy` — the pilot strategy (engine, hook, plants).",
  "",
  "================================================================",
  "POLISH SCOPE — five locked categories, NO OTHERS:",
  "================================================================",
  "",
  "  1) surrender_continuity",
  "     Find contradictions where a character has already surrendered",
  "     an item before the PUBLIC SURRENDER SCENE. The public Surrender",
  "     scene must be the FIRST time they give that item up.",
  "     Example: Solano implying Margot already surrendered the",
  "     recorder before the public Surrender scene.",
  "",
  "  2) notebook_recorder_object_logic",
  "     Find places where a character later USES or REACHES FOR an",
  "     item they have already surrendered. After Surrender, those",
  "     items live in the transparent case. The body should reach,",
  "     find them ABSENT, and adjust.",
  "     Example: Margot writing in her notebook in her casita AFTER",
  "     surrendering it.",
  "",
  "  3) dialogue_polish",
  "     Find scenes where conversation is SUMMARIZED in prose rather",
  "     than dramatized. Especially in social scenes (dinner,",
  "     check-in, group). Propose short, character-specific dialogue",
  "     beats. Keep dialogue restrained but real — characters should",
  "     feel alive, not like architecture notes.",
  "",
  "  4) showrunner_note_prose",
  "     Find lines that explain what the audience should FEEL or what",
  "     the architecture MEANS. Examples to flag:",
  "       • 'The system is running.'",
  "       • 'The wound is nowhere in this room.'",
  "       • 'The audience feels…'",
  "       • 'The avoidance strategies run quietly…'",
  "     For each: propose converting to filmable behavior OR cutting.",
  "",
  "  5) episode_2_hook",
  "     The final transparent-case / Paul-chime ending must STAY.",
  "     Find ways to make it slightly more compelling WITHOUT",
  "     revealing accident/texting/guilt truth. Example: Paul's",
  "     phone lights up inside the transparent case — we don't see",
  "     the message. The question we leave on: why did Paul's body",
  "     recognize that sound?",
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
  "  • Wounds are INTERNAL ARCHITECTURE — never explained in dialogue.",
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
  "Pass 2 (later) will generate the actual polished Fountain text.",
  "Your job is to diagnose + direct, not to draft.",
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
  "  approachSummary  (string, 1–3 sentences) — overall polish stance.",
  "                   What's the texture you're sharpening? Stay neutral",
  "                   on architecture; describe touch-up philosophy.",
  "",
  "  items            (array) — one entry per polish item. Each entry:",
  "",
  '    existingSceneOrd  (integer | null) — the ord of the scene in the',
  "                      promoted draft. null = pilot-level item (e.g.",
  "                      hook arc spanning the closing block).",
  '    existingSlugline  (string) — slug of the existing scene (for',
  "                      review readability). Optional.",
  '    category          (one of the five locked tokens):',
  "                        surrender_continuity,",
  "                        notebook_recorder_object_logic,",
  "                        dialogue_polish,",
  "                        showrunner_note_prose,",
  "                        episode_2_hook",
  '    diagnosis         (string, 1–2 sentences) — what is wrong. Quote',
  "                      the offending text in single quotes when useful.",
  '    fixDirection      (string, 1–3 sentences) — what to change. PLAN-',
  "                      LEVEL prose. Behavior, intent, replacement",
  "                      strategy. NOT screenplay text.",
  '    severity          (string, optional) — \"high\" / \"medium\" / \"low\"',
  '    scope             (string, optional) — \"line\" / \"scene\" / \"ending\"',
  "",
  "Aim for completeness over brevity — surface every plausible polish",
  "opportunity within the five categories. The showrunner will edit /",
  "drop items they don't want.",
].join("\n");

export interface GenerateR7PolishPlanArgs {
  /** The promoted EP01 Fountain — the polish base. */
  promotedFountain: string;
  /** The promoted script's id, for plan-time provenance. */
  promotedScriptId: string;
  /** Promoted draft number, for plan-time provenance display. */
  promotedDraftNumber?: number | null;
  guardrails: RedevR6GuardrailsBundle;
  pass1Plan: RedevR6RewriteScenePlan[];
  pilotStrategy: RedevPilotStrategy;
  notes?: string;
}

export interface R7PolishPlanGenerationResult {
  approachSummary: string;
  items: RedevR7PolishItem[];
  priorScriptId: string;
  audit: AuditReport;
}

/** Coerce one raw plan entry to a typed RedevR7PolishItem. */
function normalizeItem(raw: unknown): RedevR7PolishItem | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const category = typeof o.category === "string" ? o.category : "";
  if (!VALID_CATEGORIES.includes(category as RedevR7PolishCategory)) {
    return null;
  }
  const diagnosis = typeof o.diagnosis === "string" ? o.diagnosis.trim() : "";
  const fixDirection =
    typeof o.fixDirection === "string" ? o.fixDirection.trim() : "";
  if (!diagnosis || !fixDirection) return null;
  const severityRaw = typeof o.severity === "string" ? o.severity : "";
  const severity = VALID_SEVERITY.includes(
    severityRaw as RedevR7PolishSeverity
  )
    ? (severityRaw as RedevR7PolishSeverity)
    : undefined;
  const scopeRaw = typeof o.scope === "string" ? o.scope : "";
  const scope: RedevR7PolishItem["scope"] =
    scopeRaw === "line" || scopeRaw === "scene" || scopeRaw === "ending"
      ? scopeRaw
      : undefined;
  return {
    existingSceneOrd:
      typeof o.existingSceneOrd === "number" ? o.existingSceneOrd : null,
    existingSlugline:
      typeof o.existingSlugline === "string" && o.existingSlugline.trim()
        ? o.existingSlugline.trim()
        : undefined,
    category: category as RedevR7PolishCategory,
    diagnosis,
    fixDirection,
    severity,
    scope,
  };
}

export async function generateR7PolishPlan(
  args: GenerateR7PolishPlanArgs
): Promise<R7PolishPlanGenerationResult> {
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
    r6Pass1Plan: args.pass1Plan.map((p) => ({
      existingSceneOrd: p.existingSceneOrd,
      action: p.action,
      slug: p.newSlugline ?? p.existingSlugline,
      changeNotes: p.changeNotes,
      targets: p.targets,
      serves: p.serves,
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
      // Plan only — should be well within 6-8k. Bias slightly higher
      // since a thorough polish pass on a full pilot may yield ~30-60
      // diagnosis items.
      maxTokens: 8000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(
      `R7 Polish Plan LLM failed: ${(err as Error).message}`
    );
  }

  let parsed: { approachSummary?: unknown; items?: unknown } = {};
  try {
    parsed = extractJSON<{ approachSummary?: unknown; items?: unknown }>(raw);
  } catch (err) {
    throw new Error(
      `R7 Polish Plan LLM returned non-JSON: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const approachSummary =
    typeof parsed.approachSummary === "string"
      ? parsed.approachSummary.trim()
      : "";
  const items: RedevR7PolishItem[] = Array.isArray(parsed.items)
    ? (parsed.items as unknown[])
        .map(normalizeItem)
        .filter((i): i is RedevR7PolishItem => i !== null)
    : [];

  const audit = auditAndRepairR7PolishPlan({
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
