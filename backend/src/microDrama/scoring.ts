// Micro Drama retention engine — Binge Momentum Score + Viral Test.
//
// Deterministic, fast, no LLM call. Computed from the four story-structure
// fields on each episode (hook / setup / twist / cliffhanger) plus the
// project-level curiosity gap. Surfaced on the episode card; consumed by
// the viral test gate that flags episodes the audience wouldn't continue.

import type {
  BingeMomentumScore,
  BingeMomentumComponents,
  MicroDramaEpisodeStructure,
  ViralTestResult,
} from "@toburt/shared";

// ---- helpers ---------------------------------------------------------------

const wordCount = (s: string | undefined): number =>
  (s ?? "").trim().split(/\s+/).filter(Boolean).length;

const containsQuestion = (s: string | undefined): boolean =>
  /[?]\s*$/.test((s ?? "").trim());

// HIGH_PULL token families — each family has a canonical key + every
// morphological variant the scorer accepts.
//
// Calibration pass (Phase E):
//   • Substring matching is replaced by WORD-BOUNDARY regex. "secretary"
//     no longer triggers "secret"; "office" no longer triggers any signal
//     containing "off"; "deadline" no longer triggers "dead".
//   • Common English variants of seven families are now credited:
//       calls   ← call / calls / called / calling
//       texts   ← text / texts / texted / texting
//       knows   ← know / knows / knew / known / knowing
//       warns   ← warn / warns / warned / warning
//       reveal  ← reveal / reveals / revealed / revealing
//       lie     ← lie / lies / lied / lying
//       follows ← follow / follows / followed / following
//       wakes   ← wake / wakes / waking / woke / woken
//       (plus regular plurals for noun families)
//   • `alive` stays specific. Bare `live` is NOT counted.
//   • Hit-count is by CANONICAL family, not raw match count — saying "called"
//     twice in one sentence still credits one `calls` hit (preserves the
//     original "one credit per dictionary token" intent).
const HIGH_PULL_FAMILIES: ReadonlyArray<{ canon: string; variants: string[] }> = [
  { canon: "first time", variants: ["first time"] },
  { canon: "missing", variants: ["missing"] },
  { canon: "secret", variants: ["secret", "secrets"] },
  { canon: "dead", variants: ["dead"] },
  { canon: "alive", variants: ["alive"] }, // do NOT include bare "live"
  { canon: "never", variants: ["never"] },
  { canon: "wrong", variants: ["wrong"] },
  { canon: "different", variants: ["different"] },
  { canon: "stranger", variants: ["stranger", "strangers"] },
  { canon: "wedding", variants: ["wedding", "weddings"] },
  { canon: "funeral", variants: ["funeral", "funerals"] },
  { canon: "blood", variants: ["blood", "bloody"] },
  { canon: "knife", variants: ["knife", "knives"] },
  { canon: "gun", variants: ["gun", "guns"] },
  { canon: "pregnant", variants: ["pregnant"] },
  { canon: "twin", variants: ["twin", "twins"] },
  { canon: "another", variants: ["another"] },
  { canon: "second", variants: ["second", "seconds"] },
  { canon: "third", variants: ["third"] },
  { canon: "wakes", variants: ["wake", "wakes", "waking", "woke", "woken"] },
  { canon: "texts", variants: ["text", "texts", "texted", "texting"] },
  { canon: "calls", variants: ["call", "calls", "called", "calling"] },
  { canon: "warns", variants: ["warn", "warns", "warned", "warning"] },
  { canon: "follows", variants: ["follow", "follows", "followed", "following"] },
  { canon: "reveal", variants: ["reveal", "reveals", "revealed", "revealing"] },
  { canon: "kiss", variants: ["kiss", "kisses", "kissed", "kissing"] },
  { canon: "lie", variants: ["lie", "lies", "lied", "lying"] },
  { canon: "knows", variants: ["know", "knows", "knew", "known", "knowing"] },
  { canon: "denies", variants: ["deny", "denies", "denied", "denying"] },
  { canon: "marry", variants: ["marry", "marries", "married", "marrying"] },
  // Phase E addition — "hide" was previously only in SIGNAL (via "hidden")
  // but the writer's spec explicitly requested it as a high-pull family.
  { canon: "hide", variants: ["hide", "hides", "hiding", "hidden"] },
];

const VARIANT_TO_CANON: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const f of HIGH_PULL_FAMILIES) {
    for (const v of f.variants) m.set(v, f.canon);
  }
  return m;
})();

const escapeRe = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HIGH_PULL_RE = new RegExp(
  "\\b(?:" +
    HIGH_PULL_FAMILIES.flatMap((f) => f.variants)
      .map(escapeRe)
      .join("|") +
    ")\\b",
  "gi"
);

const LOW_PULL_FILLER = [
  "however", "perhaps", "maybe", "kind of", "sort of", "i think",
  "subtly", "gently", "quietly suggesting",
];

