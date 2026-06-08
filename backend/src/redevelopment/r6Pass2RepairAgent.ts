// R6 Pass 2 Repair Agent — SURGICAL plant injection.
//
// When the post-Pass-2 audit reports missing character plants but every
// hard protection passed, we DO NOT regenerate the whole pilot. We take
// the current proposedDraftText as the base and run ONE LLM call that
// adds ONLY the requested plants, preserving every other beat verbatim.
//
// Repair targets are a finite, locked set with showrunner-supplied
// direction for each. The LLM is told to honor the targets' exact intent
// (e.g. "Margot should analyze before she feels" — not just "add Margot
// to a scene"). The output is the full revised Fountain.

import { callLLM, extractJSON } from "../llm/provider.js";
import { PLANT_DETECTION_PATTERNS } from "./validators.js";
import type {
  RedevR6GuardrailsBundle,
} from "./types.js";

/** Locked set of repair target IDs the showrunner can request. */
export type R6Pass2RepairTarget =
  | "margot_professional_structure"
  | "nadia_searching_behavior"
  | "claire_ritualized_grief"
  | "dean_usefulness";

/** Per-target prompt fragment supplied verbatim to the LLM. Mirrors
 *  the showrunner's directive — same language they used in the spec so
 *  the LLM gets the precise intent. */
/** Per-target detection patterns. Imported from validators.ts so the
 *  repair verifier and the final audit ALWAYS use the same regex. If a
 *  marker passes here, it passes there — no detection drift. */
const REPAIR_VERIFY_PATTERN: Record<R6Pass2RepairTarget, RegExp> = {
  margot_professional_structure: PLANT_DETECTION_PATTERNS.margot,
  nadia_searching_behavior: PLANT_DETECTION_PATTERNS.nadia,
  claire_ritualized_grief: PLANT_DETECTION_PATTERNS.claire,
  dean_usefulness: PLANT_DETECTION_PATTERNS.dean,
};

const REPAIR_SPECS: Record<R6Pass2RepairTarget, { label: string; direction: string }> = {
  margot_professional_structure: {
    label: "Margot — professional / analytical identity",
    direction:
      "Add an EARLY camera-visible beat showing Margot's professional / " +
      "analytical identity as STRUCTURE. The scene MUST include AT LEAST ONE " +
      "of these visible markers tied to Margot: recorder, notebook, files, " +
      "diagnostic observation, field-note behavior, reading the room. " +
      "She should ANALYZE BEFORE SHE FEELS. Do NOT expose Cass or grief. " +
      "The wound stays internal architecture; only the avoidance behavior " +
      "is on screen. Use the word 'Margot' AND at least one of the markers " +
      "in close proximity (same paragraph) so the audit can verify.",
  },
  nadia_searching_behavior: {
    label: "Nadia — searching / attentive behavior (no Elena reveal)",
    direction:
      "Add a behavioral plant showing Nadia is searching for something " +
      "SPECIFIC without naming Elena or revealing the sister relationship. " +
      "The scene MUST include AT LEAST ONE of these visible markers tied " +
      "to Nadia: archive, records, photograph wall, staff board, scanning, " +
      "noticing, tracking, attentive watching, investigating. NO EXPOSITION. " +
      "NO dialogue that names Elena or the relationship. The relationship " +
      "reveal is later-season. Use the word 'Nadia' AND at least one of the " +
      "markers in close proximity (same paragraph) so the audit can verify.",
  },
  claire_ritualized_grief: {
    label: "Claire — private ritual / ritualized grief",
    direction:
      "Add a PRIVATE ritual that reads as memorializing without naming " +
      "Marcus or explaining the loss. The scene MUST include AT LEAST ONE " +
      "of these visible markers tied to Claire: ritual, folded object, " +
      "careful handling, past-tense correction, practiced gesture, " +
      "memorializing, small thing handled with deliberateness. NO GRIEF " +
      "SPEECH. Marcus is never named. Use the word 'Claire' AND at least " +
      "one of the markers in close proximity so the audit can verify.",
  },
  dean_usefulness: {
    label: "Dean — usefulness / performed success",
    direction:
      "Add a camera-visible usefulness / performed-success beat. The scene " +
      "MUST include AT LEAST ONE of these visible markers tied to Dean: " +
      "charm, charisma, orienting toward distress, refilling something, " +
      "moving toward the quietest person, managing the room, performed " +
      "usefulness, admired. Make him LIKABLE, NOT SUSPICIOUS. The shame " +
      "stays internal architecture; only the performance is on screen. " +
      "Use the word 'Dean' AND at least one of the markers in close " +
      "proximity so the audit can verify.",
  },
};

export const R6_PASS2_REPAIR_TARGET_LABEL: Record<R6Pass2RepairTarget, string> = {
  margot_professional_structure: REPAIR_SPECS.margot_professional_structure.label,
  nadia_searching_behavior: REPAIR_SPECS.nadia_searching_behavior.label,
  claire_ritualized_grief: REPAIR_SPECS.claire_ritualized_grief.label,
  dean_usefulness: REPAIR_SPECS.dean_usefulness.label,
};

