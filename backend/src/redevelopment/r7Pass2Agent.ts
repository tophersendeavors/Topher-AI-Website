// R7 Pass 2 — Polish Apply Agent.
//
// Reads the APPROVED R7 polish plan + the promoted EP01 Fountain (from
// the scripts table) + R6 guardrails, then runs ONE constrained LLM
// call that applies ONLY the approved polish items. Every other beat
// is preserved verbatim. R6 protections (Paul / Elena / Solano /
// Surrender / final hook) stay locked.
//
// CRITICAL RULE (from showrunner memory): when removing showrunner-note
// prose, the replacement must be FILMABLE ACTION or SHORT CHARACTER-
// SPECIFIC DIALOGUE or a CLEANER CONTINUITY CORRECTION. Replacing
// explanatory prose with different explanatory prose is forbidden.

import { callLLM, extractJSON } from "../llm/provider.js";
import type {
  RedevR6GuardrailsBundle,
  RedevR7PolishItem,
} from "./types.js";

const SYSTEM_PROMPT = [
  "You are PASS 2 of the R7 Pilot Polish Pass. PASS 1 produced an APPROVED",
  "polish plan. The R1-R6 architecture is LOCKED. R6 has already promoted",
  "a rewritten pilot to a new draft. Your job is to APPLY the approved",
  "polish items to that draft and produce the new Fountain text.",
  "",
  "You are NOT redeveloping the series. You are NOT rewriting the pilot.",
  "You are touching ONLY the specific lines / beats / scenes the approved",
  "plan flags. Every other beat in the pilot must be preserved VERBATIM.",
  "",
  "================================================================",
  "INPUTS — locked policy you MUST honor:",
  "================================================================",
  "",
  "  • `promotedPilot.fountain` — current EP01 Fountain (the polish base).",
  "  • `polishPlan.items` — approved list of polish items. Each item has",
  "    a category, diagnosis, fixDirection, optional scope. Apply ONLY",
  "    these.",
  "  • `r6Guardrails` — per-character protection contracts + global rule",
  "    + global plants. Polish must NEVER violate these.",
  "",
  "================================================================",
  "POLISH CATEGORIES — what to do per category:",
  "================================================================",
  "",
  "  1) surrender_continuity",
  "     Fix the contradiction. Re-order or delete the offending line.",
  "     The public Surrender scene is the FIRST time the item is given",
  "     up. Earlier dialogue cannot reference it as already surrendered.",
  "",
  "  2) notebook_recorder_object_logic",
  "     After Surrender, the surrendered items live in the transparent",
  "     case. If a character reaches for a surrendered item later, the",
  "     hand should find ABSENCE. Rewrite the beat as the body reaching,",
  "     finding empty space, and ADJUSTING. Do not have the character",
  "     use the item.",
  "",
  "  3) dialogue_polish",
  "     Replace summarized prose with short, character-specific dialogue.",
  "     Restrained. 1-3 lines per beat. The characters must sound like",
  "     THEMSELVES, not like architecture notes. Do not summarize whole",
  "     conversations in prose.",
  "",
  "  4) showrunner_note_prose  ← MOST CRITICAL RULE",
  "     Remove lines that explain what the audience should feel or what",
  "     the architecture means. Examples to remove:",
  "       • 'The system is running.'",
  "       • 'The wound is nowhere in this room.'",
  "       • 'The audience feels…'",
  "       • 'The avoidance strategies run quietly…'",
  "       • 'The room knows…' / 'The body understands…'",
  "     For EACH removed line, the replacement MUST be ONE of:",
  "       (a) FILMABLE ACTION — a beat a camera could literally capture",
  "           (a hand reaching, a body adjusting, an eye catching a name).",
  "       (b) SHORT CHARACTER-SPECIFIC DIALOGUE — 1-2 lines that sound",
  "           like the character speaking, restrained, in voice.",
  "       (c) CLEANER CONTINUITY CORRECTION — if the line was a continuity",
  "           bandage, fix the underlying structure instead of re-narrating.",
  "     ABSOLUTELY FORBIDDEN: replacing showrunner-note prose with",
  "     different showrunner-note prose. Do NOT introduce new lines",
  "     containing 'the audience feels', 'the room knows', 'the body",
  "     understands', 'the system is', 'the wound is', 'the avoidance",
  "     strategies', or any other meta-narration. The audience must",
  "     INFER feeling from behavior, not be told what to feel.",
  "",
  "  5) episode_2_hook",
  "     Make the final transparent-case / Paul-chime ending slightly",
  "     more compelling WITHOUT revealing the accident truth. Example:",
  "     Paul's phone lights up inside the transparent case — we don't",
  "     see the message. Do not show the text. Do not imply guilt too",
  "     directly. Leave the question: why did Paul's body recognize",
  "     that sound?",
  "",
  "================================================================",
  "ABSOLUTE PROTECTIONS — non-negotiable:",
  "================================================================",
  "",
  "  • Do NOT reveal Paul's texting / accident responsibility / timestamp",
  "    evidence / guilt.",
  "  • Do NOT reveal that Elena is Nadia's sister.",
  "  • Do NOT frame Solano as fraud / cult / con / liar / manipulator.",
  "  • Do NOT remove Surrender as the pilot engine.",
  "  • Do NOT remove the final transparent-case / Paul chime hook.",
  "  • Do NOT introduce flashbacks, confession circles, or therapy",
  "    exposition.",
  "  • Wounds remain INTERNAL ARCHITECTURE — never explained in dialogue.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT JSON:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences. No commentary.",
  "",
  "The object MUST have these keys:",
  "",
  "  fountain     (string) — the FULL polished pilot in Fountain format,",
  "                          ready to save as a new draft. Every untouched",
  "                          beat is verbatim from the base. Edits apply",
  "                          ONLY to the approved plan items.",
  "",
  "  applied      (array)  — one entry per polish item you addressed:",
  "                            { category, location, before, after,",
  "                              replacementKind }",
  "                          where replacementKind ∈ \"action\" |",
  "                          \"dialogue\" | \"continuity_correction\" |",
  "                          \"removal\" (no replacement needed).",
  "                          `before` quotes the original snippet (≤ 200",
  "                          chars); `after` quotes the new snippet (≤",
  "                          200 chars).",
  "",
  "  unapplied    (array)  — plan items you could NOT address, with",
  "                          per-item reason. Empty array if all applied.",
].join("\n");

