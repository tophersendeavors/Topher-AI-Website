// Tier 1 "Dramatic Turn / Leverage Shift" detector — free, heuristic, no LLM.
//
// Replaces the old "scene ends on an action line = maybe a turn" proxy with a
// MULTI-AXIS fingerprint. A scene "turns" when its end-state differs from its
// start-state along any of seven axes. Each axis fires from cheap lexical cues
// in the scene text and/or structural score signals. The output language is
// deliberately honest — we never assert a turn as fact, only "detected",
// "possible", or "no clear detected turn".
//
// Scope-agnostic and pure: consumed by the shared analysis (episode + season)
// and safe to run on every EI pass.

export type TurnAxis =
  | "leverage"
  | "decision"
  | "secret"
  | "relationship"
  | "emotion"
  | "new-problem"
  | "audience";

export const TURN_AXIS_LABEL: Record<TurnAxis, string> = {
  leverage: "leverage",
  decision: "decision",
  secret: "secret",
  relationship: "relationship",
  emotion: "emotion",
  "new-problem": "new problem",
  audience: "audience understanding",
};

export type TurnLevel = "detected" | "possible" | "none";

export const TURN_LEVEL_LABEL: Record<TurnLevel, string> = {
  detected: "Turn detected",
  possible: "Possible turn",
  none: "No clear detected turn",
};

export interface TurnResult {
  level: TurnLevel;
  axes: TurnAxis[];
  /** 0..1 — rough confidence, for sorting/emphasis only. */
  confidence: number;
  /** Up to a few short snippets explaining what fired. */
  evidence: string[];
}

export type TurnAlignment =
  | "aligned"
  | "intent-not-landing"
  | "unintended-turn"
  | "none";

export interface SceneTurn {
  detected: TurnResult;
  /** The authored Turn from the scene plan (Goal / Conflict / Turn), if any. */
  intendedTurn: string | null;
  alignment: TurnAlignment;
  /** Human-facing note, e.g. "Intended turn may not be landing." */
  note?: string;
  /** The inferred job this scene performs. */
  job: SceneJob;
  /** Whether the job is meant to turn (drives "quiet by design" framing). */
  expectsTurn: boolean;
}

/** Minimal shape the detector needs (AnalyzedScene satisfies it structurally). */
export interface TurnScene {
  order: number;
  slugline: string;
  overall: number;
  scores: Record<string, { value: number; available: boolean } | undefined>;
  /** Scene body (Fountain) — enables the lexical axes when present. */
  fountain?: string;
  /** Authored Turn from the scene plan, if materialized. */
  authoredTurn?: string | null;
}

