// R6 Pass 2 — Scene Text Generator + Compiler.
//
// Reads the APPROVED Pass 1 plan + existing EP01 fountain + approved
// R1-R6 architecture and produces the rewritten pilot as Fountain.
//
// Strategy:
//   • KEEP / MOVE — copy the existing scene's fountain verbatim.
//   • REVISE / ADD / MERGE — single LLM call generates fountain for
//     all these scenes in one structured JSON response, keyed by
//     plan index. Each scene is constrained by its plan entry
//     (action + changeNotes + targets + serves) plus the R5 strategy +
//     R6 guardrails the agent must honor.
//   • CUT — skipped.
//
// Output order = plan order (the plan already represents the new
// pilot's scene order; MOVE actions are already in their new position).
//
// The compiled draft is NOT promoted to a real EP01 draft here — that's
// an explicit approve step (`promoteR6Rewrite` in store.ts).

import { supabase } from "../db/client.js";
import { callLLM, extractJSON } from "../llm/provider.js";
import type {
  RedevBrief,
  RedevCharacterBible,
  RedevPilotStrategy,
  RedevProtocolModule,
  RedevR6GuardrailsBundle,
  RedevR6RewriteScenePlan,
  RedevSeasonArcEpisode,
} from "./types.js";

const SYSTEM_PROMPT = [
  "You are PASS 2 of a controlled pilot rewrite. PASS 1 produced an",
  "APPROVED scene-by-scene plan. Your job is to generate the FOUNTAIN",
  "TEXT for every scene the plan marks as REVISE, ADD, or MERGE. KEEP",
  "and MOVE scenes are copied verbatim by the orchestrator — you do not",
  "rewrite them. CUT scenes are dropped — you do not write them.",
  "",
  "================================================================",
  "INPUTS — locked policy you MUST honor:",
  "================================================================",
  "",
  "  • `plan` — the approved Pass 1 plan. Each entry has a planIndex,",
  "    action, slug, changeNotes, targets, serves, and (for revise/move/",
  "    merge) the existing scene's fountain you should ground in.",
  "  • `r5Strategy` — approved Pilot Strategy. What must change, what",
  "    must remain, plants, removes, hook direction.",
  "  • `r6Guardrails.perCharacter` — per-character protection contract:",
  "    plant THESE behaviors; never reveal in `doNotReveal`; never do in",
  "    `doNotDo`; honor `executionRule`.",
  "  • `r6Guardrails.globalRule` — whole-pilot rewrite rule.",
  "  • `r6Guardrails.globalPlants` — pilot-level concrete plants.",
  "  • `seriesArchitecture` — R1 brief, R2 bibles, R3 modules, R4 arc.",
  "    Context only — do not contradict.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT JSON:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have one key: `scenes` — an array of entries, one",
  "per plan entry whose action is `revise`, `add`, or `merge`. Each",
  "entry has:",
  "",
  '  planIndex   (integer) — exact index from the plan array.',
  '  fountain    (string)  — the scene\'s FULL Fountain text. Begin',
  "                          with the scene heading (INT./EXT. LOCATION -",
  "                          TIME), then action lines, then dialogue.",
  "                          Use proper Fountain formatting.",
  "",
  "================================================================",
  "ABSOLUTE PROTECTIONS — non-negotiable:",
  "================================================================",
  "",
  "  • Paul's late-season reveal (texting, accident responsibility,",
  "    timestamp evidence, Paul's guilt) MUST NOT appear in any scene.",
  "    Plant unease only — phone, notification chime body response,",
  "    driving avoidance, hands always doing something for someone",
  "    else, caretaking as motion.",
  "  • Elena is Nadia's sister — do NOT reveal the relationship. Plant",
  "    Elena as ABSENCE / OBJECT / FACT only. Do not have any character",
  "    explicitly name the relationship.",
  "  • Solano is NOT a fraud, liar, cult leader, or manipulator. Frame",
  "    her as UNSETTLINGLY CERTAIN. The Protocol works.",
  "  • No flashbacks. No confession circles. No therapy exposition.",
  "    No cheap thriller twist.",
  "  • Wounds are INTERNAL ARCHITECTURE — never explained in dialogue.",
  "    Plant AVOIDANCE BEHAVIORS only.",
  "",
  "================================================================",
  "EXECUTION PRINCIPLES:",
  "================================================================",
  "",
  "  • For REVISE: ground in the existing scene's fountain, then apply",
  "    the plan's changeNotes. Keep what works; change what the plan",
  "    says to change. The scene should land its `targets` (e.g.",
  "    surrender_execution, paul_phone_driving_plant) through behavior.",
  "  • For ADD: write a NEW scene that lands the architectural targets",
  "    the plan declared. Be specific and filmable.",
  "  • For MERGE: combine the merged scenes' content into one scene.",
  "    The plan tells you which scene this merges INTO (mergeIntoOrd) —",
  "    output the combined content under THIS planIndex; the orchestrator",
  "    will route output correctly.",
  "  • Plant avoidance behaviors visibly. Surrendered objects in the",
  "    transparent case. Empty hands. Aborted reaches. Body responses.",
  "  • Solano speaks declaratively, not interpretively. She does not",
  "    explain the Protocol — she runs it.",
  "  • End the pilot on the FINAL BLENDED HOOK: bodies after Surrender,",
  "    then the transparent case, then Paul's body responding to the",
  "    notification chime. Only the LAST scene carries this beat.",
].join("\n");

