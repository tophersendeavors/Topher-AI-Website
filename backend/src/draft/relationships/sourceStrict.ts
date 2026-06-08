// Source-strict validator. Runs AFTER the relationship agent returns and
// removes sentences that smell like invented specifics — pseudonyms,
// off-screen conversations, fabricated episode beats, invented timeline
// markers, etc. Removed sentences are quarantined into Internal Notes
// under a clear "Possible future story idea — not canon" header so the
// writer never loses them, but they don't pollute the main fields.
//
// Two layers:
//   1. DENYLIST patterns — strong tells for invented specifics. Match → remove.
//   2. SOURCE CHECK — when a sentence names a specific entity / event, check
//      whether the source manifest text mentions it. If not, remove.

import type { RelationshipDraft } from "./generator.js";

const MAIN_FIELDS: (keyof RelationshipDraft)[] = [
  "nature",
  "aWants",
  "bWants",
  "aWithholds",
  "bWithholds",
  "coreTension",
  "powerDynamic",
  "emotionalCost",
  "dramaticFunction",
  "buyerSummary",
];

// Patterns that imply invented canon — direct phrases AND the rephrased
// structures the LLM keeps inventing. Case-insensitive.
const DENYLIST: Array<{ re: RegExp; label: string }> = [
  // Pseudonym / private notes
  { re: /\bunder a pseudonym\b/i, label: "pseudonym" },
  { re: /\b(?:already )?in (?:her|his|their|the)?\s*notes\b/i, label: "private notes reference" },
  { re: /\bsubject of (?:her|his|their) notes\b/i, label: "private notes reference" },

  // Specific things / unsourced past moments
  { re: /\bthe specific thing\b/i, label: "specific past event" },
  { re: /\bthe night before\b/i, label: "the night before" },
  { re: /\bbefore (?:they|she|he|the (?:retreat|booking|trip))\s+(?:had|booked|arrived|met)\b/i, label: "pre-event timeline" },
  { re: /\bbefore booking SELVAJE\b/i, label: "pre-booking event" },

  // First-time / never-been canon
  { re: /\bfirst\s+(?:intimacy|time|kiss|touch|escalation|honest|real)\b/i, label: "first-time canon" },
  { re: /\b(?:never|hasn't|hasn['']?t) been (?:the same|honest|seen)\b/i, label: "never-been canon" },
  { re: /\bnever (?:left|told|been able|allowed (?:herself|himself|themselves))\b/i, label: "never canon" },
  { re: /\b(?:has|have) never\s+(?:done|been|told|allowed)\b/i, label: "has-never canon" },

  // Source / journalism past life
  { re: /\b(?:a |her |his )?(?:past )?source (?:was|got|trusted (?:her|him)|destroyed|burned|killed|died|sacrificed|silenced)\b/i, label: "source past-life backstory" },
  { re: /\bsource trusted (?:her|him)\b/i, label: "source past-life backstory" },
  { re: /\bher (?:last|previous|first) source\b/i, label: "source past-life backstory" },
  { re: /\b(?:credibility|career) (?:survived|destroyed|lost|ruined)\b/i, label: "career backstory" },

  // Wound / trauma specifics
  { re: /\b(?:wound|trauma) (?:from|of|involving|caused by|tied to)\b/i, label: "specific wound" },
  { re: /\b(?:her|his) wound is (?:activated|reopened|triggered)\b/i, label: "scripted wound activation" },

  // Recorder / off-the-record discovery beats
  { re: /\b(?:recorder|wire|tape) (?:discovery|reveal|aftermath|consequence)\b/i, label: "recorder discovery beat" },
  { re: /\boff[- ]?the[- ]?record\b/i, label: "off-the-record canon" },
  { re: /\bnever off the record\b/i, label: "off-the-record canon" },
  { re: /\b(?:discovery|reveal|aftermath|exposure) (?:of|when|that)\b/i, label: "discovery / aftermath canon" },

  // Sexual / marital specifics
  { re: /\bsexually\s+(?:dissatisfied|disappointed|frustrated|attracted|drawn)\b/i, label: "sexual specifics" },
  { re: /\bsexual\s+(?:dissatisfaction|tension|attraction|frustration)\b/i, label: "sexual specifics" },
  { re: /\b(?:in|outside) (?:her|his|the) marriage (?:she|he) (?:is|has|wants)\b/i, label: "marital interior canon" },
  { re: /\bintimacy (?:with|outside|inside)\b/i, label: "intimacy canon" },

  // Episode placement / scripted future beats
  { re: /\bdiscovery in Ep(?:isode)?\b/i, label: "episode placement" },
  { re: /\b(?:in|during|by) episode \d+\b/i, label: "episode placement" },
  { re: /\bepisode placement\b/i, label: "episode placement" },
  { re: /\b(?:scripted )?turning point in (?:episode|act|the season)\b/i, label: "scripted turning point" },
  { re: /\bshould (?:not )?end the relationship\b/i, label: "scripted outcome" },
  { re: /\bscene where\b/i, label: "scripted scene reference" },
  { re: /\bwill (?:eventually )?(?:confess|reveal|discover|expose|leave|return|forgive|destroy)\b/i, label: "scripted future beat" },
];

/** Split a text into sentences naïvely; preserves punctuation. */
function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z(])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function joinSentences(sentences: string[]): string {
  return sentences.join(" ").trim();
}

/** Build a normalized haystack of all approved source text for fast contains-checks. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Detect proper-noun-like tokens — useful for "is this named entity in source?" checks. */
function properNouns(sentence: string): string[] {
  const out = new Set<string>();
  // Sequences of capitalized words (excluding sentence-initial common stopwords).
  const re = /\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]+){0,3})\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence)) != null) {
    const phrase = m[1];
    // Skip super-common starters.
    if (/^(The|And|But|This|That|If|When|Where|Why|How|Or|But|It|She|He|They|We|You|I)$/.test(phrase)) continue;
    out.add(phrase);
  }
  return [...out];
}

