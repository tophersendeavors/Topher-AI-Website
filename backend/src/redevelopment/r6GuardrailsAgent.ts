// R6 Guardrails — deterministic generator from approved R1-R5.
//
// Goal: the showrunner should never have to type per-character
// contracts by hand. The system already has R2 bibles (avoidance +
// wound + revelation + final choice), R3 modules, R4 arc, and R5
// strategy lists — that's enough to derive a strong first draft of
// the contract. The showrunner reviews and edits the result; manual
// construction is the fallback, not the default.
//
// Architecture:
//   1. Generic deriver: per character, walk R2 + R5 and split content
//      into plants (camera-visible) / doNotReveal (internal) / doNotDo
//      (executional risks) / executionRule (tonal summary).
//   2. SELVAJE overlay: when the brief reads as SELVAJE (Solano Rule
//      + Protocol philosophy present), apply showrunner-locked text
//      for known principals (Paul especially) and use the SELVAJE
//      global rule.
//   3. Global rule: composed from R1 forbidden tones + R5 hook
//      direction. SELVAJE overlay provides the exact locked text.

import type {
  RedevBrief,
  RedevCharacterBible,
  RedevPilotStrategy,
  RedevProtocolModule,
  RedevR6Guardrail,
  RedevR6GuardrailsBundle,
  RedevSeasonArcEpisode,
} from "./types.js";

/** SELVAJE Paul Beaumont contract — the showrunner-locked text from
 *  the directive. Used when the project reads as SELVAJE and one of
 *  the approved bibles is Paul Beaumont. */
const SELVAJE_PAUL: RedevR6Guardrail = {
  characterName: "Paul Beaumont",
  plants: [
    "phone behavior",
    "notification-chime body response",
    "driving avoidance",
    "hands always doing something for someone else",
    "caretaking as motion",
  ],
  doNotReveal: [
    "texting",
    "accident responsibility",
    "timestamp evidence",
    "innocent driver / wrongful blame",
    "Paul's guilt",
  ],
  doNotDo: [
    "imply guilt through dialogue or obvious reaction shots",
    "make the phone feel like a plot clue",
    "have anyone confront Paul about the accident",
    "make Paul visibly suspicious",
  ],
  executionRule:
    "Execute unease only. Plant the body response, not the explanation.",
};

/** SELVAJE per-character overlays. Each entry adds locked plant /
 *  doNotReveal / doNotDo language on top of whatever the generic
 *  deriver produced. Use `mergeOverlay()` so we don't lose any of the
 *  derived items. */
const SELVAJE_OVERLAYS: Record<string, Partial<RedevR6Guardrail>> = {
  "paul beaumont": SELVAJE_PAUL,
  "margot ellison": {
    plants: [
      "analytical reading of the room before she sits",
      "professional / diagnostic identity made visible",
      "intellectualizing as her body's first defense",
    ],
    doNotReveal: [
      "the daughter's death (only Margot's avoidance shows)",
      "Margot's specific guilt or self-narrative about her daughter",
    ],
    doNotDo: [
      "have anyone ask Margot about her daughter",
      "let Margot articulate her wound in dialogue",
    ],
    executionRule:
      "Plant her analytical avoidance. The wound is internal architecture; do not expose.",
  },
  "nadia reyes": {
    plants: [
      "an attentive interest in the archive / records / room layouts",
      "the specific shape of someone she's looking for (without naming Elena)",
      "a learned smallness — careful in shared space",
    ],
    doNotReveal: [
      "that Elena is Nadia's sister",
      "why Nadia came to Selvaje",
      "any explicit search-mission framing",
    ],
    doNotDo: [
      "make Nadia explicitly question staff about Elena",
      "stage an 'I'm looking for someone' beat in the pilot",
      "let any character name Nadia's relationship to Elena",
    ],
    executionRule:
      "Plant the searching body. The relationship reveal is later-season.",
  },
  "claire beaumont": {
    plants: [
      "a small private ritual that reads as memorializing without naming what",
      "an instinctive caretaking gesture toward Paul (the kind that wears them both down)",
      "the muscle memory of someone who has practiced grief",
    ],
    doNotReveal: [
      "Marcus by name or by direct reference",
      "the specific loss Claire is carrying",
      "the architecture of her marriage with Paul",
    ],
    doNotDo: [
      "let Claire deliver a grief speech",
      "make the ritual symbolic or magical — keep it observable",
    ],
    executionRule:
      "Plant the practiced grief. Do not let her articulate it.",
  },
  "dean palter": {
    plants: [
      "the easy charisma of someone who has been admired",
      "an instinctive deflection toward charm whenever the room turns serious",
      "a body that is performing health, not having it",
    ],
    doNotReveal: [
      "what Dean's empire actually did or to whom",
      "the architecture of his shame",
    ],
    doNotDo: [
      "let Dean confess to anything",
      "frame Dean as a villain in the pilot — his shame surfaces later",
    ],
    executionRule:
      "Plant the performance of success. The shame surfaces later when the Protocol pressures it.",
  },
  "dr. izel solano": {
    plants: [
      "unsettling certainty — she is the only person in the room not lying",
      "Protocol-issued language and process visible on screen",
      "a refusal to perform reassurance",
    ],
    doNotReveal: [
      "the full reach of the Protocol",
      "Solano's own arc or backstory",
    ],
    doNotDo: [
      "frame Solano as ambiguous, hiding, manipulating, or fraudulent",
      "let anyone successfully read her",
      "give her a 'reveal' beat in the pilot",
    ],
    executionRule:
      "She is unsettling because she is certain, not because she is evil. The Protocol works.",
  },
};

