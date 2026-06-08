// Template-driven check runtime.
//
// Validators call into these helpers instead of hard-coding regex for
// SELVAJE's locked reveals. Each helper takes:
//   • the active `RedevProjectTemplate`
//   • the haystack text (a brief snippet, a draft, a strategy bag)
//   • an `idPrefix` so the same template rule can fire under different
//     stage ids (e.g. "r5_paul_reveal_protected" and
//     "r6plan_paul_reveal_protected").
//
// On `blank` templates these helpers return an empty array because the
// template declares no protections. On SELVAJE they return the same
// checks the old hard-coded validators produced.

import type { AuditCheck, AuditCheckId } from "./types.js";
import type { RedevProjectTemplate } from "./templates/types.js";
import { compileRegex, anyMatch } from "./templates/shared.js";

/** Helper that mirrors `unnegatedHit` from validators.ts but operates
 *  on compiled `RegexSource` arrays. Returns true if any pattern fires
 *  on a sentence that isn't visibly negated within a small window.
 *
 *  For SELVAJE we keep the existing simple form (no negation gymnastics);
 *  this matches the prior `unnegatedHit` behavior for the SELVAJE regex
 *  set. Generalize later if a template needs richer negation analysis. */
function templateMatchHit(
  haystack: string,
  patterns: import("./templates/shared.js").RegexSource[]
): boolean {
  if (!haystack) return false;
  return anyMatch(haystack, patterns);
}

/** Compose a fresh "passed" check — used when a template has nothing
 *  to enforce so the audit still produces a positive row instead of
 *  a missing one. */
function passed(id: AuditCheckId, label: string, message: string): AuditCheck {
  return { id, label, status: "passed", message };
}

/** Compose a "warning" check. */
function warning(id: AuditCheckId, label: string, message: string): AuditCheck {
  return { id, label, status: "warning", message };
}

/** Run protected-reveal checks against a haystack. One audit row per
 *  template-declared `protectedReveals[]` entry. */
export function runProtectedRevealChecks(args: {
  template: RedevProjectTemplate;
  haystack: string;
  idPrefix: string;
  /** Optional override message used when the check passes. */
  passLabel?: (revealLabel: string) => string;
  /** Optional override message used when the check warns. */
  warnLabel?: (revealLabel: string) => string;
}): AuditCheck[] {
  const out: AuditCheck[] = [];
  for (const reveal of args.template.protectedReveals) {
    const id = `${args.idPrefix}_${reveal.id}` as AuditCheckId;
    const leak = templateMatchHit(args.haystack, reveal.forbiddenPatterns);
    out.push(
      leak
        ? warning(
            id,
            `${reveal.label} — protection`,
            args.warnLabel?.(reveal.label) ??
              `${reveal.label}: forbidden language detected. ${reveal.promptLine}`
          )
        : passed(
            id,
            `${reveal.label} — protection`,
            args.passLabel?.(reveal.label) ?? `${reveal.label} stays protected.`
          )
    );
  }
  return out;
}

/** Run forbidden-framing checks (SELVAJE: Solano-as-fraud). */
export function runForbiddenFramingChecks(args: {
  template: RedevProjectTemplate;
  haystack: string;
  idPrefix: string;
}): AuditCheck[] {
  const out: AuditCheck[] = [];
  for (const framing of args.template.forbiddenFramings) {
    const id = `${args.idPrefix}_${framing.id}` as AuditCheckId;
    const leak = templateMatchHit(args.haystack, framing.forbiddenPatterns);
    out.push(
      leak
        ? warning(
            id,
            `${framing.label}`,
            `${framing.label}: forbidden framing detected. ${framing.promptLine}`
          )
        : passed(id, `${framing.label}`, `${framing.label} avoided.`)
    );
  }
  return out;
}

/** Run forbidden-move checks (flashbacks, confession circles, therapy). */
export function runForbiddenMoveChecks(args: {
  template: RedevProjectTemplate;
  haystack: string;
  idPrefix: string;
}): AuditCheck[] {
  const out: AuditCheck[] = [];
  for (const move of args.template.forbiddenMoves) {
    const id = `${args.idPrefix}_${move.id}` as AuditCheckId;
    const hit = templateMatchHit(args.haystack, move.forbiddenPatterns);
    out.push(
      hit
        ? warning(
            id,
            `No ${move.label}`,
            `${move.label} detected. ${move.promptLine}`
          )
        : passed(id, `No ${move.label}`, `No ${move.label.toLowerCase()} introduced.`)
    );
  }
  return out;
}

