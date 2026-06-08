// Post-generation validator for the Micro Drama Screenplay Agent.
//
// Five lightweight heuristic checks. NOT a quality scorer — the binge
// scorer already grades the chain. These checks only verify that the
// agent honored the chain contract:
//
//   1. Hook present in the opening 25% of the screenplay
//   2. Setup dramatized somewhere in the body
//   3. Twist present somewhere in the body
//   4. Screenplay ends on the cliffhanger (last 25%)
//   5. WITHHELD information not exposed anywhere in the screenplay
//
// Returns a structured report. The route surfaces this to the writer so
// they can spot a chain breach BEFORE the screenplay enters their library.

import type { MicroDramaEpisodePlan } from "@toburt/shared";

export interface ScreenplayValidation {
  /** Overall — true only if every required check passes. */
  passes: boolean;
  checks: {
    hookPresent: ValidationCheck;
    setupDramatized: ValidationCheck;
    twistPresent: ValidationCheck;
    endsOnCliffhanger: ValidationCheck;
    withheldNotExposed: ValidationCheck;
  };
  /** Writer-facing summary lines, ordered most-important first. */
  notes: string[];
}

export interface ValidationCheck {
  passes: boolean;
  message: string;
}

const STOP = new Set([
  "the","a","an","of","to","in","on","at","by","for","with","and","or","but",
  "if","is","was","are","were","be","been","being","have","has","had","do",
  "does","did","will","would","could","should","must","may","might","can",
  "she","he","they","it","this","that","these","those","his","her","their",
  "its","him","them","what","when","where","who","why","how","as","from",
  "up","down","out","over","into","onto","under","after","before","while",
  "during","between","about","above","below","than","then","so","no","not",
  "yes","i","we","you","me","my","your","our","us","all","any","some","more",
  "most","less","few","many","much","very","too","only","just","even","still",
  "also","now","new","old","first","last","next","every","each","both","just",
]);

/**
 * Tokenizer.
 *
 * V4.1 — possessive normalization. "Daniel's" and "Daniel" used to
 * tokenize as different strings ("daniel's" vs "daniel"), which made the
 * possessive form in the chain.setup ("Daniel's funeral") fail to
 * dedupe with the bare form in the screenplay body ("contact name:
 * DANIEL"). The validator then flagged "daniel" as withheld-leak. Fix:
 * strip a trailing `'s` / `s'` / `s` after lowercasing so possessives
 * and bare nouns collide on the same token.
 */