/** The SELVAJE locked global rule — used when the pass reads as SELVAJE. */
const SELVAJE_GLOBAL_RULE =
  "Rewrite the pilot to plant avoidance behaviors, not expose wounds. " +
  "No flashbacks, no confession circles, no therapy exposition, no cheap " +
  "thriller twist, no Solano-as-fraud framing, no Paul accident reveal, " +
  "no Elena-sister reveal. The pilot's engine is Surrender. End with the " +
  "blended Option A + C hook: bodies after Surrender, then the transparent " +
  "case, then Paul's body responding to the notification chime.";

/** Detect SELVAJE-shaped passes — the redev brief uses the Solano Rule
 *  + Protocol philosophy fields, which other projects won't have. */
function isSelvaje(brief: RedevBrief): boolean {
  return (
    !!brief.solanoRule?.trim() &&
    !!brief.protocolPhilosophy?.trim() &&
    /solano/i.test(brief.solanoRule)
  );
}

/** Per approved bible, build the set of name-token aliases (≥4 chars)
 *  that, when found in an R5 strategy item, identify that bible as a
 *  candidate owner of that item. */
type OwnerEntry = { bible: RedevCharacterBible; aliases: string[] };
function buildOwnerMap(bibles: RedevCharacterBible[]): OwnerEntry[] {
  return bibles
    .filter((b) => !!b.approvedAt)
    .map((b) => ({
      bible: b,
      aliases: b.characterName
        .toLowerCase()
        .split(/\s+/)
        .map((t) => t.replace(/[.,]/g, "").trim())
        .filter((t) => t.length >= 4),
    }));
}

/** For one R5 item, return the SET of character full names whose
 *  aliases appear (word-boundary, case-insensitive). */