async function loadSceneFountainByOrd(
  scriptId: string
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!scriptId) return out;
  const { data } = await supabase
    .from("script_scenes")
    .select("ord, fountain")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  for (const r of data ?? []) {
    const ord = r.ord as number;
    const fountain = (r.fountain as string) ?? "";
    if (typeof ord === "number" && fountain) out.set(ord, fountain);
  }
  return out;
}

export interface GenerateR6Pass2Args {
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  seasonArc: RedevSeasonArcEpisode[];
  pilotStrategy: RedevPilotStrategy;
  guardrails: RedevR6GuardrailsBundle;
  plan: RedevR6RewriteScenePlan[];
  /** ID of the existing EP01 script — used to copy KEEP/MOVE scenes
   *  verbatim and to ground REVISE prompts. */
  priorScriptId: string;
  /** Optional steering note. */
  notes?: string;
}

export interface R6Pass2Result {
  /** Compiled Fountain document for the rewritten pilot. */
  compiledFountain: string;
  /** Per-action counts for the UI summary. */
  sceneActionSummary: {
    kept: number;
    revised: number;
    moved: number;
    merged: number;
    cut: number;
    added: number;
  };
  /** Plan indices the LLM was asked to generate (revise/add/merge). */
  generatedPlanIndices: number[];
  /** Plan indices the LLM actually returned. */
  returnedPlanIndices: number[];
  /** Plan indices for which the LLM produced nothing (missing). */
  missingPlanIndices: number[];
}

