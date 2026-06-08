// R8 Pass 2 — Voice/Life Apply Agent.
//
// Reads the APPROVED R8 voice polish plan + the promoted R7 EP01
// Fountain + R6 guardrails + R2 character bibles, then runs ONE
// constrained LLM call that applies ONLY the approved voice items.
// Every other beat is preserved verbatim. R6 protections (Paul / Elena /
// Solano / Surrender / final hook) stay locked. R7 polish gains are
// preserved.
//
// CRITICAL RULES:
//   • No new explanatory prose (same as R7 — replacements must be
//     filmable action, short character-specific dialogue, or cleaner
//     phrasing). NEVER add new "the audience feels" / "the body
//     understands" / "the system is" lines.
//   • No new backstory or exposition. Voice polish sharpens what's
//     already on the page — never invents new information.
//   • Wounds remain INTERNAL ARCHITECTURE — never explained in dialogue.

import { callLLM, extractJSON } from "../llm/provider.js";
import type {
  RedevR6GuardrailsBundle,
  RedevR8VoicePolishItem,
  RedevCharacterBible,
} from "./types.js";

const SYSTEM_PROMPT = [
  "You are PASS 2 of the R8 Character Voice & Scene Life Pass. PASS 1",
  "produced an APPROVED voice/life polish plan. The R1-R7 architecture",
  "is LOCKED. R7 has already promoted a polished pilot to a new draft.",
  "Your job is to APPLY the approved voice items to that draft and",
  "produce the new Fountain text.",
  "",
  "You are NOT redeveloping the series. You are NOT rewriting the pilot.",
  "You are NOT revisiting R7's polish areas (surrender continuity,",
  "object logic, showrunner-note removal, episode 2 hook). You are",
  "touching ONLY the specific lines / beats the approved R8 plan flags.",
  "Every other beat in the pilot must be preserved VERBATIM.",
  "",
  "================================================================",
  "INPUTS — locked policy you MUST honor:",
  "================================================================",
  "",
  "  • `promotedPilot.fountain` — current EP01 Fountain (the polish base).",
  "  • `voicePlan.items` — approved list of voice items. Each has a",
  "    category, diagnosis, fixDirection, optional character + scope.",
  "    Apply ONLY these.",
  "  • `r6Guardrails` — per-character protection contracts + global rule.",
  "    Voice polish must NEVER violate these.",
  "  • `r2CharacterBibles` — public/private identity, core wound,",
  "    avoidance strategy per character. Use to make voice-specific",
  "    replacements feel earned — but NEVER surface wound / hidden",
  "    truth in dialogue.",
  "",
  "================================================================",
  "VOICE CATEGORIES — what to do per category:",
  "================================================================",
  "",
  "  1) dialogue_naturalness",
  "     Rewrite the flagged line to sound like someone actually saying",
  "     it. Use mid-thought pauses, small filler words ('oh', 'I mean',",
  "     'wait'), incomplete sentences. Do NOT add exposition. Make it",
  "     1-3 lines max, restrained.",
  "",
  "  2) character_voice",
  "     Sharpen the line into voice the character would own. Reference",
  "     the bible. Margot speaks in observed structure. Dean charm-",
  "     deflects then orients toward distress. Nadia scans and",
  "     understates. Claire ritualizes / past-tense corrects. Solano",
  "     is certain, restrained, never sells. Paul half-says things.",
  "     Replace the generic line with one that could only be this",
  "     character.",
  "",
  "  3) emotional_tension",
  "     Add ONE micro-beat to the scene per flagged item. Filmable.",
  "     A held breath. A hand starting to reach and stopping. A look",
  "     that doesn't land. A withheld response (a beat of silence",
  "     before the next line). Do NOT explain the feeling — make the",
  "     audience infer it.",
  "",
  "  4) scene_rhythm",
  "     Tightenings: cut the lines named in `fixDirection`. Condense",
  "     repeated movement into one line. Breathings: insert ONE silence",
  "     or pause beat where the plan asks for it (action line only,",
  "     1-2 short sentences). Do NOT add dialogue to fill rhythm gaps.",
  "",
  "  5) subtext_moment",
  "     Replace the said-feeling line with ONE of:",
  "       (a) An action that contradicts the words.",
  "       (b) Silence + a small physical adjustment.",
  "       (c) A line about something tangential that lets the audience",
  "           INFER the real feeling.",
  "     Subtext is what the audience hears that the character isn't",
  "     saying. NEVER replace on-the-nose feeling with new explanatory",
  "     prose about the feeling.",
  "",
  "  6) behavioral_de_repetition",
  "     For each repeated observation, KEEP the strongest instance.",
  "     Cut or condense the others. Don't replace the cut beats with",
  "     new prose — just lose them.",
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
  "  • Do NOT add NEW backstory or NEW exposition. Voice polish never",
  "    adds new information — it sharpens what's already on the page.",
  "  • Wounds remain INTERNAL ARCHITECTURE — never explained in dialogue.",
  "  • ABSOLUTELY FORBIDDEN: introducing new lines containing 'the",
  "    audience feels', 'the room knows', 'the body understands', 'the",
  "    system is', 'the wound is', 'the avoidance strategies', or any",
  "    other meta-narration. The audience must INFER feeling from",
  "    behavior, not be told what to feel.",
  "  • Do NOT turn the pilot into therapy drama or thriller.",
  "  • PRESERVE all R7 polish gains — do not undo R7 fixes.",
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
  "  applied      (array)  — one entry per voice item you addressed:",
  "                            { category, location, before, after,",
  "                              replacementKind }",
  "                          where replacementKind ∈ \"action\" |",
  "                          \"dialogue\" | \"continuity_correction\" |",
  "                          \"removal\".",
  "                          `before` quotes the original snippet (≤ 200",
  "                          chars); `after` quotes the new snippet (≤",
  "                          200 chars).",
  "",
  "  unapplied    (array)  — plan items you could NOT address, with",
  "                          per-item reason. Empty array if all applied.",
].join("\n");

