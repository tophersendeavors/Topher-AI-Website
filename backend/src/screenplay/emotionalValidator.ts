import { parseFountain } from "./fountain.js";
import type {
  DirectnessReport,
  DirectnessViolation,
} from "@toburt/shared";

/**
 * Direct-explanation validator.
 *
 * Detects dialogue that *states* emotion instead of dramatizing it. The
 * patterns are deliberately specific — false positives are acceptable at
 * `warn` severity, but `critical` is reserved for "this would never play".
 *
 * Patterns are tagged and weighted. The scene is rejected if it has more
 * than N critical violations (see config.EMOTIONAL_REJECTION_THRESHOLD)
 * unless the project's `allow_stylistic_directness` flag is true.
 */

interface Rule {
  pattern: RegExp;
  /** Short, stable identifier surfaced to the UI. */
  id: string;
  severity: "info" | "warn" | "critical";
  note: string;
}

const RULES: Rule[] = [
  // Explicit "I feel X" / "I'm X" statements of named emotion
  {
    id: "i_feel_emotion",
    pattern:
      /\b(?:i|we)\s+(?:am|'m|feel|felt|was|were|am being)\s+(?:so|really|very|truly|just)?\s*(?:sad|angry|furious|scared|terrified|happy|hurt|jealous|lonely|ashamed|guilty|broken|lost|empty|abandoned|betrayed|humiliated|powerless|worthless|unloved)\b/i,
    severity: "critical",
    note: "Character names the emotion. Dramatize it through action or subtext.",
  },
  // "I love/hate/miss/need you" — flag as warn (sometimes appropriate)
  {
    id: "i_emotion_you",
    pattern: /\b(?:i)\s+(?:love|hate|miss|fear|need|loathe|adore)\s+(?:you|him|her|them|us)\b/i,
    severity: "warn",
    note: "Direct emotional declaration. Consider what they *do* instead.",
  },
  // "Ever since X, I've felt Y" — exposition emotion
  {
    id: "ever_since_exposition",
    pattern: /\bever since\s+.{2,80}?,?\s*i(?:'ve|\s+have|\s+'m|\s+am)\s+/i,
    severity: "critical",
    note: "Exposition emotion. Show the wound's effect, don't narrate it.",
  },
  // "You make me feel X"
  {
    id: "you_make_me_feel",
    pattern: /\byou make me feel\b/i,
    severity: "critical",
    note: "Direct accusation of an emotion. Show the behavior the feeling causes.",
  },
  // "I'm feeling X because Y"
  {
    id: "feeling_because",
    pattern: /\b(?:i'm|i am|i)\s+(?:feeling|feel)\b.{0,40}?\bbecause\b/i,
    severity: "critical",
    note: "Emotion + causal explanation. Trust the audience to infer.",
  },
  // "I have/had a hard time with X"
  {
    id: "i_have_trouble",
    pattern:
      /\bi\s+(?:have|had|always have)\s+(?:a hard time|trouble|difficulty)\s+with\b/i,
    severity: "warn",
    note: "Therapy-room phrasing. Translate into behavior.",
  },
  // Therapy diagnostic-mode self-reflection
  {
    id: "therapy_diagnosis",
    pattern: /\bmy (?:trauma|attachment style|anxiety|depression|trust issues)\b/i,
    severity: "warn",
    note: "Therapeutic vocabulary in dialogue is almost always on-the-nose.",
  },
  // "What I'm trying to say is..."
  {
    id: "what_im_trying_to_say",
    pattern: /\bwhat i'?m trying to say is\b/i,
    severity: "warn",
    note: "Speech that announces its own meaning. Let the meaning land in action.",
  },
  // "Don't you see that..."
  {
    id: "dont_you_see",
    pattern: /\bdon'?t you (?:see|understand|get it) that\b/i,
    severity: "warn",
    note: "Forces a subtext into the open. Trust the audience.",
  },
  // "I just want X" with named emotional X
  {
    id: "i_just_want_emotion",
    pattern:
      /\bi\s+just\s+want(?:ed)?\s+(?:you to love me|to be loved|to feel safe|to feel seen|to feel important|to be heard|to belong)\b/i,
    severity: "critical",
    note: "Naked statement of need. Dramatize through what they pursue or refuse.",
  },
];

/**
 * Validate a scene's Fountain text.
 *
 * Returns one violation per matching dialogue line (action lines are not
 * checked — narration directness is a different problem).
 */
export function validateSceneDirectness(
  fountain: string,
  opts: { rejectionThreshold?: number; allowStylistic?: boolean } = {}
): DirectnessReport {
  const violations: DirectnessViolation[] = [];

  // Walk the elements; we only care about dialogue lines and parentheticals.
  const parsed = parseFountain(fountain);
  for (const scene of parsed.scenes.length ? parsed.scenes : [{ elements: parsed.elements, startLine: 0 } as any]) {
    let lineNum = scene.startLine ?? 0;
    for (const el of scene.elements) {
      if (el.kind === "dialogue") {
        for (const rule of RULES) {
          if (rule.pattern.test(el.text)) {
            violations.push({
              line: lineNum,
              text: el.text,
              pattern: rule.id,
              severity: rule.severity,
            });
          }
        }
      }
      lineNum += 1;
    }
  }

  const threshold = opts.rejectionThreshold ?? 2;
  const criticalCount = violations.filter((v) => v.severity === "critical").length;
  const shouldReject = !opts.allowStylistic && criticalCount > threshold;

  return { violations, shouldReject };
}

/**
 * Validate a whole script. Returns per-scene reports so the UI can render
 * inline annotations.
 */
export function validateScriptDirectness(
  fountain: string,
  opts: { rejectionThreshold?: number; allowStylistic?: boolean } = {}
): Array<{ order: number; slugline: string; report: DirectnessReport }> {
  const parsed = parseFountain(fountain);
  return parsed.scenes.map((s) => ({
    order: s.order,
    slugline: s.slugline,
    report: validateSceneDirectness(s.fountain, opts),
  }));
}

/** Stable export for the rule list — used by the UI's hints panel. */
export const DIRECTNESS_RULES = RULES.map((r) => ({
  id: r.id,
  severity: r.severity,
  note: r.note,
}));