export interface StrictRemoval {
  /** Field the removed sentence came from. */
  field: keyof RelationshipDraft;
  /** Why it was flagged (denylist label or "unsourced entity"). */
  reason: string;
  /** The removed sentence verbatim. */
  snippet: string;
}

export interface StrictResult {
  /** Cleaned draft — same shape as input, with sentences surgically removed. */
  cleaned: RelationshipDraft;
  /** Everything that was removed. Surfaced to the UI as a diff. */
  removed: StrictRemoval[];
  /** New nonCanonNotes string to append to Internal Notes. */
  quarantine: string;
}

/**
 * Validate an agent-generated draft against approved source text. Returns a
 * surgically-cleaned draft + the list of removed sentences + a non-canon
 * notes string to append into Internal Notes.
 */
export function validateStrict(
  draft: RelationshipDraft,
  sourceText: string,
  characterNames: string[] = []
): StrictResult {
  const haystack = normalize(sourceText);
  const knownNames = new Set(characterNames.map((n) => n.toLowerCase()));
  const removed: StrictRemoval[] = [];
  const cleaned: RelationshipDraft = { ...draft };

  const isUnsupportedEntity = (sentence: string): string | null => {
    // Sentence references a proper noun the source doesn't mention.
    for (const n of properNouns(sentence)) {
      const lower = n.toLowerCase();
      // Skip character names — those are explicitly the subject and won't
      // be flagged for "unknown".
      if (knownNames.has(lower)) continue;
      // Multi-word noun phrase: split into tokens for the contains check.
      const tokens = lower.split(/\s+/).filter((t) => t.length >= 4);
      const seen = tokens.some((t) => haystack.includes(t));
      if (!seen) return n;
    }
    return null;
  };

  for (const field of MAIN_FIELDS) {
    const raw = (cleaned as Record<string, unknown>)[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const sentences = splitSentences(raw);
    const keep: string[] = [];
    for (const s of sentences) {
      // (1) Denylist pattern match
      const hit = DENYLIST.find((d) => d.re.test(s));
      if (hit) {
        removed.push({ field, reason: hit.label, snippet: s });
        continue;
      }
      // (2) Unsourced-entity check (proper noun not in source). Disabled on
      // `nature` (one-phrase relationship-type field) to avoid stripping
      // legitimate genre words.
      if (field !== "nature") {
        const unsourced = isUnsupportedEntity(s);
        if (unsourced) {
          removed.push({ field, reason: `unsourced reference: ${unsourced}`, snippet: s });
          continue;
        }
      }
      keep.push(s);
    }
    (cleaned as Record<string, unknown>)[field] = joinSentences(keep);
  }

  // Build the quarantine block for Internal Notes. We keep removed sentences
  // labeled by field so the writer can promote any of them later if they
  // become canon.
  const quarantineLines: string[] = [];
  if (removed.length > 0) {
    quarantineLines.push("Possible future story idea — not canon");
    for (const r of removed) {
      quarantineLines.push(`• [${String(r.field)}] (${r.reason}) ${r.snippet}`);
    }
  }
  const quarantine = quarantineLines.join("\n");

  return { cleaned, removed, quarantine };
}

/**
 * Merge a strict quarantine block into Internal Notes WITHOUT duplicating.
 * Prior non-canon blocks are replaced so the notes don't bloat across runs.
 */
export function mergeQuarantineIntoNotes(
  priorNotes: string | undefined,
  quarantine: string
): string {
  const prior = (priorNotes ?? "").trim();
  // Strip any existing non-canon block (header + lines until a blank line
  // or end of string).
  const cleanedPrior = prior
    .replace(
      /Possible future story idea — not canon[\s\S]*?(?=\n\n[A-Z]|\n*$)/i,
      ""
    )
    .trim();
  if (!quarantine.trim()) return cleanedPrior;
  return [cleanedPrior, quarantine].filter(Boolean).join("\n\n").trim();
}
