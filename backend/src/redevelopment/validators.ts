// Series Redevelopment — self-auditing validators + deterministic repairs.
//
// Generation pipeline for R3/R4:
//   1. LLM generates the structured output.
//   2. `auditAndRepair…()` runs ALL rules against it.
//   3. Where the rule can be fixed without judgment (metadata,
//      character lists, banned phrases) the repair runs inline and is
//      recorded in `repairs[]`.
//   4. Where the rule needs human judgment (tone drift, therapy
//      language, distinctness), the rule is surfaced as a "warning"
//      check the user sees in the Quality Check panel.
//   5. The final repaired output + AuditReport flows back to the UI.
//
// This file is intentionally deterministic — no LLM calls. LLM repair
// for creative-text issues can be slotted in later as a separate pass,
// but the metadata/continuity rules below are fast, predictable, and
// trustworthy without one.

import { CHARACTER_INCLUSION_RULES, enforceCharacterInclusion } from "./protocolModuleAgent.js";
import type {
  AuditCheck,
  AuditCheckId,
  AuditRepair,
  AuditReport,
  RedevBrief,
  RedevCharacterBible,
  RedevPilotStrategy,
  RedevProtocolModule,
  RedevR6GuardrailsBundle,
  RedevR6RewriteScenePlan,
  RedevR6RewriteTarget,
  RedevSeasonArcEpisode,
} from "./types.js";
import { R6_REWRITE_TARGET_LABEL } from "./types.js";

/** Shared per-character plant-detection patterns.
 *
 *  Single source of truth used by BOTH:
 *    • the R6 Pass 2 final audit (`auditAndRepairR6Pass2Draft`)
 *    • the R6 Pass 2 repair verifier (in `r6Pass2RepairAgent.ts`)
 *
 *  Previously the two had divergent keyword sets — the repair verifier
 *  was broader (it accepted "folded", "refills", "staff board",
 *  "orients toward distress", etc.) while the final audit was narrower.
 *  Result: the LLM would satisfy the verifier on a repair pass but the
 *  final audit would still flag the same warning, leaving the
 *  showrunner stuck. Both detectors must accept the EXACT vocabulary
 *  the repair prompt instructs the LLM to use.
 *
 *  Each pattern requires the character's first name + at least one
 *  markers from the union of both prior sets, within a short proximity
 *  window. Case-insensitive. */
export const PLANT_DETECTION_PATTERNS = {
  margot:
    /\bmargot\b[^.]{0,200}\b(analy|diagnos|profess|read(s|ing)?\s+the\s+room|clinic|forensic|recorder|notebook|notes\b|chart|field\s*note)/i,
  nadia:
    /\bnadia\b[^.]{0,300}\b(archive|records|elena|photograph|staff\s+board|search|scan|notice|attentive|tracking|tracks|investigat|looking)/i,
  claire:
    /\bclaire\b[^.]{0,300}\b(ritual|gestur|memorializ|small\s+thing|practic|fold|folded|placed|grief|caretaking|paul|usefulness|past[-\s]?tense)/i,
  dean:
    /\bdean\b[^.]{0,300}\b(charm|charism|empire|performance|orient|refill|admir|use(ful)?|usef|moves\s+toward|distress)/i,
} as const;

// ============================================================================
// R3 — Protocol Module audit
// ============================================================================

/** Phrases that look like personal-tool leakage AFTER Surrender has
 *  been declared in this redevelopment pass. Surrender removes personal
 *  notebooks / pens / recorders / phones / files — any later module
 *  that names those items needs to either use Protocol-issued language
 *  or be flagged. */
const PERSONAL_TOOL_PATTERNS: Array<{
  pattern: RegExp;
  replacement: string;
  describe: string;
}> = [
  {
    pattern: /\b(her|his|their)\s+(personal\s+)?notebook\b/gi,
    replacement: "the Protocol-issued observation log",
    describe: "personal notebook → Protocol-issued observation log",
  },
  {
    pattern: /\bpersonal\s+notebook\b/gi,
    replacement: "Protocol-issued observation log",
    describe: "personal notebook → Protocol-issued observation log",
  },
  {
    pattern: /\b(her|his|their)\s+(personal\s+)?(audio\s+)?recorder\b/gi,
    replacement: "the Protocol-issued recording station",
    describe: "personal recorder → Protocol-issued recording station",
  },
  {
    pattern: /\b(her|his|their)\s+(personal\s+)?files\b/gi,
    replacement: "Protocol-issued intake materials",
    describe: "personal files → Protocol-issued intake materials",
  },
  {
    pattern: /\b(her|his|their)\s+(personal\s+)?research\s+materials\b/gi,
    replacement: "Protocol-issued briefing materials",
    describe: "personal research materials → Protocol-issued briefing materials",
  },
];

/** Phrases that frame Solano / Selvaje as a fraud / scam / surveillance
 *  thriller. These violate the architectural Solano rule and get
 *  flagged for the showrunner. We do NOT auto-rewrite them — the
 *  language might be the user's intent in a future pass. We surface
 *  them clearly so the user can address with regen-with-notes. */
const SOLANO_ETHICS_RED_FLAGS = [
  /\bfraud(ulent)?\b/i,
  /\bscam\b/i,
  /\bcon\b(?!fess|firm|sent|tract|tinue|cept)/i, // "con" as noun, not con- prefix
  /\bcult\s+leader\b/i,
  /\bcult\b/i,
  /\bsecret(ly)?\s+(record|surveil|film|watch)/i,
  /\bcovert\s+(surveillance|recording|camera)/i,
  /\bhidden\s+camera\b/i,
  /\billegal\s+surveillance\b/i,
  /\bSelvaje\s+is\s+(fake|a\s+lie|a\s+scam)/i,
  /\bProtocol\s+is\s+(fake|a\s+lie|a\s+scam)/i,
];

/** Phrases that point too directly at Paul's late-season reveal. The
 *  reveal architecture is: he was texting at the moment of the accident,
 *  the timestamps align, the convicted other driver may have been
 *  innocent. None of that should surface in an R3 module — modules can
 *  only pressure Paul behaviorally (caretaking, restraint, hands shaking,
 *  driving avoidance) before the late-season payoff. */
const PAUL_REVEAL_RED_FLAGS = [
  /\btimestamp(s)?\s+(of|align|match)/i,
  /\boutgoing\s+text/i,
  /\btext\s+message\s+at\b/i,
  /\bwas\s+texting\b/i,
  /\baccident\s+timestamp/i,
  /\bphone\s+records\b/i,
  /\binnocent\s+driver\b/i,
  /\bother\s+driver\s+was\s+innocent/i,
  /\bwrongly\s+convicted/i,
  /\bPaul\s+caused\s+the\s+accident/i,
  /\bPaul\s+was\s+responsible\b/i,
];

/** Phrases that drift into the forbidden tones list (hypnosis, magic,
 *  supernatural, psychedelic, generic therapy, confession-circle,
 *  "tell me about your childhood"). */
const TONE_DRIFT_RED_FLAGS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bhypnos(is|e|t)/i, label: "hypnosis" },
  { pattern: /\bmagical?\b/i, label: "magical" },
  { pattern: /\bsupernatural\b/i, label: "supernatural" },
  { pattern: /\bpsychedelic/i, label: "psychedelic" },
  { pattern: /\bayahuasca\b/i, label: "ayahuasca" },
  { pattern: /\bvision\s+quest/i, label: "vision quest" },
  { pattern: /\bsacred\s+(plant|medicine)/i, label: "sacred plant / medicine" },
  { pattern: /\btell\s+me\s+about\s+your\s+childhood/i, label: "'tell me about your childhood'" },
  { pattern: /\bconfess(ion|ional)\s+circle/i, label: "confession circle" },
  { pattern: /\binner\s+landscape/i, label: "inner landscape (generic therapy)" },
  { pattern: /\bhold\s+space\b/i, label: "'hold space' (generic therapy)" },
  { pattern: /\bsacred\s+space\b/i, label: "'sacred space' (generic therapy)" },
  { pattern: /\bunlock\s+the\s+unconscious/i, label: "'unlock the unconscious'" },
  { pattern: /\binner\s+child\b/i, label: "'inner child'" },
  { pattern: /\bchakra/i, label: "chakra" },
];

/** Phrases that suggest the module is attacking the WOUND directly
 *  ("ask X to confess Y") rather than the avoidance STRATEGY. The
 *  Protocol attacks behavior, not the wound. */
const WOUND_DIRECT_RED_FLAGS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bask\s+(Margot|Paul|Claire|Nadia|Dean|Solano)\s+(to\s+)?(confess|admit|reveal|explain)/i, label: "'ask [character] to confess/admit/explain' — direct-wound" },
  { pattern: /\btalk\s+about\s+(Cass|Marcus|Elena|the\s+accident)/i, label: "'talk about [name]' — direct-wound" },
  { pattern: /\bdescribe\s+(your|the)\s+(loss|trauma|grief|wound)/i, label: "'describe your loss/trauma' — direct-wound" },
  { pattern: /\bshare\s+(your|the)\s+(story|trauma|loss)/i, label: "'share your story/trauma' — direct-wound" },
];