function itemOwners(item: string, ownerMap: OwnerEntry[]): string[] {
  const lower = item.toLowerCase();
  const owners = new Set<string>();
  for (const { bible, aliases } of ownerMap) {
    if (
      aliases.some((alias) => {
        const re = new RegExp(
          `\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          "i"
        );
        return re.test(lower);
      })
    ) {
      owners.add(bible.characterName);
    }
  }
  return Array.from(owners);
}

/** Architectural plants belong to the PILOT, not any character. When an
 *  item mentions any of these, it goes to globalPlants regardless of
 *  whether a character name appears in the body — the character
 *  reference is a staging note, not ownership. */
const ARCHITECTURAL_PATTERNS: RegExp[] = [
  /\barchive\s*(?:room)?\b/i,
  /\btransparent\s+case\b/i,
  /\bphotograph(?:s)?\s+wall\b/i,
  /\bphoto\s+wall\b/i,
  /\bcommon\s+room\b/i,
];

function isArchitectural(item: string): boolean {
  return ARCHITECTURAL_PATTERNS.some((re) => re.test(item));
}

/** Strict per-character filter. An R5 item lands in a character's
 *  contract ONLY IF it mentions exactly one character (that character)
 *  AND is NOT architectural. Eliminates the cross-character bleeding
 *  the previous lax filter produced. */
function strictItemsForCharacter(
  items: string[],
  characterName: string,
  ownerMap: OwnerEntry[]
): string[] {
  return items.filter((item) => {
    if (isArchitectural(item)) return false;
    const owners = itemOwners(item, ownerMap);
    return owners.length === 1 && owners[0] === characterName;
  });
}

/** Pilot-level items: anything from the supplied lists that is either
 *  architectural OR mentions 0 characters OR mentions 2+ characters
 *  (cross-character beat). These go to globalPlants. */
function pilotLevelItems(items: string[], ownerMap: OwnerEntry[]): string[] {
  return items.filter((item) => {
    if (isArchitectural(item)) return true;
    const owners = itemOwners(item, ownerMap);
    return owners.length !== 1;
  });
}

/** Strip ALL-CAPS character labels from a globalPlants item without
 *  changing its meaning:
 *    • Leading headings like "NADIA:" / "NADIA —" / "NADIA -" are removed.
 *    • Inline ALL-CAPS first names (SOLANO, MARGOT) are converted to
 *      mixed case (Solano, Margot). Already-mixed-case body references
 *      are untouched.
 *    • The first character of the remaining text is recapitalized so
 *      we don't leave a fragment starting with a lowercase letter.
 *  Why: R5 sometimes formats items as `NADIA: searches the archive`,
 *  which reads as a per-character heading and triggers the
 *  cross-contamination audit. In a Global Plants bucket we want the
 *  same semantic content with neutral pilot-level phrasing.
 */
function neutralizeAllCapsCharacterLabels(
  item: string,
  ownerMap: OwnerEntry[]
): string {
  let out = item;
  // Collect every alias for every character (≥4-char tokens like
  // "Margot", "Solano", "Izel"). We strip / neutralize each one.
  const aliases = ownerMap.flatMap((e) => e.aliases.filter((a) => a.length >= 4));
  for (const alias of aliases) {
    const upper = alias.toUpperCase();
    const titlecase =
      alias.charAt(0).toUpperCase() + alias.slice(1).toLowerCase();
    // 1) Leading heading: "NADIA:" / "NADIA —" / "NADIA -"
    out = out.replace(new RegExp(`^\\s*${upper}\\s*[:\\-–—]\\s*`), "");
    // 2) Inline ALL-CAPS occurrences → titlecase (preserves meaning,
    //    just stops it shouting). Case-sensitive — body text already in
    //    mixed case is untouched.
    out = out.replace(new RegExp(`\\b${upper}\\b`, "g"), titlecase);
  }
  out = out.trim();
  // Recapitalize the first letter if we stripped a heading and left a
  // lowercase-start fragment (e.g. "searches the archive room").
  if (out.length > 0 && out[0] === out[0].toLowerCase()) {
    out = out.charAt(0).toUpperCase() + out.slice(1);
  }
  return out;
}

/** Generic deriver: per approved bible, walk R2 + R5 and split content
 *  into the four guardrail buckets. STRICT — only items mentioning
 *  THIS character (and no other) make it into the contract. Pilot-level
 *  and cross-character items are routed to globalPlants by the caller. */
function deriveCharacterGuardrail(
  bible: RedevCharacterBible,
  pilotStrategy: RedevPilotStrategy,
  brief: RedevBrief,
  ownerMap: OwnerEntry[]
): RedevR6Guardrail {
  const name = bible.characterName;
  const p = bible.proposed;
  const plants: string[] = [];
  const doNotReveal: string[] = [];
  const doNotDo: string[] = [];

  // Plants — camera-visible. R2 avoidance is the safest signal (it's
  // bible-owned by definition). R5 items pass through the strict
  // owner filter so an item mentioning Margot + Solano doesn't end
  // up in BOTH cards.
  if (p.avoidanceStrategy?.trim()) {
    plants.push(`avoidance behavior: ${p.avoidanceStrategy.trim()}`);
  }
  plants.push(
    ...strictItemsForCharacter(
      pilotStrategy.characterIntroAdjustments ?? [],
      name,
      ownerMap
    )
  );
  plants.push(
    ...strictItemsForCharacter(
      pilotStrategy.newSeedsToPlant ?? [],
      name,
      ownerMap
    )
  );
  plants.push(
    ...strictItemsForCharacter(
      pilotStrategy.characterArcPlants ?? [],
      name,
      ownerMap
    )
  );

  // Do NOT reveal — internal architecture from the R2 bible (always
  // single-owner). R5 oldBeatsToRemove items pass the strict filter.
  if (p.hiddenTruth?.trim())
    doNotReveal.push(`hidden truth: ${p.hiddenTruth.trim()}`);
  if (p.coreWound?.trim())
    doNotReveal.push(`core wound: ${p.coreWound.trim()}`);
  if (p.seasonRevelation?.trim())
    doNotReveal.push(`season revelation: ${p.seasonRevelation.trim()}`);
  if (p.finalChoice?.trim())
    doNotReveal.push(`final-choice destination: ${p.finalChoice.trim()}`);
  doNotReveal.push(
    ...strictItemsForCharacter(
      pilotStrategy.oldBeatsToRemove ?? [],
      name,
      ownerMap
    )
  );

  // Do NOT do — executional risks. R1 forbidden tones are whole-show;
  // we put those in the GLOBAL rule, not per-character (the old code
  // duplicated them across every contract — pure noise). Per-character
  // doNotDo is reserved for character-specific old-draft moves.
  const oldMoves = strictItemsForCharacter(
    pilotStrategy.whatMustChange ?? [],
    name,
    ownerMap
  );
  for (const m of oldMoves) doNotDo.push(`old-draft move to avoid: ${m}`);

  // Execution rule: one-line tonal summary anchored to avoidance.
  const firstName = name.split(/\s+/)[0];
  const executionRule = p.avoidanceStrategy?.trim()
    ? `Plant ${firstName}'s avoidance behavior on screen. The wound is internal architecture — do not expose it in the pilot.`
    : `Plant ${firstName}'s pilot presence through behavior, not exposition.`;

  // Silence the unused-import warning for `brief` — we keep the
  // parameter on the signature so future contract-tuning has access
  // to R1 fields without a re-plumb.
  void brief;

  return {
    characterName: name,
    plants: dedupeNonEmpty(plants),
    doNotReveal: dedupeNonEmpty(doNotReveal),
    doNotDo: dedupeNonEmpty(doNotDo),
    executionRule,
  };
}

function dedupeNonEmpty(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const t = item.trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

/** Merge an overlay onto a generic guardrail. Overlay items APPEND
 *  rather than replace — the showrunner-locked text + the derived
 *  text both make it into the contract, deduped. ExecutionRule from
 *  the overlay (when present) wins. */
function mergeOverlay(
  base: RedevR6Guardrail,
  overlay: Partial<RedevR6Guardrail>
): RedevR6Guardrail {
  return {
    characterName: base.characterName,
    plants: dedupeNonEmpty([...(overlay.plants ?? []), ...base.plants]),
    doNotReveal: dedupeNonEmpty([
      ...(overlay.doNotReveal ?? []),
      ...base.doNotReveal,
    ]),
    doNotDo: dedupeNonEmpty([...(overlay.doNotDo ?? []), ...base.doNotDo]),
    executionRule:
      overlay.executionRule?.trim() || base.executionRule,
  };
}

/** Compose a generic global rule from R1 + R5 when no SELVAJE overlay
 *  applies. */
function deriveGenericGlobalRule(
  brief: RedevBrief,
  pilotStrategy: RedevPilotStrategy
): string {
  const parts: string[] = [];
  parts.push(
    "Rewrite the pilot to plant avoidance behaviors, not expose wounds."
  );
  if (brief.forbiddenTones?.trim()) {
    parts.push(`Forbidden tones: ${brief.forbiddenTones.trim()}`);
  }
  if (brief.mustNotChange?.trim()) {
    parts.push(`Locked: ${brief.mustNotChange.trim()}`);
  }
  const hooks = pilotStrategy.finalHookOptions ?? [];
  if (hooks.length > 0) {
    parts.push(`End on one of the approved hook options: ${hooks.join(" / ")}.`);
  }
  return parts.join(" ");
}

export interface GenerateR6GuardrailsArgs {
  brief: RedevBrief;
  characterBibles: RedevCharacterBible[];
  protocolModules: RedevProtocolModule[];
  seasonArc: RedevSeasonArcEpisode[];
  pilotStrategy: RedevPilotStrategy;
}

/** SELVAJE architectural globalPlants overlay. Concrete pilot-level
 *  plants that aren't owned by any single character — preserved here
 *  so they don't pollute the per-character contracts. */
const SELVAJE_ARCHITECTURAL_PLANTS: string[] = [
  "Archive room — present in EP01 but not yet explained; later-season payoff.",
  "Transparent case in the common room — architectural, not symbolic. Surrendered objects live here visibly.",
  "Photograph wall — if present in the existing pilot, preserve it as a watching surface.",
  "Surrender architecture: each guest visibly relinquishes their specific avoidance instrument; the drama is what the body does afterward.",
];

/** Compose a full R6 guardrails bundle from approved R1-R5. */
export function generateR6Guardrails(
  args: GenerateR6GuardrailsArgs
): RedevR6GuardrailsBundle {
  const selvaje = isSelvaje(args.brief);
  const approved = args.characterBibles.filter((b) => !!b.approvedAt);
  const ownerMap = buildOwnerMap(args.characterBibles);

  const perCharacter: RedevR6Guardrail[] = approved.map((bible) => {
    const base = deriveCharacterGuardrail(
      bible,
      args.pilotStrategy,
      args.brief,
      ownerMap
    );
    if (!selvaje) return base;
    const overlay = SELVAJE_OVERLAYS[bible.characterName.toLowerCase()];
    return overlay ? mergeOverlay(base, overlay) : base;
  });

  // Pilot-level plants: items the strict filter rejected from every
  // per-character contract — either architectural (archive room,
  // transparent case, photograph wall) or cross-character (mention
  // multiple principals) or character-free pilot beats.
  //
  // ALL-CAPS character labels (R5 sometimes prefixes items like
  // `NADIA: searches the archive room`) get neutralized into mixed
  // case so the Global Plants bucket reads as pilot-level prose
  // without per-character shouting.
  const rawPilotItems: string[] = [
    ...pilotLevelItems(args.pilotStrategy.newSeedsToPlant ?? [], ownerMap),
    ...pilotLevelItems(
      args.pilotStrategy.characterIntroAdjustments ?? [],
      ownerMap
    ),
    ...pilotLevelItems(
      args.pilotStrategy.characterArcPlants ?? [],
      ownerMap
    ),
    ...pilotLevelItems(args.pilotStrategy.mysteryPlants ?? [], ownerMap),
    ...pilotLevelItems(
      args.pilotStrategy.protocolPhilosophyMoments ?? [],
      ownerMap
    ),
  ];
  const pilotItems = rawPilotItems.map((item) =>
    neutralizeAllCapsCharacterLabels(item, ownerMap)
  );
  const globalPlants = selvaje
    ? dedupeNonEmpty([...SELVAJE_ARCHITECTURAL_PLANTS, ...pilotItems])
    : dedupeNonEmpty(pilotItems);

  const globalRule = selvaje
    ? SELVAJE_GLOBAL_RULE
    : deriveGenericGlobalRule(args.brief, args.pilotStrategy);

  return {
    perCharacter,
    globalRule,
    globalPlants,
    // Generated bundle is not auto-approved — the showrunner reviews
    // and clicks Approve.
    approvedAt: null,
  };
}