export type R8Pass2ReplacementKind =
  | "action"
  | "dialogue"
  | "continuity_correction"
  | "removal";

export interface R8Pass2AppliedEntry {
  category: string;
  location: string;
  before: string;
  after: string;
  replacementKind: R8Pass2ReplacementKind;
}

export interface R8Pass2UnappliedEntry {
  itemIndex: number;
  reason: string;
}

export interface R8Pass2Result {
  fountain: string;
  applied: R8Pass2AppliedEntry[];
  unapplied: R8Pass2UnappliedEntry[];
  fountainChanged: boolean;
  bytesDelta: number;
}

export interface ApplyR8Pass2Args {
  baseFountain: string;
  items: RedevR8VoicePolishItem[];
  guardrails: RedevR6GuardrailsBundle;
  characterBibles: RedevCharacterBible[];
  notes?: string;
}

const VALID_REPLACEMENT: R8Pass2ReplacementKind[] = [
  "action",
  "dialogue",
  "continuity_correction",
  "removal",
];

function normalizeApplied(raw: unknown): R8Pass2AppliedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rk = typeof o.replacementKind === "string" ? o.replacementKind : "";
  return {
    category: typeof o.category === "string" ? o.category : "",
    location: typeof o.location === "string" ? o.location : "",
    before: typeof o.before === "string" ? o.before : "",
    after: typeof o.after === "string" ? o.after : "",
    replacementKind: VALID_REPLACEMENT.includes(rk as R8Pass2ReplacementKind)
      ? (rk as R8Pass2ReplacementKind)
      : "action",
  };
}

function normalizeUnapplied(raw: unknown): R8Pass2UnappliedEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  return {
    itemIndex: typeof o.itemIndex === "number" ? o.itemIndex : -1,
    reason: typeof o.reason === "string" ? o.reason : "",
  };
}

export async function applyR8Pass2(
  args: ApplyR8Pass2Args
): Promise<R8Pass2Result> {
  if (!args.baseFountain.trim()) {
    throw new Error(
      "R8 Pass 2: base fountain is empty — cannot apply voice polish to nothing"
    );
  }
  if (args.items.length === 0) {
    throw new Error(
      "R8 Pass 2: voice plan has zero items — nothing to apply"
    );
  }

  const userPayload = {
    promotedPilot: { fountain: args.baseFountain },
    voicePlan: {
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
      temperature: 0.4,
      // Output is the full polished pilot. Match R7 Pass 2's cap.
      maxTokens: 16000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`R8 Pass 2 LLM failed: ${(err as Error).message}`);
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
      `R8 Pass 2 LLM returned non-JSON: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const fountain =
    typeof parsed.fountain === "string" && parsed.fountain.trim()
      ? parsed.fountain.trim()
      : "";
  if (!fountain) {
    throw new Error(
      "R8 Pass 2: the agent did not return a fountain field. No changes saved."
    );
  }
  const fountainChanged = fountain !== args.baseFountain;
  const bytesDelta = fountain.length - args.baseFountain.length;
  if (!fountainChanged) {
    throw new Error(
      "R8 Pass 2: the agent returned the base draft unchanged. No voice polish applied."
    );
  }

  const applied: R8Pass2AppliedEntry[] = Array.isArray(parsed.applied)
    ? (parsed.applied as unknown[])
        .map(normalizeApplied)
        .filter((a): a is R8Pass2AppliedEntry => a !== null)
    : [];
  const unapplied: R8Pass2UnappliedEntry[] = Array.isArray(parsed.unapplied)
    ? (parsed.unapplied as unknown[])
        .map(normalizeUnapplied)
        .filter((u): u is R8Pass2UnappliedEntry => u !== null)
    : [];

  return {
    fountain,
    applied,
    unapplied,
    fountainChanged,
    bytesDelta,
  };
}