const containsHighPull = (s: string | undefined): number => {
  if (!s) return 0;
  const matches = s.toLowerCase().match(HIGH_PULL_RE) ?? [];
  if (matches.length === 0) return 0;
  const distinct = new Set<string>();
  for (const m of matches) distinct.add(VARIANT_TO_CANON.get(m) ?? m);
  return distinct.size;
};

const containsFiller = (s: string | undefined): number => {
  if (!s) return 0;
  const lower = s.toLowerCase();
  let hits = 0;
  for (const w of LOW_PULL_FILLER) if (lower.includes(w)) hits++;
  return hits;
};

// SIGNAL words for the Curiosity Gap scorer. Word-boundary matched so the
// setup must use the word as a standalone word — "office" no longer counts
// as "off"; "anonymously" still credits "anonymous" because anonymous is
// listed in addition. Calibration additions (Phase E): off, waiting,
// blinking, recording, anonymous.
const SIGNAL_WORDS = [
  "face-down", "redacted", "blurred", "off-screen",
  "unknown", "unnamed",
  "missing", "deleted", "blocked", "hidden",
  "not visible", "unsent",
  // Phase E additions:
  "off", "waiting", "blinking", "recording", "anonymous",
];

const SIGNAL_RE = new RegExp(
  "\\b(?:" + SIGNAL_WORDS.map(escapeRe).join("|") + ")\\b",
  "i"
);

// ---- hook strength (0..25) -------------------------------------------------
//
// A strong hook is:
//   • short (1 sentence, ≤ 18 words is ideal)
//   • present-tense, observable
//   • contains a high-pull noun/verb
//   • NOT a question (questions belong in cliffhanger)
function scoreHook(hook: string | undefined): { score: number; notes: string[] } {
  const notes: string[] = [];
  if (!hook || !hook.trim()) {
    return { score: 0, notes: ["Hook is empty — the first 1–3 seconds have no purpose."] };
  }
  const wc = wordCount(hook);
  let score = 0;
  if (wc <= 18) score += 10;
  else if (wc <= 28) score += 6;
  else {
    score += 2;
    notes.push(`Hook is ${wc} words — too long for the first 3 seconds.`);
  }
  const pull = containsHighPull(hook);
  if (pull >= 2) score += 12;
  else if (pull === 1) score += 8;
  else {
    score += 2;
    notes.push("Hook has no high-pull noun/verb (missing, lie, wakes, reveals, …).");
  }
  // Bonus for present-tense punctuation.
  if (/\b(?:wakes|finds|opens|sees|hears|gets|receives|notices|spots|grabs)\b/i.test(hook)) {
    score += 3;
  }
  return { score: Math.min(25, score), notes };
}

// ---- curiosity-gap strength (0..25) ----------------------------------------
//
// Two sources:
//   • project-level curiosityGap string (what is withheld across season)
//   • per-episode setup containing a specific unnamed-thing reference
function scoreCuriosityGap(
  setup: string | undefined,
  projectCuriosityGap: string | undefined
): { score: number; notes: string[] } {
  const notes: string[] = [];
  let score = 0;
  if (projectCuriosityGap && projectCuriosityGap.trim()) {
    score += 12;
  } else {
    notes.push("Project has no curiosityGap set — the audience doesn't know what they're trying to find out.");
  }
  // Per-episode signal: the setup names something specific the audience
  // hasn't been shown ("a voicemail", "a name on the screen", "a photograph
  // turned face-down", a "missing X"). Word-boundary matched via SIGNAL_RE
  // defined at the top of this file.
  if (setup) {
    if (SIGNAL_RE.test(setup)) {
      score += 10;
    } else if (setup.trim()) {
      score += 4;
      notes.push("Setup names no withheld element — nothing left for the audience to wonder about.");
    }
  } else {
    notes.push("Setup is empty.");
  }
  // Generic adverb filler bleeds curiosity.
  if (containsFiller(setup) >= 2) {
    score -= 3;
    notes.push("Setup is full of filler — \"perhaps\", \"maybe\", \"kind of\". Commit to specifics.");
  }
  return { score: Math.max(0, Math.min(25, score)), notes };
}

