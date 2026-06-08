// Micro Drama Story Engine — TikTok / Reels-native episode chain planner.
//
// PLANNING LAYER ONLY. Never writes screenplay pages, scenes, dialogue,
// shot briefs, prompts, or production data.
//
// Targets vertical-drama binge behaviour, not prestige television pacing.
// Every episode is built around the four-beat anatomy:
//   1. IMMEDIATE HOOK   (0–5 sec — what stops the scroll)
//   2. NEW INFORMATION  (one specific reveal — never recap)
//   3. REVERSAL OR ESCALATION (stakes flip OR rise — never neutral)
//   4. CLIFFHANGER      (specific question that ENDS this episode and
//                        compounds the next swipe)
//
// Self-revision orchestration:
//   • Up to 3 LLM passes total before the preview is returned.
//   • Pass 1 = initial generation against the bible.
//   • A pass is RE-RUN automatically when:
//       avg binge < 70                              → full critique-and-regen
//       avg binge < 65                              → full critique-and-regen (hard reject)
//       more than 20% of episodes fail viral test   → targeted weak-episode rewrite
//   • The writer sees the original score, the final revised score, and
//     the revision-reason trail in the preview UI.

import { config } from "../config.js";
import { callLLM, extractJSON } from "../llm/provider.js";
import { computeBingeMomentum, viralTest } from "./scoring.js";
import {
  computeNarrativeCohesion,
  type NarrativeCohesionResult,
} from "./cohesionScoring.js";
import type {
  CharacterRevealTracker,
  MicroDramaBible,
  MicroDramaChainRevisionStep,
  MicroDramaEpisodeChainPreview,
  MicroDramaEpisodeChainPreviewEntry,
  MicroDramaEpisodePlan,
} from "@toburt/shared";

export interface GenerateChainInput {
  bible: MicroDramaBible;
  /** Optional override — when omitted, falls back to bible.seasonLength. */
  episodeCount?: number;
}

const TARGET_AVG = 70;
const HARD_REJECT_AVG = 65;
const VIRAL_FAIL_RATIO_LIMIT = 0.2;
const MAX_PASSES = 3;

/**
 * Run the LLM agent with up to 3 self-revision passes. Returns the
 * validated planning chain + retention rollup + revision trail.
 */
export async function generateEpisodeChain(
  input: GenerateChainInput
): Promise<MicroDramaEpisodeChainPreview> {
  const bible = input.bible;
  const count = clampSeasonLength(input.episodeCount ?? bible.seasonLength);

  // -------- Pass 1: initial generation ------------------------------------
  let plans = await callGenerator(bible, count);
  let entries = scoreEntries(plans, bible.curiosityGap);
  let cohesion = computeNarrativeCohesion(plans);
  const originalAvg = averageOf(entries.map((e) => e.binge.total));
  const originalCohesion = cohesion;

  const trail: MicroDramaChainRevisionStep[] = [];

  // -------- Self-revision passes ------------------------------------------
  for (let pass = 1; pass < MAX_PASSES; pass++) {
    const decision = decideRevision(entries, originalAvg, cohesion);
    if (!decision) break;

    let nextPlans: MicroDramaEpisodePlan[];
    if (decision.mode === "weak" && decision.targetedEpisodes.length > 0) {
      nextPlans = await callRevisor(bible, count, plans, entries, {
        mode: "weak",
        targets: decision.targetedEpisodes,
        critique: decision.critique,
      });
    } else {
      nextPlans = await callRevisor(bible, count, plans, entries, {
        mode: "full",
        targets: entries.map((e) => e.plan.episodeNumber),
        critique: decision.critique,
      });
    }

    plans = nextPlans;
    entries = scoreEntries(plans, bible.curiosityGap);
    cohesion = computeNarrativeCohesion(plans);

    trail.push({
      pass,
      averageBinge: averageOf(entries.map((e) => e.binge.total)),
      reason: decision.reason,
      mode: decision.mode,
      targetedEpisodes: decision.targetedEpisodes,
    });

    // Stop only when BOTH binge target AND cohesion gate are cleared —
    // a high-binge but incoherent chain still needs another pass.
    const avgNow = averageOf(entries.map((e) => e.binge.total));
    if (avgNow >= TARGET_AVG && cohesion.passes) break;
  }

  return buildPreview(entries, originalAvg, trail, cohesion, originalCohesion);
}