/** Run required-plants checks (SELVAJE: transparent case, archive room). */
export function runRequiredPlantChecks(args: {
  template: RedevProjectTemplate;
  haystack: string;
  tail?: string;       // optional pre-extracted tail for `location: "tail"`
  idPrefix: string;
}): AuditCheck[] {
  const out: AuditCheck[] = [];
  for (const plant of args.template.requiredPlants) {
    const id = `${args.idPrefix}_${plant.id}_present` as AuditCheckId;
    const scope =
      plant.location === "tail" && args.tail !== undefined
        ? args.tail
        : args.haystack;
    const present = templateMatchHit(scope, plant.presencePatterns);
    out.push(
      present
        ? passed(id, plant.label, `${plant.label} present.`)
        : warning(
            id,
            plant.label,
            `${plant.label} not detected${plant.location === "tail" ? " in the closing block" : ""}. Restore the plant before approval.`
          )
    );
  }
  return out;
}

/** Run the hook-anchor check (SELVAJE: ≥2 of bodies/case/chime in tail). */
export function runHookAnchorCheck(args: {
  template: RedevProjectTemplate;
  fullText: string;
  idPrefix: string;
  tailChars?: number;     // default 3500
}): AuditCheck | null {
  const hook = args.template.hookStrategy;
  if (!hook.anchors || hook.anchors.length === 0) return null;
  const tail = args.fullText.slice(
    Math.max(0, args.fullText.length - (args.tailChars ?? 3500))
  );
  const scope = (hook.scanLocation ?? "tail") === "tail" ? tail : args.fullText;
  const hits = hook.anchors.filter((a) => templateMatchHit(scope, a.patterns));
  const required = hook.requiredAnchorCount ?? Math.min(2, hook.anchors.length);
  const ok = hits.length >= required;
  return {
    id: `${args.idPrefix}_hook_present` as AuditCheckId,
    label: hook.label,
    status: ok ? "passed" : "warning",
    message: ok
      ? `Hook anchors detected: ${hits.map((h) => h.label).join(", ")}.`
      : `Hook anchors not detected (${hits.length}/${required}). ${hook.label} must survive every rewrite.`,
  };
}

/** Run meta-narration check — fires if the polished text has MORE
 *  meta-narration matches than the base. Generic across templates. */
export function runMetaNarrationDelta(args: {
  template: RedevProjectTemplate;
  base: string;
  polished: string;
  idPrefix: string;
}): AuditCheck {
  const countOne = (s: string): number => {
    let n = 0;
    for (const p of args.template.metaNarrationPatterns) {
      const gre = new RegExp(p.source, (p.flags ?? "i").includes("g") ? p.flags ?? "ig" : (p.flags ?? "i") + "g");
      const m = s.match(gre);
      if (m) n += m.length;
    }
    return n;
  };
  const baseCount = countOne(args.base);
  const polishedCount = countOne(args.polished);
  const introduced = polishedCount > baseCount;
  return {
    id: `${args.idPrefix}_no_meta_narration` as AuditCheckId,
    label: "No new meta-narration introduced",
    status: introduced ? "warning" : "passed",
    message: introduced
      ? `Polished draft added ${polishedCount - baseCount} new meta-narration line(s). Use filmable directives only.`
      : `No new meta-narration introduced (base: ${baseCount}, polished: ${polishedCount}).`,
  };
}

/** Compose template-driven prompt fragments for agent system prompts.
 *  Returns a multi-line block of "Do NOT …" lines lifted from the
 *  template's protections + framings + moves. Used in R6/R7/R8/R9
 *  agent prompts in place of hand-written SELVAJE strings. */
export function composeProtectionPromptBlock(
  template: RedevProjectTemplate
): string {
  const lines: string[] = [];
  for (const r of template.protectedReveals) lines.push(`  • ${r.promptLine}`);
  for (const f of template.forbiddenFramings) lines.push(`  • ${f.promptLine}`);
  for (const m of template.forbiddenMoves) lines.push(`  • ${m.promptLine}`);
  if (lines.length === 0) {
    return "  • (No project-specific reveal protections declared in the active template.)";
  }
  return lines.join("\n");
}

/** Render a short prompt block describing the template's required
 *  hook strategy. Empty when the template has no hook. */