export async function generateR6Pass2(
  args: GenerateR6Pass2Args
): Promise<R6Pass2Result> {
  // Load existing scene fountain (keyed by ord) for KEEP/MOVE copy and
  // for grounding REVISE prompts.
  const sceneFountain = await loadSceneFountainByOrd(args.priorScriptId);

  // Build the list of plan entries the LLM has to generate text for.
  const generatedPlanIndices: number[] = [];
  const llmInputScenes: Array<{
    planIndex: number;
    action: string;
    newSlug?: string;
    existingSlug?: string;
    insertAfterOrd?: number;
    mergeIntoOrd?: number;
    changeNotes: string;
    targets?: string[];
    serves?: string[];
    existingFountain?: string;
    mergeFromFountain?: string;
  }> = [];
  args.plan.forEach((p, i) => {
    if (p.action === "revise" || p.action === "add" || p.action === "merge") {
      generatedPlanIndices.push(i);
      const existingFountain =
        p.existingSceneOrd != null
          ? sceneFountain.get(p.existingSceneOrd)
          : undefined;
      const mergeFromFountain =
        p.action === "merge" && p.mergeIntoOrd != null
          ? sceneFountain.get(p.mergeIntoOrd)
          : undefined;
      llmInputScenes.push({
        planIndex: i,
        action: p.action,
        newSlug: p.newSlugline,
        existingSlug: p.existingSlugline,
        insertAfterOrd: p.insertAfterOrd,
        mergeIntoOrd: p.mergeIntoOrd,
        changeNotes: p.changeNotes,
        targets: p.targets,
        serves: p.serves,
        existingFountain,
        mergeFromFountain,
      });
    }
  });

  // If there's nothing to generate, skip the LLM call entirely (rare —
  // a plan that's all KEEPs has nothing to rewrite, but possible).
  let returned: Array<{ planIndex: number; fountain: string }> = [];
  if (llmInputScenes.length > 0) {
    const approvedBibles = args.characterBibles
      .filter((b) => !!b.approvedAt)
      .map((b) => ({
        name: b.characterName,
        avoidanceStrategy: b.proposed.avoidanceStrategy,
        seasonRevelation: b.proposed.seasonRevelation,
      }));
    const userPayload = {
      seriesArchitecture: {
        corePrinciple: args.brief.newCorePrinciple || undefined,
        protocolPhilosophy: args.brief.protocolPhilosophy || undefined,
        solanoRule: args.brief.solanoRule || undefined,
        audiencePromise: args.brief.audiencePromise || undefined,
        forbiddenTones: args.brief.forbiddenTones || undefined,
        characterBibles: approvedBibles.length > 0 ? approvedBibles : undefined,
      },
      r5Strategy: {
        whatMustChange: args.pilotStrategy.whatMustChange,
        whatMustRemain: args.pilotStrategy.whatMustRemain,
        newSeedsToPlant: args.pilotStrategy.newSeedsToPlant,
        oldBeatsToRemove: args.pilotStrategy.oldBeatsToRemove,
        finalHookOptions: args.pilotStrategy.finalHookOptions,
      },
      r6Guardrails: {
        globalRule: args.guardrails.globalRule,
        globalPlants: args.guardrails.globalPlants ?? [],
        perCharacter: args.guardrails.perCharacter,
      },
      plan: llmInputScenes,
      writerSteeringForThisRegen: args.notes?.trim() || undefined,
    };

    let raw = "";
    try {
      const res = await callLLM({
        model: "claude-sonnet-4-6",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(userPayload, null, 2) },
        ],
        temperature: 0.5,
        // Pass 2 output is meaningful — Fountain text for every
        // REVISE/ADD/MERGE scene. Bias toward the high end of Sonnet's
        // comfortable output range. If truncation occurs, the parsed
        // result will have fewer scenes than requested and we'll flag
        // it as a missing-plan-index audit warning.
        maxTokens: 16000,
      });
      raw = res.text.trim();
    } catch (err) {
      throw new Error(`R6 Pass 2 LLM failed: ${(err as Error).message}`);
    }

    let parsed: { scenes?: unknown } = {};
    try {
      parsed = extractJSON<{ scenes?: unknown }>(raw);
    } catch (err) {
      throw new Error(
        `R6 Pass 2 LLM returned non-JSON: ${(err as Error).message}. ` +
          `Raw (first 200 chars): ${raw.slice(0, 200)}`
      );
    }
    if (Array.isArray(parsed.scenes)) {
      returned = (parsed.scenes as unknown[])
        .map((s) => {
          if (!s || typeof s !== "object") return null;
          const o = s as Record<string, unknown>;
          const pi = typeof o.planIndex === "number" ? o.planIndex : null;
          const f =
            typeof o.fountain === "string" && o.fountain.trim()
              ? o.fountain.trim()
              : "";
          if (pi === null || !f) return null;
          return { planIndex: pi, fountain: f };
        })
        .filter((x): x is { planIndex: number; fountain: string } => x !== null);
    }
  }

  const generatedByIndex = new Map<number, string>();
  for (const r of returned) generatedByIndex.set(r.planIndex, r.fountain);

  // Compile final Fountain by walking the plan in order. KEEP/MOVE pull
  // from sceneFountain; REVISE/ADD/MERGE use the LLM output. CUT drops.
  const fountainParts: string[] = [];
  const summary = {
    kept: 0,
    revised: 0,
    moved: 0,
    merged: 0,
    cut: 0,
    added: 0,
  };
  const missingPlanIndices: number[] = [];
  args.plan.forEach((p, i) => {
    switch (p.action) {
      case "keep": {
        summary.kept++;
        if (p.existingSceneOrd != null) {
          const f = sceneFountain.get(p.existingSceneOrd);
          if (f) fountainParts.push(f);
        }
        break;
      }
      case "move": {
        summary.moved++;
        if (p.existingSceneOrd != null) {
          const f = sceneFountain.get(p.existingSceneOrd);
          if (f) fountainParts.push(f);
        }
        break;
      }
      case "revise":
      case "add":
      case "merge": {
        if (p.action === "revise") summary.revised++;
        else if (p.action === "add") summary.added++;
        else summary.merged++;
        const generated = generatedByIndex.get(i);
        if (generated) {
          fountainParts.push(generated);
        } else {
          missingPlanIndices.push(i);
        }
        break;
      }
      case "cut": {
        summary.cut++;
        break;
      }
    }
  });

  const compiledFountain = fountainParts.join("\n\n");

  return {
    compiledFountain,
    sceneActionSummary: summary,
    generatedPlanIndices,
    returnedPlanIndices: returned.map((r) => r.planIndex),
    missingPlanIndices,
  };
}