export type R7Pass2ReplacementKind =
  | "action"
  | "dialogue"
  | "continuity_correction"
  | "removal";

export interface R7Pass2AppliedEntry {
  category: string;
  location: string;
  before: string;
  after: string;
  replacementKind: R7Pass2ReplacementKind;
}

export interface R7Pass2UnappliedEntry {
  /** Index of the plan item (in the order it was sent in). */
  itemIndex: number;
  reason: string;
}

export interface R7Pass2Result {
  fountain: string;
  applied: R7Pass2AppliedEntry[];
  unapplied: R7Pass2UnappliedEntry[];
  fountainChanged: boolean;
  bytesDelta: number;
}

export interface ApplyR7Pass2Args {
  baseFountain: string;
  items: RedevR7PolishItem[];
  guardrails: RedevR6GuardrailsBundle;
  notes?: string;
}

const VALID_REPLACEMENT: R7Pass2ReplacementKind[] = [
  "action",
  "dialogue",
  "continuity_correction",
  "removal",
];

function normalizeApplied(raw: unknown): R7Pass2AppliedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rk = typeof o.replacementKind === "string" ? o.replacementKind : "";
  return {
    category: typeof o.category === "string" ? o.category : "",
    location: typeof o.location === "string" ? o.location : "",
    before: typeof o.before === "string" ? o.before : "",
    after: typeof o.after === "string" ? o.after : "",
    replacementKind: VALID_REPLACEMENT.includes(rk as R7Pass2ReplacementKind)
      ? (rk as R7Pass2ReplacementKind)
      : "action",
  };
}

function normalizeUnapplied(raw: unknown): R7Pass2UnappliedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    itemIndex: typeof o.itemIndex === "number" ? o.itemIndex : -1,
    reason: typeof o.reason === "string" ? o.reason : "",
  };
}

export async function applyR7Pass2(
  args: ApplyR7Pass2Args
): Promise<R7Pass2Result> {
  if (!args.baseFountain.trim()) {
    throw new Error(
      "R7 Pass 2: base fountain is empty — cannot apply polish to nothing"
    );
  }
  if (args.items.length === 0) {
    throw new Error(
      "R7 Pass 2: polish plan has zero items — nothing to apply"
    );
  }

  const userPayload = {
    promotedPilot: { fountain: args.baseFountain },
    polishPlan: {
      items: args.items.map((it, i) => ({
        itemIndex: i,
        existingSceneOrd: it.existingSceneOrd,
        existingSlugline: it.existingSlugline,
        category: it.category,
        diagnosis: it.diagnosis,
        fixDirection: it.fixDirection,
        severity: it.severity,
        scope: it.scope,
      })),
    },
    r6Guardrails: {
      globalRule: args.guardrails.globalRule,
      globalPlants: args.guardrails.globalPlants ?? [],
      perCharacter: args.guardrails.perCharacter,
    },
    writerSteeringForThisApply: args.notes?.trim() || undefined,
  };

  let raw = "";
  try {
    const res = await callLLM({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
      ],
      // Polish is surgical — slightly lower temp than fresh generation.
      temperature: 0.4,
      // Output is the full polished pilot. Match R6 Pass 2's cap.
      maxTokens: 16000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`R7 Pass 2 LLM failed: ${(err as Error).message}`);
  }

  let parsed: {
    fountain?: unknown;
    applied?: unknown;
    unapplied?: unknown;
  } = {};
  try {
    parsed = extractJSON<typeof parsed>(raw);
  } catch (err) {
    throw new Error(
      `R7 Pass 2 LLM returned non-JSON: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const fountain =
    typeof parsed.fountain === "string" && parsed.fountain.trim()
      ? parsed.fountain.trim()
      : "";
  if (!fountain) {
    throw new Error(
      "R7 Pass 2: the agent did not return a fountain field. No changes saved."
    );
  }
  const fountainChanged = fountain !== args.baseFountain;
  const bytesDelta = fountain.length - args.baseFountain.length;
  if (!fountainChanged) {
    throw new Error(
      "R7 Pass 2: the agent returned the base draft unchanged. No polish applied."
    );
  }

  const applied: R7Pass2AppliedEntry[] = Array.isArray(parsed.applied)
    ? (parsed.applied as unknown[])
        .map(normalizeApplied)
        .filter((a): a is R7Pass2AppliedEntry => a !== null)
    : [];
  const unapplied: R7Pass2UnappliedEntry[] = Array.isArray(parsed.unapplied)
    ? (parsed.unapplied as unknown[])
        .map(normalizeUnapplied)
        .filter((u): u is R7Pass2UnappliedEntry => u !== null)
    : [];

  return {
    fountain,
    applied,
    unapplied,
    fountainChanged,
    bytesDelta,
  };
}
