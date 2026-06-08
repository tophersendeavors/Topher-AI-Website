// R9 Pass 2 — Final Polish Apply Agent.
//
// Reads the APPROVED R9 plan + the R8-promoted Draft 4 + R6 guardrails
// + R2 character bibles, then runs ONE constrained LLM call that
// applies ONLY the approved items. Every other beat is preserved
// verbatim. All R7/R8 protections stay locked. Draft 5 (the output)
// is the locked Episode 1 writing draft.

import { callLLM, extractJSON } from "../llm/provider.js";
import type {
  RedevR6GuardrailsBundle,
  RedevR9FinalPolishItem,
  RedevCharacterBible,
} from "./types.js";

const SYSTEM_PROMPT = [
  "You are PASS 2 of the R9 Final Hook & Emotional Anchor Pass. Pass 1",
  "produced an APPROVED plan. The R1-R8 architecture is LOCKED. R8 has",
  "already promoted Draft 4. Your job is to apply ONLY the approved",
  "items and produce Draft 5 — the LOCKED Episode 1 writing draft.",
  "",
  "You are NOT redeveloping the series. You are NOT rewriting the pilot.",
  "You are NOT revisiting R7/R8 polish areas. You are touching ONLY",
  "the specific lines / beats / scenes the approved plan flags.",
  "Every other beat in the pilot must be preserved VERBATIM.",
  "",
  "================================================================",
  "INPUTS — locked policy you MUST honor:",
  "================================================================",
  "",
  "  • `promotedPilot.fountain` — current Draft 4 (the apply base).",
  "  • `finalPlan.items` — approved list of R9 items. Apply ONLY these.",
  "  • `r6Guardrails` — per-character contracts + global rule.",
  "  • `r2CharacterBibles` — character voice context. Never surface",
  "    wound or hidden truth.",
  "",
  "================================================================",
  "FIVE LENSES — what to do per category:",
  "================================================================",
  "",
  "  1) margot_emotional_anchor",
  "     Add the ONE private filmable crack the plan describes (a hand",
  "     that hesitates over the file's edge, fingertips that smooth a",
  "     corner, breath caught for a beat, recorder paused mid-thought,",
  "     a chair pushed back an inch). Behavior, no exposition.",
  "     FORBIDDEN: any Cass reveal (name, relation, timeline marker),",
  "     grief speech, or dialogue that names the loss.",
  "",
  "  2) archive_visual_mystery",
  "     In the Solano-archive-room scene, add the ONE visual plant the",
  "     plan describes — wall of participant photos in identical frames,",
  "     labeled files in a system the camera can read, a single removed",
  "     frame leaving a brighter rectangle, a covered section under a",
  "     drop cloth, a locked drawer. FORBIDDEN: Elena name; sister; any",
  "     'younger version of someone' clue; dialogue that names what's",
  "     hidden.",
  "",
  "  3) sound_design",
  "     Add or sharpen the recurring sound motif at the specified",
  "     location: recorder click/hum, rain on canvas/canopy/tile,",
  "     jungle ambient, howler monkeys (sparingly), transparent case",
  "     lock click, called-out silence beat, notification chime. ONE",
  "     line per item, environmental/diegetic only. NO music or score.",
  "",
  "  4) pacing_economy",
  "     Cut the lines / beats the plan flags. Condense repeated",
  "     observation gestures. Preserve every core character plant. Do",
  "     NOT add replacement prose — just lose the redundant beats.",
  "",
  "  5) final_hook_polish",
  "     Add the ONE restrained extra beat in the closing block. The",
  "     existing hook stays intact; you are ADDING — not changing —",
  "     one micro-beat. Examples the plan may direct: a softer second",
  "     chime; Paul's fingers moving once toward the case then stopping;",
  "     the case lock ticking in silence; an extra second of screen glow",
  "     inside the case. FORBIDDEN: showing the message; revealing",
  "     texting / accident / timestamp / guilt; adding dialogue; cutting",
  "     any existing hook beat.",
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
  "  • ABSOLUTELY FORBIDDEN: introducing new lines containing 'the",
  "    audience feels', 'the room knows', 'the body understands',",
  "    'the system is', 'the wound is', 'the avoidance strategies',",
  "    'we realize', 'what this means is', or any other meta-narration.",
  "  • Do NOT turn the pilot into therapy drama or thriller.",
  "  • PRESERVE all R7 + R8 polish gains.",
  "  • Margot remains the primary lens.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT JSON:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. First char `{`, last `}`.",
  "No prose outside. No code fences. No commentary.",
  "",
  "  fountain     (string) — the FULL Draft 5 in Fountain format. Every",
  "                          untouched beat verbatim from Draft 4.",
  "  applied      (array)  — one entry per plan item addressed:",
  "                            { category, location, before, after,",
  "                              replacementKind }",
  "                          where replacementKind ∈ \"action\" |",
  "                          \"dialogue\" | \"continuity_correction\" |",
  "                          \"removal\" | \"sound\" | \"insertion\".",
  "                          `before` ≤ 200 chars; `after` ≤ 200 chars.",
  "  unapplied    (array)  — plan items you could NOT address, with",
  "                          per-item reason. Empty array if all applied.",
].join("\n");

