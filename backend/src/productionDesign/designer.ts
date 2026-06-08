// Production Design Pass runner.
//
// Pure heuristic — no LLM cost. Per scene:
//   1. Look up Location Bible by slugline (normalized + partial word match).
//   2. Pull Visual World Rules (project-level).
//   3. Scan the scene's fountain text for prop name mentions; pull the
//      matching Prop Bibles.
//   4. Compose the design output blocks (spatial / prop / lighting /
//      dressing / unified continuity prompt).
//   5. Emit warnings for missing bibles / missing rules / undeclared props.

import { supabase } from "../db/client.js";
import type { LocationBible, PropBible } from "../continuity/types.js";
import { normalizeKey } from "../continuity/types.js";
import type {
  PDWarning,
  ProductionDesignPassResult,
  ProductionDesignSceneResult,
  VisualWorldRules,
} from "./types.js";

function locationByPartialName(
  slug: string,
  bibles: Record<string, LocationBible>
): LocationBible | null {
  const key = normalizeKey(slug);
  if (bibles[key]) return bibles[key];
  const slugWords = key.split("_").filter(Boolean);
  for (const [k, b] of Object.entries(bibles)) {
    const kWords = k.split("_").filter(Boolean);
    if (kWords.length === 0) continue;
    // Partial: every word in the bible key must be in the slug, OR the slug's distinctive words all appear in the bible key.
    if (kWords.every((w) => slugWords.includes(w))) return b;
    if (slugWords.every((w) => kWords.includes(w))) return b;
  }
  return null;
}

/**
 * Match prop bibles to a scene by scanning the fountain text for prop
 * names. When a Location Bible has resolved for this scene, props are
 * pre-filtered to those whose homeLocation matches — this stops "phone"
 * in EP01's bedroom from pulling EP02's Living Room props (Daniel's
 * phone, gravel, urn, etc.).
 */
function matchPropsInScene(
  fountain: string,
  propBibles: Record<string, PropBible>,
  resolvedLocationName: string | null
): PropBible[] {
  const hayLower = fountain.toLowerCase();
  const seen = new Set<string>();
  const matches: PropBible[] = [];
  const norm = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  const locKey = norm(resolvedLocationName ?? "");
  const locWords = locKey.split("_").filter((w) => w.length >= 4);

  // Helper: does this prop belong to the scene's location?
  // "Belongs" = home matches normalized location name OR every distinctive
  // prop-home word also appears in the location's words (subset). Sharing
  // ONE word (like "MAYA") is not enough — Maya's Bedroom and Maya's
  // Living Room would both share that token. Props with NO homeLocation
  // always match (treated as cross-location).
  const propBelongs = (pb: PropBible): boolean => {
    if (!resolvedLocationName) return true;
    const propHome = norm(pb.homeLocation ?? "");
    if (!propHome) return true;
    if (propHome === locKey) return true;
    const propWords = propHome.split("_").filter((w) => w.length >= 4);
    if (propWords.length === 0) return true;
    // Subset: every distinctive prop-home word must be in the location's words.
    return propWords.every((w) => locWords.includes(w));
  };

  const STOP_WORDS = new Set([
    "the","and","but","for","with","into","onto","over","under","above","below",
    "from","that","this","these","those","when","where","what","which","while",
    "their","there","other","some","more","much","also","upon","into",
    "her","his","its","not","yes","you","may","can","will","does","done","does",
  ]);
  for (const pb of Object.values(propBibles)) {
    if (!propBelongs(pb)) continue;
    // Match by canonical prop name + handler aliases first (full phrase).
    const candidates = [pb.name, ...pb.handledBy].map((s) => s.toLowerCase());
    const stripped = candidates.map((s) =>
      s.replace(/^maya'?s\s+/i, "").replace(/^daniel'?s\s+/i, "")
    );
    const phraseCands = [...new Set([...candidates, ...stripped])].filter(
      (s) => s.trim().length >= 3
    );
    let matched = phraseCands.some((n) => hayLower.includes(n));
    // Fall back to distinctive-word matching: if any word from the prop
    // name (length ≥ 5, not a stop-word) appears in the fountain, count
    // it as a match. Catches "Nightstand digital clock" → fountain says
    // "clock"; "Blood smear" → "blood".
    if (!matched) {
      const words = new Set<string>();
      for (const c of phraseCands) {
        for (const w of c.split(/[^a-z0-9]+/)) {
          if (w.length >= 5 && !STOP_WORDS.has(w)) words.add(w);
        }
      }
      if (words.size > 0 && [...words].some((w) => hayLower.includes(w))) {
        matched = true;
      }
    }
    if (matched && !seen.has(pb.name)) {
      seen.add(pb.name);
      matches.push(pb);
    }
  }
  return matches;
}

