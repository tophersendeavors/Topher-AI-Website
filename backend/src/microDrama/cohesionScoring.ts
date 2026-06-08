// Narrative Cohesion scorer for micro-drama chains.
//
// Sits ALONGSIDE the Binge Score + Viral Test. Binge measures surprise +
// retention pull at the per-episode level. Cohesion measures whether the
// season tells one mystery or a soup of unrelated ones — a chain that
// scores 92/100 on binge but introduces a new mystery every other episode
// is incoherent and gets rejected here.
//
// Inputs: the planning chain (no LLM call — pure heuristic).
// Outputs (NarrativeCohesionResult):
//   cohesionScore       0..100  — average alignment of episodes 2..N to
//                                 the EP01 mystery seed.
//   promiseRetentionPct 0..100  — % of episodes whose dominant question
//                                 STILL references the EP01 seed. Target ≥80.
//   mysterySystemsCount integer — distinct topical "anchors" introduced
//                                 across the season beyond the EP01 seed.
//                                 Target ≤ 3.
//   mysteryLayerCount   integer — major mystery layers introduced (cap is
//                                 1 per 5 episodes).
//   characterRevealCount integer — major character reveals (cap is 1 per
//                                 5 episodes).
//   forbiddenTropeHits  Array<{ trope, episodes[] }> — forbidden reveals
//                                 detected. Twin gets the "seeded 5+ eps"
//                                 exception; everything else is flat-banned.
//   issues              string[] — actionable diagnoses for the LLM critique.
//   passes              boolean — overall cohesion gate.

import type { MicroDramaEpisodePlan } from "@toburt/shared";

const STOP = new Set([
  "the","a","an","of","to","in","on","at","by","for","with","and","or","but","if",
  "is","was","are","were","be","been","being","have","has","had","do","does","did",
  "will","would","could","should","must","shall","may","might","can","cannot",
  "she","he","they","it","this","that","these","those","his","her","their","its",
  "him","them","what","when","where","who","why","how","as","from","up","down",
  "out","over","into","onto","under","after","before","while","during","between",
  "about","above","below","than","then","so","no","not","yes","i","we","you","me",
  "my","your","our","us","all","any","some","more","most","less","few","many",
  "much","very","too","only","just","even","still","also","now","very","one",
  "two","three","new","old","first","last","next","every","each","both","other",
  "another","such","like","get","got","make","made","take","took","see","saw",
  "say","said","tell","told","know","knew","find","found","think","thought",
  "feel","felt","look","looked","ask","asked","walk","run","go","went","gone",
  "come","came","does","doing","done","there","here","into","off","again","back",
]);

