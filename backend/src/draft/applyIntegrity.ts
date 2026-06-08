// Deterministic, line-anchored text edits + post-apply integrity checks.
//
// The previous subtext apply used `before.replace(substring, ...)` (first
// occurrence, substring) plus a loose fuzzy re-match at apply time. That
// produced duplicated lines, orphaned fragments, failed deletes, and partial
// replacements. This module replaces that with EXACT, single-occurrence,
// line-anchored edits and verifies the result before anything is committed.

export type IntegrityKind =
  | "duplicate-adjacent"
  | "failed-delete"
  | "original-not-removed"
  | "orphan-fragment"
  | "missing-speaker";

export interface IntegrityIssue {
  kind: IntegrityKind;
  severity: "critical" | "warn";
  detail: string;
}

export interface LineEditResult {
  ok: boolean;
  after?: string;
  /** Why the edit could not be applied deterministically. */
  reason?: "not-found" | "ambiguous";
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * Apply a single line edit by EXACT full-line match. The target line must
 * appear exactly once (by trimmed equality). Replacing/deleting by line index
 * — never substring — so we can't partially replace or leave fragments.
 *   - 0 matches  → not-found  (scene drifted; caller should re-propose)
 *   - >1 matches → ambiguous  (won't guess which one)
 * `replacement === ""` deletes the line.
 */
export function applyLineEdit(
  before: string,
  original: string,
  replacement: string
): LineEditResult {
  const lines = before.split(/\r?\n/);
  const ot = norm(original);
  if (!ot) return { ok: false, reason: "not-found" };
  const idxs = lines
    .map((l, i) => (norm(l) === ot ? i : -1))
    .filter((i) => i >= 0);
  if (idxs.length === 0) return { ok: false, reason: "not-found" };
  if (idxs.length > 1) return { ok: false, reason: "ambiguous" };

  const idx = idxs[0];
  const out = [...lines];
  if (replacement.trim() === "") {
    out.splice(idx, 1);
  } else {
    out.splice(idx, 1, ...replacement.split(/\r?\n/));
  }
  const after = out.join("\n").replace(/\n{3,}/g, "\n\n");
  return { ok: true, after };
}

const isCue = (l: string) =>
  /^[A-Z][A-Z0-9 .'’\-()]{1,30}$/.test(l.trim()) &&
  !/^(INT|EXT|EST|I\/E)\b/.test(l.trim()) &&
  !/^(CUT TO|FADE|SMASH|DISSOLVE|MATCH CUT|TO:)/.test(l.trim()) &&
  !/[a-z]/.test(l.trim());

const looksFragment = (l: string) => {
  const t = l.trim();
  if (!t || t.length > 45 || isCue(t)) return false;
  const startsLower = /^[a-z]/.test(t) || /^(and|but|or|isn't|don't|because|so|then|which|that)\b/i.test(t);
  const noTerminal = !/[.?!…"”']$/.test(t);
  return startsLower && noTerminal;
};

/**
 * Verify that an edit produced a clean result. Returns the problems found so
 * the caller can refuse to commit a corrupting change.
 */
export function checkIntegrity(
  before: string,
  after: string,
  original: string,
  replacement: string
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const aLines = after.split(/\r?\n/).map((l) => l.trim());
  const bLines = before.split(/\r?\n/).map((l) => l.trim());
  const ot = norm(original);

  // Failed delete: the line we meant to remove is still present.
  if (replacement.trim() === "" && aLines.some((l) => norm(l) === ot)) {
    issues.push({ kind: "failed-delete", severity: "critical", detail: `Line still present: "${original.slice(0, 60)}"` });
  }
  // Original survived a replace (partial / wrong-target replacement).
  if (replacement.trim() !== "" && aLines.some((l) => norm(l) === ot)) {
    issues.push({ kind: "original-not-removed", severity: "critical", detail: `Original line not removed: "${original.slice(0, 60)}"` });
  }

  // Duplicate adjacent non-empty lines introduced by the edit.
  const wasAdjDup = (lines: string[]) => {
    const set = new Set<string>();
    for (let i = 1; i < lines.length; i++) if (lines[i] && lines[i] === lines[i - 1]) set.add(lines[i]);
    return set;
  };
  const beforeDup = wasAdjDup(bLines);
  for (let i = 1; i < aLines.length; i++) {
    if (aLines[i] && aLines[i] === aLines[i - 1] && !beforeDup.has(aLines[i])) {
      issues.push({ kind: "duplicate-adjacent", severity: "critical", detail: `Duplicated line: "${aLines[i].slice(0, 60)}"` });
      break;
    }
  }

  // Replacement that duplicates an existing line ANYWHERE (the example-1
  // pattern: a line ends up appearing twice, not necessarily adjacent).
  if (replacement.trim() !== "") {
    const repl = norm(replacement);
    const occ = aLines.filter((l) => norm(l) === repl).length;
    const before = bLines.filter((l) => norm(l) === repl).length;
    if (occ > 1 && occ > before) {
      issues.push({
        kind: "duplicate-adjacent",
        severity: "critical",
        detail: `Replacement duplicates an existing line: "${replacement.slice(0, 60)}"`,
      });
    }
  }

  // New orphaned fragment lines.
  const beforeSet = new Set(bLines.filter(Boolean).map(norm));
  for (const l of aLines) {
    if (l && !beforeSet.has(norm(l)) && looksFragment(l)) {
      issues.push({ kind: "orphan-fragment", severity: "warn", detail: `Possible orphan fragment: "${l.slice(0, 60)}"` });
      break;
    }
  }

  // Missing speaker label: fewer character cues but dialogue volume held.
  const cuesBefore = bLines.filter(isCue).length;
  const cuesAfter = aLines.filter(isCue).length;
  if (replacement.trim() !== "" && cuesAfter < cuesBefore) {
    issues.push({ kind: "missing-speaker", severity: "warn", detail: "A character cue may have been dropped." });
  }

  return issues;
}

/**
 * Verify a WHOLE-SCENE rewrite (e.g. a Rewrite & Polish fix) didn't corrupt the
 * scene. Unlike checkIntegrity (one line edit), there's no single target — we
 * check structural health: no new adjacent duplicates, no new orphan fragments,
 * speaker cues preserved, and the scene didn't collapse to a fragment.
 */
export function checkSceneIntegrity(before: string, after: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const aLines = after.split(/\r?\n/).map((l) => l.trim());
  const bLines = before.split(/\r?\n/).map((l) => l.trim());

  // New adjacent duplicates.
  const beforeAdj = new Set<string>();
  for (let i = 1; i < bLines.length; i++) if (bLines[i] && bLines[i] === bLines[i - 1]) beforeAdj.add(bLines[i]);
  for (let i = 1; i < aLines.length; i++) {
    if (aLines[i] && aLines[i] === aLines[i - 1] && !beforeAdj.has(aLines[i])) {
      issues.push({ kind: "duplicate-adjacent", severity: "critical", detail: `Duplicated line: "${aLines[i].slice(0, 60)}"` });
      break;
    }
  }
  // New orphan fragments.
  const beforeSet = new Set(bLines.filter(Boolean).map(norm));
  for (const l of aLines) {
    if (l && !beforeSet.has(norm(l)) && looksFragment(l)) {
      issues.push({ kind: "orphan-fragment", severity: "warn", detail: `Possible orphan fragment: "${l.slice(0, 60)}"` });
      break;
    }
  }
  // Dropped speaker cues.
  const cuesBefore = bLines.filter(isCue).length;
  const cuesAfter = aLines.filter(isCue).length;
  if (cuesAfter < cuesBefore) {
    issues.push({ kind: "missing-speaker", severity: "warn", detail: `Lost ${cuesBefore - cuesAfter} character cue(s) — a speaker label may be missing.` });
  }
  // Scene collapsed to a fragment of its former self.
  const bNonEmpty = bLines.filter(Boolean).length;
  const aNonEmpty = aLines.filter(Boolean).length;
  if (bNonEmpty >= 6 && aNonEmpty < bNonEmpty * 0.5) {
    issues.push({ kind: "orphan-fragment", severity: "critical", detail: `Scene shrank from ${bNonEmpty} to ${aNonEmpty} lines — likely a truncated rewrite.` });
  }
  return issues;
}

/**
 * Self-consistency scan of a single scene's fountain (no before/after) — used
 * to find existing corruption in an already-damaged draft.
 */
export function scanFountain(fountain: string): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const lines = fountain.split(/\r?\n/).map((l) => l.trim());

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] && lines[i] === lines[i - 1]) {
      issues.push({ kind: "duplicate-adjacent", severity: "critical", detail: `Adjacent duplicate: "${lines[i].slice(0, 60)}"` });
    }
  }
  // Repeated substantial lines (likely partial-apply duplication). Restricted
  // to longer lines so a refrain word doesn't trip it. Orphan-fragment is NOT
  // scanned standalone — it's too noisy without a before/after to compare; it's
  // only reliable at apply time (see checkIntegrity).
  const counts: Record<string, number> = {};
  for (const l of lines) if (l.length > 24) counts[l] = (counts[l] ?? 0) + 1;
  for (const [l, n] of Object.entries(counts)) {
    if (n > 1) issues.push({ kind: "duplicate-adjacent", severity: "warn", detail: `Line appears ${n}×: "${l.slice(0, 60)}"` });
  }
  return issues;
}

/** Remove adjacent duplicate non-empty lines (safe auto-repair). Returns the
 *  cleaned text + how many duplicates were removed. */
export function dedupeAdjacentLines(fountain: string): { text: string; removed: number } {
  const lines = fountain.split(/\r?\n/);
  const out: string[] = [];
  let removed = 0;
  for (const l of lines) {
    const prev = out[out.length - 1];
    if (l.trim() && prev !== undefined && prev.trim() === l.trim()) {
      removed++;
      continue;
    }
    out.push(l);
  }
  return { text: out.join("\n"), removed };
}
