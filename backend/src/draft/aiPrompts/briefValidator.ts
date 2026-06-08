// Brief Validator — write-time gate against interpretive language.
//
// Runs over every shot brief at persist time (from autoBuild.ts) and on
// every read by the composer. Any field containing screenplay analysis,
// psychology, theme, or metaphor language has the offending phrase
// stripped and a human-readable warning recorded on the brief.
//
// The rule from the writer: if the camera cannot photograph it, it does
// not belong in the brief. This module is the enforcement layer.

import type { MasterShotBrief } from "./types.js";

interface Pattern {
  pattern: RegExp;
  label: string;
}

/**
 * The forbidden-interpretive set. Each entry is a precise multi-word or
 * collocated pattern so common visual descriptors using the same root
 * words ("restrained lighting", "watchful camera") still pass.
 */
const INTERPRETIVE: Pattern[] = [
  // Effortful / clinical / composed / watchful / measured inner states.
  { pattern: /\beffortful (?:calm|stillness|control|composure|restraint)\b/gi, label: "effortful [inner state]" },
  { pattern: /\bclinical (?:stillness|elegance|restraint|composure|calm|precision)\b/gi, label: "clinical [inner state]" },
  { pattern: /\b(?:composed|measured|controlled) (?:stillness|silence|distance|restraint|presence)\b/gi, label: "[composed/measured] [inner state]" },
  { pattern: /\b(?:quiet|measured|guarded|withheld) intensity\b/gi, label: "[inner-state] intensity" },
  { pattern: /\bwatchful (?:stillness|silence|presence|patience|gaze)\b/gi, label: "watchful [inner state]" },

  // Expression / face as state.
  { pattern: /\bexpression (?:withheld|held back|guarded|sealed|veiled|empty|blank|unreadable|inscrutable)\b/gi, label: "expression [inner state]" },
  { pattern: /\b(?:withheld|guarded|veiled|sealed|impassive|inscrutable) expression\b/gi, label: "[inner state] expression" },

  // "Wears X like Y" / "Control worn like" metaphors.
  { pattern: /\bcontrol worn like(?: clothing| a [\w-]+)?\b/gi, label: "control worn like …" },
  { pattern: /\b(?:wears|worn) (?:her|his|their) [\w-]+ like\b/gi, label: "wears [X] like …" },

  // Emotion labels attached to the subject.
  { pattern: /\bemotionally (?:restrained|controlled|withdrawn|guarded|distant|absent|withheld|wounded)\b/gi, label: "emotionally [inner state]" },
  { pattern: /\binternally? (?:conflicted|contained|tense|struggling)\b/gi, label: "internally [inner state]" },

  // Psychology / therapy / diagnosis language.
  { pattern: /\btherapist'?s tell\b/gi, label: "therapist's tell" },
  { pattern: /\b(?:psychological|psychology) (?:portrait|study|diagnosis|insight|read|assessment)\b/gi, label: "psychological [X]" },
  { pattern: /\bpsychology\b/gi, label: "psychology" },
  { pattern: /\b(?:character |emotional )?diagnosis\b/gi, label: "diagnosis" },
  { pattern: /\bemotional state\b/gi, label: "emotional state" },

  // Specific emotions and inner-state words used as nouns/adjectives.
  { pattern: /\bgrief\b/gi, label: "grief" },
  { pattern: /\bgrieving\b/gi, label: "grieving" },
  { pattern: /\bguarded\b/gi, label: "guarded" },
  { pattern: /\bwatchful\b/gi, label: "watchful" },
  { pattern: /\bobservant\b/gi, label: "observant" },
  { pattern: /\bperceptive\b/gi, label: "perceptive" },
  { pattern: /\bcomposure\b/gi, label: "composure" },
  { pattern: /\brestrained emotion\b/gi, label: "restrained emotion" },

  // "Effortful calm" — explicit phrase from the writer's banned list.
  { pattern: /\beffortful calm\b/gi, label: "effortful calm" },

  // Theme / symbol / meta language.
  { pattern: /\bsymbol(?:izes|izing|ic|ically)?\b/gi, label: "symbol(ism)" },
  { pattern: /\brepresents?(?:ation)?\b/gi, label: "represents" },
  { pattern: /\bshows? that\b/gi, label: "shows that …" },
  { pattern: /\breveal(?:s|ing)? (?:that|her|his|their|the)\b/gi, label: "reveals [interpretive]" },
  { pattern: /\bsuggest(?:s|ing)?\b/gi, label: "suggests" },
  { pattern: /\b(?:metaphor|metaphorical|metaphorically)\b/gi, label: "metaphor" },

  // "Portrait" as a framing word (banned in non-portrait briefs).
  { pattern: /\bportrait\b/gi, label: "portrait" },

  // "Tell" as a noun (poker / behavioral).
  { pattern: /\b[\w-]+'s tell\b/gi, label: "[X]'s tell" },
];

/** Fields the validator inspects + writes back. */
const TEXT_FIELDS = [
  // The seven photographable fields.
  "primaryImage",
  "cameraSees",
  "action",
  "frame",
  "light",
  "texture",
  "lockedDetails",
  // Legacy fields (still validated for back-compat).
  "shotPurpose",
  "storyBeat",
  "emotionalBeat",
  "performanceDirection",
  "lighting",
  "colorPalette",
  "cameraFraming",
  "lensSuggestion",
  "cameraMovement",
  "productionDesign",
  "visualMotif",
  "continuityNotes",
  "safetyNotes",
  "dialogue",
] as const;

export interface BriefValidationResult {
  cleaned: MasterShotBrief;
  /** Human-readable warnings, one per unique pattern hit per field.
   *  Format: 'field "phrase" — label'. Surface to the writer. */
  warnings: string[];
  /** True when any field had to be sanitized. */
  sanitized: boolean;
}

/**
 * Strip interpretive phrases from a single string field. Replaces hits
 * with a single space and collapses whitespace. Does NOT preserve
 * sentence boundaries — interpretation is removed surgically.
 */
function stripField(text: string): { cleaned: string; hits: { phrase: string; label: string }[] } {
  if (!text || typeof text !== "string") return { cleaned: text, hits: [] };
  let out = text;
  const hits: { phrase: string; label: string }[] = [];
  for (const { pattern, label } of INTERPRETIVE) {
    // Reset regex state since we're using the /g flag.
    pattern.lastIndex = 0;
    const matches = out.match(pattern);
    if (!matches) continue;
    for (const m of matches) hits.push({ phrase: m, label });
    out = out.replace(pattern, " ");
  }
  // Collapse the resulting whitespace + tidy dangling punctuation.
  out = out
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([,;:])\s*\1+/g, "$1")
    .replace(/^\s*[,.;:!-]+\s*/, "")
    .trim();
  return { cleaned: out, hits };
}

/**
 * Validate every photographable text field on a brief. Returns a cleaned
 * brief with interpretive phrases removed, plus a list of warnings.
 *
 * The brief is treated as immutable input — the cleaned copy is returned.
 */
export function validateBrief(brief: MasterShotBrief): BriefValidationResult {
  const out: MasterShotBrief = { ...brief };
  const warnings: string[] = [];
  let sanitized = false;

  // Walk the flat text fields.
  for (const f of TEXT_FIELDS) {
    const v = (brief as Record<string, unknown>)[f];
    if (typeof v !== "string") continue;
    const { cleaned, hits } = stripField(v);
    if (hits.length === 0) continue;
    sanitized = true;
    (out as Record<string, unknown>)[f] = cleaned;
    // De-dupe warnings per field × label so we don't spam the writer when
    // a pattern matched twice in the same string.
    const seen = new Set<string>();
    for (const h of hits) {
      const key = `${f}:${h.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const phraseShort = h.phrase.length > 60 ? h.phrase.slice(0, 57) + "…" : h.phrase;
      warnings.push(`${f}: "${phraseShort}" — ${h.label}`);
    }
  }

  // Walk character[].description — this field is poisoned most often.
  if (Array.isArray(brief.characters)) {
    out.characters = brief.characters.map((c) => {
      const { cleaned, hits } = stripField(c.description ?? "");
      if (hits.length > 0) {
        sanitized = true;
        const seen = new Set<string>();
        for (const h of hits) {
          if (seen.has(h.label)) continue;
          seen.add(h.label);
          warnings.push(
            `characters[${c.name}].description: "${
              h.phrase.length > 60 ? h.phrase.slice(0, 57) + "…" : h.phrase
            }" — ${h.label}`
          );
        }
      }
      return { ...c, description: cleaned };
    });
  }

  // Persist the warnings on the brief so the composer + UI can surface
  // them. We cap to 12 to keep payloads sensible.
  if (warnings.length > 0) {
    (out as MasterShotBrief & { interpretiveWarnings?: string[] }).interpretiveWarnings =
      warnings.slice(0, 12);
  }

  return { cleaned: out, warnings, sanitized };
}