// ---------------------------------------------------------------------------
// Revision decision
// ---------------------------------------------------------------------------
// First-match-wins. Returns null when no revision is needed.

interface RevisionDecision {
  mode: "full" | "weak";
  reason: string;
  /** The episode numbers this pass will target. */
  targetedEpisodes: number[];
  /** Per-episode critique fed back into the LLM. */
  critique: ChainCritique;
}

function decideRevision(
  entries: MicroDramaEpisodeChainPreviewEntry[],
  originalAvg: number,
  cohesion: NarrativeCohesionResult
): RevisionDecision | null {
  const avg = averageOf(entries.map((e) => e.binge.total));
  const failingNums = entries
    .filter((e) => !e.viral.passes)
    .map((e) => e.plan.episodeNumber);
  const failingRatio = entries.length === 0 ? 0 : failingNums.length / entries.length;
  const critique = buildCritique(entries, cohesion);

  // 1) Forbidden trope detected — IMMEDIATE full regenerate. No mercy.
  if (cohesion.forbiddenTropeHits.length > 0) {
    const tropes = cohesion.forbiddenTropeHits.map((h) => h.label).join("; ");
    return {
      mode: "full",
      targetedEpisodes: entries.map((e) => e.plan.episodeNumber),
      reason: `Forbidden trope(s) in chain: ${tropes}. Full regenerate without these reveals.`,
      critique,
    };
  }
  // 2) More than 3 unrelated mystery systems — full regenerate, fold back in.
  if (cohesion.mysterySystemsCount > 3) {
    return {
      mode: "full",
      targetedEpisodes: entries.map((e) => e.plan.episodeNumber),
      reason: `Detected ${cohesion.mysterySystemsCount} unrelated mystery systems (cap 3). Full regenerate that folds extras into the EP01 mystery.`,
      critique,
    };
  }
  // 3) Narrative cohesion below floor OR audience-promise retention below 80%
  //    → full regenerate that re-centers on the EP01 question.
  if (cohesion.cohesionScore < 70 || cohesion.promiseRetentionPct < 80) {
    return {
      mode: "full",
      targetedEpisodes: entries.map((e) => e.plan.episodeNumber),
      reason: `Cohesion ${cohesion.cohesionScore}/100 · promise retention ${cohesion.promiseRetentionPct}% — full regenerate that deepens the SAME mystery from EP01.`,
      critique,
    };
  }
  // 4) Binge average below the hard floor — full regenerate with critique.
  if (avg < HARD_REJECT_AVG) {
    return {
      mode: "full",
      targetedEpisodes: entries.map((e) => e.plan.episodeNumber),
      reason: `Avg binge ${avg}/100 below hard floor ${HARD_REJECT_AVG} — full regenerate with critique (was ${originalAvg}/100).`,
      critique,
    };
  }
  // 5) Too many viral fails — targeted weak-episode rewrite.
  if (failingRatio > VIRAL_FAIL_RATIO_LIMIT && failingNums.length > 0) {
    return {
      mode: "weak",
      targetedEpisodes: failingNums,
      reason: `${failingNums.length}/${entries.length} episodes (>${Math.round(VIRAL_FAIL_RATIO_LIMIT * 100)}%) fail viral test — targeted rewrite of weak episodes.`,
      critique,
    };
  }
  // 6) Below target avg — full revision pass.
  if (avg < TARGET_AVG) {
    return {
      mode: "full",
      targetedEpisodes: entries.map((e) => e.plan.episodeNumber),
      reason: `Avg binge ${avg}/100 below target ${TARGET_AVG} — full revision pass.`,
      critique,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// LLM calls
// ---------------------------------------------------------------------------

async function callGenerator(
  bible: MicroDramaBible,
  count: number
): Promise<MicroDramaEpisodePlan[]> {
  const system = buildSystemPrompt(count);
  const user = buildGenerateUserPrompt(bible, count);
  const episodes = await callJSON(system, user, count);
  return normalisePlans(episodes, count);
}

async function callRevisor(
  bible: MicroDramaBible,
  count: number,
  currentPlans: MicroDramaEpisodePlan[],
  currentEntries: MicroDramaEpisodeChainPreviewEntry[],
  args: { mode: "full" | "weak"; targets: number[]; critique: ChainCritique }
): Promise<MicroDramaEpisodePlan[]> {
  const system = buildSystemPrompt(count);
  const user = buildReviseUserPrompt(
    bible,
    count,
    currentPlans,
    currentEntries,
    args
  );
  const episodes = await callJSON(system, user, count);
  const revised = normalisePlans(episodes, count);

  // Targeted mode: merge — keep non-targeted episodes verbatim from current
  // chain so the LLM can't accidentally regress them.
  if (args.mode === "weak") {
    const targetSet = new Set(args.targets);
    const byNumber = new Map<number, MicroDramaEpisodePlan>();
    for (const p of currentPlans) byNumber.set(p.episodeNumber, p);
    for (const p of revised) {
      if (targetSet.has(p.episodeNumber)) byNumber.set(p.episodeNumber, p);
    }
    return [...byNumber.values()].sort(
      (a, b) => a.episodeNumber - b.episodeNumber
    );
  }
  return revised;
}

async function callJSON(
  system: string,
  user: string,
  count: number
): Promise<RawEpisode[]> {
  const attempt = async (extra?: string): Promise<RawEpisode[] | null> => {
    const messages = [
      { role: "system" as const, content: system },
      { role: "user" as const, content: user },
    ];
    if (extra) messages.push({ role: "user" as const, content: extra });
    const r = await callLLM({
      model: config.SHOWRUNNER_MODEL,
      messages,
      temperature: 0.5,
      // Generous ceiling — a 50-ep chain × 9 fields × ~30 words each is
      // well under 8000 tokens. The bigger risk is the model truncating
      // mid-JSON, which extractJSON's partial-parse recovery handles.
      maxTokens: Math.min(2000 + count * 220, 12000),
    });
    try {
      const parsed = extractJSON(r.text) as { episodes?: RawEpisode[] };
      return Array.isArray(parsed.episodes) ? parsed.episodes : null;
    } catch {
      return null;
    }
  };
  const first = await attempt();
  if (first && first.length > 0) return first;
  const retry = await attempt(
    [
      "Your previous response could not be parsed as JSON.",
      "Respond now with the JSON object ONLY — no markdown fences, no prose,",
      'no preamble. Schema: { "episodes": [ { /* one plan object */ } ] }.',
    ].join("\n")
  );
  if (!retry || retry.length === 0) {
    throw new Error(
      "Episode Chain generator did not return usable JSON after retry."
    );
  }
  return retry;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildSystemPrompt(count: number): string {
  const innerStart = Math.floor(count / 3) + 1;
  const innerEnd = Math.ceil((2 * count) / 3);
  return [
    "You are the Micro Drama Story Engine for TOBURT Studios — a",
    "TikTok / Reels-native vertical drama planner.",
    "",
    "Vertical-drama audiences SCROLL. Every episode must earn the next swipe.",
    "DO NOT write prestige-television pacing. DO NOT explain. DO NOT recap.",
    "",
    "EPISODE ANATOMY — every episode contains all four beats:",
    "  1. IMMEDIATE HOOK  (0–5 seconds — what stops the scroll)",
    "  2. NEW INFORMATION (one specific reveal — never a recap)",
    "  3. REVERSAL OR ESCALATION (stakes flip OR rise — never neutral)",
    "  4. CLIFFHANGER     (a SPECIFIC question that ENDS the episode)",
    "",
    "HARD RULES (failure to follow = rejected output):",
    "  • Exposition ≤ 15% of any episode. Action and reveal dominate.",
    "  • No episode exists solely to explain prior events.",
    "  • Every answer this episode MUST raise a LARGER question.",
    `  • Middle-third episodes (${innerStart}..${innerEnd}) INCREASE stakes — never explain stakes.`,
    "  • No 'to be continued', 'find out next time', 'tune in next episode'.",
    "  • Cliffhanger ends with a specific question mark and a specific noun",
    "    (a person, an object, a date, a number). Never abstract.",
    "  • The audience's project-level curiosity gap is NEVER resolved before the final episode.",
    "",
    "NARRATIVE COHESION (separate gate, scored independently from surprise):",
    "  • EP01 establishes THE central audience promise — the question the",
    "    audience came here to see answered. That question must REMAIN the",
    "    dominant thread through at least 80% of the season.",
    "  • Every episode after EP01 must DEEPEN the SAME central mystery — not",
    "    introduce a different one. Connected complications are fine;",
    "    unrelated mythology is not.",
    "  • Pacing cap: at most ONE major mystery LAYER every 5 episodes.",
    "    Layers accrete onto the EP01 mystery; they do not replace it.",
    "  • Pacing cap: at most ONE major CHARACTER reveal every 5 episodes.",
    "  • The chain must contain at most 3 unrelated mystery systems total.",
    "    Connected complications of EP01's mystery are NOT counted as",
    "    'new systems'.",
    "",
    "FORBIDDEN TROPES (these get the chain auto-rejected):",
    "  • Secret twin reveals UNLESS the twin is seeded in 5+ prior episodes.",
    "  • Clone reveals.",
    "  • Multiple personality / dissociative identity disorder reveals.",
    "  • 'It was all in their head / a dream / hallucination / coma dream' reveals.",
    "  • Replacement-person / doppelganger / body-double / impersonator reveals.",
    "",
    "QUALITY BAR per episode:",
    "  • Hook ≤ 18 words. Present-tense. Observable. Contains a high-pull",
    "    noun or verb (missing, dead, alive, wakes, calls, knows, kiss,",
    "    funeral, pregnant, knife, blood, stranger, secret, lie, reveal).",
    "  • Twist is a real reversal — what the audience thought was true,",
    "    isn't. Not a clarification.",
    "  • Cliffhanger is escalating: every cliffhanger is a HIGHER-STAKES",
    "    question than the prior episode's.",
    "",
    "JSON SCHEMA — every episode object must contain:",
    "  episodeNumber  (integer, 1-based, consecutive)",
    "  title          (short — fall back to EP01, EP02… if you cannot beat it)",
    "  hook           (the IMMEDIATE HOOK — first 0–5 seconds)",
    "  setup          (the NEW INFORMATION introduced this episode)",
    "  twist          (the REVERSAL OR ESCALATION)",
    "  cliffhanger    (the specific question that ends this episode)",
    "  revealedToAudience  (what was given to the audience this episode)",
    "  withheldFromAudience (what was deliberately held back this episode)",
    "  falseAssumptionReinforcedOrBroken (which audience-held false belief shifted)",
    "",
    "BANS:",
    "  • No screenplay formatting. No scene headings. No INT./EXT.",
    "  • No dialogue lines. No fountain. No shot lists.",
    "  • No filler verbs ('maybe', 'perhaps', 'kind of', 'sort of',",
    "    'quietly suggesting', 'subtly hints').",
    "  • No exposition-only episodes.",
    "  • No twist that is actually an explanation.",
    "",
    "Return JSON only. No preamble. No markdown fences. No commentary.",
  ].join("\n");
}

function buildGenerateUserPrompt(bible: MicroDramaBible, count: number): string {
  const reveal = formatRevealTracker(bible.characterRevealTracker);
  return [
    `Generate a ${count}-episode planning chain.`,
    "",
    `HOOK (concept): ${bible.hook}`,
    `AUDIENCE EMOTION: ${bible.audienceEmotion}`,
    `EPISODE LENGTH: ${bible.episodeLengthSec} seconds`,
    `SEASON LENGTH: ${count} episodes`,
    `CLIFFHANGER ENGINE: ${bible.cliffhangerEngine}`,
    bible.curiosityGap ? `PROJECT CURIOSITY GAP: ${bible.curiosityGap}` : "",
    reveal ? `CHARACTER REVEAL TRACKER:\n${reveal}` : "",
    "",
    `Return JSON: { "episodes": [ ${count} objects ] }`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildReviseUserPrompt(
  bible: MicroDramaBible,
  count: number,
  current: MicroDramaEpisodePlan[],
  scored: MicroDramaEpisodeChainPreviewEntry[],
  args: { mode: "full" | "weak"; targets: number[]; critique: ChainCritique }
): string {
  const reveal = formatRevealTracker(bible.characterRevealTracker);
  const targetSet = new Set(args.targets);

  const lines: string[] = [];
  lines.push(
    args.mode === "weak"
      ? `Rewrite ONLY these episodes: ${args.targets
          .map((n) => `EP${pad(n)}`)
          .join(", ")}.`
      : `The previous chain underperformed. Regenerate the FULL ${count}-episode chain.`
  );
  lines.push("");
  lines.push(`HOOK (concept): ${bible.hook}`);
  lines.push(`AUDIENCE EMOTION: ${bible.audienceEmotion}`);
  lines.push(`EPISODE LENGTH: ${bible.episodeLengthSec} seconds`);
  lines.push(`SEASON LENGTH: ${count} episodes`);
  lines.push(`CLIFFHANGER ENGINE: ${bible.cliffhangerEngine}`);
  if (bible.curiosityGap) {
    lines.push(`PROJECT CURIOSITY GAP: ${bible.curiosityGap}`);
  }
  if (reveal) {
    lines.push(`CHARACTER REVEAL TRACKER:\n${reveal}`);
  }

  // Season-level diagnosis.
  lines.push("");
  lines.push("PRIOR-PASS RETENTION DIAGNOSIS:");
  for (const line of args.critique.seasonNotes) lines.push(`  • ${line}`);

  // Per-episode diagnosis for the targeted episodes.
  lines.push("");
  lines.push("PER-EPISODE FIXES REQUIRED:");
  for (const e of scored) {
    if (args.mode === "weak" && !targetSet.has(e.plan.episodeNumber)) continue;
    const epNotes = args.critique.perEpisode[e.plan.episodeNumber] ?? [];
    if (epNotes.length === 0) continue;
    lines.push(`  EP${pad(e.plan.episodeNumber)} (binge ${e.binge.total}/100, viral ${e.viral.verdict}):`);
    for (const note of epNotes) lines.push(`    - ${note}`);
  }

  if (args.mode === "weak") {
    // Show the unmodified episodes so the model knows the spine it must NOT
    // break when rewriting the weak ones.
    lines.push("");
    lines.push("CURRENT CHAIN (DO NOT MODIFY non-targeted episodes — copy them verbatim):");
    for (const p of current) {
      lines.push(
        `  EP${pad(p.episodeNumber)} ${p.title} — hook="${oneLine(
          p.hook
        )}" / twist="${oneLine(p.twist)}" / cliff="${oneLine(p.cliffhanger)}"`
      );
    }
    lines.push("");
    lines.push(
      `Return JSON with ALL ${count} episodes. The targeted ones rewritten; the rest copied verbatim.`
    );
  } else {
    lines.push("");
    lines.push(
      `Return JSON: { "episodes": [ ${count} objects ] }. Re-author the entire chain applying the fixes above.`
    );
  }
  return lines.join("\n");
}

function formatRevealTracker(
  tracker: CharacterRevealTracker | undefined
): string {
  if (!tracker) return "";
  const lines: string[] = [];
  for (const [name, slots] of Object.entries(tracker)) {
    lines.push(`  ${name}:`);
    if (slots.known.length) lines.push(`    known: ${slots.known.join("; ")}`);
    if (slots.unknown.length)
      lines.push(`    unknown: ${slots.unknown.join("; ")}`);
    if (slots.falseAssumptions.length)
      lines.push(`    false: ${slots.falseAssumptions.join("; ")}`);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Critique generator (deterministic — drives revision prompts)
// ---------------------------------------------------------------------------

interface ChainCritique {
  /** Season-level notes (e.g. weak middle, low average). */
  seasonNotes: string[];
  /** Per-episode actionable issues, keyed by episode number. */
  perEpisode: Record<number, string[]>;
}

function buildCritique(
  entries: MicroDramaEpisodeChainPreviewEntry[],
  cohesion: NarrativeCohesionResult
): ChainCritique {
  const seasonNotes: string[] = [];
  const perEpisode: Record<number, string[]> = {};

  // Cohesion notes come FIRST — they're the most important season-level
  // fixes. The revisor sees these before the binge-driven notes.
  for (const issue of cohesion.issues) {
    seasonNotes.push(issue);
  }
  // Per-episode forbidden-trope flags so the revisor knows exactly which
  // episodes to rewrite. We QUOTE the matched substring back to the model
  // — without that, the model is told "remove DID" but can't see what
  // triggered the detector, and either refuses or re-emits similar text.
  for (const hit of cohesion.forbiddenTropeHits) {
    for (const m of hit.matches) {
      const notes = perEpisode[m.episodeNumber] ?? [];
      notes.push(
        `FORBIDDEN trope (${hit.label}) — the phrase "${m.matched}" triggered the detector. Rewrite this episode so that phrase and the underlying reveal are gone.`
      );
      perEpisode[m.episodeNumber] = notes;
    }
  }

  const avg = averageOf(entries.map((e) => e.binge.total));
  if (avg < HARD_REJECT_AVG) {
    seasonNotes.push(
      `Season average binge ${avg}/100 is below the hard floor of ${HARD_REJECT_AVG}. Rewrite for SCROLL behaviour, not television pacing.`
    );
  } else if (avg < TARGET_AVG) {
    seasonNotes.push(
      `Season average binge ${avg}/100 is below the target ${TARGET_AVG}. Tighten hooks and sharpen cliffhanger specificity.`
    );
  }

  const n = entries.length;
  const midStart = Math.floor(n / 3);
  const midEnd = Math.ceil((2 * n) / 3);
  const weakMiddle = entries
    .slice(midStart, midEnd)
    .filter((e) => e.binge.total < 50)
    .map((e) => e.plan.episodeNumber);
  if (weakMiddle.length > 0) {
    seasonNotes.push(
      `Middle-third saggy: EP${weakMiddle.map(pad).join(", EP")}. These episodes must INCREASE stakes — do not explain them.`
    );
  }

  for (const e of entries) {
    const notes: string[] = [];
    const c = e.binge.components;
    if (c.hookStrength < 12) {
      notes.push(
        "Hook is weak — rewrite as a 0–5s observable moment with a high-pull noun/verb."
      );
    }
    if (c.curiosityGap < 12) {
      notes.push(
        "Setup does not advance the project curiosity gap — withhold something specific instead."
      );
    }
    if (c.twistStrength < 12) {
      notes.push(
        "Twist is not a real reversal — make the audience's prior belief wrong, not just incomplete."
      );
    }
    if (c.cliffhangerStrength < 12) {
      notes.push(
        "Cliffhanger is generic — end with a specific question (specific noun, person, or date)."
      );
    }
    if (!/\?\s*$/.test(e.plan.cliffhanger ?? "")) {
      notes.push("Cliffhanger must end with a question mark.");
    }
    // Surface viral test recommendation if non-yes.
    if (e.viral.verdict !== "yes" && e.viral.recommendation) {
      notes.push(`Viral test (${e.viral.verdict}): ${e.viral.recommendation}`);
    }
    if (notes.length > 0) perEpisode[e.plan.episodeNumber] = notes;
  }

  return { seasonNotes, perEpisode };
}

// ---------------------------------------------------------------------------
// Normalisation + scoring helpers
// ---------------------------------------------------------------------------

interface RawEpisode {
  episodeNumber?: unknown;
  title?: unknown;
  hook?: unknown;
  setup?: unknown;
  twist?: unknown;
  cliffhanger?: unknown;
  revealedToAudience?: unknown;
  withheldFromAudience?: unknown;
  falseAssumptionReinforcedOrBroken?: unknown;
}

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" ? v.trim() : fallback;

function normalisePlans(
  raw: RawEpisode[],
  expected: number
): MicroDramaEpisodePlan[] {
  const plans: MicroDramaEpisodePlan[] = raw.map((e, i) => {
    const numCandidate = Number(e.episodeNumber);
    const episodeNumber =
      Number.isFinite(numCandidate) && numCandidate > 0
        ? Math.trunc(numCandidate)
        : i + 1;
    const fallbackTitle = `EP${pad(episodeNumber)}`;
    return {
      episodeNumber,
      title: str(e.title, fallbackTitle) || fallbackTitle,
      hook: str(e.hook),
      setup: str(e.setup),
      twist: str(e.twist),
      cliffhanger: str(e.cliffhanger),
      revealedToAudience: str(e.revealedToAudience),
      withheldFromAudience: str(e.withheldFromAudience),
      falseAssumptionReinforcedOrBroken: str(
        e.falseAssumptionReinforcedOrBroken
      ),
    };
  });

  const byNum = new Map<number, MicroDramaEpisodePlan>();
  for (const p of plans) {
    if (!byNum.has(p.episodeNumber)) byNum.set(p.episodeNumber, p);
  }
  const sorted = [...byNum.values()].sort(
    (a, b) => a.episodeNumber - b.episodeNumber
  );
  const out = sorted.slice(0, expected);
  while (out.length < expected) {
    const n = out.length + 1;
    out.push({
      episodeNumber: n,
      title: `EP${pad(n)}`,
      hook: "",
      setup: "",
      twist: "",
      cliffhanger: "",
      revealedToAudience: "",
      withheldFromAudience: "",
      falseAssumptionReinforcedOrBroken: "",
    });
  }
  return out.map((p, i) => ({ ...p, episodeNumber: i + 1 }));
}

function scoreEntries(
  plans: MicroDramaEpisodePlan[],
  curiosityGap?: string
): MicroDramaEpisodeChainPreviewEntry[] {
  return plans.map((plan) => {
    const binge = computeBingeMomentum(
      {
        hook: plan.hook,
        setup: plan.setup,
        twist: plan.twist,
        cliffhanger: plan.cliffhanger,
      },
      curiosityGap
    );
    const viral = viralTest(binge);
    return { plan, binge, viral };
  });
}

function buildPreview(
  entries: MicroDramaEpisodeChainPreviewEntry[],
  originalAvg: number,
  revisionTrail: MicroDramaChainRevisionStep[],
  cohesion: NarrativeCohesionResult,
  originalCohesion: NarrativeCohesionResult
): MicroDramaEpisodeChainPreview {
  const averageBinge = averageOf(entries.map((e) => e.binge.total));
  const failingEpisodes = entries
    .filter((e) => !e.viral.passes)
    .map((e) => e.plan.episodeNumber);

  const n = entries.length;
  const midStart = Math.floor(n / 3);
  const midEnd = Math.ceil((2 * n) / 3);
  const weakMiddle = entries
    .filter(
      (_, idx) =>
        idx >= midStart && idx < midEnd && entries[idx].binge.total < 50
    )
    .map((e) => e.plan.episodeNumber);

  return {
    entries,
    averageBinge,
    originalAverageBinge: originalAvg,
    failingEpisodes,
    weakMiddle,
    revisionTrail,
    cohesion: toCohesionPayload(cohesion),
    originalCohesion: toCohesionPayload(originalCohesion),
  };
}

function toCohesionPayload(
  c: NarrativeCohesionResult
): MicroDramaEpisodeChainPreview["cohesion"] {
  return {
    cohesionScore: c.cohesionScore,
    promiseRetentionPct: c.promiseRetentionPct,
    mysterySystemsCount: c.mysterySystemsCount,
    mysteryLayerCount: c.mysteryLayerCount,
    characterRevealCount: c.characterRevealCount,
    forbiddenTropeHits: c.forbiddenTropeHits,
    detectedAnchors: c.detectedAnchors,
    passes: c.passes,
  };
}

function averageOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((s, n) => s + n, 0) / nums.length);
}

function clampSeasonLength(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return 20;
  return Math.min(Math.trunc(n), 100);
}

const pad = (n: number): string => String(n).padStart(2, "0");
const oneLine = (s: string): string =>
  (s ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