const VALID_TARGETS = Object.keys(REPAIR_SPECS) as R6Pass2RepairTarget[];

const SYSTEM_PROMPT = [
  "You are repairing a rewritten pilot draft. The pilot's HARD PROTECTIONS",
  "(no Paul reveal, no Elena sister reveal, no Solano-as-fraud framing,",
  "Surrender drives the engine, final blended hook) HAVE ALREADY PASSED",
  "the audit. You MUST NOT change any beat that protects those rules.",
  "",
  "Your ONLY job is to ADD the per-character plants listed in the user",
  "payload's `repairTargets` array. Each target carries an exact direction",
  "from the showrunner. Inject ONE plant per target, surgically.",
  "",
  "================================================================",
  "RULES — non-negotiable:",
  "================================================================",
  "",
  "  • Preserve every scene that is NOT being modified VERBATIM. Do not",
  "    edit scene headings, dialogue, or action lines unless the change is",
  "    required to land a target plant.",
  "  • For each repair target, find the BEST existing scene to host the",
  "    plant (early-pilot for character intros; private moments for Claire),",
  "    and add ONE small beat that lands it. Prefer behavioral plants over",
  "    dialogue.",
  "  • Do NOT introduce new scenes unless absolutely necessary. If you must",
  "    add a scene, keep it short (≤ half a page) and place it adjacent to",
  "    an existing scene that motivates it.",
  "  • Do NOT touch the pilot's ending. The final blended hook (bodies",
  "    after Surrender → transparent case → Paul's chime response) is",
  "    LOCKED.",
  "  • Do NOT expose Paul's late-season reveal (texting, accident, timestamp,",
  "    guilt). Do NOT name Elena's relationship to Nadia. Do NOT frame",
  "    Solano as fraud/cult/manipulator. Do NOT name Marcus. Do NOT name",
  "    Cass.",
  "  • Wounds are INTERNAL ARCHITECTURE. Plant AVOIDANCE BEHAVIORS only.",
  "    No therapy talk, no confessions, no flashbacks.",
  "",
  "================================================================",
  "OUTPUT CONTRACT — STRICT JSON:",
  "================================================================",
  "",
  "Your entire response is a single JSON object. The FIRST character is `{`,",
  "the LAST is `}`. No prose outside. No code fences.",
  "",
  "The object MUST have these keys:",
  "",
  "  fountain     (string) — the FULL revised pilot in Fountain format,",
  "                          ready to save as the new proposedDraftText.",
  "                          Must preserve every untouched scene verbatim.",
  "",
  "  repairs      (array)  — one entry per target you addressed, each:",
  "                            { target: <id>, location: <scene slug or",
  "                              ord/anchor>, summary: <what you added> }",
  "                          Do NOT include any screenplay text in summary;",
  "                          that lives in the fountain field.",
  "",
  "  unrepaired   (array)  — target IDs you could NOT address (e.g. no",
  "                          suitable host scene). Empty array if all were",
  "                          repaired. Be honest — the audit will catch it.",
].join("\n");

export interface RepairR6Pass2Args {
  /** Current compiled Fountain — the base the repair edits. */
  baseFountain: string;
  /** Target IDs to repair. Must be from VALID_TARGETS. */
  targets: R6Pass2RepairTarget[];
  /** Approved R6 guardrails — passed to LLM as protective context. */
  guardrails: RedevR6GuardrailsBundle;
  /** Optional steering note for this repair pass. */
  notes?: string;
}

export interface R6Pass2RepairResult {
  fountain: string;
  /** Repairs the LLM reported AND that pass the deterministic
   *  post-repair verification. */
  repairs: Array<{
    target: string;
    location: string;
    summary: string;
    verified: boolean;
  }>;
  /** Targets the LLM didn't address OR claimed but failed verification. */
  unrepaired: string[];
  /** Did the fountain actually change vs the base? Catches the case
   *  where the LLM returned its prose without changing the document. */
  fountainChanged: boolean;
  /** Net characters added/removed (newLen − baseLen). */
  bytesDelta: number;
  /** True iff every requested target was verified by the deterministic
   *  post-repair check. The audit runs separately and is the final word. */
  fullyRepaired: boolean;
  /** Per-target verification details. Lets the UI show "Margot claim
   *  passed verification" vs "Nadia claim FAILED verification". */
  verification: Array<{
    target: R6Pass2RepairTarget;
    claimed: boolean;
    verified: boolean;
    /** Short reason when not verified ("Margot keywords not found in
     *  proximity to her name"). */
    reason?: string;
  }>;
}