function buildSpatialMap(loc: LocationBible | null): string {
  if (!loc) return "";
  const lines: string[] = [];
  lines.push(`LAYOUT: ${loc.layout || "(no layout text)"}`);
  if (loc.furniture.length > 0) {
    lines.push("FURNITURE (locked):");
    for (const f of loc.furniture) {
      lines.push(
        `  • ${f.name} — ${f.position}${f.orientation ? `; ${f.orientation}` : ""}${
          f.locked ? " [locked]" : ""
        }`
      );
    }
  }
  if (loc.doors.length > 0) {
    lines.push("DOORS / ENTRANCES:");
    for (const d of loc.doors) {
      lines.push(`  • ${d.name} — ${d.position}${d.orientation ? `; ${d.orientation}` : ""}`);
    }
  }
  if (loc.windows.length > 0) {
    lines.push("WINDOWS:");
    for (const w of loc.windows) lines.push(`  • ${w.name} — ${w.position}`);
  }
  if (loc.cameraSafeAngles.length > 0) {
    lines.push("CAMERA-SAFE ANGLES:");
    for (const a of loc.cameraSafeAngles) lines.push(`  • ${a.label} — ${a.description}`);
  }
  if (loc.forbiddenAngles.length > 0) {
    lines.push("FORBIDDEN ANGLES (do NOT compose):");
    for (const a of loc.forbiddenAngles) lines.push(`  • ${a.label} — ${a.description}`);
  }
  if (loc.eyelineRules.length > 0) {
    lines.push("EYELINE RULES:");
    for (const e of loc.eyelineRules) lines.push(`  • ${e}`);
  }
  if (loc.doNotFlip) lines.push("ROOM GEOMETRY: do not flip / mirror the room.");
  return lines.join("\n");
}

function buildPropMap(props: PropBible[]): string {
  if (props.length === 0) return "";
  const lines = ["PROPS (locked across shots):"];
  for (const p of props) {
    lines.push(
      `  • ${p.name}${p.homeLocation ? ` (home: ${p.homeLocation})` : ""}` +
        (p.orientation ? `\n      orientation: ${p.orientation}` : "")
    );
    if (p.startsAt) lines.push(`      starts at: ${p.startsAt}`);
    if (p.endsAt) lines.push(`      ends at:   ${p.endsAt}`);
    if (p.handledBy.length > 0) lines.push(`      handled by: ${p.handledBy.join(", ")}`);
    if (p.visualDetails) lines.push(`      visual details: ${p.visualDetails}`);
    if (p.doNotChange.length > 0) {
      lines.push("      DO NOT CHANGE:");
      for (const d of p.doNotChange) lines.push(`        - ${d}`);
    }
  }
  return lines.join("\n");
}

function buildLightingMap(
  loc: LocationBible | null,
  vwr: VisualWorldRules | null
): string {
  const lines: string[] = [];
  if (loc && loc.lightingSources.length > 0) {
    lines.push("PRACTICAL LIGHT SOURCES (only these — do not invent new ones):");
    for (const l of loc.lightingSources) {
      lines.push(
        `  • ${l.name}: ${l.color}${l.direction ? `, ${l.direction}` : ""}${
          l.intensity ? `, ${l.intensity}` : ""
        }`
      );
    }
  }
  if (vwr && vwr.lighting.length > 0) {
    lines.push("PROJECT LIGHTING ANCHORS:");
    for (const l of vwr.lighting) lines.push(`  • ${l}`);
  }
  return lines.join("\n");
}

function buildSetDressing(
  loc: LocationBible | null,
  vwr: VisualWorldRules | null
): string {
  const lines: string[] = [];
  if (vwr && vwr.texture.length > 0) {
    lines.push("VISUAL TEXTURE / PALETTE:");
    for (const t of vwr.texture) lines.push(`  • ${t}`);
  }
  if (loc && loc.props.length > 0) {
    lines.push("SET DRESSING (locked props on set):");
    for (const p of loc.props) {
      lines.push(`  • ${p.name} — ${p.position}${p.orientation ? `; ${p.orientation}` : ""}`);
    }
  }
  if (loc && loc.continuityAnchors.length > 0) {
    lines.push("CONTINUITY ANCHORS:");
    for (const a of loc.continuityAnchors) lines.push(`  • ${a}`);
  }
  return lines.join("\n");
}

function buildContinuityPrompt(
  loc: LocationBible | null,
  props: PropBible[],
  vwr: VisualWorldRules | null
): string {
  const lines: string[] = [];
  // World rules first — they're the project's aesthetic frame.
  if (vwr) {
    if (vwr.aesthetic.length > 0) {
      lines.push("VISUAL WORLD (project aesthetic — non-negotiable):");
      for (const a of vwr.aesthetic) lines.push(`  • ${a}`);
    }
    if (vwr.forbidden.length > 0) {
      lines.push("VISUAL WORLD — FORBIDDEN:");
      for (const f of vwr.forbidden) lines.push(`  • ${f}`);
    }
  }
  // Location's verbatim continuity prompt (already locked geometry).
  if (loc && loc.continuityPrompt) {
    lines.push("");
    lines.push(loc.continuityPrompt);
  }
  // Concise prop continuity block.
  if (props.length > 0) {
    lines.push("");
    lines.push("PROP CONTINUITY:");
    for (const p of props) {
      lines.push(
        `  • ${p.name}${p.orientation ? ` — ${p.orientation}` : ""}${
          p.doNotChange.length > 0 ? ` (locked: ${p.doNotChange[0]})` : ""
        }`
      );
    }
  }
  return lines.join("\n").trim();
}