const tokenize = (s: string): string[] => {
  return (
    s
      .toLowerCase()
      .match(/[a-z][a-z'-]+/g)
      ?.map((t) => t.replace(/['’]s$/, "").replace(/s'$/, ""))
      .filter((t) => t.length >= 4 && !STOP.has(t)) ?? []
  );
};

const distinctTokens = (s: string): Set<string> => new Set(tokenize(s));

function overlap(needle: Set<string>, haystack: Set<string>): number {
  let n = 0;
  for (const t of needle) if (haystack.has(t)) n++;
  return n;
}

export function validateScreenplay(
  fountain: string,
  chain: Pick<
    MicroDramaEpisodePlan,
    | "hook"
    | "setup"
    | "twist"
    | "cliffhanger"
    | "withheldFromAudience"
    | "revealedToAudience"
  >
): ScreenplayValidation {
  const text = fountain.trim();
  const len = text.length;
  // Slice the screenplay into thirds-ish so we can detect WHERE a beat lands.
  const openingEnd = Math.max(80, Math.floor(len * 0.25));
  const closingStart = Math.floor(len * 0.75);
  const opening = text.slice(0, openingEnd);
  const closing = text.slice(closingStart);

  const allTokens = distinctTokens(text);
  const openingTokens = distinctTokens(opening);
  const closingTokens = distinctTokens(closing);

  const hookTokens = distinctTokens(chain.hook ?? "");
  const setupTokens = distinctTokens(chain.setup ?? "");
  const twistTokens = distinctTokens(chain.twist ?? "");
  const cliffTokens = distinctTokens(chain.cliffhanger ?? "");
  const withheldTokens = distinctTokens(chain.withheldFromAudience ?? "");

  // 1. Hook present in the opening 25%.
  const hookHits = overlap(hookTokens, openingTokens);
  const hookRequired = Math.max(2, Math.floor(hookTokens.size * 0.35));
  const hookPresent: ValidationCheck = {
    passes: hookTokens.size === 0 || hookHits >= Math.min(hookRequired, 2),
    message:
      hookTokens.size === 0
        ? "Hook is empty in chain — skipped."
        : hookHits >= Math.min(hookRequired, 2)
        ? `Hook present in opening (${hookHits} key tokens matched).`
        : `Opening does not establish the hook (only ${hookHits} key tokens matched, expected ≥ ${Math.min(hookRequired, 2)}). The screenplay should literally open on the hook image.`,
  };

  // 2. Setup dramatized somewhere in the body.
  const setupHits = overlap(setupTokens, allTokens);
  const setupRequired = Math.max(2, Math.floor(setupTokens.size * 0.3));
  const setupDramatized: ValidationCheck = {
    passes: setupTokens.size === 0 || setupHits >= Math.min(setupRequired, 2),
    message:
      setupTokens.size === 0
        ? "Setup is empty in chain — skipped."
        : setupHits >= Math.min(setupRequired, 2)
        ? `Setup dramatized (${setupHits} key tokens present).`
        : `Setup under-dramatized (${setupHits} key tokens, expected ≥ ${Math.min(setupRequired, 2)}). The writer may need to re-run.`,
  };

  // 3. Twist present.
  const twistHits = overlap(twistTokens, allTokens);
  const twistRequired = Math.max(2, Math.floor(twistTokens.size * 0.3));
  const twistPresent: ValidationCheck = {
    passes: twistTokens.size === 0 || twistHits >= Math.min(twistRequired, 2),
    message:
      twistTokens.size === 0
        ? "Twist is empty in chain — skipped."
        : twistHits >= Math.min(twistRequired, 2)
        ? `Twist present (${twistHits} key tokens matched).`
        : `Twist missing or weak (${twistHits} key tokens, expected ≥ ${Math.min(twistRequired, 2)}).`,
  };

  // 4. Screenplay ends on the cliffhanger — closing 25% must reference it.
  const cliffClosingHits = overlap(cliffTokens, closingTokens);
  const cliffRequired = Math.max(2, Math.floor(cliffTokens.size * 0.3));
  const endsOnCliffhanger: ValidationCheck = {
    passes:
      cliffTokens.size === 0 ||
      cliffClosingHits >= Math.min(cliffRequired, 2),
    message:
      cliffTokens.size === 0
        ? "Cliffhanger is empty in chain — skipped."
        : cliffClosingHits >= Math.min(cliffRequired, 2)
        ? `Screenplay closes on the cliffhanger (${cliffClosingHits} key tokens in the final 25%).`
        : `Screenplay does NOT end on the cliffhanger (${cliffClosingHits} key tokens in closing — expected ≥ ${Math.min(cliffRequired, 2)}). The agent missed the contract's last beat.`,
  };

  // 5. WITHHELD information must not appear in the screenplay.
  //
  // V4.1 — distinguish allowed hook tokens from forbidden withheld
  // revelations. A token that ALSO appears in any of:
  //   • hook
  //   • setup
  //   • twist
  //   • cliffhanger
  //   • revealedToAudience  ← NEW: explicit audience-canon facts
  // is excluded from the withheld check. This means a character name
  // that's part of the approved hook (e.g. "Daniel" as the texting
  // contact in EP01) doesn't count as withheld leakage, while genuine
  // withheld revelations (e.g. "Daniel is alive" / "Daniel emerges from
  // the closet") still do.
  const revealedTokens = distinctTokens(chain.revealedToAudience ?? "");
  const chainTokenUnion = new Set<string>();
  for (const t of hookTokens) chainTokenUnion.add(t);
  for (const t of setupTokens) chainTokenUnion.add(t);
  for (const t of twistTokens) chainTokenUnion.add(t);
  for (const t of cliffTokens) chainTokenUnion.add(t);
  for (const t of revealedTokens) chainTokenUnion.add(t);
  const withheldOnly = new Set<string>();
  for (const t of withheldTokens) {
    if (!chainTokenUnion.has(t)) withheldOnly.add(t);
  }
  const withheldLeaks: string[] = [];
  for (const t of withheldOnly) if (allTokens.has(t)) withheldLeaks.push(t);
  const withheldNotExposed: ValidationCheck = {
    passes: withheldTokens.size === 0 || withheldLeaks.length === 0,
    message:
      withheldTokens.size === 0
        ? "Nothing withheld in chain — skipped."
        : withheldLeaks.length === 0
        ? "WITHHELD information stays withheld."
        : `WITHHELD information may have leaked: [${withheldLeaks.join(", ")}]. Review before approving.`,
  };

  const checks = {
    hookPresent,
    setupDramatized,
    twistPresent,
    endsOnCliffhanger,
    withheldNotExposed,
  };
  const passes = Object.values(checks).every((c) => c.passes);
  const notes = Object.values(checks).map((c) => c.message);

  return { passes, checks, notes };
}
