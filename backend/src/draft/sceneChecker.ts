import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";
import type { CanonicalContext } from "./canonical.js";

export type SceneViolation = {
  facet:
    | "character_name"
    | "location"
    | "time_of_day"
    | "timeline_order"
    | "relationship_state"
    | "villa_number"
    | "protocol_stage"
    | "duplicate_beat";
  detail: string;
  evidence: string; // verbatim quote from the scene
};

export type SceneCheckResult = {
  pass: boolean;
  violations: SceneViolation[];
  /** New continuity facts this scene establishes (for the canonical ledger). */
  continuityOut: string[];
  /** 1-2 sentence canonical summary for future scenes to reference. */
  canonicalSummary: string;
};

/**
 * Grounded per-scene continuity check. Validates ONE scene's fountain against
 * the locked cast + canonical facts on the required facets. Every violation
 * must quote verbatim text from the scene (no confabulation). Also extracts
 * the continuity facts the scene establishes + a canonical summary.
 */
export async function checkScene(args: {
  ord: number;
  sceneFountain: string;
  ctx: CanonicalContext;
  manifest?: {
    storyPurpose?: string | null;
    timelinePosition?: number | null;
    protocolStage?: string | null;
    continuityIn?: unknown[];
  };
}): Promise<SceneCheckResult> {
  const { ord, sceneFountain, ctx, manifest } = args;

  const system = [
    "You are a grounded continuity checker for a single screenplay scene.",
    "Validate the scene against the LOCKED CAST and the CANONICAL FACTS below.",
    "Check these facets only:",
    "  - character_name: only canonical cast names (exact) or unnamed background.",
    "  - location / time_of_day: consistent with the scene's slugline and canon.",
    "  - timeline_order: events fit the established timeline; no impossibilities.",
    "  - relationship_state: relationships match the locked bible + prior scenes.",
    "  - villa_number / protocol_stage: consistent with established facts.",
    "  - duplicate_beat: this scene must not re-stage a beat already covered by a prior canonical scene.",
    "",
    "GROUNDING RULE: every violation MUST include `evidence` — an exact verbatim",
    "quote copied from THIS scene's text proving the problem. If you cannot quote",
    "the scene, do not raise the violation. Never cite the cast bible or prior",
    "scenes as evidence — evidence comes from THIS scene only.",
    "",
    "Return ONLY this JSON:",
    "{",
    '  "pass": <true if zero violations, else false>,',
    '  "violations": [ { "facet": "<one of the facets>", "detail": "<what is wrong>", "evidence": "<verbatim quote from this scene>" } ],',
    '  "continuityOut": ["<concrete fact this scene ESTABLISHES that later scenes must honor — e.g. \'Margot is in Villa 4\', \'Day 1 evening\', \'Dean and Margot have not yet met\'>"],',
    '  "canonicalSummary": "<1-2 sentence summary of what happens, for future scenes to reference>"',
    "}",
  ].join("\n");

  const user = [
    ctx.text,
    "",
    manifest?.storyPurpose ? `SCENE PURPOSE: ${manifest.storyPurpose}` : "",
    manifest?.protocolStage ? `PROTOCOL STAGE (expected): ${manifest.protocolStage}` : "",
    manifest?.timelinePosition != null
      ? `TIMELINE POSITION (expected): ${manifest.timelinePosition}`
      : "",
    Array.isArray(manifest?.continuityIn) && manifest!.continuityIn.length > 0
      ? `FACTS THIS SCENE CARRIES IN: ${JSON.stringify(manifest!.continuityIn)}`
      : "",
    "",
    `SCENE #${ord} TO VALIDATE:`,
    sceneFountain,
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: config.CONTINUITY_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    maxTokens: 3000,
  });

  let parsed: Partial<SceneCheckResult>;
  try {
    parsed = extractJSON(res.text);
  } catch {
    // If the checker fails to return JSON, fail open with a soft pass so we
    // never block drafting on a checker hiccup — but flag it.
    return {
      pass: true,
      violations: [],
      continuityOut: [],
      canonicalSummary: `Scene ${ord} (checker returned no JSON; not validated).`,
    };
  }

  const haystack = sceneFountain.toLowerCase().replace(/\s+/g, " ");
  const rawViolations = Array.isArray(parsed.violations) ? parsed.violations : [];
  const facets = new Set([
    "character_name", "location", "time_of_day", "timeline_order",
    "relationship_state", "villa_number", "protocol_stage", "duplicate_beat",
  ]);
  // Ground every violation: its evidence quote must appear in the scene.
  const violations: SceneViolation[] = rawViolations
    .map((v): SceneViolation | null => {
      const o = (v ?? {}) as Record<string, unknown>;
      const facet = String(o.facet ?? "");
      const evidence = typeof o.evidence === "string" ? o.evidence : "";
      const detail = typeof o.detail === "string" ? o.detail : "";
      if (!facets.has(facet) || !detail) return null;
      // duplicate_beat is the one facet whose evidence may reference structure
      // rather than a literal quote; allow it through even without a match.
      if (facet !== "duplicate_beat") {
        const ev = evidence.toLowerCase().replace(/\s+/g, " ").trim();
        if (ev.length < 6 || !haystack.includes(ev)) return null; // ungrounded → drop
      }
      return { facet: facet as SceneViolation["facet"], detail, evidence };
    })
    .filter((v): v is SceneViolation => v !== null);

  const continuityOut = Array.isArray(parsed.continuityOut)
    ? (parsed.continuityOut as unknown[]).filter((f): f is string => typeof f === "string")
    : [];

  return {
    pass: violations.length === 0,
    violations,
    continuityOut,
    canonicalSummary:
      typeof parsed.canonicalSummary === "string" && parsed.canonicalSummary.trim()
        ? parsed.canonicalSummary.trim()
        : `Scene ${ord}.`,
  };
}
