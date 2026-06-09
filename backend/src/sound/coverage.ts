// Sound Bible coverage helpers.
//
// Shared logic that answers "does the persisted bible cover every scene
// in the locked source draft?". Used by the approve route as a hard
// gate, by the route GET payload so the frontend can surface an
// incomplete-coverage banner, and by the standalone verifier.
//
// No DB writes. Pure functions over data the caller already loaded.

import type { SoundBible } from "./types.js";

export interface SoundBibleCoverage {
  /** Every ord in the locked source draft. */
  expectedOrds: number[];
  /** Every ord present in the SoundBible. */
  presentOrds: number[];
  /** Locked ords with no bible row. */
  missingOrds: number[];
  /** Bible rows whose ord is not in the locked source. */
  extraOrds: number[];
  /** Approved scene rows (only rows the composer will inject). */
  approvedSceneCount: number;
  /** True iff missingOrds.length === 0 && extraOrds.length === 0. */
  isFullyCovered: boolean;
}

export function computeSoundBibleCoverage(
  bible: SoundBible,
  expectedSceneOrds: readonly number[]
): SoundBibleCoverage {
  const expected = new Set(expectedSceneOrds.map((o) => Number(o)));
  const present = new Set(Object.keys(bible.scenes).map((k) => Number(k)));
  const missing: number[] = [];
  for (const o of expected) {
    if (!present.has(o)) missing.push(o);
  }
  const extra: number[] = [];
  for (const o of present) {
    if (!expected.has(o)) extra.push(o);
  }
  missing.sort((a, b) => a - b);
  extra.sort((a, b) => a - b);
  const approvedSceneCount = Object.values(bible.scenes).filter(
    (s) => s.approvedAt != null
  ).length;
  return {
    expectedOrds: [...expected].sort((a, b) => a - b),
    presentOrds: [...present].sort((a, b) => a - b),
    missingOrds: missing,
    extraOrds: extra,
    approvedSceneCount,
    isFullyCovered: missing.length === 0 && extra.length === 0,
  };
}

/** Human-readable one-line summary suitable for an approve-gate error
 *  message or a UI banner. */
export function describeCoverageGap(c: SoundBibleCoverage): string {
  if (c.isFullyCovered) {
    return `${c.approvedSceneCount} of ${c.expectedOrds.length} scenes approved.`;
  }
  const parts: string[] = [];
  parts.push(
    `${c.presentOrds.length} of ${c.expectedOrds.length} locked scene${c.expectedOrds.length === 1 ? "" : "s"} covered`
  );
  if (c.missingOrds.length > 0) {
    parts.push(
      `Missing scene${c.missingOrds.length === 1 ? "" : "s"} ${c.missingOrds.join(", ")}`
    );
  }
  if (c.extraOrds.length > 0) {
    parts.push(
      `Extra row${c.extraOrds.length === 1 ? "" : "s"} for scene${c.extraOrds.length === 1 ? "" : "s"} ${c.extraOrds.join(", ")} (no longer in script)`
    );
  }
  return parts.join(" · ") + ".";
}