function buildDesignSummary(
  loc: LocationBible | null,
  props: PropBible[],
  vwr: VisualWorldRules | null
): string {
  if (!loc && props.length === 0 && !vwr) {
    return "No production design data resolved for this scene.";
  }
  const parts: string[] = [];
  if (loc) {
    parts.push(`Location: ${loc.name}.`);
    if (loc.layout) parts.push(loc.layout);
  } else {
    parts.push("No Location Bible matched this scene's slugline.");
  }
  if (props.length > 0) {
    parts.push(
      `${props.length} prop bible${props.length === 1 ? "" : "s"} relevant: ${props.map((p) => p.name).join(", ")}.`
    );
  } else {
    parts.push("No prop bibles referenced in this scene.");
  }
  if (vwr) {
    const totalRules =
      vwr.aesthetic.length +
      vwr.forbidden.length +
      vwr.lighting.length +
      vwr.texture.length;
    parts.push(
      `Visual World Rules: ${totalRules} entries across aesthetic / forbidden / lighting / texture.`
    );
  } else {
    parts.push("No Visual World Rules set on the project — production design will lean on defaults.");
  }
  return parts.join(" ");
}

export async function runProductionDesignPass(
  scriptId: string
): Promise<ProductionDesignPassResult> {
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const projectId = script.project_id as string;

  const [{ data: proj }, { data: scenes }] = await Promise.all([
    supabase.from("projects").select("metadata").eq("id", projectId).maybeSingle(),
    supabase
      .from("script_scenes")
      .select("ord, slugline, fountain")
      .eq("script_id", scriptId)
      .order("ord"),
  ]);

  const projMeta = (proj?.metadata as Record<string, unknown> | null) ?? {};
  const locationBibles =
    (projMeta.locationBibles as Record<string, LocationBible>) ?? {};
  const propBibles = (projMeta.propBibles as Record<string, PropBible>) ?? {};
  const vwr =
    (projMeta.visualWorldRules as VisualWorldRules | undefined) ?? null;

  const sceneResults: Record<number, ProductionDesignSceneResult> = {};
  let scenesReady = 0;
  let scenesWarning = 0;
  let scenesFail = 0;

  for (const s of scenes ?? []) {
    const sceneOrd = s.ord as number;
    const slugline = (s.slugline as string) ?? "";
    const fountain = (s.fountain as string) ?? "";

    const loc = locationByPartialName(slugline, locationBibles);
    const props = matchPropsInScene(fountain, propBibles, loc?.name ?? null);

    const warnings: PDWarning[] = [];
    if (!loc) {
      warnings.push({
        severity: "fail",
        message: `No Location Bible matches slugline "${slugline}". The composer will fall back to in-fountain detail only — geometry / forbidden angles / eyeline rules will not be enforced.`,
      });
    }
    if (props.length === 0) {
      warnings.push({
        severity: "info",
        message: "No prop bibles matched in this scene's text. If the scene has hero props (phone, urn, clock, etc.), add them in Continuity → Props so their orientation/locks flow into prompts.",
      });
    }
    if (!vwr) {
      warnings.push({
        severity: "warning",
        message: "No Visual World Rules set on the project. Aesthetic anchors won't be injected into prompts.",
      });
    }
    if (loc && loc.eyelineRules.length === 0) {
      warnings.push({
        severity: "warning",
        message: `Location Bible "${loc.name}" has no eyeline rules. Add explicit rules so shot prompts inherit them.`,
      });
    }
    if (loc && loc.lightingSources.length === 0) {
      warnings.push({
        severity: "warning",
        message: `Location Bible "${loc.name}" has no lighting sources declared. Add the practicals so the LLM doesn't invent new ones.`,
      });
    }
    if (loc && !loc.doNotFlip) {
      warnings.push({
        severity: "warning",
        message: `Location Bible "${loc.name}" does NOT have doNotFlip set. Recommend enabling for micro-drama continuity.`,
      });
    }

    const hasFail = warnings.some((w) => w.severity === "fail");
    const hasWarning = warnings.some((w) => w.severity === "warning");
    if (hasFail) scenesFail += 1;
    else if (hasWarning) scenesWarning += 1;
    else scenesReady += 1;

    sceneResults[sceneOrd] = {
      sceneOrd,
      slugline,
      location: loc,
      props,
      visualWorldRules: vwr,
      designSummary: buildDesignSummary(loc, props, vwr),
      spatialMap: buildSpatialMap(loc),
      propMap: buildPropMap(props),
      lightingMap: buildLightingMap(loc, vwr),
      setDressing: buildSetDressing(loc, vwr),
      continuityPrompt: buildContinuityPrompt(loc, props, vwr),
      warnings,
    };
  }

  return {
    runAt: new Date().toISOString(),
    scriptId,
    scenes: sceneResults,
    summary: {
      scenesTotal: Object.keys(sceneResults).length,
      scenesReady,
      scenesWarning,
      scenesFail,
    },
  };
}