export async function repairR6Pass2(
  args: RepairR6Pass2Args
): Promise<R6Pass2RepairResult> {
  // Filter to known targets — silently drop unknown IDs rather than
  // pass them to the LLM.
  const targets = args.targets.filter((t): t is R6Pass2RepairTarget =>
    VALID_TARGETS.includes(t as R6Pass2RepairTarget)
  );
  if (targets.length === 0) {
    return {
      fountain: args.baseFountain,
      repairs: [],
      unrepaired: [],
      fullyRepaired: true,
    };
  }

  const repairTargetsBlock = targets.map((t) => ({
    id: t,
    label: REPAIR_SPECS[t].label,
    direction: REPAIR_SPECS[t].direction,
  }));

  const userPayload = {
    repairTargets: repairTargetsBlock,
    r6Guardrails: {
      globalRule: args.guardrails.globalRule,
      globalPlants: args.guardrails.globalPlants ?? [],
      perCharacter: args.guardrails.perCharacter,
    },
    baseFountain: args.baseFountain,
    writerSteeringForThisRepair: args.notes?.trim() || undefined,
  };

  let raw = "";
  try {
    const res = await callLLM({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(userPayload, null, 2) },
      ],
      // Repair is a tighter, more surgical edit than fresh generation —
      // run at slightly lower temperature so the LLM is less likely to
      // drift outside the requested targets.
      temperature: 0.35,
      // Output is the FULL revised pilot; size matches Pass 2's cap.
      maxTokens: 16000,
    });
    raw = res.text.trim();
  } catch (err) {
    throw new Error(`R6 Pass 2 repair LLM failed: ${(err as Error).message}`);
  }

  let parsed: { fountain?: unknown; repairs?: unknown; unrepaired?: unknown } = {};
  try {
    parsed = extractJSON<typeof parsed>(raw);
  } catch (err) {
    throw new Error(
      `R6 Pass 2 repair LLM returned non-JSON: ${(err as Error).message}. ` +
        `Raw (first 200 chars): ${raw.slice(0, 200)}`
    );
  }

  const llmFountain =
    typeof parsed.fountain === "string" && parsed.fountain.trim()
      ? parsed.fountain.trim()
      : "";

  // Hard reject: the LLM must return a fountain. Silent fallback to
  // baseFountain would mean we'd save "repaired = original" and the
  // audit would show the same warnings — exactly the bug the showrunner
  // hit. Surface this clearly instead.
  if (!llmFountain) {
    throw new Error(
      "R6 Pass 2 repair: the agent did not return a fountain field. " +
        "No changes were saved. Try again, or run a steering note."
    );
  }

  const fountainChanged = llmFountain !== args.baseFountain;
  const bytesDelta = llmFountain.length - args.baseFountain.length;

  if (!fountainChanged) {
    throw new Error(
      "R6 Pass 2 repair: the agent returned the original draft unchanged. " +
        "No repairs were applied. The proposedDraftText has NOT been updated. " +
        "Re-run with a steering note that names a specific scene to edit."
    );
  }

  const llmRepairs = Array.isArray(parsed.repairs)
    ? (parsed.repairs as unknown[])
        .map((r) => {
          if (!r || typeof r !== "object") return null;
          const o = r as Record<string, unknown>;
          return {
            target: typeof o.target === "string" ? o.target : "",
            location: typeof o.location === "string" ? o.location : "",
            summary: typeof o.summary === "string" ? o.summary : "",
          };
        })
        .filter((r): r is { target: string; location: string; summary: string } =>
          r !== null && r.target.length > 0
        )
    : [];
  const llmUnrepaired = Array.isArray(parsed.unrepaired)
    ? (parsed.unrepaired as unknown[])
        .map((x) => (typeof x === "string" ? x : ""))
        .filter((x) => x.length > 0)
    : [];

  // Deterministic post-repair verification — for every target we asked
  // the LLM to repair, check the verification pattern against the new
  // fountain. If the pattern doesn't match, the LLM's "successful
  // repair" claim is downgraded — we move that target to `unrepaired`.
  //
  // This catches the case where the LLM returns repair summaries but
  // didn't actually edit the document enough for the audit to pass.
  const verification = targets.map((t) => {
    const claimed = llmRepairs.some((r) => r.target === t);
    const verified = REPAIR_VERIFY_PATTERN[t].test(llmFountain);
    return {
      target: t,
      claimed,
      verified,
      reason: verified
        ? undefined
        : `Expected pattern for ${REPAIR_SPECS[t].label} not found in close proximity to the character's name in the repaired draft.`,
    };
  });

  // Final repairs list = only those that pass verification AND were
  // claimed by the LLM. (We allow verified-but-not-claimed too — e.g.
  // the LLM forgot to report a repair it actually made.)
  const verifiedTargets = new Set(
    verification.filter((v) => v.verified).map((v) => v.target as string)
  );
  const repairs = llmRepairs
    .filter((r) => verifiedTargets.has(r.target))
    .map((r) => ({ ...r, verified: true }));

  // Targets that were requested but failed verification go to unrepaired.
  const failedVerification = verification
    .filter((v) => !v.verified)
    .map((v) => v.target as string);
  const unrepaired = Array.from(
    new Set<string>([...llmUnrepaired, ...failedVerification])
  );

  return {
    fountain: llmFountain,
    repairs,
    unrepaired,
    fountainChanged,
    bytesDelta,
    fullyRepaired:
      unrepaired.length === 0 &&
      verification.every((v) => v.verified),
    verification,
  };
}