export type R9Pass2ReplacementKind =
  | "action"
  | "dialogue"
  | "continuity_correction"
  | "removal"
  | "sound"
  | "insertion";

export interface R9Pass2AppliedEntry {
  category: string;
  location: string;
  before: string;
  after: string;
  replacementKind: R9Pass2ReplacementKind;
}

export interface R9Pass2UnappliedEntry {
  itemIndex: number;
  reason: string;
}

export interface R9Pass2Result {
  fountain: string;
  applied: R9Pass2AppliedEntry[];
  unapplied: R9Pass2UnappliedEntry[];
  fountainChanged: boolean;
  bytesDelta: number;
}

export interface ApplyR9Pass2Args {
  baseFountain: string;
  items: RedevR9FinalPolishItem[];
  guardrails: RedevR6GuardrailsBundle;
  characterBibles: RedevCharacterBible[];
  notes?: string;
}

const VALID_REPLACEMENT: R9Pass2ReplacementKind[] = [
  "action",
  "dialogue",
  "continuity_correction",
  "removal",
  "sound",
  "insertion",
];

function normalizeApplied(raw: unknown): R9Pass2AppliedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rk = typeof o.replacementKind === "string" ? o.replacementKind : "";
  return {
    category: typeof o.category === "string" ? o.category : "",
    location: typeof o.location === "string" ? o.location : "",
    before: typeof o.before === "string" ? o.before : "",
    after: typeof o.after === "string" ? o.after : "",
    replacementKind: VALID_REPLACEMENT.includes(rk as R9Pass2ReplacementKind)
      ? (rk as R9Pass2ReplacementKind)
      : "action",
  };
}

function normalizeUnapplied(raw: unknown): R9Pass2UnappliedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    itemIndex: typeof o.itemIndex === "number" ? o.itemIndex : -1,
    reason: typeof o.reason === "string" ? o.reason : "",
  };
}

export async function applyR9Pass2(
  args: ApplyR9Pass2Args
): Promise<R9Pass2Result> {
  if (!args.baseFountain.trim()) {
    throw new Error(
      "R9 Pass 2: base fountain is empty — cannot apply final polish to nothing"
    );
  }
  if (args.items.length === 0) {
    throw new Error("R9 Pass 2: plan has zero items — nothing to apply");
  }

  const userPayload = {
    promotedPilot: { fountain: args.baseFountain },
    finalPlan: {
      items: args.items.map((it, i) => ({
        itemIndex: i,
        existingSceneOrd: it.existingSceneOrd,
        existingSlugline: it.existingSlugline,
        character: it.character,
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
    r2CharacterBibles: args.characterBibles
      .filter((b) => !!b.approvedAt)
      .map((b) => ({
        characterName: b.characterName,
        publicIdentity: b.proposed.publicIdentity,
        privateIdentity: b.proposed.privateIdentity,
        coreWound: b.proposed.coreWound,
        avoidanceStrategy: b.proposed.avoidanceStrategy,
      })),
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
      temperature: 0.35,
      // Output is the full Draft 5. Match R7/R8 Pass 2 cap.
      maxTokens: 16000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`R9 Pass 2 LLM failed: ${(err as Error).message}`);
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
      `R9 Pass 2 LLM returned non-JSON: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const fountain =
    typeof parsed.fountain === "string" && parsed.fountain.trim()
      ? parsed.fountain.trim()
      : "";
  if (!fountain) {
    throw new Error(
      "R9 Pass 2: the agent did not return a fountain field. No changes saved."
    );
  }
  const fountainChanged = fountain !== args.baseFountain;
  const bytesDelta = fountain.length - args.baseFountain.length;
  if (!fountainChanged) {
    throw new Error(
      "R9 Pass 2: the agent returned the base draft unchanged. No polish applied."
    );
  }

  const applied: R9Pass2AppliedEntry[] = Array.isArray(parsed.applied)
    ? (parsed.applied as unknown[])
        .map(normalizeApplied)
        .filter((a): a is R9Pass2AppliedEntry => a !== null)
    : [];
  const unapplied: R9Pass2UnappliedEntry[] = Array.isArray(parsed.unapplied)
    ? (parsed.unapplied as unknown[])
        .map(normalizeUnapplied)
        .filter((u): u is R9Pass2UnappliedEntry => u !== null)
    : [];

  return { fountain, applied, unapplied, fountainChanged, bytesDelta };
}