// ---- twist strength (0..25) ------------------------------------------------
//
// A strong twist:
//   • reverses an assumption from setup
//   • has a present-tense action verb
//   • introduces or removes a specific element
function scoreTwist(twist: string | undefined): { score: number; notes: string[] } {
  const notes: string[] = [];
  if (!twist || !twist.trim()) {
    return { score: 0, notes: ["Twist is empty — nothing changes mid-episode."] };
  }
  let score = 0;
  // Verb / action.
  if (/\b(?:turns out|reveals|finds|discovers|opens|hears|sees|gets|appears|arrives|breaks|cracks|catches|catches up|confesses|admits|denies|lies|calls back|hangs up)\b/i.test(twist)) {
    score += 12;
  } else {
    score += 3;
    notes.push("Twist has no clear reversal verb — name what changes.");
  }
  // High-pull token bonus.
  const pull = containsHighPull(twist);
  score += Math.min(10, pull * 4);
  // Length penalty if too short OR too long.
  const wc = wordCount(twist);
  if (wc < 4) {
    score -= 3;
    notes.push("Twist is too thin — one phrase is not a reversal.");
  } else if (wc > 60) {
    score -= 3;
    notes.push("Twist runs long — it's a scene, not a beat.");
  }
  return { score: Math.max(0, Math.min(25, score)), notes };
}

// ---- cliffhanger strength (0..25) ------------------------------------------
//
// A strong cliffhanger:
//   • IS a question (or ends in one)
//   • points forward, not back
//   • contains a high-pull noun
//   • specific to THIS episode, not generic
function scoreCliffhanger(cliffhanger: string | undefined): { score: number; notes: string[] } {
  const notes: string[] = [];
  if (!cliffhanger || !cliffhanger.trim()) {
    return { score: 0, notes: ["Cliffhanger is empty — no reason to watch the next episode."] };
  }
  let score = 0;
  if (containsQuestion(cliffhanger)) score += 10;
  else {
    score += 4;
    notes.push("Cliffhanger is not phrased as a question — make the unanswered thing explicit.");
  }
  const pull = containsHighPull(cliffhanger);
  score += Math.min(10, pull * 5);
  if (pull === 0) notes.push("Cliffhanger has no high-pull noun — what is the audience desperate to know?");
  // Generic phrasing penalty.
  const GENERIC = [
    "what happens next", "what will happen", "to be continued",
    "the answer is unclear", "we'll see", "stay tuned",
  ];
  const lower = cliffhanger.toLowerCase();
  for (const g of GENERIC) {
    if (lower.includes(g)) {
      score -= 6;
      notes.push(`Cliffhanger contains generic phrasing ("${g}") — specific reveals beat vague teases.`);
      break;
    }
  }
  // Length sweet spot. Loosened (Phase E) from 6..24 to 6..32 — vertical-
  // drama cliffhangers commonly need a specific physical image PLUS a
  // pointed question PLUS a named noun, which routinely runs 25–32 words
  // even when the writing is tight.
  const wc = wordCount(cliffhanger);
  if (wc >= 6 && wc <= 32) score += 5;
  return { score: Math.max(0, Math.min(25, score)), notes };
}

// ---- top-level: score + viral test -----------------------------------------

export function computeBingeMomentum(
  episode: Partial<MicroDramaEpisodeStructure>,
  projectCuriosityGap?: string
): BingeMomentumScore {
  const hook = scoreHook(episode.hook);
  const gap = scoreCuriosityGap(episode.setup, projectCuriosityGap);
  const twist = scoreTwist(episode.twist);
  const cliff = scoreCliffhanger(episode.cliffhanger);
  const components: BingeMomentumComponents = {
    hookStrength: hook.score,
    curiosityGap: gap.score,
    twistStrength: twist.score,
    cliffhangerStrength: cliff.score,
  };
  const total = Math.floor(
    components.hookStrength +
      components.curiosityGap +
      components.twistStrength +
      components.cliffhangerStrength
  );
  return {
    total,
    components,
    notes: [...hook.notes, ...gap.notes, ...twist.notes, ...cliff.notes],
  };
}

/**
 * Viral test — would a viewer NEED to know what happens next?
 *
 *   passes === true   → score ≥ 65 AND cliffhanger ≥ 15. Approvable.
 *   passes === false  → score < 50 OR cliffhanger ≤ 8 OR hook ≤ 5.
 *                       FLAGGED in the dashboard.
 *   otherwise         → "weak". Approvable with rewrite warning.
 */
export function viralTest(score: BingeMomentumScore): ViralTestResult {
  const c = score.components;
  if (score.total >= 65 && c.cliffhangerStrength >= 15 && c.hookStrength >= 12) {
    return {
      passes: true,
      verdict: "yes",
      recommendation: "Strong hook + cliffhanger. Approvable as-is.",
    };
  }
  if (score.total < 50 || c.cliffhangerStrength <= 8 || c.hookStrength <= 5) {
    const weakest =
      c.cliffhangerStrength <= 8
        ? "cliffhanger"
        : c.hookStrength <= 5
        ? "hook"
        : c.twistStrength <= 8
        ? "twist"
        : "curiosity gap";
    return {
      passes: false,
      verdict: "no",
      recommendation: `Viewer would scroll. Rewrite the ${weakest}.`,
    };
  }
  return {
    passes: true,
    verdict: "weak",
    recommendation: "Approvable, but the cliffhanger or hook could carry more pull.",
  };
}