export function composeHookPromptBlock(template: RedevProjectTemplate): string {
  const hook = template.hookStrategy;
  if (!hook.anchors || hook.anchors.length === 0) {
    return "  • (No hook strategy declared in the active template.)";
  }
  const anchors = hook.anchors.map((a) => `"${a.label}"`).join(", ");
  return `  • Hook strategy "${hook.label}" must survive — required anchors: ${anchors}.`;
}

// ---------------------------------------------------------------------------
// Audit-output filter
// ---------------------------------------------------------------------------
//
// Until every validator function is rewritten to take `template` as an
// arg and gate its SELVAJE-specific checks internally, we filter the
// output at the route layer. The validators keep producing the full
// SELVAJE-flavored check list; this filter strips checks whose `id`
// matches a known SELVAJE-specific token when the active template
// isn't SELVAJE.
//
// Result: SELVAJE behaves identically (filter is a no-op when
// templateId === "selvaje" or undefined). Other templates see only the
// generic, template-agnostic checks.

const SELVAJE_SPECIFIC_CHECK_PATTERNS: RegExp[] = [
  /paul/i,                  // paul_reveal_protected / r5_paul_timing / etc.
  /elena/i,                 // elena_protected / nadia_elena_timing
  /solano/i,                // solano_framing / solano_protected
  /surrender/i,             // surrender_drives_pilot / surrender_present
  /margot/i,                // margot_professional_identity / margot_planted / r9 cass-leak
  /\bcass\b/i,
  /transparent.?case/i,
  /chime/i,
  /archive.?room/i,
  /photograph.?wall/i,
  /younger.?version/i,
  /no_cass/i,
  /plant_detection/i,
];

function isSelvajeSpecificCheckId(id: string): boolean {
  return SELVAJE_SPECIFIC_CHECK_PATTERNS.some((re) => re.test(id));
}

/** Filter an `AuditReport` so non-SELVAJE templates don't see SELVAJE-
 *  specific check rows. Used at the route layer until each validator
 *  threads `template` through and gates its own blocks. SELVAJE
 *  (templateId === "selvaje" or undefined) gets the unfiltered report. */
export function filterAuditForTemplate<
  T extends { checks: Array<{ id: string }>; repairs?: unknown[] }
>(audit: T, templateId: string | null | undefined): T {
  if (!templateId || templateId === "selvaje") return audit;
  return {
    ...audit,
    checks: audit.checks.filter((c) => !isSelvajeSpecificCheckId(c.id)),
  };
}

// ---------------------------------------------------------------------------
// Per-request active-template context
// ---------------------------------------------------------------------------
//
// Validators (validators.ts) are SYNC and don't currently accept a
// `templateId` argument. To avoid touching their signatures (which would
// require updating ~12 audit functions + ~15 route call sites), each
// validator runs `applyActiveTemplateFilter()` on its return value, and
// routes set the active template id RIGHT BEFORE calling any audit.
//
// Node.js is single-threaded per event-loop turn, and audits are sync,
// so `withActiveTemplate(id, () => auditAndRepairXxx({...}))` is atomic
// and safe under concurrency.
//
// Default value `undefined` means "no template set" — applyActiveTemplateFilter
// then returns the audit unfiltered, preserving SELVAJE behavior for
// every existing caller.

let _activeTemplateId: string | null | undefined = undefined;

/** Set the active template id for any subsequent audit calls.
 *  Resets to `undefined` automatically when `withActiveTemplate` is used. */
export function setActiveAuditTemplate(id: string | null | undefined): void {
  _activeTemplateId = id;
}

/** Run `fn` with the active audit template set to `id`. Automatically
 *  resets after the call (even if `fn` throws). Recommended over the
 *  raw setter so callers can't leak state. */
export function withActiveAuditTemplate<T>(
  id: string | null | undefined,
  fn: () => T
): T {
  const prev = _activeTemplateId;
  _activeTemplateId = id;
  try {
    return fn();
  } finally {
    _activeTemplateId = prev;
  }
}

/** Apply the active template filter to an audit. Called inside each
 *  audit function's return path. No-op when no active template is set
 *  or the active template is `"selvaje"`. */
export function applyActiveTemplateFilter<
  T extends { checks: Array<{ id: string }>; repairs?: unknown[] }
>(audit: T): T {
  return filterAuditForTemplate(audit, _activeTemplateId);
}
