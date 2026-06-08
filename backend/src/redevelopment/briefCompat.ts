// Backward-compat helpers for `RedevBrief` field-name evolution.
//
// The brief originally had a `solanoRule` field that was named after a
// SELVAJE character. Post-refactor, the canonical field is
// `characterAnchorRule`. Existing SELVAJE passes in the database still
// have `solanoRule`. Every read goes through `getCharacterAnchorRule()`;
// every write should populate BOTH fields until we're confident nothing
// reads the old name.

import type { RedevBrief } from "./types.js";

export function getCharacterAnchorRule(
  brief: Pick<RedevBrief, "characterAnchorRule" | "solanoRule"> | null | undefined
): string {
  if (!brief) return "";
  return (brief.characterAnchorRule ?? brief.solanoRule ?? "").trim();
}

/** Normalize on write — when saving a brief, populate both fields so
 *  legacy readers don't break and new readers don't need the fallback. */
export function applyCharacterAnchorRule<T extends Partial<RedevBrief>>(
  brief: T,
  rule: string
): T {
  return {
    ...brief,
    characterAnchorRule: rule,
    solanoRule: rule,
  };
}
