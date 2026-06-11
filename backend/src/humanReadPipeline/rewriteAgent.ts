// Controlled rewrite agent. It receives ONLY the locked Approved Change Set
// payload — never the free-form Human Read report — plus the in-scope source
// scenes and read-only neighbor headings for continuity. It rewrites only the
// scenes named in the approved changes, honoring the protected elements, and
// flags anything it could not do without violating them.

import { callLLM, extractJSON } from "../llm/provider.js";
import type { ApprovedChangePayload } from "@toburt/shared";

export interface ControlledRewriteInput {
  /** The ONLY instruction source. Contains only approved/auto_safe changes. */
  payload: ApprovedChangePayload;
  /** Only the in-scope scenes (ord, heading, current fountain). */
  scenes: Array<{ ord: number; heading: string; fountain: string }>;
  /** All scene headings, read-only, for continuity awareness. */
  neighborHeadings: Array<{ ord: number; heading: string }>;
}

export interface RewrittenScene {
  ord: number;
  newFountain: string;
  changeSummary: string;
  /** proposalIds (titles) this scene's change satisfies. */
  satisfies: string[];
  /** True if applying the change required touching a protected element. */
  protectedTouched: boolean;
  continuityRisks: string[];
}

export interface ControlledRewriteResult {
  scenes: RewrittenScene[];
}

export async function runControlledRewriteAgent(
  input: ControlledRewriteInput
): Promise<ControlledRewriteResult> {
  const { payload, scenes, neighborHeadings } = input;
  if (scenes.length === 0) return { scenes: [] };

  const changesBlock = payload.approvedChanges
    .map(
      (c, i) =>
        `CHANGE ${i + 1} [id ${c.proposalId}] — ${c.title}\n` +
        `  apply: ${c.proposedSolution}\n` +
        `  scenes: ${c.scenesAffected.join(", ") || "—"}\n` +
        `  boundary: ${c.rewriteScope}\n` +
        (c.creatorDecisionNotes ? `  creator note (obey exactly): ${c.creatorDecisionNotes}\n` : "") +
        (c.protectedElements.length ? `  protect: ${c.protectedElements.join("; ")}` : "")
    )
    .join("\n\n");

  const sys = [
    "You are a controlled rewrite agent. You apply ONLY the approved changes",
    "below to ONLY the scenes provided. You are forbidden from making any other",
    "change. You did not receive the original review notes — only these approved",
    "changes — and you must not infer or invent additional edits.",
    "",
    "ABSOLUTE RULES:",
    payload.rule,
    "",
    "- Touch ONLY the scenes provided. Do not add or remove scenes.",
    "- Apply ONLY the approved changes that name a scene. If no approved change",
    "  names a scene, return it UNCHANGED.",
    "- Never violate a protected element. If a change cannot be applied without",
    "  violating one, leave the scene's fountain UNCHANGED, set protectedTouched",
    "  true, and explain in changeSummary.",
    "- Obey every creator note exactly (e.g. 'subtle, no exposition, one moment only').",
    "- Preserve the screenplay's voice, formatting, and everything not required",
    "  by an approved change. Make the SMALLEST edit that satisfies the change.",
    "",
    "GLOBAL PROTECTED ELEMENTS (never violate):",
    ...payload.protectedElements.map((p) => `- ${p}`),
    "",
    "Return JSON shaped EXACTLY as:",
    '{ "scenes": [',
    "  {",
    '    "ord": number,',
    '    "newFountain": string,          // the full rewritten scene in Fountain; UNCHANGED if no change applies',
    '    "changeSummary": string,        // what you changed and why, or "no change"',
    '    "satisfies": string[],          // change ids applied to this scene',
    '    "protectedTouched": boolean,',
    '    "continuityRisks": string[]     // risks this edit may introduce for later scenes',
    "  }",
    "] }",
  ].join("\n");

  const user = [
    "APPROVED CHANGES (the only edits you may make):",
    changesBlock,
    "",
    "FULL SCENE MAP (read-only, for continuity — do NOT edit scenes not listed below):",
    neighborHeadings.map((s) => `${s.ord}. ${s.heading}`).join("\n"),
    "",
    "SCENES TO REWRITE (apply only the approved changes that name them):",
    scenes.map((s) => `=== SCENE ${s.ord} — ${s.heading} ===\n${s.fountain}`).join("\n\n"),
  ].join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: 8000,
  });

  const parsed = extractJSON<{ scenes?: unknown[] }>(res.text);
  const byOrd = new Map(scenes.map((s) => [s.ord, s]));
  const out: RewrittenScene[] = [];
  for (const raw of parsed.scenes ?? []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const ord = Number(m.ord);
    const src = byOrd.get(ord);
    if (!src) continue; // never accept a scene we did not send
    const newFountain = typeof m.newFountain === "string" && m.newFountain.trim() ? m.newFountain.trim() : src.fountain.trim();
    out.push({
      ord,
      newFountain,
      changeSummary: typeof m.changeSummary === "string" ? m.changeSummary.trim() : "",
      satisfies: Array.isArray(m.satisfies) ? m.satisfies.map(String) : [],
      protectedTouched: m.protectedTouched === true,
      continuityRisks: Array.isArray(m.continuityRisks) ? m.continuityRisks.map(String).filter(Boolean) : [],
    });
  }
  return { scenes: out };
}