/** Build a haystack from a module's body fields for substring scans. */
function moduleHaystack(m: RedevProtocolModule): string {
  return [
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
}

/** Apply tool-continuity rewrites to every text field on the module
 *  and return the patched module + repair notes. */
function repairToolContinuity(
  m: RedevProtocolModule
): { module: RedevProtocolModule; repairs: AuditRepair[] } {
  const repairs: AuditRepair[] = [];
  const patched = { ...m };
  const fields: Array<keyof RedevProtocolModule> = [
    "purpose",
    "psychologicalTarget",
    "avoidanceBehaviorStripped",
    "physicalSomaticExercise",
    "visualExecution",
    "dramaticRisks",
    "truthPressured",
  ];
  for (const field of fields) {
    const original = (patched[field] as string | undefined) ?? "";
    if (!original) continue;
    let next = original;
    for (const p of PERSONAL_TOOL_PATTERNS) {
      if (p.pattern.test(next)) {
        next = next.replace(p.pattern, p.replacement);
        if (!repairs.some((r) => r.description.startsWith(p.describe))) {
          repairs.push({
            checkId: "r3_tool_continuity",
            description: `${p.describe} (Surrender removes personal tools — later modules use Protocol-issued materials).`,
          });
        }
      }
    }
    (patched as Record<string, unknown>)[field] = next;
  }
  return { module: patched, repairs };
}

export function auditAndRepairProtocolModule(args: {
  module: RedevProtocolModule;
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  /** Other modules in the same pass — used for distinctness check. */
  siblingModules?: RedevProtocolModule[];
}): { module: RedevProtocolModule; audit: AuditReport } {
  const checks: AuditCheck[] = [];
  const repairs: AuditRepair[] = [];
  let m = args.module;

  // -------------------------------------------------------------------------
  // 1. Character inclusion (deterministic).
  //    Reuses the keyword rules in CHARACTER_INCLUSION_RULES.
  // -------------------------------------------------------------------------
  const inc = enforceCharacterInclusion(m);
  m = inc.module;
  for (const note of inc.validatorNotes) {
    repairs.push({
      checkId: "r3_character_inclusion",
      description: `Added ${note.characterName} to affected characters because the module mentioned ${note.triggeredBy
        .slice(0, 4)
        .map((t) => `"${t}"`)
        .join(", ")}.`,
    });
  }
  checks.push({
    id: "r3_character_inclusion",
    label: "Character inclusion",
    status: inc.validatorNotes.length > 0 ? "auto_repaired" : "passed",
    message:
      inc.validatorNotes.length > 0
        ? `Auto-added ${inc.validatorNotes.map((n) => n.characterName).join(", ")}.`
        : "All characters whose territory appears in the module body are listed in affected characters.",
  });

  // -------------------------------------------------------------------------
  // 2. Tool continuity (deterministic rewrite).
  // -------------------------------------------------------------------------
  const tc = repairToolContinuity(m);
  m = tc.module;
  repairs.push(...tc.repairs);
  checks.push({
    id: "r3_tool_continuity",
    label: "Tool continuity (post-Surrender)",
    status: tc.repairs.length > 0 ? "auto_repaired" : "passed",
    message:
      tc.repairs.length > 0
        ? `Rewrote ${tc.repairs.length} reference${tc.repairs.length === 1 ? "" : "s"} to personal tools as Protocol-issued materials.`
        : "No personal-tool leakage detected. Any objects in this module read as Protocol-issued or consented intake materials.",
  });

  // -------------------------------------------------------------------------
  // 3. Solano ethics (warning only — surface to user, don't auto-rewrite).
  // -------------------------------------------------------------------------
  const haystack = moduleHaystack(m);
  const solanoHits = SOLANO_ETHICS_RED_FLAGS.filter((re) => re.test(haystack));
  checks.push({
    id: "r3_solano_ethics",
    label: "Solano ethics (not a fraud, not a cult leader)",
    status: solanoHits.length > 0 ? "warning" : "passed",
    message:
      solanoHits.length > 0
        ? `Module body contains ${solanoHits.length} phrase${solanoHits.length === 1 ? "" : "s"} that frame the Protocol as deceptive (fraud / cult / covert surveillance). Review and rewrite via Regenerate with notes.`
        : "No fraud / cult / surveillance language detected.",
  });

  // -------------------------------------------------------------------------
  // 4. Paul reveal timing (warning).
  // -------------------------------------------------------------------------
  const paulHits = PAUL_REVEAL_RED_FLAGS.filter((re) => re.test(haystack));
  checks.push({
    id: "r3_paul_reveal_timing",
    label: "Paul reveal timing (protected for EP06/07)",
    status: paulHits.length > 0 ? "warning" : "passed",
    message:
      paulHits.length > 0
        ? `Module body references Paul's late-season reveal architecture (timestamp / outgoing text / innocent driver). Restrict to behavioral pressure (notification chime, driving avoidance, hands shaking, caretaking-as-motion).`
        : "No late-season Paul reveals detected. Module operates on behavioral pressure only, which is correct for R3.",
  });

  // -------------------------------------------------------------------------
  // 5. Behavioral-not-therapy (warning).
  // -------------------------------------------------------------------------
  const toneHits = TONE_DRIFT_RED_FLAGS.filter((rule) => rule.pattern.test(haystack));
  checks.push({
    id: "r3_behavioral_not_therapy",
    label: "Behavioral, not therapeutic / mystical",
    status: toneHits.length > 0 ? "warning" : "passed",
    message:
      toneHits.length > 0
        ? `Module contains forbidden-tone language: ${toneHits.map((t) => t.label).join(", ")}. Rewrite via Regenerate with notes — Protocol must read as physical / behavioral / cinematic, not therapy / mystical.`
        : "Module reads as physical / behavioral / cinematic. No therapy / mystical drift detected.",
  });

  // -------------------------------------------------------------------------
  // 6. Strategy-not-wound (warning).
  // -------------------------------------------------------------------------
  const woundHits = WOUND_DIRECT_RED_FLAGS.filter((rule) => rule.pattern.test(haystack));
  checks.push({
    id: "r3_strategy_not_wound",
    label: "Attacks avoidance strategy, not the wound directly",
    status: woundHits.length > 0 ? "warning" : "passed",
    message:
      woundHits.length > 0
        ? `Module asks for direct-wound confession (${woundHits.map((w) => w.label).join("; ")}). Rewrite to attack the BEHAVIOR (intellectualization, caretaking, ritual, withholding) instead.`
        : "Module attacks behavior / strategy. No direct-wound confession asks detected.",
  });

  // -------------------------------------------------------------------------
  // 7. Module distinctness (warning).
  // -------------------------------------------------------------------------
  let distinctnessMessage =
    "Module's purpose is distinct from sibling modules in this pass.";
  let distinctnessStatus: "passed" | "warning" = "passed";
  if (args.siblingModules && args.siblingModules.length > 0) {
    const overlapping = args.siblingModules.filter(
      (sib) =>
        sib.id !== m.id &&
        sib.psychologicalTarget &&
        m.psychologicalTarget &&
        sib.psychologicalTarget.trim().toLowerCase() ===
          m.psychologicalTarget.trim().toLowerCase()
    );
    if (overlapping.length > 0) {
      distinctnessStatus = "warning";
      distinctnessMessage = `Psychological target matches ${overlapping.length} other module${overlapping.length === 1 ? "" : "s"} in this pass (${overlapping
        .map((s) => `"${s.name}"`)
        .join(", ")}). Consider sharpening this module's distinct function.`;
    }
  }
  checks.push({
    id: "r3_module_distinctness",
    label: "Module distinctness (no duplicate jobs)",
    status: distinctnessStatus,
    message: distinctnessMessage,
  });

  return { module: m, audit: { checks, repairs } };
}

// ============================================================================
// R4 — Season Arc audit
// ============================================================================

/** Phrases that frame Selvaje as a fraud/scam/cult in R4 revelations. */
const R4_SOLANO_FRAMING_FLAGS = [
  /\bSolano\s+is\s+(lying|a\s+fraud|a\s+con|a\s+cult\s+leader)/i,
  /\bSelvaje\s+is\s+(a\s+scam|a\s+con|a\s+lie|fake)/i,
  /\bProtocol\s+is\s+(fake|a\s+scam|a\s+lie)/i,
  /\bexpose\s+(Solano|Selvaje)/i,
];

/** Phrases in early episodes that point at Paul's late reveal. */
const R4_PAUL_TIMING_FLAGS = PAUL_REVEAL_RED_FLAGS;

function episodeHaystack(ep: RedevSeasonArcEpisode): string {
  return [
    ep.theme,
    ep.characterBreakthrough,
    ep.characterCollision,
    ep.mysteryProgression,
    ep.revelation,
    ep.cliffhanger,
    ep.episode1Plant,
  ]
    .filter(Boolean)
    .join("\n");
}

export function auditAndRepairSeasonArc(args: {
  episodes: RedevSeasonArcEpisode[];
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  /** Free-text classifications for approved-but-not-primary modules.
   *  The R4 module-usage check passes if every approved module's NAME
   *  appears either as a primary episode anchor OR somewhere in this
   *  text (case-insensitive substring match). */
  supportingModuleUsageNotes?: string;
}): { episodes: RedevSeasonArcEpisode[]; audit: AuditReport } {
  const checks: AuditCheck[] = [];
  const repairs: AuditRepair[] = [];
  const episodes = args.episodes.map((e) => ({ ...e }));

  // -------------------------------------------------------------------------
  // 1. Episode engine completeness.
  // -------------------------------------------------------------------------
  const missingFields: Array<{ ep: number; field: string }> = [];
  const requiredFields: Array<keyof RedevSeasonArcEpisode> = [
    "title",
    "theme",
    "protocolModule",
    "characterBreakthrough",
    "characterCollision",
    "mysteryProgression",
    "revelation",
    "cliffhanger",
  ];
  for (const ep of episodes) {
    for (const field of requiredFields) {
      const v = ep[field];
      if (typeof v !== "string" || !v.trim()) {
        missingFields.push({ ep: ep.number, field: String(field) });
      }
    }
  }
  checks.push({
    id: "r4_episode_engine",
    label: "Episode engine completeness",
    status: missingFields.length > 0 ? "warning" : "passed",
    message:
      missingFields.length > 0
        ? `${missingFields.length} required field${missingFields.length === 1 ? "" : "s"} missing across episodes: ${missingFields
            .slice(0, 4)
            .map((m) => `EP${String(m.ep).padStart(2, "0")}.${m.field}`)
            .join(", ")}${missingFields.length > 4 ? "…" : ""}.`
        : "Every episode has all 8 required fields populated.",
  });

  // -------------------------------------------------------------------------
  // 2. Paul timing (warning — late-season reveal must not surface in EP1–5).
  // -------------------------------------------------------------------------
  const paulTimingHits: Array<{ ep: number; phrase: string }> = [];
  for (const ep of episodes) {
    if (ep.number > 5) continue; // EP6/7/8 may surface the reveal
    const hay = episodeHaystack(ep);
    for (const re of R4_PAUL_TIMING_FLAGS) {
      const match = hay.match(re);
      if (match) paulTimingHits.push({ ep: ep.number, phrase: match[0] });
    }
  }
  checks.push({
    id: "r4_paul_timing",
    label: "Paul reveal timing (EP06/07 only)",
    status: paulTimingHits.length > 0 ? "warning" : "passed",
    message:
      paulTimingHits.length > 0
        ? `Paul's late-season reveal appears too early in: ${paulTimingHits
            .slice(0, 3)
            .map((h) => `EP${String(h.ep).padStart(2, "0")} ("${h.phrase}")`)
            .join(", ")}. Restrict EP1–5 to behavioral pressure only.`
        : "Paul's late-season reveal is protected. EP1–5 use behavioral pressure only.",
  });

  // -------------------------------------------------------------------------
  // 3. Nadia / Elena timing (Elena must be planted EP1).
  // -------------------------------------------------------------------------
  const ep1 = episodes.find((e) => e.number === 1);
  const ep1Haystack = ep1 ? episodeHaystack(ep1) : "";
  const elenaInEp1 =
    /\bElena\b/i.test(ep1Haystack) ||
    /\bsister\b/i.test(ep1Haystack) ||
    /\bmissing\s+(woman|sister)\b/i.test(ep1Haystack);
  checks.push({
    id: "r4_nadia_elena_timing",
    label: "Elena / Nadia's sister planted in EP01",
    status: elenaInEp1 ? "passed" : "warning",
    message: elenaInEp1
      ? "Elena / Nadia's sister thread is planted in Episode 1 — investigation will read as personal before audience knows why."
      : "Elena / Nadia's sister doesn't appear in EP01 fields. Plant her early — investigation must feel personal before the audience understands why.",
  });

  // -------------------------------------------------------------------------
  // 4. Solano framing (warning).
  // -------------------------------------------------------------------------
  const allText = episodes.map(episodeHaystack).join("\n");
  const solanoHits = R4_SOLANO_FRAMING_FLAGS.filter((re) => re.test(allText));
  checks.push({
    id: "r4_solano_framing",
    label: "Solano ethics (not a fraud / scam / con)",
    status: solanoHits.length > 0 ? "warning" : "passed",
    message:
      solanoHits.length > 0
        ? `${solanoHits.length} episode field${solanoHits.length === 1 ? "" : "s"} frame Solano / Selvaje as a fraud / scam / con. The mystery is what the Protocol DOES to people, not whether it's fake. Rewrite via Regenerate with notes.`
        : "No 'expose Solano' / 'Selvaje is a scam' framing detected.",
  });

  // -------------------------------------------------------------------------
  // 5. Pilot plant usefulness.
  //    Each episode1Plant must be reasonably specific (not just a mood).
  //    Heuristic: at least one of behavior, prop, location, sound, line,
  //    visual cue, relationship dynamic must be name-able.
  // -------------------------------------------------------------------------
  const plantRedFlags: Array<{ ep: number; reason: string }> = [];
  const VAGUE_PLANT_PATTERNS = [
    /^a\s+sense\s+of/i,
    /^the\s+feeling\s+of/i,
    /^mood\s+of/i,
    /^atmosphere\s+of/i,
    /^vibe\s+of/i,
  ];
  for (const ep of episodes) {
    const plant = (ep.episode1Plant ?? "").trim();
    if (!plant) {
      plantRedFlags.push({ ep: ep.number, reason: "empty" });
      continue;
    }
    if (plant.length < 30) {
      plantRedFlags.push({ ep: ep.number, reason: "too short to be filmable" });
      continue;
    }
    if (VAGUE_PLANT_PATTERNS.some((re) => re.test(plant))) {
      plantRedFlags.push({ ep: ep.number, reason: "starts with vague mood phrase" });
    }
  }
  checks.push({
    id: "r4_pilot_plant_usefulness",
    label: "Pilot-plant fields are filmable",
    status: plantRedFlags.length > 0 ? "warning" : "passed",
    message:
      plantRedFlags.length > 0
        ? `${plantRedFlags.length} episode${plantRedFlags.length === 1 ? "" : "s"} have weak Episode 1 plants: ${plantRedFlags
            .slice(0, 3)
            .map((p) => `EP${String(p.ep).padStart(2, "0")} (${p.reason})`)
            .join(", ")}. R5 Pilot Strategy will need specific plants — name a behavior, prop, location, sound cue, or line.`
        : "Every episode's pilot plant is specific enough to use in R5 (behavior, prop, location, sound, line, or visual motif).",
  });

  // -------------------------------------------------------------------------
  // 6. Finale logic (EP08 must touch the architectural questions).
  // -------------------------------------------------------------------------
  const ep8 = episodes.find((e) => e.number === 8);
  let finaleStatus: "passed" | "warning" = "passed";
  let finaleMessage =
    "EP08 touches the architectural questions: Selvaje's effect, Elena's choice, Paul's truth, character arcs.";
  if (ep8) {
    const ep8Text = episodeHaystack(ep8).toLowerCase();
    const required = [
      { tag: "Selvaje's effect on people", patterns: [/selvaje/i, /protocol/i] },
      { tag: "Elena's choice", patterns: [/elena/i, /sister/i, /chose/i, /chose\s+selvaje/i] },
      { tag: "Paul's truth", patterns: [/paul/i, /accident/i, /text/i, /timestamp/i] },
      { tag: "Margot's arc", patterns: [/margot/i] },
      { tag: "Claire's arc", patterns: [/claire/i] },
    ];
    const missing = required.filter((r) => !r.patterns.some((p) => p.test(ep8Text)));
    if (missing.length > 0) {
      finaleStatus = "warning";
      finaleMessage = `EP08 doesn't surface: ${missing.map((m) => m.tag).join(", ")}. Finale should answer the season's load-bearing questions.`;
    }
  } else {
    finaleStatus = "warning";
    finaleMessage = "EP08 is missing from the arc.";
  }
  checks.push({
    id: "r4_finale_logic",
    label: "Finale logic (EP08 answers the architecture)",
    status: finaleStatus,
    message: finaleMessage,
  });

  // -------------------------------------------------------------------------
  // 7. Approved module usage.
  //    A module is "accounted for" if its name appears either:
  //      • on at least one episode's `protocolModule` field (primary
  //        episode anchor), OR
  //      • in `supportingModuleUsageNotes` (classified as supporting /
  //        embedded / alternate / saved-for-future-season).
  //    Case-insensitive substring matching on the module name. The
  //    showrunner explicitly classifies non-primary modules in the
  //    Supporting / Embedded Module Usage textarea on R4.
  // -------------------------------------------------------------------------
  const approvedModules = args.protocolModules.filter((m) => !!m.approvedAt);
  const usedModuleNames = new Set(
    episodes
      .map((ep) => ep.protocolModule.toLowerCase())
      .filter((s) => s.length > 0)
  );
  const supportingNotesLower = (args.supportingModuleUsageNotes ?? "").toLowerCase();
  const unclassified: Array<{ name: string }> = [];
  const supportingOnly: Array<{ name: string }> = [];
  for (const m of approvedModules) {
    const nameLower = m.name.toLowerCase();
    const isPrimary = Array.from(usedModuleNames).some((u) => u.includes(nameLower));
    if (isPrimary) continue;
    const isSupporting = supportingNotesLower.includes(nameLower);
    if (isSupporting) {
      supportingOnly.push({ name: m.name });
    } else {
      unclassified.push({ name: m.name });
    }
  }
  let usageStatus: "passed" | "warning";
  let usageMessage: string;
  if (unclassified.length > 0) {
    usageStatus = "warning";
    usageMessage = `${unclassified.length} approved module${
      unclassified.length === 1 ? "" : "s"
    } not accounted for as primary OR supporting: ${unclassified
      .map((u) => `"${u.name}"`)
      .join(", ")}. Either assign as a primary anchor on an episode, or classify in the Supporting / Embedded Module Usage field.`;
  } else if (supportingOnly.length > 0) {
    usageStatus = "passed";
    usageMessage = `Every approved R3 Protocol module is accounted for — ${
      approvedModules.length - supportingOnly.length
    } as primary episode anchor${approvedModules.length - supportingOnly.length === 1 ? "" : "s"}, ${
      supportingOnly.length
    } as supporting / embedded / alternate (${supportingOnly.map((s) => `"${s.name}"`).join(", ")}).`;
  } else {
    usageStatus = "passed";
    usageMessage =
      "Every approved R3 Protocol module appears as a primary anchor on at least one episode.";
  }
  checks.push({
    id: "r4_approved_module_usage",
    label: "Approved module usage",
    status: usageStatus,
    message: usageMessage,
  });

  return { episodes, audit: { checks, repairs } };
}

// ============================================================================
// R5 — Pilot Strategy audit (warning-only)
// ============================================================================
//
// R5 produces nine free-text lists. The validator is deliberately light:
// it surfaces issues for the showrunner to address (or accept) without
// auto-rewriting creative text. This matches the R4 warning-only stance.

const R5_REQUIRED_KEYS: Array<keyof RedevPilotStrategy> = [
  "whatMustChange",
  "whatMustRemain",
  "newSeedsToPlant",
  "oldBeatsToRemove",
  "characterIntroAdjustments",
  "protocolPhilosophyMoments",
  "mysteryPlants",
  "characterArcPlants",
  "finalHookOptions",
];

const R5_KEY_LABEL: Record<string, string> = {
  whatMustChange: "What must change",
  whatMustRemain: "What must remain",
  newSeedsToPlant: "New seeds to plant",
  oldBeatsToRemove: "Old beats to remove",
  characterIntroAdjustments: "Character intro adjustments",
  protocolPhilosophyMoments: "Protocol philosophy moments",
  mysteryPlants: "Mystery plants",
  characterArcPlants: "Character arc plants",
  finalHookOptions: "Final hook options",
};

/** Tokenize a character's `characterName` into the aliases that should
 *  COUNT as the character being named. Strategy text often uses just
 *  the first name (e.g. "Margot's intro should…") which is fine
 *  creatively — the validator should not fail that. We keep every
 *  whitespace-separated token of length ≥ 4 (skips "Dr.", "Mr", "Mrs")
 *  alongside the full lowercased name. */
function characterNameAliases(fullName: string): string[] {
  const lower = fullName.toLowerCase();
  const tokens = lower
    .split(/\s+/)
    .map((t) => t.replace(/[.,]/g, "").trim())
    .filter((t) => t.length >= 4);
  return Array.from(new Set([lower, ...tokens]));
}

/** Words that, when they appear in the same sentence BEFORE a forbidden
 *  pattern match, indicate the showrunner is WARNING AGAINST the thing,
 *  not advocating it. Matches user spec: "do not reveal", "must not",
 *  "avoid", "protect", "remove", "should not", etc. */
const NEGATION_HINTS = [
  "do not",
  "must not",
  "should not",
  "cannot",
  "no ",
  "not ",
  "never",
  "avoid",
  "avoiding",
  "protect",
  "protected",
  "remove",
  "removed",
  "must remain",
  "do not surface",
  "do not expose",
  "do not reveal",
];

/** Given a haystack and a match, return TRUE if the surrounding sentence
 *  contains a negation hint BEFORE the match — i.e. the forbidden phrase
 *  is being warned against, not advocated. The sentence window is the
 *  text from the nearest preceding sentence boundary (./!/?/newline) up
 *  to and including the match. */
function matchIsNegated(haystack: string, matchIndex: number, matchLength: number): boolean {
  const start = (() => {
    let i = matchIndex - 1;
    while (i >= 0 && !".!?\n".includes(haystack[i])) i--;
    return i + 1;
  })();
  const window = haystack.slice(start, matchIndex + matchLength).toLowerCase();
  return NEGATION_HINTS.some((h) => window.includes(h));
}

/** Run every regex over the haystack and return true iff any match is
 *  NOT negated. Used to make Paul / Solano reveal checks robust to
 *  protective phrasing like "do not reveal Paul's texting in the pilot". */
function unnegatedHit(haystack: string, patterns: RegExp[]): boolean {
  for (const re of patterns) {
    // We need `g` flag to iterate every match. Clone the source regex
    // so we don't mutate a shared lastIndex.
    const gre = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = gre.exec(haystack)) !== null) {
      if (!matchIsNegated(haystack, m.index, m[0].length)) return true;
    }
  }
  return false;
}

