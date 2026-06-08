// Shared template helpers — used by every template + by the validator
// runtime that compiles template patterns into RegExp.

/** A regex pattern as a JSON-safe string + optional flags. Stored as
 *  source so templates can be edited / persisted / compared structurally.
 *  Validators compile these on use with `compileRegex(source)`. */
export interface RegexSource {
  source: string;
  flags?: string;   // default "i"
}

export type ProtectionTone = "warning" | "blocking" | "passed";

/** Compile a `RegexSource` into a `RegExp`. */
export function compileRegex(r: RegexSource): RegExp {
  return new RegExp(r.source, r.flags ?? "i");
}

/** Apply a list of regex sources against a single haystack string.
 *  Returns true if ANY pattern matches. Used by audits when the
 *  template's protectedReveals / forbiddenFramings / forbiddenMoves
 *  fire. */
export function anyMatch(haystack: string, patterns: RegexSource[]): boolean {
  for (const p of patterns) {
    if (compileRegex(p).test(haystack)) return true;
  }
  return false;
}

/** Convenience shorthand for `{ source }` (with default `i` flag). */
export function re(source: string, flags = "i"): RegexSource {
  return { source, flags };
}