const tokenize = (s: string): string[] => {
  return (
    s
      .toLowerCase()
      .match(/[a-z][a-z'-]+/g)
      ?.filter((t) => t.length >= 3 && !STOP.has(t)) ?? []
  );
};

const episodeText = (p: MicroDramaEpisodePlan): string =>
  [p.hook, p.setup, p.twist, p.cliffhanger].filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Forbidden trope detectors
// ---------------------------------------------------------------------------

// Forbidden trope detectors. Each pattern must be a *narrative-domain*
// match — never trip on common English. Specifically:
//   • The DID/multiple-personality detector requires either a fully-spelled
//     phrase ("split personalit…", "multiple personalit…", "dissociative
//     identit…", "another personality", "different personalities") or the
//     dotted abbreviation "D.I.D." with explicit dots. The earlier version
//     allowed the bare letters "did" to match — which is the English verb.
//     That caused the engine to flag and infinitely revise normal plot text.
//   • "alter ego" was removed (too benign — many legitimate stories use it
//     for stage names, online aliases, etc.).
const FORBIDDEN_PATTERNS: Array<{
  /** Match against episode setup/twist/cliffhanger text. */
  pattern: RegExp;
  /** Stable id used by the UI. */
  id: string;
  /** Display label. */
  label: string;
  /** True only for twin — gets the "seeded 5+ episodes" exception. */
  twinException?: boolean;
}> = [
  {
    pattern: /\btwins?\b/i,
    id: "twin",
    label: "secret twin reveal",
    twinException: true,
  },
  {
    pattern: /\bclones?\b|\bcloning\b|\bcloned\b/i,
    id: "clone",
    label: "clone reveal",
  },
  {
    // Spelled-out psychiatric phrasings + explicit "D.I.D." (with dots).
    // The bare letters "did" must NOT match — that's the English verb.
    pattern:
      /(\bsplit personalit\w*\b|\bmultiple personalit\w*\b|\bdissociative identit\w*\b|\banother personality\b|\bdifferent personalit\w*\b|\bD\.I\.D\.?\b)/i,
    id: "multiple-personality",
    label: "multiple personality / DID reveal",
  },
  {
    pattern:
      /\b(all (in (her|his|their) (head|mind|imagination))|just a dream|only a dream|just imagined|hallucinat\w*|coma dream)\b/i,
    id: "all-in-head",
    label: "'it was all in their head / a dream' reveal",
  },
  {
    pattern:
      /\b(doppelg[äa]nger|body[ -]?double|look[ -]?alike|impersonat\w*|impostors?\b|imposters?\b|replaced by|replacement (husband|wife|son|daughter|man|woman|person))\b/i,
    id: "replacement",
    label: "replacement-person / doppelganger reveal",
  },
];

interface ForbiddenHit {
  id: string;
  label: string;
  episodes: number[];
  /**
   * Per-episode triggering substrings. Lets the critique fed back to the
   * LLM quote the EXACT phrase that needs to be rewritten — otherwise the
   * model is told "remove DID" while looking at text that doesn't contain
   * the trope and either refuses or re-emits something similar.
   */
  matches: Array<{ episodeNumber: number; matched: string }>;
}

function detectForbiddenTropes(
  plans: MicroDramaEpisodePlan[]
): ForbiddenHit[] {
  const hits: ForbiddenHit[] = [];
  for (const def of FORBIDDEN_PATTERNS) {
    const episodes: number[] = [];
    const matches: ForbiddenHit["matches"] = [];
    for (const p of plans) {
      const m = def.pattern.exec(episodeText(p));
      if (m) {
        episodes.push(p.episodeNumber);
        matches.push({ episodeNumber: p.episodeNumber, matched: m[0] });
      }
    }
    if (episodes.length === 0) continue;

    if (def.twinException) {
      // Allowed ONLY when the twin term is seeded across 5 or more
      // distinct prior episodes before a late reveal. If the first
      // mention lands inside the last 5 episodes of the season, the reveal
      // cannot have been seeded 5+ episodes back, so it's forbidden.
      const total = plans.length;
      const firstMention = episodes[0];
      const seededEpisodes = episodes.length;
      const tooLate = firstMention > total - 5;
      if (tooLate || seededEpisodes < 5) {
        hits.push({ id: def.id, label: def.label, episodes, matches });
      }
    } else {
      hits.push({ id: def.id, label: def.label, episodes, matches });
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Mystery system detection
// ---------------------------------------------------------------------------
// A "mystery system" = a topical noun anchor that recurs across the season
// but is NOT part of EP01's seed bag. If a chain has more than 3 such
// anchors, it's introducing more than 3 unrelated mysteries — reject.

function detectMysterySystems(
  plans: MicroDramaEpisodePlan[],
  seedBag: Set<string>
): { count: number; anchors: string[] } {
  if (plans.length === 0) return { count: 0, anchors: [] };
  const tokenEpisodes = new Map<string, Set<number>>();
  for (const p of plans) {
    const toks = new Set(tokenize(episodeText(p)));
    for (const t of toks) {
      if (seedBag.has(t)) continue;
      let set = tokenEpisodes.get(t);
      if (!set) {
        set = new Set();
        tokenEpisodes.set(t, set);
      }
      set.add(p.episodeNumber);
    }
  }
  // A token is an "anchor" when it appears in 3+ distinct episodes (after
  // EP01) without being part of the seed. That's strong evidence it's its
  // own running thread.
  const minRecurrence = Math.min(3, Math.max(2, Math.floor(plans.length / 8)));
  const anchors = [...tokenEpisodes.entries()]
    .filter(([, eps]) => eps.size >= minRecurrence)
    .map(([token, eps]) => ({ token, count: eps.size }))
    .sort((a, b) => b.count - a.count)
    .map((a) => a.token);
  return { count: anchors.length, anchors };
}

// ---------------------------------------------------------------------------
// Pacing — mystery layers + character reveals
// ---------------------------------------------------------------------------
// We approximate "major mystery layer introduced" as an episode whose twist
// or cliffhanger contains both a high-pull noun AND mentions something
// outside the EP01 seed bag for the first time in the season. "Major
// character reveal" = an episode whose `falseAssumptionReinforcedOrBroken`
// indicates a broken false assumption (keywords: reveal, really, actually,
// turns out, true identity, secretly).

const HIGH_PULL_NOUNS = [
  "secret","lie","reveal","dead","alive","missing","kidnap","ransom","weapon",
  "knife","gun","blood","body","pregnant","murder","betray","witness","trap",
  "deal","money","key","letter","photo","video","recording","child","baby",
  "wedding","funeral","tape","mask",
];

function countMysteryLayers(
  plans: MicroDramaEpisodePlan[],
  seedBag: Set<string>
): number {
  const seenOutsideSeed = new Set<string>();
  let layers = 0;
  for (const p of plans) {
    const tokens = new Set(tokenize(p.twist + " " + p.cliffhanger));
    const hasHighPull = [...tokens].some((t) => HIGH_PULL_NOUNS.includes(t));
    const introducesNewAnchor = [...tokens].some((t) => {
      if (seedBag.has(t)) return false;
      if (seenOutsideSeed.has(t)) return false;
      if (!HIGH_PULL_NOUNS.includes(t)) return false;
      return true;
    });
    if (hasHighPull && introducesNewAnchor) layers++;
    for (const t of tokens) seenOutsideSeed.add(t);
  }
  return layers;
}

const REVEAL_KEYWORDS = [
  "reveal", "revealed", "really", "actually", "turns out", "true identity",
  "secretly", "discovers", "discovery", "exposed", "uncovered", "real name",
  "real face", "all along",
];

function countCharacterReveals(plans: MicroDramaEpisodePlan[]): number {
  let count = 0;
  for (const p of plans) {
    const txt = (
      p.falseAssumptionReinforcedOrBroken + " " + p.twist
    ).toLowerCase();
    if (REVEAL_KEYWORDS.some((k) => txt.includes(k))) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface NarrativeCohesionResult {
  cohesionScore: number;
  promiseRetentionPct: number;
  mysterySystemsCount: number;
  mysteryLayerCount: number;
  characterRevealCount: number;
  forbiddenTropeHits: ForbiddenHit[];
  /** Anchors flagged as "new mystery systems" (debug/UX). */
  detectedAnchors: string[];
  /** Actionable per-chain diagnoses fed back into the revisor. */
  issues: string[];
  /** Overall cohesion gate. */
  passes: boolean;
}

export function computeNarrativeCohesion(
  plans: MicroDramaEpisodePlan[]
): NarrativeCohesionResult {
  const issues: string[] = [];
  if (plans.length === 0) {
    return {
      cohesionScore: 0,
      promiseRetentionPct: 0,
      mysterySystemsCount: 0,
      mysteryLayerCount: 0,
      characterRevealCount: 0,
      forbiddenTropeHits: [],
      detectedAnchors: [],
      issues: ["Chain is empty."],
      passes: false,
    };
  }

  // EP01 seed bag — the central audience promise.
  const ep1 = plans[0];
  const seedBag = new Set(tokenize(episodeText(ep1)));

  // Cohesion — alignment of each subsequent episode to the seed.
  const alignments: number[] = [];
  const aligned: boolean[] = [];
  for (let i = 1; i < plans.length; i++) {
    const epTokens = new Set(tokenize(episodeText(plans[i])));
    if (seedBag.size === 0) {
      alignments.push(0);
      aligned.push(false);
      continue;
    }
    const overlap = [...seedBag].filter((t) => epTokens.has(t)).length;
    const score = overlap / seedBag.size;
    alignments.push(score);
    aligned.push(score >= 0.18);
  }
  const avgAlignment =
    alignments.length === 0
      ? 0
      : alignments.reduce((s, a) => s + a, 0) / alignments.length;
  const cohesionScore = Math.round(Math.min(1, avgAlignment * 2.2) * 100);
  // The 2.2× compression is a calibration: getting ~45% lexical overlap with
  // EP01 across the season is already strong cohesion in practice.

  const promiseRetentionPct =
    aligned.length === 0
      ? 0
      : Math.round((aligned.filter(Boolean).length / aligned.length) * 100);

  // Mystery systems (anchors beyond the seed).
  const { count: mysterySystemsCount, anchors } = detectMysterySystems(
    plans,
    seedBag
  );

  // Pacing caps.
  const mysteryLayerCount = countMysteryLayers(plans, seedBag);
  const characterRevealCount = countCharacterReveals(plans);
  const mysteryLayerCap = Math.max(1, Math.floor(plans.length / 5));
  const characterRevealCap = Math.max(1, Math.floor(plans.length / 5));

  // Forbidden tropes.
  const forbiddenTropeHits = detectForbiddenTropes(plans);

  // Build issues list for the revisor.
  if (cohesionScore < 70) {
    issues.push(
      `Narrative cohesion ${cohesionScore}/100 — too many episodes drift away from EP01's central question. Make every cliffhanger and twist deepen the SAME mystery.`
    );
  }
  if (promiseRetentionPct < 80) {
    issues.push(
      `Audience promise retention ${promiseRetentionPct}%. The EP01 question must be the dominant thread in at least 80% of the season.`
    );
  }
  if (mysterySystemsCount > 3) {
    issues.push(
      `Detected ${mysterySystemsCount} unrelated mystery systems (anchors: ${anchors
        .slice(0, 6)
        .join(", ")}). Maximum allowed is 3. Fold extras back into the EP01 mystery or remove them.`
    );
  }
  if (mysteryLayerCount > mysteryLayerCap) {
    issues.push(
      `${mysteryLayerCount} major mystery layers introduced; cap for a ${plans.length}-episode season is ${mysteryLayerCap} (one per 5 episodes). Spread layers further apart.`
    );
  }
  if (characterRevealCount > characterRevealCap) {
    issues.push(
      `${characterRevealCount} major character reveals; cap for a ${plans.length}-episode season is ${characterRevealCap} (one per 5 episodes). Cluster reveals further apart.`
    );
  }
  for (const hit of forbiddenTropeHits) {
    issues.push(
      `Forbidden trope detected: ${hit.label} in EP${hit.episodes
        .map((n) => String(n).padStart(2, "0"))
        .join(", EP")}. Remove or replace.`
    );
  }

  const passes =
    cohesionScore >= 70 &&
    promiseRetentionPct >= 80 &&
    mysterySystemsCount <= 3 &&
    mysteryLayerCount <= mysteryLayerCap &&
    characterRevealCount <= characterRevealCap &&
    forbiddenTropeHits.length === 0;

  return {
    cohesionScore,
    promiseRetentionPct,
    mysterySystemsCount,
    mysteryLayerCount,
    characterRevealCount,
    forbiddenTropeHits,
    detectedAnchors: anchors.slice(0, 12),
    issues,
    passes,
  };
}