export interface PilotStrategyAuditContext {
  /** When TRUE, the strategy was grounded in a real EP01 draft (scene
   *  summaries were available). Drives `r5_pilot_draft_read`. */
  pilotDraftRead?: boolean;
  /** EP01 draft number, when known. Used in the audit message. */
  pilotDraftNumber?: number | null;
  /** EP01 scene count read into context. Drives the message when >0. */
  pilotSceneCount?: number;
}

export function auditAndRepairPilotStrategy(args: {
  strategy: Omit<RedevPilotStrategy, "approvedAt">;
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  seasonArc: RedevSeasonArcEpisode[];
  /** Optional provenance context — only available right after a fresh
   *  generation. When omitted, the provenance checks degrade to a
   *  neutral message rather than a false-positive warning. */
  context?: PilotStrategyAuditContext;
  /** Approved R3 modules for the Surrender-driver + protocol-philosophy
   *  checks. When omitted, those checks degrade gracefully. */
  protocolModules?: { name: string; approvedAt: string | null }[];
}): AuditReport {
  const checks: AuditCheck[] = [];
  const repairs: AuditRepair[] = []; // R5 is warning-only; repairs stays empty.
  const s = args.strategy;

  // 1. Lists populated — every bucket has at least one concrete item.
  const empty = R5_REQUIRED_KEYS.filter(
    (k) => !Array.isArray(s[k]) || (s[k] as string[]).length === 0
  );
  checks.push({
    id: "r5_lists_populated",
    label: "Strategy completeness",
    status: empty.length === 0 ? "passed" : "warning",
    message:
      empty.length === 0
        ? "All nine strategy buckets are populated."
        : `${empty.length} bucket(s) are empty: ${empty
            .map((k) => R5_KEY_LABEL[k] ?? k)
            .join(", ")}. Regenerate or add at least one item to each.`,
  });

  // 2. Character coverage — every approved bible character is named
  //    somewhere. Accepts first-name OR full-name OR any other ≥4-char
  //    token from the bible name. "Margot" counts for "Margot Ellison";
  //    "Solano" counts for "Dr. Izel Solano". (The earlier strict
  //    full-name check produced false positives because the strategy
  //    naturally uses first names in headings.)
  const approvedBibles = args.characterBibles.filter((b) => !!b.approvedAt);
  const flat = [
    ...s.whatMustChange,
    ...s.whatMustRemain,
    ...s.newSeedsToPlant,
    ...s.oldBeatsToRemove,
    ...s.characterIntroAdjustments,
    ...s.protocolPhilosophyMoments,
    ...s.mysteryPlants,
    ...s.characterArcPlants,
    ...s.finalHookOptions,
  ]
    .join(" \n ")
    .toLowerCase();
  const missingChars = approvedBibles.filter((b) => {
    const aliases = characterNameAliases(b.characterName);
    // Per alias, use a word-boundary regex so "izel" doesn't match
    // "izelite" or similar. Word boundaries also catch first names at
    // the start of a heading line, in possessives like "Margot's", etc.
    return !aliases.some((alias) => {
      const re = new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      return re.test(flat);
    });
  });
  checks.push({
    id: "r5_character_coverage",
    label: "Character coverage",
    status: missingChars.length === 0 ? "passed" : "warning",
    message:
      missingChars.length === 0
        ? `Every approved principal is named somewhere in the strategy (${approvedBibles.length} character${approvedBibles.length === 1 ? "" : "s"}). First names + full names both accepted.`
        : `${missingChars.length} approved principal(s) not named in the strategy: ${missingChars
            .map((c) => c.characterName)
            .join(", ")}. The pilot strategy should at minimum address each principal's intro.`,
  });

  // 3. No "remain ↔ change" contradictions — same exact line in both lists.
  const remainSet = new Set(s.whatMustRemain.map((x) => x.trim().toLowerCase()));
  const conflicts = s.whatMustChange.filter((x) =>
    remainSet.has(x.trim().toLowerCase())
  );
  checks.push({
    id: "r5_no_contradictions",
    label: "Internal consistency",
    status: conflicts.length === 0 ? "passed" : "warning",
    message:
      conflicts.length === 0
        ? "No items appear in both 'what must change' and 'what must remain'."
        : `${conflicts.length} item(s) appear in both 'change' AND 'remain': ${conflicts
            .slice(0, 2)
            .map((c) => `"${c.slice(0, 60)}${c.length > 60 ? "…" : ""}"`)
            .join(", ")}${conflicts.length > 2 ? ", …" : ""}. Pick one.`,
  });

  // 4. Hook options — need at least 2 distinct candidates.
  const hookCount = s.finalHookOptions.filter((h) => h.trim().length > 0).length;
  checks.push({
    id: "r5_hook_options",
    label: "Final hook options",
    status: hookCount >= 2 ? "passed" : "warning",
    message:
      hookCount >= 2
        ? `${hookCount} distinct pilot-ending hook options offered.`
        : `Only ${hookCount} hook option(s) provided. R5 should propose at least 2 alternatives so you can pick.`,
  });

  // 5. Seeds match arc — every season-arc episode1Plant is reflected in
  //    newSeedsToPlant OR whatMustRemain (if already present in the draft).
  const arcPlants = args.seasonArc
    .map((e) => e.episode1Plant.trim())
    .filter((p) => p.length > 0);
  if (arcPlants.length > 0) {
    const seedsAndRemainsLower = [
      ...s.newSeedsToPlant,
      ...s.whatMustRemain,
    ]
      .join(" \n ")
      .toLowerCase();
    // For coverage, look for a few content keywords from each plant.
    const KEYWORD_MIN_LEN = 5;
    const STOPWORDS = new Set([
      "the",
      "and",
      "for",
      "from",
      "that",
      "with",
      "into",
      "this",
      "what",
      "their",
      "they",
      "them",
      "have",
      "will",
      "scene",
      "would",
      "about",
      "where",
    ]);
    const missingPlants = arcPlants.filter((plant) => {
      const words = plant
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length >= KEYWORD_MIN_LEN && !STOPWORDS.has(w));
      if (words.length === 0) return false;
      // Plant counts as covered if ≥1 distinctive word appears in seeds/remains.
      return !words.some((w) => seedsAndRemainsLower.includes(w));
    });
    checks.push({
      id: "r5_seeds_match_arc",
      label: "Season-arc plants covered",
      status: missingPlants.length === 0 ? "passed" : "warning",
      message:
        missingPlants.length === 0
          ? `Every season-arc EP01 plant is reflected in the pilot strategy (${arcPlants.length} plant${arcPlants.length === 1 ? "" : "s"} covered).`
          : `${missingPlants.length} season-arc EP01 plant(s) appear to be missing from newSeedsToPlant / whatMustRemain. First missing: "${missingPlants[0].slice(0, 80)}${missingPlants[0].length > 80 ? "…" : ""}".`,
    });
  }

  // 6. Solano framing — flag any "Solano lying / fraud / reveal she's a
  //    fraud" framing, BUT skip when the surrounding sentence shows the
  //    showrunner is explicitly warning against that framing (negation
  //    hints like "do not frame Solano as a fraud").
  const SOLANO_FRAUD_PATTERNS = [
    /\bsolano\b[^.]{0,80}\b(lying|liar|fraud|fake|deceiv|manipulat)/i,
    /\b(reveal|expose|prove)\b[^.]{0,40}\bsolano\b[^.]{0,40}\bnot\b/i,
  ];
  const solanoIssues = flat ? unnegatedHit(flat, SOLANO_FRAUD_PATTERNS) : false;
  checks.push({
    id: "r5_solano_framing",
    label: "Solano framing",
    status: solanoIssues ? "warning" : "passed",
    message: solanoIssues
      ? "Strategy text hints at framing Solano as a fraud / liar. Per the Solano Rule, the Protocol works; the danger is truth, not deception."
      : "Strategy text honors the Solano Rule (Protocol works; danger is truth).",
  });

  // 7. Paul timing — flag attempts to expose Paul's late-season reveal
  //    early. Skips negated contexts so "do not reveal Paul's texting in
  //    the pilot" reads as a PROTECTION, not a violation. (Prior
  //    strict-regex version produced false positives on protective
  //    phrasing — the showrunner saw a warning for a sentence that was
  //    literally protecting the reveal.)
  const PAUL_LATE_REVEAL = [
    /\bpaul\b[^.]{0,80}\b(texting|texts)\b/i,
    /\bpaul\b[^.]{0,80}\b(affair|cheating)\b[^.]{0,40}\b(expose|reveal)/i,
  ];
  const paulIssues = flat ? unnegatedHit(flat, PAUL_LATE_REVEAL) : false;
  checks.push({
    id: "r5_paul_timing",
    label: "Paul reveal timing",
    status: paulIssues ? "warning" : "passed",
    message: paulIssues
      ? "Strategy text hints at exposing Paul's late-season reveal in the pilot. Plant unease only; the texting/affair reveal is architected for episode 6-7."
      : "Pilot strategy keeps Paul's late-season reveal protected (negated phrasing like 'do not reveal' is counted as protective, not violating).",
  });

  // ===== Provenance + scope checks =====================================
  //
  // 8. Pilot draft read — was the strategy grounded in a real EP01
  //    script? Only reported when context is provided (i.e. the audit
  //    runs as part of a generation). On the read-only audit endpoint
  //    we don't have provenance, so the check degrades to a neutral
  //    "not applicable" rather than a false-positive warning.
  if (args.context) {
    const wasRead = !!args.context.pilotDraftRead && (args.context.pilotSceneCount ?? 0) > 0;
    checks.push({
      id: "r5_pilot_draft_read",
      label: "Pilot draft read",
      status: wasRead ? "passed" : "warning",
      message: wasRead
        ? `Strategy was grounded in EP01${
            args.context.pilotDraftNumber != null
              ? ` Draft ${args.context.pilotDraftNumber}`
              : ""
          } — ${args.context.pilotSceneCount} scene${args.context.pilotSceneCount === 1 ? "" : "s"} read.`
        : "No EP01 draft was read. Recommendations are principle-level only. Write the pilot first if you want scene-specific callouts.",
    });
  }

  // 9. Architecture used — R1-R4 approved? This is a precondition check;
  //    if a generation succeeded with everything approved, this passes.
  if (args.context) {
    const r1ok = !!args.brief.approvedAt;
    const r2approved = args.characterBibles.filter((b) => b.approvedAt).length;
    const r2total = args.characterBibles.length;
    const r3approved = (args.protocolModules ?? []).filter((m) => m.approvedAt).length;
    const r3total = (args.protocolModules ?? []).length;
    const r4ok = args.seasonArc.length > 0;
    const allOk = r1ok && r2approved === r2total && r2approved > 0 && r4ok;
    checks.push({
      id: "r5_architecture_used",
      label: "R1–R4 architecture used",
      status: allOk ? "passed" : "warning",
      message: allOk
        ? `Strategy used: R1 brief (approved), ${r2approved}/${r2total} character bibles, ${r3approved}/${r3total} protocol modules, ${args.seasonArc.length}-episode arc.`
        : "Some upstream redevelopment stages are missing approval. The strategy may be incomplete — re-approve R1-R4 and regenerate.",
    });
  }

  // 10. No screenplay pages — R5 is strategy only, not scene text. Flag
  //     items that look like screenplay (FADE IN, INT./EXT., scene
  //     headings, action paragraphs, or stage directions).
  const SCREENPLAY_PATTERNS = [
    /\bFADE\s+(IN|OUT)\b/,
    /\b(INT|EXT)\.\s+[A-Z]/,
    /\b(CONTINUED|CONT'D|V\.O\.|O\.S\.)\b/,
    /\([A-Z][a-z]+\s+[a-z]+,?\s+(then|now|softly|quietly|then,)\)/, // "(beat, then quietly)"
  ];
  const screenplayHits = flat.length > 0
    ? SCREENPLAY_PATTERNS.some((re) => re.test(flat))
    : false;
  checks.push({
    id: "r5_no_screenplay_pages",
    label: "Strategy scope (no screenplay)",
    status: screenplayHits ? "warning" : "passed",
    message: screenplayHits
      ? "Strategy text contains screenplay-style formatting (FADE IN, INT./EXT., parentheticals). R5 is strategy only — the screenplay rewrite happens in R6."
      : "Strategy stayed in strategy form — no screenplay pages.",
  });

  // ===== SELVAJE-specific plant + driver checks =========================
  //
  // 11. EP01 plants are specific and filmable — i.e. concrete enough for
  //     production. Flag plants that read as abstract themes.
  const VAGUE_PLANT_HINTS = [
    /^a sense of/i,
    /^a feeling of/i,
    /^a hint of/i,
    /^something is/i,
    /^the audience feels/i,
  ];
  const vaguePlants = s.newSeedsToPlant.filter((p) =>
    VAGUE_PLANT_HINTS.some((re) => re.test(p.trim()))
  );
  checks.push({
    id: "r5_plants_filmable",
    label: "EP01 plants are specific and filmable",
    status: vaguePlants.length === 0 ? "passed" : "warning",
    message:
      vaguePlants.length === 0
        ? "EP01 plants read as concrete, filmable beats (an object, an action, a specific line) — production-ready."
        : `${vaguePlants.length} plant(s) read as abstract feeling/atmosphere instead of a concrete beat: "${vaguePlants[0].slice(0, 80)}${vaguePlants[0].length > 80 ? "…" : ""}". Rewrite as an action, object, or specific moment a camera can see.`,
  });

  // 12. Elena protected — Nadia's sister mystery must be planted in the
  //     pilot but the sister RELATIONSHIP shouldn't be surfaced too
  //     early. Flag explicit "Elena is Nadia's sister" in the pilot
  //     plants; negation-aware.
  const ELENA_SISTER_REVEAL = [
    /\belena\b[^.]{0,60}\b(is|was)\b[^.]{0,40}\b(nadia'?s?\s+)?sister\b/i,
    /\bnadia'?s?\s+sister\b[^.]{0,40}\belena\b/i,
  ];
  const elenaIssues = flat ? unnegatedHit(flat, ELENA_SISTER_REVEAL) : false;
  checks.push({
    id: "r5_elena_protected",
    label: "Elena planted, sister relationship protected",
    status: elenaIssues ? "warning" : "passed",
    message: elenaIssues
      ? "Strategy explicitly states Elena is Nadia's sister in the pilot. The relationship reveal lands later — plant Elena as an absence / object / fact only."
      : "Elena can be planted in the pilot without revealing the sister relationship.",
  });

  // 13. Archive room plant — SELVAJE EP01 requires the archive room
  //     plant. Flag if no plant references the archive.
  const archiveMentioned = /\barchive\b/i.test(flat);
  checks.push({
    id: "r5_archive_room_plant",
    label: "Archive room plant included",
    status: archiveMentioned ? "passed" : "warning",
    message: archiveMentioned
      ? "Archive room plant is present in the strategy."
      : "No mention of the archive room. The SELVAJE pilot requires an archive room plant — add it to newSeedsToPlant.",
  });

  // 14. Margot professional identity plant — Margot's identity as a
  //     diagnostician/analyst must be visible in the pilot. Flag if the
  //     strategy mentions Margot but doesn't address her professional /
  //     analytical identity.
  const margotPro =
    /\bmargot\b[^.]{0,120}\b(analy[sz]|diagnos|professional|psychiatrist|psycholog|therapist|clinician|forensic)/i.test(
      flat
    );
  const margotMentioned = /\bmargot\b/i.test(flat);
  checks.push({
    id: "r5_margot_professional_identity",
    label: "Margot professional identity plant",
    status: margotPro ? "passed" : "warning",
    message: margotPro
      ? "Margot's professional / analytical identity is planted in the pilot strategy."
      : margotMentioned
        ? "Margot is mentioned but her professional / analytical identity isn't planted. Add a beat showing she reads behavior diagnostically — that's her avoidance."
        : "Margot is not addressed in the strategy. Add her intro adjustment and a plant for her analytical identity.",
  });

  // 15. Surrender drives the pilot — Surrender must be the pilot's
  //     primary Protocol module (matches the SELVAJE pilot architecture).
  //     Look for "surrender" in either protocolPhilosophyMoments or
  //     newSeedsToPlant or whatMustRemain.
  const surrenderText = [
    ...s.protocolPhilosophyMoments,
    ...s.newSeedsToPlant,
    ...s.whatMustRemain,
    ...s.characterIntroAdjustments,
  ]
    .join(" \n ")
    .toLowerCase();
  const surrenderDrives = /\bsurrender\b/i.test(surrenderText);
  checks.push({
    id: "r5_surrender_drives_pilot",
    label: "Surrender module drives the pilot",
    status: surrenderDrives ? "passed" : "warning",
    message: surrenderDrives
      ? "The Surrender module is named as a driver in the pilot strategy."
      : "Surrender (the pilot's foundational Protocol module) isn't named in the strategy. Add it to protocolPhilosophyMoments or newSeedsToPlant.",
  });

  return { checks, repairs };
}

// ============================================================================
// R6 — Guardrails audit (warning-only)
// ============================================================================
//
// Checks the bundle is complete + each contract is non-empty + the
// SELVAJE protections (Paul / Elena / Solano / Surrender / final hook)
// are honored. Warning-only — the showrunner reviews and decides.

const R6_PAUL_PROTECTED_REVEALS = [
  "texting",
  "accident responsibility",
  "timestamp",
  "paul's guilt",
  "innocent driver",
  "wrongful blame",
];

const R6_SOLANO_FRAUD_LANGUAGE = [
  "lying",
  "liar",
  "fraud",
  "fake",
  "deceiv",
  "manipulat",
];

export function auditAndRepairR6Guardrails(args: {
  bundle: RedevR6GuardrailsBundle;
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
}): AuditReport {
  const checks: AuditCheck[] = [];
  const repairs: AuditRepair[] = [];
  const { perCharacter, globalRule } = args.bundle;

  // 1. All approved principals have contracts. First-name-aware match.
  const approvedBibles = args.characterBibles.filter((b) => !!b.approvedAt);
  const haveContract = new Set(
    perCharacter.map((g) => g.characterName.toLowerCase())
  );
  const missing = approvedBibles.filter((b) => {
    const fn = b.characterName.split(/\s+/)[0]?.toLowerCase() ?? "";
    return ![...haveContract].some((c) => {
      return (
        c === b.characterName.toLowerCase() ||
        (fn.length >= 4 && c.includes(fn))
      );
    });
  });
  checks.push({
    id: "r6_all_principals_covered",
    label: "All approved principals have guardrails",
    status: missing.length === 0 ? "passed" : "warning",
    message:
      missing.length === 0
        ? `Every approved principal has a guardrail contract (${approvedBibles.length} total).`
        : `${missing.length} approved principal(s) missing a guardrail contract: ${missing
            .map((b) => b.characterName)
            .join(", ")}. Click 'Generate guardrails from approved strategy' to auto-create.`,
  });

  // 2. Each contract has at least one plant.
  const noPlants = perCharacter.filter((g) => g.plants.length === 0);
  checks.push({
    id: "r6_each_has_plants",
    label: "Each contract has a plant",
    status: noPlants.length === 0 ? "passed" : "warning",
    message:
      noPlants.length === 0
        ? "Every per-character contract has at least one camera-visible plant."
        : `${noPlants.length} contract(s) have no plants: ${noPlants.map((g) => g.characterName).join(", ")}. Add at least one behavior the camera can see.`,
  });

  // 3. Each contract has at least one doNotReveal.
  const noDNR = perCharacter.filter((g) => g.doNotReveal.length === 0);
  checks.push({
    id: "r6_each_has_donotreveal",
    label: "Each contract has a protection",
    status: noDNR.length === 0 ? "passed" : "warning",
    message:
      noDNR.length === 0
        ? "Every per-character contract has at least one 'do NOT reveal' protection."
        : `${noDNR.length} contract(s) have no 'do NOT reveal' protections: ${noDNR.map((g) => g.characterName).join(", ")}. Add at least one fact the pilot must not surface.`,
  });

  // 4. Paul reveal protected. Look for Paul's guardrail; require that
  //    its doNotReveal mentions the architectural protections (texting,
  //    accident responsibility, timestamp, guilt).
  const paulGuard = perCharacter.find((g) =>
    /paul/i.test(g.characterName)
  );
  let paulProtected = false;
  let paulMessage = "";
  if (!paulGuard) {
    paulMessage = "No Paul guardrail. Add Paul Beaumont and protect his late-season reveal.";
  } else {
    const dnrText = paulGuard.doNotReveal.join(" | ").toLowerCase();
    const matched = R6_PAUL_PROTECTED_REVEALS.filter((r) => dnrText.includes(r));
    paulProtected = matched.length >= 2;
    paulMessage = paulProtected
      ? `Paul's late-season reveal is protected — guardrail names ${matched.length} of the architectural protections (${matched.slice(0, 3).join(", ")}${matched.length > 3 ? ", …" : ""}).`
      : "Paul's guardrail doesn't fully protect the late-season reveal. Add: texting, accident responsibility, timestamp evidence, Paul's guilt to 'do NOT reveal'.";
  }
  checks.push({
    id: "r6_paul_reveal_protected",
    label: "Paul reveal protected",
    status: paulProtected ? "passed" : "warning",
    message: paulMessage,
  });

  // 5. Elena / sister relationship protected. Find a Nadia guardrail
  //    and require doNotReveal to name the sister relationship.
  const nadiaGuard = perCharacter.find((g) =>
    /nadia/i.test(g.characterName)
  );
  let elenaProtected = false;
  let elenaMessage = "";
  if (!nadiaGuard) {
    elenaMessage = "No Nadia guardrail. Add Nadia Reyes and protect the sister-relationship reveal.";
  } else {
    const dnrText = nadiaGuard.doNotReveal.join(" | ").toLowerCase();
    elenaProtected = /\belena\b|\bsister\b/.test(dnrText);
    elenaMessage = elenaProtected
      ? "Nadia's guardrail protects the Elena / sister-relationship reveal."
      : "Nadia's guardrail doesn't protect the sister-relationship reveal. Add 'Elena is Nadia's sister' to 'do NOT reveal'.";
  }
  checks.push({
    id: "r6_elena_protected",
    label: "Elena / sister relationship protected",
    status: elenaProtected ? "passed" : "warning",
    message: elenaMessage,
  });

  // 6. Solano rule protected. Find a Solano guardrail and require
  //    doNotDo to forbid fraud / liar / manipulate framing.
  const solanoGuard = perCharacter.find((g) =>
    /solano|izel/i.test(g.characterName)
  );
  let solanoProtected = false;
  let solanoMessage = "";
  if (!solanoGuard) {
    solanoMessage = "No Solano guardrail. Add Dr. Izel Solano and lock the Solano Rule.";
  } else {
    const dndText = solanoGuard.doNotDo.join(" | ").toLowerCase();
    solanoProtected = R6_SOLANO_FRAUD_LANGUAGE.some((r) => dndText.includes(r));
    solanoMessage = solanoProtected
      ? "Solano's guardrail honors the Solano Rule (no fraud / liar framing)."
      : "Solano's guardrail doesn't forbid fraud / liar / manipulate framing. Add a 'do NOT do' rule per the Solano Rule.";
  }
  checks.push({
    id: "r6_solano_rule_protected",
    label: "Solano rule protected",
    status: solanoProtected ? "passed" : "warning",
    message: solanoMessage,
  });

  // 7. Surrender drives the pilot — look in the global rule.
  const surrenderInGlobal = /surrender/i.test(globalRule);
  checks.push({
    id: "r6_surrender_drives_pilot",
    label: "Surrender drives the pilot",
    status: surrenderInGlobal ? "passed" : "warning",
    message: surrenderInGlobal
      ? "Global rule names Surrender as the pilot's Protocol driver."
      : "Global rule doesn't name Surrender as the pilot's driver. Add 'The pilot's engine is Surrender.' to the global rule.",
  });

  // 8. Final hook direction present in the global rule.
  const hookKeywords = ["hook", "end", "final", "close", "ending", "option"];
  const hookPresent = hookKeywords.some((k) =>
    new RegExp(`\\b${k}\\b`, "i").test(globalRule)
  );
  checks.push({
    id: "r6_final_hook_direction",
    label: "Final hook direction present",
    status: hookPresent ? "passed" : "warning",
    message: hookPresent
      ? "Global rule includes final hook direction for the rewrite."
      : "Global rule doesn't specify how the pilot should END. Add a one-line hook direction (e.g. 'End with Option A + C: bodies after Surrender, then the case, then Paul's chime response.').",
  });

  // 9. No screenplay attempted — the guardrails should not include
  //    screenplay-style formatting (FADE IN, INT./EXT., parentheticals).
  const SCREENPLAY_PATTERNS = [
    /\bFADE\s+(IN|OUT)\b/,
    /\b(INT|EXT)\.\s+[A-Z]/,
    /\([A-Z][a-z]+\s+[a-z]+,?\s+(then|now|softly|quietly)\)/,
  ];
  const allText = [
    globalRule,
    ...perCharacter.flatMap((g) => [
      ...g.plants,
      ...g.doNotReveal,
      ...g.doNotDo,
      g.executionRule,
    ]),
  ].join("\n");
  const screenplayHit = SCREENPLAY_PATTERNS.some((re) => re.test(allText));
  checks.push({
    id: "r6_no_screenplay_attempted",
    label: "No screenplay rewrite attempted",
    status: screenplayHit ? "warning" : "passed",
    message: screenplayHit
      ? "Guardrails contain screenplay-style formatting. R6 guardrails are a contract, not scene text — the rewrite happens when the R6 rewrite generator ships."
      : "Guardrails stayed at contract level — no screenplay text attempted (correct).",
  });

  // 10. Cross-character contamination — flag a per-character contract
  //     that contains another character's first name in ALL CAPS. An
  //     all-caps heading is a strong signal the item is OWNED by the
  //     other character and was misfiled. Case-sensitive on purpose:
  //     "Solano" in body text is fine; "SOLANO" as a heading in
  //     Margot's plants is contamination.
  const firstNameByFull = new Map<string, string>();
  for (const g of perCharacter) {
    const fn = g.characterName.split(/\s+/).find((t) => t.length >= 4) ?? "";
    firstNameByFull.set(g.characterName, fn);
  }
  const contaminations: string[] = [];
  // Set of EVERY principal's ALL-CAPS first name. Used for the
  // globalPlants scan below — any ALL-CAPS principal name in Global
  // Plants is contamination (the bucket is supposed to be neutral).
  const allUpperFirstNames = Array.from(firstNameByFull.values())
    .filter((fn) => fn.length >= 4)
    .map((fn) => fn.toUpperCase());

  for (const g of perCharacter) {
    const ownFn = firstNameByFull.get(g.characterName) ?? "";
    const ownFnLower = ownFn.toLowerCase();
    const allOtherFns: string[] = [];
    for (const [full, fn] of firstNameByFull) {
      if (full === g.characterName) continue;
      if (fn && fn.toLowerCase() !== ownFnLower) allOtherFns.push(fn);
    }
    const items = [
      ...g.plants,
      ...g.doNotReveal,
      ...g.doNotDo,
      g.executionRule,
    ];
    for (const item of items) {
      for (const otherFn of allOtherFns) {
        // Match ALL-CAPS occurrence of the other character's first
        // name as a standalone token. No `i` flag — case-sensitive.
        const re = new RegExp(`\\b${otherFn.toUpperCase()}\\b`);
        if (re.test(item)) {
          contaminations.push(
            `${g.characterName} contains "${otherFn.toUpperCase()}" label`
          );
          break;
        }
      }
    }
  }

  // Also scan Global Plants — that bucket should never contain ALL-CAPS
  // principal labels. If any sneak past the neutralizer, flag here so
  // the showrunner sees it on Audit.
  const globalPlantsList = args.bundle.globalPlants ?? [];
  for (const p of globalPlantsList) {
    for (const upperFn of allUpperFirstNames) {
      const re = new RegExp(`\\b${upperFn}\\b`);
      if (re.test(p)) {
        contaminations.push(`Global Plants contains "${upperFn}" label`);
        break;
      }
    }
  }
  checks.push({
    id: "r6_no_cross_contamination",
    label: "No cross-character contamination",
    status: contaminations.length === 0 ? "passed" : "warning",
    message:
      contaminations.length === 0
        ? "Per-character contracts and Global Plants are clean of ALL-CAPS principal labels."
        : `${contaminations.length} item(s) contain an ALL-CAPS principal label: ${[
            ...new Set(contaminations),
          ]
            .slice(0, 4)
            .join(" · ")}${contaminations.length > 4 ? " · …" : ""}. Convert to mixed case (e.g. "Solano", not "SOLANO") or remove.`,
  });

  // 11. Global plants separated — flag per-character plants that
  //     mention architectural keywords (archive, transparent case,
  //     photograph wall, common room). Those should live in globalPlants.
  const ARCHITECTURAL_KEYWORDS = [
    /\barchive\b/i,
    /\btransparent\s+case\b/i,
    /\bphotograph(?:s)?\s+wall\b/i,
    /\bphoto\s+wall\b/i,
    /\bcommon\s+room\b/i,
  ];
  const leaks: string[] = [];
  for (const g of perCharacter) {
    for (const p of g.plants) {
      if (ARCHITECTURAL_KEYWORDS.some((re) => re.test(p))) {
        leaks.push(
          `${g.characterName}: "${p.slice(0, 60)}${p.length > 60 ? "…" : ""}"`
        );
      }
    }
  }
  checks.push({
    id: "r6_global_plants_separated",
    label: "Global plants separated from per-character contracts",
    status: leaks.length === 0 ? "passed" : "warning",
    message:
      leaks.length === 0
        ? "Architectural plants (archive, transparent case, photograph wall, common room) are not polluting per-character contracts."
        : `${leaks.length} architectural plant(s) leaked into per-character contracts. Move to Global Plants: ${leaks
            .slice(0, 2)
            .join(" · ")}${leaks.length > 2 ? " · …" : ""}.`,
  });

  return { checks, repairs };
}

// ============================================================================
// R6 Rewrite Plan (Pass 1) audit — warning-only
// ============================================================================
//
// Plan-level safety checks before Pass 2 (actual scene text generation):
//   1. Every existing scene appears in the plan exactly once.
//   2. Every architectural target is covered by ≥1 scene.
//   3. changeNotes are plan-level prose, not screenplay text.
//   4. Paul / Elena / Solano protections honored at the plan level.
//   5. Surrender + final hook explicitly present in plan targets.

export function auditAndRepairR6RewritePlan(args: {
  plan: RedevR6RewriteScenePlan[];
  approachSummary: string;
  existingScenes: Array<{
    ord: number;
    slugline: string;
    canonicalSummary: string | null;
  }>;
  guardrails: RedevR6GuardrailsBundle;
}): AuditReport {
  const checks: AuditCheck[] = [];
  const repairs: AuditRepair[] = [];
  const { plan, approachSummary, existingScenes } = args;

  // 1. Existing scenes covered — every ord must appear in plan exactly
  //    once via existingSceneOrd (any non-`add` action).
  const planOrds = plan
    .map((p) => p.existingSceneOrd)
    .filter((o): o is number => typeof o === "number");
  const existingOrds = existingScenes.map((s) => s.ord);
  const missingOrds = existingOrds.filter((o) => !planOrds.includes(o));
  const dupeOrds = planOrds.filter(
    (o, i) => planOrds.indexOf(o) !== i
  );
  let coverageStatus: AuditCheck["status"] = "passed";
  let coverageMsg = `Every existing scene has a decision (${existingOrds.length} scenes).`;
  if (existingScenes.length === 0) {
    coverageStatus = "warning";
    coverageMsg =
      "No existing pilot scenes were read. Plan is grounded only in approved architecture — review carefully.";
  } else if (missingOrds.length > 0 || dupeOrds.length > 0) {
    coverageStatus = "warning";
    const parts: string[] = [];
    if (missingOrds.length > 0) {
      parts.push(`${missingOrds.length} scene(s) missing a decision (ord ${missingOrds.slice(0, 5).join(", ")}${missingOrds.length > 5 ? ", …" : ""})`);
    }
    if (dupeOrds.length > 0) {
      parts.push(`${[...new Set(dupeOrds)].length} scene(s) appear in plan more than once`);
    }
    coverageMsg = parts.join("; ") + ".";
  }
  checks.push({
    id: "r6plan_existing_scenes_covered",
    label: "Every existing scene has a decision",
    status: coverageStatus,
    message: coverageMsg,
  });

  // 2. Architectural targets covered.
  const allTargets = Object.keys(R6_REWRITE_TARGET_LABEL) as RedevR6RewriteTarget[];
  const seenTargets = new Set<RedevR6RewriteTarget>();
  for (const p of plan) {
    for (const t of p.targets ?? []) seenTargets.add(t);
  }
  const missingTargets = allTargets.filter((t) => !seenTargets.has(t));
  checks.push({
    id: "r6plan_targets_covered",
    label: "Architectural targets covered",
    status: missingTargets.length === 0 ? "passed" : "warning",
    message:
      missingTargets.length === 0
        ? `All ${allTargets.length} architectural targets have at least one scene serving them.`
        : `${missingTargets.length} architectural target(s) not served by any scene: ${missingTargets.map((t) => R6_REWRITE_TARGET_LABEL[t]).join(", ")}. Add at least one scene whose targets[] includes each.`,
  });

  // 3. No screenplay text — changeNotes should be plan-level prose.
  const SCREENPLAY_PATTERNS = [
    /\bFADE\s+(IN|OUT)\b/,
    /\b(INT|EXT)\.\s+[A-Z]+/,
    /\([A-Z][a-z]+\s+[a-z]+,?\s+(then|now|softly|quietly)\)/,
  ];
  const allChangeNotesText = plan
    .map((p) => p.changeNotes ?? "")
    .join("\n");
  const screenplayLeak = SCREENPLAY_PATTERNS.some((re) =>
    re.test(allChangeNotesText)
  );
  checks.push({
    id: "r6plan_no_screenplay_text",
    label: "No screenplay text in plan",
    status: screenplayLeak ? "warning" : "passed",
    message: screenplayLeak
      ? "Plan changeNotes contain screenplay-style formatting. Pass 1 is plan-level only — screenplay text comes in Pass 2."
      : "Plan changeNotes stayed at plan level — no screenplay text.",
  });

  // 4. Paul reveal protected in the plan. Scan changeNotes + targets
  //    for late-season-reveal hints.
  const PAUL_LATE_REVEAL = [
    /\bpaul\b[^.]{0,80}\b(texting|texts)\b/i,
    /\b(reveal|expose)\b[^.]{0,40}\b(accident|timestamp|guilt)/i,
  ];
  const paulLeak = PAUL_LATE_REVEAL.some((re) =>
    re.test(allChangeNotesText)
  );
  checks.push({
    id: "r6plan_paul_reveal_protected",
    label: "Paul reveal protected at plan level",
    status: paulLeak ? "warning" : "passed",
    message: paulLeak
      ? "Plan changeNotes hint at exposing Paul's late-season reveal in the pilot. The phone / driving plant is unease only — texting / accident / timestamp are NOT in the pilot."
      : "Plan keeps Paul's late-season reveal protected.",
  });

  // 5. Elena sister relationship protected.
  const elenaLeak =
    /\belena\b[^.]{0,60}\b(is|was)\b[^.]{0,40}\bsister\b/i.test(
      allChangeNotesText
    );
  checks.push({
    id: "r6plan_elena_protected",
    label: "Elena sister relationship protected at plan level",
    status: elenaLeak ? "warning" : "passed",
    message: elenaLeak
      ? "Plan changeNotes explicitly state Elena is Nadia's sister. Plant Elena as absence / object / fact only."
      : "Plan keeps the Elena / sister relationship protected.",
  });

  // 6. Solano framing — no fraud / liar / manipulate language.
  const solanoLeak = /\bsolano\b[^.]{0,80}\b(lying|liar|fraud|fake|deceiv|manipulat)/i.test(
    allChangeNotesText + " " + approachSummary
  );
  checks.push({
    id: "r6plan_solano_framing",
    label: "Solano framing honored",
    status: solanoLeak ? "warning" : "passed",
    message: solanoLeak
      ? "Plan frames Solano as fraud / liar / manipulator. The Solano Rule: Protocol works; she is unsettlingly certain, not deceptive."
      : "Plan honors the Solano Rule.",
  });

  // 7. Surrender explicitly present in targets.
  const surrenderInTargets = seenTargets.has("surrender_execution");
  checks.push({
    id: "r6plan_surrender_present",
    label: "Surrender drives the pilot",
    status: surrenderInTargets ? "passed" : "warning",
    message: surrenderInTargets
      ? "At least one scene carries the Surrender execution target."
      : "No scene declares surrender_execution in targets[]. The pilot's Protocol driver must be Surrender.",
  });

  // 8. Final blended hook present.
  const finalHookPresent = seenTargets.has("final_blended_hook");
  checks.push({
    id: "r6plan_final_hook_present",
    label: "Final hook direction present",
    status: finalHookPresent ? "passed" : "warning",
    message: finalHookPresent
      ? "At least one scene carries the final_blended_hook target."
      : "No scene declares final_blended_hook in targets[]. The pilot must end on the blended Option A + C hook.",
  });

  return { checks, repairs };
}

// ============================================================================
// R6 Rewrite Pass 2 — full-document audit (warning-only)
// ============================================================================
//
// Runs against the compiled Fountain draft Pass 2 produced. Same
// negation-aware approach the R5 validator uses so "do not reveal Paul's
// texting" doesn't fire a false positive.

export function auditAndRepairR6Pass2Draft(args: {
  compiledFountain: string;
  guardrails: RedevR6GuardrailsBundle;
  missingPlanIndices?: number[];
}): AuditReport {
  const checks: AuditCheck[] = [];
  const repairs: AuditRepair[] = [];
  const text = args.compiledFountain ?? "";
  const lower = text.toLowerCase();

  // Helper: a pattern hits IFF it appears AND the same sentence has no
  // negation hint (do not, must not, avoid, never, protect…). We reuse
  // the NEGATION_HINTS list from the R5 helpers above.
  const hit = (patterns: RegExp[]): boolean => unnegatedHit(text, patterns);

  // 1. Paul reveal protected. Same patterns as R5 + the extended set
  //    from the showrunner's R6 guardrail spec.
  const PAUL_LATE = [
    /\bpaul\b[^.]{0,80}\b(texting|texts|texted)\b/i,
    /\b(reveal|expose|admit|confess)\b[^.]{0,40}\b(accident|timestamp|guilt)/i,
    /\bpaul'?s?\s+guilt\b/i,
    /\btimestamp\s+evidence\b/i,
  ];
  const paulLeak = hit(PAUL_LATE);
  checks.push({
    id: "r6draft_paul_protected",
    label: "Paul reveal protected in the rewritten pilot",
    status: paulLeak ? "warning" : "passed",
    message: paulLeak
      ? "Rewritten pilot exposes Paul's late-season reveal (texting / accident / timestamp / guilt). Plant unease only — the texting/accident truth is architected for episode 6-7."
      : "Paul's late-season reveal is protected.",
  });

  // 2. Elena sister relationship protected.
  const ELENA_SISTER = [
    /\belena\b[^.]{0,60}\b(is|was)\b[^.]{0,40}\bsister\b/i,
    /\bnadia'?s?\s+sister\b/i,
    /\bmy\s+sister\b[^.]{0,30}\belena\b/i,
  ];
  const elenaLeak = hit(ELENA_SISTER);
  checks.push({
    id: "r6draft_elena_protected",
    label: "Elena sister relationship protected",
    status: elenaLeak ? "warning" : "passed",
    message: elenaLeak
      ? "Rewritten pilot reveals the sister relationship. Plant Elena as absence / object / fact only; the relationship reveal lands later."
      : "Sister relationship stays protected.",
  });

  // 3. Solano framing protected — no fraud / liar / con / cult / manipulate
  //    language pointed at Solano.
  const SOLANO_FRAUD = [
    /\bsolano\b[^.]{0,80}\b(lying|liar|fraud|fake|con\b|cult|deceiv|manipulat)/i,
    /\b(reveal|expose|prove)\b[^.]{0,40}\bsolano\b[^.]{0,40}\bnot\b/i,
  ];
  const solanoLeak = hit(SOLANO_FRAUD);
  checks.push({
    id: "r6draft_solano_protected",
    label: "Solano rule protected",
    status: solanoLeak ? "warning" : "passed",
    message: solanoLeak
      ? "Rewritten pilot drifts into Solano-as-fraud/cult/con framing. The Solano Rule: she is unsettlingly certain; the Protocol works."
      : "Solano framing honors the Solano Rule.",
  });

  // 4. Surrender drives the pilot — must be visibly present.
  const surrenderPresent = /\bsurrender\b/i.test(text);
  checks.push({
    id: "r6draft_surrender_present",
    label: "Surrender drives the pilot",
    status: surrenderPresent ? "passed" : "warning",
    message: surrenderPresent
      ? "Surrender is present in the rewritten pilot."
      : "Surrender is not mentioned in the rewritten pilot. The pilot's Protocol driver must be Surrender.",
  });

  // 5–8. Per-principal plant presence. Patterns extracted to
  // PLANT_DETECTION_PATTERNS below so the surgical-repair verifier
  // and the final audit cannot drift. Previously these had narrower
  // keyword sets than the repair verifier accepted, so the LLM could
  // satisfy the verifier (using "folded hoodie", "refills", "staff
  // board", "orients toward distress") and the final audit would
  // still warn. Single source of truth now.
  const plantChecks: Array<{
    id: AuditCheckId;
    label: string;
    pattern: RegExp;
    miss: string;
    pass: string;
  }> = [
    {
      id: "r6draft_margot_planted",
      label: "Margot professional structure planted",
      pattern: PLANT_DETECTION_PATTERNS.margot,
      miss: "No clear Margot professional/analytical plant in the pilot. Add a beat showing her diagnostic identity.",
      pass: "Margot's professional / analytical identity is planted.",
    },
    {
      id: "r6draft_nadia_planted",
      label: "Nadia / Elena planted behaviorally",
      pattern: PLANT_DETECTION_PATTERNS.nadia,
      miss: "No clear Nadia plant in the pilot. Plant her searching/attentive behavior (without naming the sister relationship).",
      pass: "Nadia's searching behavior is planted (relationship still protected).",
    },
    {
      id: "r6draft_claire_planted",
      label: "Claire ritualized grief planted",
      pattern: PLANT_DETECTION_PATTERNS.claire,
      miss: "No clear Claire ritualized-grief plant in the pilot. Plant her private ritual / caretaking gesture.",
      pass: "Claire's practiced/ritualized grief is planted.",
    },
    {
      id: "r6draft_dean_planted",
      label: "Dean usefulness planted",
      pattern: PLANT_DETECTION_PATTERNS.dean,
      miss: "No clear Dean usefulness/performance plant in the pilot. Plant his performed-success body.",
      pass: "Dean's usefulness/performance is planted.",
    },
  ];
  for (const c of plantChecks) {
    const present = c.pattern.test(text);
    checks.push({
      id: c.id,
      label: c.label,
      status: present ? "passed" : "warning",
      message: present ? c.pass : c.miss,
    });
  }

  // 9. Archive room planted.
  const archive = /\barchive\b/i.test(text);
  checks.push({
    id: "r6draft_archive_room_planted",
    label: "Archive room planted",
    status: archive ? "passed" : "warning",
    message: archive
      ? "Archive room is planted in the rewritten pilot."
      : "Archive room is missing from the rewritten pilot. Add the plant per the global plants.",
  });

  // 10. Photograph wall planted.
  const photoWall = /\b(photograph|photo)\s+wall\b/i.test(text);
  checks.push({
    id: "r6draft_photograph_wall_planted",
    label: "Photograph wall planted",
    status: photoWall ? "passed" : "warning",
    message: photoWall
      ? "Photograph wall is planted in the rewritten pilot."
      : "Photograph wall is missing from the rewritten pilot. Add the plant per the global plants.",
  });

  // 11. Final blended hook present — bodies + transparent case +
  //     Paul's chime response. Look for at least 2 of the 3 anchors
  //     in the last ~3000 chars of the draft.
  const tail = text.slice(Math.max(0, text.length - 3000));
  const tailLower = tail.toLowerCase();
  const hookAnchors = {
    bodies: /\bbodies\b/i.test(tail) || /\bafter\s+surrender\b/i.test(tail),
    case: /\btransparent\s+case\b/i.test(tail),
    chime: /\b(chime|notification|phone)\b/i.test(tail) && /\bpaul\b/i.test(tail),
  };
  const anchorCount = [hookAnchors.bodies, hookAnchors.case, hookAnchors.chime].filter(Boolean).length;
  checks.push({
    id: "r6draft_final_hook_present",
    label: "Final blended Option A + C hook present",
    status: anchorCount >= 2 ? "passed" : "warning",
    message:
      anchorCount >= 2
        ? `Final hook anchors detected in tail: ${[
            hookAnchors.bodies && "bodies after Surrender",
            hookAnchors.case && "transparent case",
            hookAnchors.chime && "Paul + chime/phone",
          ]
            .filter(Boolean)
            .join(", ")}.`
        : "Final blended hook anchors (bodies after Surrender → transparent case → Paul's chime response) not detected in the closing of the pilot. Land at least 2 of the 3.",
  });
  void tailLower;

  // 12. No flashbacks — Fountain-style markers + literal "FLASHBACK".
  const FLASHBACK = [
    /\bFLASHBACK\b/,
    /\bINT\.\s+[A-Z][^\n]*?\b-\s*FLASHBACK\b/,
    /\bEXT\.\s+[A-Z][^\n]*?\b-\s*FLASHBACK\b/,
    /\b\(FLASHBACK\)/,
  ];
  const flashback = FLASHBACK.some((re) => re.test(text));
  checks.push({
    id: "r6draft_no_flashbacks",
    label: "No flashbacks",
    status: flashback ? "warning" : "passed",
    message: flashback
      ? "Rewritten pilot contains FLASHBACK markers. Global rule forbids flashbacks."
      : "No flashbacks detected.",
  });

  // 13. No confession circles.
  const confession = /\bconfession\s+circle\b/i.test(text);
  checks.push({
    id: "r6draft_no_confession_circles",
    label: "No confession circles",
    status: confession ? "warning" : "passed",
    message: confession
      ? "Rewritten pilot contains a confession-circle beat. Global rule forbids confession circles."
      : "No confession circles detected.",
  });

  // 14. No therapy exposition — heuristic: 'tell me about your childhood',
  //     'how does that make you feel', etc.
  const THERAPY = [
    /\btell\s+me\s+about\s+your\s+(childhood|mother|father|family)\b/i,
    /\bhow\s+does\s+that\s+make\s+you\s+feel\b/i,
    /\band\s+how\s+do\s+you\s+feel\s+about\b/i,
  ];
  const therapy = THERAPY.some((re) => re.test(text));
  checks.push({
    id: "r6draft_no_therapy_exposition",
    label: "No therapy exposition",
    status: therapy ? "warning" : "passed",
    message: therapy
      ? "Rewritten pilot contains therapy-style exposition. Global rule forbids therapy questions."
      : "No therapy exposition detected.",
  });

  // 15. No Solano-as-fraud drift — narrower than the framing check
  //     above; this looks for "Solano is a fraud/con/cult" patterns
  //     anywhere in the pilot, not just unnegated.
  const SOLANO_DRIFT = /\bsolano\b[^.]{0,40}\b(is|was)\b[^.]{0,30}\b(a\s+)?(fraud|con|cult\s+leader)/i;
  const solanoDrift = SOLANO_DRIFT.test(text);
  checks.push({
    id: "r6draft_no_solano_fraud_drift",
    label: "No Solano-as-fraud/cult drift",
    status: solanoDrift ? "warning" : "passed",
    message: solanoDrift
      ? "Rewritten pilot drifts into framing Solano as a fraud/con/cult leader. The Solano Rule forbids this."
      : "No fraud/con/cult drift around Solano.",
  });

  // Bonus warning — if Pass 2 returned missing scenes (LLM truncated
  // or skipped some plan indices), flag here so the user knows the
  // compiled draft is incomplete.
  if ((args.missingPlanIndices?.length ?? 0) > 0) {
    repairs.push({
      checkId: "r6draft_paul_protected", // reuse — repair surfaced under whichever check
      description: `${args.missingPlanIndices!.length} plan entries produced no scene text (LLM may have truncated). Regenerate Pass 2 or fix per-scene.`,
    });
  }

  // Used variable to silence TS unused warning when only some branches reference `lower`.
  void lower;

  return { checks, repairs };
}