// --- Lexical axis cues (case-insensitive). Noisy individually; useful in sum.
const AXIS_PATTERNS: Array<{ axis: TurnAxis; re: RegExp }> = [
  {
    axis: "decision",
    re: /\b(i'?ll do it|i'?ve decided|i have decided|then it'?s settled|it'?s decided|i'?m done|we'?re done here|i quit|i'?m in|i'?m out|that'?s final|no more|i won'?t|i refuse|count me (in|out))\b/i,
  },
  {
    axis: "secret",
    re: /\b(the truth is|i never told you|you don'?t know|nobody knows|i know what you did|don'?t tell|between us|our secret|i lied|i'?ve been lying|i have to tell you|there'?s something you|i confess)\b/i,
  },
  {
    axis: "relationship",
    re: /\b(we'?re (over|done|through)|get out|stay with me|i love you|i can'?t trust you|i trusted you|don'?t go|marry me|i want a divorce|you'?re my|i'?m leaving you)\b/i,
  },
  {
    axis: "new-problem",
    re: /\b(but now|suddenly|turns out|except that|the problem is|now we have|it'?s worse|that changes everything|too late|out of time)\b/i,
  },
  {
    axis: "audience",
    re: /\b(all along|the whole time|it was (you|him|her|me) all|you'?re the one|i'?m your|so it was you|knew it was)\b/i,
  },
];

const LEVERAGE_RE =
  /\b(you win|have it your way|i give up|you'?re right|as you wish|or else|last chance|you have (until|one|24)|do it or|if you don'?t|i'?ll ruin you|on my terms)\b/i;
const EMOTION_RE =
  /\b(breaks down|starts to cry|in tears|trembling|can'?t breathe|falls apart|voice cracks|goes cold|shuts down)\b/i;
const EXIT_RE = /\b(exits|walks out|storms (off|out)|slams the door|leaves the room)\b/i;

const STRONG_INTENT_NEGATIVES = /^(tbd|n\/?a|none|-|—|unclear|\?+)$/i;

function snippet(text: string, re: RegExp): string | null {
  const m = text.match(re);
  if (!m) return null;
  const idx = m.index ?? 0;
  const around = text.slice(Math.max(0, idx - 12), idx + (m[0]?.length ?? 0) + 24);
  return around.replace(/\s+/g, " ").trim().slice(0, 70);
}

/** Detect a dramatic turn from lexical cues + structural score signals. */
export function detectTurn(scene: TurnScene, prev?: TurnScene): TurnResult {
  const fountain = scene.fountain ?? "";
  const axes = new Set<TurnAxis>();
  const evidence: string[] = [];
  const fire = (axis: TurnAxis, ev?: string) => {
    axes.add(axis);
    if (ev && evidence.length < 4) evidence.push(`${TURN_AXIS_LABEL[axis]}: "${ev}"`);
  };

  // --- Lexical axes (only when we have the scene text) ---
  if (fountain.trim()) {
    for (const { axis, re } of AXIS_PATTERNS) {
      const ev = snippet(fountain, re);
      if (ev) fire(axis, ev);
    }
    const lev = snippet(fountain, LEVERAGE_RE);
    if (lev) fire("leverage", lev);
    const exit = snippet(fountain, EXIT_RE);
    if (exit) fire("leverage", exit);
    const emo = snippet(fountain, EMOTION_RE);
    if (emo) fire("emotion", emo);

    // A new speaker appearing in the back half of the scene = someone enters.
    const entrance = detectLateEntrance(fountain);
    if (entrance) fire("new-problem", `${entrance} enters mid-scene`);
  }

  // --- Structural signals (always available) ---
  const power = scene.scores.powerShift?.value ?? 0;
  const tension = scene.scores.tension;
  const tensionVal = tension?.available ? tension.value : 0;
  const prevTension =
    prev && prev.scores.tension?.available ? prev.scores.tension.value : null;
  const dTension = tension?.available && prevTension != null ? tensionVal - prevTension : 0;
  const dOverall = prev ? scene.overall - prev.overall : 0;

  let strongStructural = false;
  if (power >= 0.8) {
    fire("leverage", "strong on-screen power shift");
    strongStructural = true;
  }
  if (Math.abs(dOverall) >= 0.15) {
    fire("emotion", `emotional swing ${dOverall >= 0 ? "+" : ""}${Math.round(dOverall * 100)}`);
    strongStructural = true;
  }
  if (tension?.available && dTension >= 0.1 && tensionVal >= 0.5) {
    fire("new-problem", `tension rising +${Math.round(dTension * 100)}`);
  }

  const axisList = [...axes];
  // A "secret" or "audience" reveal is high-salience even alone.
  const highSalience = axes.has("secret") || axes.has("audience");

  let level: TurnLevel;
  if (axisList.length >= 2 || strongStructural || highSalience) level = "detected";
  else if (axisList.length === 1) level = "possible";
  else level = "none";

  const confidence = Math.min(
    1,
    axisList.length * 0.22 + (strongStructural ? 0.34 : 0) + (highSalience ? 0.2 : 0)
  );

  return { level, axes: axisList, confidence, evidence };
}

function detectLateEntrance(fountain: string): string | null {
  const lines = fountain.split(/\r?\n/);
  const cues: Array<{ name: string; line: number }> = [];
  lines.forEach((raw, i) => {
    const l = raw.trim();
    // Character cue: short, mostly uppercase, not a slugline or transition.
    if (
      /^[A-Z][A-Z0-9 .'’\-()]{1,30}$/.test(l) &&
      !/^(INT|EXT|EST|I\/E)\b/.test(l) &&
      !/^(CUT TO|FADE|SMASH|DISSOLVE|MATCH CUT)/.test(l) &&
      !/[a-z]/.test(l)
    ) {
      cues.push({ name: l.replace(/\(.*\)/, "").trim(), line: i });
    }
  });
  if (cues.length < 2) return null;
  const half = lines.length / 2;
  // Distinct speakers in order of first appearance.
  const firstSeenLine = new Map<string, number>();
  const order: string[] = [];
  for (const c of cues) {
    if (!firstSeenLine.has(c.name)) {
      firstSeenLine.set(c.name, c.line);
      order.push(c.name);
    }
  }
  // A genuine entrance = a THIRD (or later) distinct speaker arriving in the
  // back half. A two-hander's second voice appearing late is not an entrance.
  if (order.length < 3) return null;
  for (let i = 2; i < order.length; i++) {
    if ((firstSeenLine.get(order[i]) ?? 0) > half) return order[i];
  }
  return null;
}

// --- Scene job (what the scene is FOR) --------------------------------------
// Evaluation is graded against the job a scene is meant to perform. A profile
// declares whether the job is expected to TURN and which tension weaknesses are
// even fair to flag. Profiles only ever RELAX penalties — a reflection scene is
// never failed for lacking an opposing objective; a dread scene is never failed
// for lacking a leverage shift.

export type SceneJob =
  | "setup"
  | "reflection"
  | "mystery"
  | "dread"
  | "confrontation"
  | "transition"
  | "payoff";

export const SCENE_JOB_LABEL: Record<SceneJob, string> = {
  setup: "Setup",
  reflection: "Reflection",
  mystery: "Mystery",
  dread: "Dread",
  confrontation: "Confrontation",
  transition: "Transition",
  payoff: "Payoff",
};

export interface SceneJobProfile {
  /** Does this job require a dramatic turn to succeed? */
  expectsTurn: boolean;
  /** Tension-weakness sources it is fair to flag for this job. */
  applicableTensionSources: TensionSourceName[];
  /** One-line description of the job's purpose. */
  purpose: string;
}

// Forward type alias so the profile can reference sources declared below.
type TensionSourceName =
  | "no-conflicting-objective"
  | "no-consequence"
  | "no-leverage-shift"
  | "agreement-too-quickly"
  | "lacks-uncertainty";

export const SCENE_JOB_PROFILE: Record<SceneJob, SceneJobProfile> = {
  setup: {
    expectsTurn: false,
    applicableTensionSources: [],
    purpose: "Establishes people, place, and the situation. Not built to turn.",
  },
  reflection: {
    expectsTurn: false,
    applicableTensionSources: [],
    purpose: "Internal processing. Graded on truth, subtext, and wound — not conflict.",
  },
  mystery: {
    expectsTurn: false,
    applicableTensionSources: ["no-consequence"],
    purpose: "Raises or deepens a question. Thrives on what is withheld.",
  },
  dread: {
    expectsTurn: false,
    applicableTensionSources: ["lacks-uncertainty", "no-consequence"],
    purpose: "Anticipatory tension toward a threat. Needs uncertainty + stakes, not a power exchange.",
  },
  confrontation: {
    expectsTurn: true,
    applicableTensionSources: [
      "no-conflicting-objective",
      "no-consequence",
      "no-leverage-shift",
      "agreement-too-quickly",
      "lacks-uncertainty",
    ],
    purpose: "Opposing objectives collide. Should turn — leverage and stakes matter most.",
  },
  transition: {
    expectsTurn: false,
    applicableTensionSources: [],
    purpose: "Connective tissue. Moves us between beats; not graded for conflict.",
  },
  payoff: {
    expectsTurn: true,
    applicableTensionSources: ["no-consequence"],
    purpose: "Delivers on planted stakes. Should land a result.",
  },
};

const DREAD_RE =
  /\b(something'?s? (wrong|coming|out there)|too quiet|any minute|before (it|they|he|she)|don'?t move|footsteps|in the dark|watching us|getting closer|not alone|behind you)\b/i;
const MYSTERY_RE =
  /\b(who (is|are|sent|did)|what (happened|is going on|are you)|why would|where did|what do you know|find out|figure out|gone missing|disappeared|no sign of)\b/i;

/** Infer the job a scene is performing (heuristic, "inferred"). Position is
 *  optional — when omitted, setup/payoff position checks are skipped. */
export function classifySceneJob(
  scene: TurnScene,
  prev?: TurnScene,
  index?: number,
  total?: number
): SceneJob {
  const f = scene.fountain ?? "";
  const power = scene.scores.powerShift?.value ?? 0;
  const tension = scene.scores.tension;
  const tensionVal = tension?.available ? tension.value : 0;
  const truth = scene.scores.truth?.value ?? 0;
  const wound = scene.scores.wound;
  const behavior = scene.scores.behavior?.value ?? 0.5;
  const dOverall = prev ? scene.overall - prev.overall : 0;
  const pos = total && total > 1 && index != null ? index / (total - 1) : 0.5;
  const hasOpposition = OPPOSITION_RE.test(f);
  const questionCount = (f.match(/\?/g) || []).length;

  // 1. Confrontation — opposing objectives actively colliding. Opposition
  //    language is the primary signal; tension/power need only be moderate
  //    (heuristic tension often reads low even in real conflict scenes).
  if (hasOpposition && (tensionVal >= 0.4 || power >= 0.5)) return "confrontation";
  // 2. Dread — anticipatory tension toward a threat, no active power exchange.
  if (
    DREAD_RE.test(f) ||
    (tension?.available && tensionVal >= 0.4 && tensionVal < 0.7 && power < 0.5 && !hasOpposition && behavior < 0.5)
  )
    return "dread";
  // 3. Mystery — questions raised / information withheld.
  if (questionCount >= 2 || MYSTERY_RE.test(f)) return "mystery";
  // 4. Payoff — late, delivering a result.
  if (pos >= 0.8 && scene.overall >= 0.65 && (power >= 0.6 || Math.abs(dOverall) >= 0.12))
    return "payoff";
  // 5. Reflection — introspective, low external tension, wound in play / near-solo.
  if (
    !hasOpposition &&
    tensionVal < 0.4 &&
    (truth >= 0.55 || (wound?.available && wound.value >= 0.5))
  )
    return "reflection";
  // 6. Setup — early establishing.
  if (pos <= 0.25) return "setup";
  // 7. Default — connective transition.
  return "transition";
}

// --- Tension-weakness source taxonomy --------------------------------------

export type TensionSource =
  | "no-conflicting-objective"
  | "no-consequence"
  | "no-leverage-shift"
  | "agreement-too-quickly"
  | "lacks-uncertainty";

export const TENSION_SOURCE_LABEL: Record<TensionSource, string> = {
  "no-conflicting-objective": "No conflicting objective — nothing opposes the POV character's want.",
  "no-consequence": "No consequence — nothing is at stake if this scene fails.",
  "no-leverage-shift": "No leverage shift — who holds power doesn't change.",
  "agreement-too-quickly": "Agreement comes too quickly — capitulation without friction.",
  "lacks-uncertainty": "Scene lacks uncertainty — the outcome is never in doubt.",
};

// Short lowercase fragments for inline "why it doesn't land" sentences.
const TENSION_SOURCE_SHORT: Record<TensionSource, string> = {
  "no-conflicting-objective": "no opposing objective",
  "no-consequence": "nothing at stake",
  "no-leverage-shift": "no leverage shift",
  "agreement-too-quickly": "they agree too quickly",
  "lacks-uncertainty": "the outcome is never in doubt",
};

const OPPOSITION_RE =
  /\b(i won'?t|you can'?t|never|i refuse|that'?s not|absolutely not|like hell|you'?re wrong|over my dead body|no way|forget it|stop)\b/i;
const STAKES_RE =
  /\b(or else|if (we|you|i) don'?t|we'?ll lose|at stake|depends on|last chance|out of time|run out|cost (you|us|me)|you'?ll regret|ruin|destroy|expose|fired|arrested|she dies|he dies|it'?s over for)\b/i;
const AGREEMENT_RE =
  /\b(okay|fine|sure|agreed|you'?re right|i suppose|whatever you say|deal|as you wish|consider it done|i'?ll do it)\b/i;
const UNCERTAINTY_RE =
  /\b(maybe|what if|i don'?t know|might|could|unless|not sure|perhaps|if it works|assuming|we'?ll see)\b/i;

/**
 * Identify the likely SOURCE(s) of weak tension. When a `job` is given, only
 * sources that are FAIR for that job survive — e.g. a reflection scene never
 * reports "no conflicting objective"; a dread scene never reports "no leverage
 * shift". This is the relax-not-invent guard.
 */
export function diagnoseTension(scene: TurnScene, job?: SceneJob): TensionSource[] {
  const f = scene.fountain ?? "";
  if (!f.trim()) return [];
  const power = scene.scores.powerShift?.value ?? 0;
  const hasOpposition = OPPOSITION_RE.test(f);
  const hasStakes = STAKES_RE.test(f);
  const hasAgreement = AGREEMENT_RE.test(f);
  const hasUncertainty = /\?/.test(f) || UNCERTAINTY_RE.test(f);
  const hasLeverage = LEVERAGE_RE.test(f) || EXIT_RE.test(f) || power >= 0.6;

  const sources: TensionSource[] = [];
  if (!hasLeverage) sources.push("no-leverage-shift");
  if (hasAgreement && !hasOpposition) sources.push("agreement-too-quickly");
  else if (!hasOpposition) sources.push("no-conflicting-objective");
  if (!hasStakes) sources.push("no-consequence");
  if (!hasUncertainty) sources.push("lacks-uncertainty");

  if (!job) return sources;
  const allowed = new Set(SCENE_JOB_PROFILE[job].applicableTensionSources);
  return sources.filter((s) => allowed.has(s));
}

/** A short "why the turn doesn't land" clause, from the missing ingredients. */
export function explainTurnMiss(scene: TurnScene, job?: SceneJob): string {
  const src = diagnoseTension(scene, job);
  if (!src.length) return "nothing changes between the scene's start and end";
  return src.slice(0, 2).map((s) => TENSION_SOURCE_SHORT[s]).join(" and ");
}

/**
 * Combine the detector with the authored (intended) turn AND the scene's job.
 * A scene whose job isn't built to turn (reflection, dread, transition, setup,
 * mystery) is NOT flagged for "no turn" — it's quiet by design. The only way a
 * non-turning job earns an "intent-not-landing" flag is if the writer authored
 * a strong turn for it anyway (their intent governs).
 */
export function analyzeSceneTurn(
  scene: TurnScene,
  prev?: TurnScene,
  job?: SceneJob
): SceneTurn {
  const resolvedJob = job ?? classifySceneJob(scene, prev);
  const expectsTurn = SCENE_JOB_PROFILE[resolvedJob].expectsTurn;
  const detected = detectTurn(scene, prev);
  const raw = (scene.authoredTurn ?? "").trim();
  const intendedTurn = raw || null;
  const hasStrongIntent =
    !!intendedTurn && intendedTurn.length >= 12 && !STRONG_INTENT_NEGATIVES.test(intendedTurn);

  let alignment: TurnAlignment = "none";
  let note: string | undefined;
  if (hasStrongIntent && detected.level === "none") {
    alignment = "intent-not-landing";
    note = `Intended turn may not be landing — ${explainTurnMiss(scene, resolvedJob)}.`;
  } else if (hasStrongIntent && detected.level !== "none") {
    alignment = "aligned";
  } else if (!hasStrongIntent && detected.level === "detected") {
    alignment = "unintended-turn";
    note = "Turn detected though the scene plan named none.";
  } else if (!expectsTurn && detected.level === "none") {
    // Honest framing: not a failure, just a quiet scene.
    note = `Quiet by design — a ${SCENE_JOB_LABEL[resolvedJob].toLowerCase()} scene isn't built to turn.`;
  }

  return { detected, intendedTurn, alignment, note, job: resolvedJob, expectsTurn };
}

export interface TurnSummary {
  detected: number;
  possible: number;
  none: number;
  /** Of the `none` scenes, those whose job ISN'T meant to turn (not a problem). */
  quietByDesign: number;
  /** Of the `none` scenes, those whose job DOES expect a turn (a real gap). */
  missingExpectedTurn: number;
  intentNotLanding: number;
  total: number;
}

/** Counts for the honest headline stat. Scenes must be in story order. */
export function summarizeTurns(scenes: TurnScene[]): TurnSummary {
  const ordered = [...scenes].sort((a, b) => a.order - b.order);
  let detected = 0;
  let possible = 0;
  let none = 0;
  let quietByDesign = 0;
  let missingExpectedTurn = 0;
  let intentNotLanding = 0;
  ordered.forEach((s, i) => {
    const t = analyzeSceneTurn(s, ordered[i - 1]);
    if (t.detected.level === "detected") detected++;
    else if (t.detected.level === "possible") possible++;
    else {
      none++;
      if (t.expectsTurn) missingExpectedTurn++;
      else quietByDesign++;
    }
    if (t.alignment === "intent-not-landing") intentNotLanding++;
  });
  return {
    detected,
    possible,
    none,
    quietByDesign,
    missingExpectedTurn,
    intentNotLanding,
    total: ordered.length,
  };
}
