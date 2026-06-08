// Continuity loader — reads Location + Prop bibles out of projects.metadata
// and resolves which ones apply to a given shot brief. The composer
// consumes the resolved blocks and injects them into the system prompt.

import { supabase } from "../db/client.js";
import type { LocationBible, PropBible } from "./types.js";
import { normalizeKey } from "./types.js";
import type { VisualWorldRules } from "../productionDesign/types.js";
import {
  loadResolvedCanon,
  type ResolvedCanon,
} from "../departments/canonResolver.js";

export interface ResolvedContinuity {
  location?: LocationBible;
  props: PropBible[];
  /** V4.3 — Visual World Rules (project-level aesthetic / forbidden /
   *  lighting / texture anchors). Applied to EVERY shot's prompt as the
   *  project's aesthetic frame; bibles are scene-/prop-specific. */
  visualWorldRules?: VisualWorldRules;
  /** Stage 4 — human-approved canon (text overrides + reference assets).
   *  Resolved against the bible field paths the location / props /
   *  characters touch. */
  canon?: ResolvedCanon;
}

/**
 * Resolve continuity context for a single shot.
 *
 *   slugline    — INT./EXT. line for the scene (used to look up location bible)
 *   propsInShot — prop names referenced by the brief (props[] + lockedDetails)
 *   projectId   — required for the lookup
 */
export async function resolveShotContinuity(
  projectId: string,
  slugline: string | null | undefined,
  propsInShot: string[]
): Promise<ResolvedContinuity> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  if (!proj) return { props: [] };
  const meta = (proj.metadata as Record<string, unknown> | null) ?? {};
  const locationBibles =
    (meta.locationBibles as Record<string, LocationBible> | undefined) ?? {};
  const propBibles =
    (meta.propBibles as Record<string, PropBible> | undefined) ?? {};
  const visualWorldRules =
    (meta.visualWorldRules as VisualWorldRules | undefined) ?? undefined;

  // Location lookup: exact normalize-match first, then partial word match.
  const slugKey = normalizeKey(slugline ?? "");
  let location: LocationBible | undefined = locationBibles[slugKey];
  if (!location && slugKey) {
    const slugWords = slugKey.split("_").filter(Boolean);
    for (const [k, b] of Object.entries(locationBibles)) {
      const kWords = k.split("_").filter(Boolean);
      if (kWords.every((w) => slugWords.includes(w))) {
        location = b;
        break;
      }
    }
  }

  // Prop lookup: match each prop name by normalized key OR substring.
  // V4.3 — when the scene resolved a Location Bible, prefer prop bibles
  // whose homeLocation is in this location. Otherwise "phone" tagged on
  // an EP01 bedroom shot would also pull EP02's Daniel's-phone bible.
  const locWordsFiltered = location
    ? normalizeKey(location.name).split("_").filter((w) => w.length >= 4)
    : [];
  const propBelongs = (b: PropBible): boolean => {
    if (!location) return true;
    const propHome = normalizeKey(b.homeLocation ?? "");
    if (!propHome) return true;
    const propWords = propHome.split("_").filter((w) => w.length >= 4);
    if (propWords.length === 0) return true;
    return locWordsFiltered.some((w) => propWords.includes(w));
  };

  const props: PropBible[] = [];
  const seen = new Set<string>();
  for (const raw of propsInShot) {
    if (!raw) continue;
    const norm = normalizeKey(raw);
    let pb: PropBible | undefined =
      propBibles[norm] && propBelongs(propBibles[norm])
        ? propBibles[norm]
        : undefined;
    if (!pb) {
      for (const [k, b] of Object.entries(propBibles)) {
        if (!propBelongs(b)) continue;
        if (k.includes(norm) || norm.includes(k) || b.name.toLowerCase().includes(raw.toLowerCase())) {
          pb = b;
          break;
        }
      }
    }
    if (pb && !seen.has(pb.name)) {
      seen.add(pb.name);
      props.push(pb);
    }
  }

  // Stage 4 — load human-approved canon and apply text overrides to the
  // location + prop bibles. References (image/URL) are returned via
  // `canon.references` for the engine to surface as referenceMetadata.
  const canon = await loadResolvedCanon(projectId);
  if (location && canon.textOverrides.size > 0) {
    applyOverridesToLocation(location, canon);
  }
  for (const p of props) {
    if (canon.textOverrides.size > 0) applyOverridesToProp(p, canon);
  }

  return { location, props, visualWorldRules, canon };
}

/** Walk every overridable field on the LocationBible and apply
 *  textOverride values where the canon resolver has them. Mutates in
 *  place — the resolved bible is private to this caller. */
function applyOverridesToLocation(loc: LocationBible, canon: ResolvedCanon): void {
  const key = normalizeKey(loc.name);
  const prefix = `locationBibles.${key}.`;
  // Top-level scalar fields.
  const topScalar = ["layout", "continuityPrompt"] as const;
  for (const k of topScalar) {
    const path = prefix + k;
    const override = canon.textOverrides.get(path);
    if (override) (loc as Record<string, unknown>)[k] = override.value;
  }
  // architecture.*
  const arch = (loc as unknown as { architecture?: Record<string, string> }).architecture;
  if (arch) {
    for (const k of Object.keys(arch)) {
      const o = canon.textOverrides.get(prefix + "architecture." + k);
      if (o) arch[k] = o.value;
    }
  }
  // furnitureDesign.*
  const fd = (loc as unknown as { furnitureDesign?: Record<string, string> }).furnitureDesign;
  if (fd) {
    for (const k of Object.keys(fd)) {
      const o = canon.textOverrides.get(prefix + "furnitureDesign." + k);
      if (o) fd[k] = o.value;
    }
  }
  // setDressing.* (one nested level for bedding)
  const sd = (loc as unknown as { setDressing?: Record<string, unknown> }).setDressing;
  if (sd) {
    for (const k of Object.keys(sd)) {
      if (k === "bedding" && sd.bedding && typeof sd.bedding === "object") {
        const bedding = sd.bedding as Record<string, unknown>;
        for (const bk of Object.keys(bedding)) {
          const o = canon.textOverrides.get(prefix + "setDressing.bedding." + bk);
          if (o) bedding[bk] = o.value;
        }
      } else {
        const o = canon.textOverrides.get(prefix + "setDressing." + k);
        if (o) (sd as Record<string, unknown>)[k] = o.value;
      }
    }
  }
}

function applyOverridesToProp(p: PropBible, canon: ResolvedCanon): void {
  const key = normalizeKey(p.name);
  const prefix = `propBibles.${key}.`;
  const scalar = ["visualDetails", "startsAt", "endsAt", "orientation"] as const;
  for (const k of scalar) {
    const o = canon.textOverrides.get(prefix + k);
    if (o) (p as Record<string, unknown>)[k] = o.value;
  }
}

/**
 * Build the system-prompt block the composer injects when a location +
 * prop set is resolved. Kept short on purpose — the composer's system
 * prompt is already long; this only adds the locked facts the model must
 * never invent against.
 */
/**
 * Optional per-shot view-zone scoping. When the writer authors view-zone
 * fields on a brief, the composer hands them here so the directive
 * filters the bible blocks to ONLY mention furniture / props the lens
 * sees on this shot — plus an explicit FORBIDDEN-IN-FRAME block.
 *
 * Without scoping the entire room bible gets dumped into every prompt
 * (correct as canon, but distracts the model). With scoping the prompt
 * stays focused on the visible slice for THIS shot.
 */
export interface ShotViewZone {
  cameraViewZone?: string;
  visibleSetElements?: string[];
  forbiddenSetElements?: string[];
  characterStartPosition?: string;
  characterEndPosition?: string;
  movementPath?: string;
  eyelineTarget?: string;
  propPositions?: string;
  lightingContinuity?: string;
}

// Cheap textual contains-check that handles plurals, possessives, and
// case. "Maya's phone" matches the visibleSetElements entry "phone" or
// "Maya's phone" or "phone screen".
function containsAny(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => {
    const t = n.toLowerCase().trim();
    if (!t) return false;
    // Allow either side to be a substring of the other so "phone" in the
    // visibleSetElements list also matches the bible's "Maya's phone".
    return h.includes(t) || t.includes(h);
  });
}

export function buildContinuityDirective(
  c: ResolvedContinuity,
  view?: ShotViewZone
): string {
  const parts: string[] = [];
  // V4.3 — Visual World Rules first. Project aesthetic frame applies to
  // every shot; bibles are scene/prop-specific and follow.
  if (c.visualWorldRules) {
    const v = c.visualWorldRules;
    parts.push("VISUAL WORLD RULES (project aesthetic — non-negotiable):");
    if (v.aesthetic.length > 0) {
      parts.push("  Aesthetic anchors:");
      for (const a of v.aesthetic) parts.push(`    • ${a}`);
    }
    if (v.forbidden.length > 0) {
      parts.push("  Forbidden moves:");
      for (const f of v.forbidden) parts.push(`    • ${f}`);
    }
    if (v.lighting.length > 0) {
      parts.push("  Project lighting anchors:");
      for (const l of v.lighting) parts.push(`    • ${l}`);
    }
    if (v.texture.length > 0) {
      parts.push("  Texture / palette anchors:");
      for (const t of v.texture) parts.push(`    • ${t}`);
    }
    parts.push("");
  }
  // V4.4 — view-zone scoping. When the brief declares visibleSetElements,
  // filter the bible's furniture / props / doors lists to only those that
  // match a visible element. This stops the prompt from listing closet
  // doors on a clock insert, or the entire bedroom on a phone macro.
  const scopeOn = !!(view?.visibleSetElements && view.visibleSetElements.length > 0);
  const visible = view?.visibleSetElements ?? [];
  const inFrame = (label: string): boolean =>
    !scopeOn || containsAny(label, visible);
  if (c.location) {
    const l = c.location;
    parts.push(
      scopeOn
        ? `LOCATION CONTINUITY — ${l.name} (scoped to THIS shot's view zone${
            view?.cameraViewZone ? `: ${view.cameraViewZone}` : ""
          }; bible canon, only visible elements shown below):`
        : `LOCATION CONTINUITY — ${l.name} (locked geometry; never invent variations):`,
      `  Layout: ${l.layout || "(see continuity prompt)"}`
    );
    if (l.continuityPrompt) {
      parts.push(`  Continuity prompt: ${l.continuityPrompt}`);
    }
    // Stage 2 — structured Art Department fields. Surfaced compactly so
    // every prompt knows what kind of room this is, what the walls /
    // floor / palette read like, and what bedding / décor is correct.
    // View-zone scoping still applies: when visibleSetElements is set,
    // only the architecture lines relevant to the view zone are pushed.
    const arch = (l as unknown as { architecture?: Record<string, string> }).architecture;
    if (arch && Object.keys(arch).length > 0) {
      // Stage 3 — visibility-aware injection. locationIdentity always
      // surfaces (it's the room anchor). Every other architecture detail
      // gates on the view zone so a phone-screen insert isn't burdened
      // with wall paint codes.
      const archLines: string[] = [];
      if (arch.locationIdentity)
        archLines.push(`  Location identity: ${arch.locationIdentity}`);
      const surface: string[] = [];
      const wallVisible = !scopeOn || containsAny("wall", visible) || containsAny("background", visible);
      const floorVisible = !scopeOn || containsAny("floor", visible);
      const ceilingVisible = !scopeOn || containsAny("ceiling", visible);
      const trimVisible = !scopeOn || containsAny("trim", visible) || containsAny("baseboard", visible);
      const doorVisible = !scopeOn || containsAny("door", visible);
      const closetVisible = !scopeOn || containsAny("closet", visible);
      if (wallVisible && (arch.wallColor || arch.wallMaterial)) {
        surface.push(`walls: ${[arch.wallColor, arch.wallMaterial].filter(Boolean).join(", ")}`);
      }
      if (floorVisible && (arch.floorColor || arch.floorMaterial)) {
        surface.push(`floor: ${[arch.floorColor, arch.floorMaterial].filter(Boolean).join(", ")}`);
      }
      if (ceilingVisible && arch.ceiling) surface.push(`ceiling: ${arch.ceiling}`);
      if (trimVisible && arch.trim) surface.push(`trim: ${arch.trim}`);
      if (surface.length > 0) archLines.push(`  Surfaces: ${surface.join("; ")}`);
      if (doorVisible && arch.doorStyle) archLines.push(`  Door style: ${arch.doorStyle}`);
      if (closetVisible && arch.closetDoorStyle)
        archLines.push(`  Closet door style: ${arch.closetDoorStyle}`);
      if (archLines.length > 0) {
        parts.push("  Architecture:");
        for (const line of archLines) parts.push(line);
      }
    }
    // Furniture design — scoped to the pieces visible in the view zone.
    const furnDes = (l as unknown as { furnitureDesign?: Record<string, string> }).furnitureDesign;
    if (furnDes && Object.keys(furnDes).length > 0) {
      const fdLines: string[] = [];
      if (furnDes.bedDesign && (!scopeOn || containsAny("bed", visible)))
        fdLines.push(`    • Bed: ${furnDes.bedDesign}`);
      if (furnDes.headboardDesign && (!scopeOn || containsAny("bed", visible)))
        fdLines.push(`    • Headboard: ${furnDes.headboardDesign}`);
      if (furnDes.nightstandDesign && (!scopeOn || containsAny("nightstand", visible)))
        fdLines.push(`    • Nightstand: ${furnDes.nightstandDesign}`);
      if (furnDes.closetDesign && (!scopeOn || containsAny("closet", visible)))
        fdLines.push(`    • Closet: ${furnDes.closetDesign}`);
      if (fdLines.length > 0) {
        parts.push(scopeOn ? "  Furniture design (in this frame):" : "  Furniture design:");
        for (const line of fdLines) parts.push(line);
      }
    }
    // Set dressing — bedding is in-frame on bed shots; lamps / mirrors /
    // wall décor are only surfaced when the view zone includes walls.
    const sd = (l as unknown as { setDressing?: Record<string, unknown> }).setDressing;
    if (sd && Object.keys(sd).length > 0) {
      const sdLines: string[] = [];
      const bedding = sd.bedding as Record<string, unknown> | undefined;
      if (bedding && (!scopeOn || containsAny("bed", visible) || containsAny("bedding", visible))) {
        const bits: string[] = [];
        if (bedding.comforterColor) bits.push(`comforter ${String(bedding.comforterColor)}`);
        if (bedding.sheetColor) bits.push(`sheets ${String(bedding.sheetColor)}`);
        if (bedding.pillowCount && bedding.pillowColors)
          bits.push(`${String(bedding.pillowCount)} pillows (${String(bedding.pillowColors)})`);
        if (bedding.condition) bits.push(String(bedding.condition));
        if (bits.length > 0) sdLines.push(`    • Bedding: ${bits.join("; ")}`);
      }
      if (sd.wallDecor) sdLines.push(`    • Wall décor: ${String(sd.wallDecor)}`);
      if (sd.personalObjects)
        sdLines.push(`    • Personal objects: ${String(sd.personalObjects)}`);
      if (sd.clutterLevel) sdLines.push(`    • Clutter level: ${String(sd.clutterLevel)}`);
      if (sd.lamps && sd.lamps !== "none" && sd.lamps !== "")
        sdLines.push(`    • Lamps: ${String(sd.lamps)}`);
      if (sd.curtains && sd.curtains !== "none" && sd.curtains !== "")
        sdLines.push(`    • Curtains: ${String(sd.curtains)}`);
      if (sd.mirrors && sd.mirrors !== "none" && sd.mirrors !== "")
        sdLines.push(`    • Mirrors: ${String(sd.mirrors)}`);
      if (sd.books && sd.books !== "none" && sd.books !== "")
        sdLines.push(`    • Books: ${String(sd.books)}`);
      if (sdLines.length > 0) {
        parts.push(scopeOn ? "  Set dressing (in this frame):" : "  Set dressing:");
        for (const line of sdLines) parts.push(line);
      }
      const forbiddenDressing = Array.isArray(sd.forbiddenDressing)
        ? (sd.forbiddenDressing as string[]).filter((x) => typeof x === "string" && x.trim().length > 0)
        : [];
      if (forbiddenDressing.length > 0) {
        parts.push(
          "  FORBIDDEN DRESSING — do NOT introduce any of these (the room must never become these):"
        );
        // Cap the list at 12 to keep the directive lean.
        for (const f of forbiddenDressing.slice(0, 12)) parts.push(`    • ${f}`);
      }
    }
    const visFurn = l.furniture.filter((f) => inFrame(f.name));
    if (visFurn.length > 0) {
      parts.push(
        scopeOn ? "  Furniture in this frame (locked):" : "  Furniture (locked):",
        ...visFurn.map(
          (f) =>
            `    • ${f.name} — ${f.position}${
              f.orientation ? `; ${f.orientation}` : ""
            }`
        )
      );
    }
    const visProps = l.props.filter((p) => inFrame(p.name));
    if (visProps.length > 0) {
      parts.push(
        scopeOn ? "  Props in this frame (locked):" : "  Props on set (locked):",
        ...visProps.map(
          (p) =>
            `    • ${p.name} — ${p.position}${
              p.orientation ? `; ${p.orientation}` : ""
            }`
        )
      );
    }
    const visDoors = l.doors.filter((d) => inFrame(d.name));
    if (visDoors.length > 0) {
      parts.push(
        scopeOn ? "  Doors in this frame:" : "  Doors:",
        ...visDoors.map(
          (d) =>
            `    • ${d.name} — ${d.position}${
              d.orientation ? `; ${d.orientation}` : ""
            }`
        )
      );
    }
    if (l.cameraSafeAngles.length > 0) {
      parts.push(
        "  Camera-safe angles (use one of these for ambiguous shots):",
        ...l.cameraSafeAngles.map((a) => `    • ${a.label} — ${a.description}`)
      );
    }
    if (l.forbiddenAngles.length > 0) {
      parts.push(
        "  FORBIDDEN angles (do NOT compose):",
        ...l.forbiddenAngles.map((a) => `    • ${a.label} — ${a.description}`)
      );
    }
    if (l.eyelineRules.length > 0) {
      parts.push(
        "  Eyeline rules (mandatory):",
        ...l.eyelineRules.map((e) => `    • ${e}`)
      );
    }
    if (l.lightingSources.length > 0) {
      parts.push(
        "  Lighting (only practicals listed below — do not invent new sources):",
        ...l.lightingSources.map(
          (g) =>
            `    • ${g.name}: ${g.color}${
              g.direction ? `, ${g.direction}` : ""
            }${g.intensity ? `, ${g.intensity}` : ""}`
        )
      );
    }
    if (l.doNotFlip) {
      parts.push("  Do NOT flip / mirror the room geometry.");
    }
    parts.push("");
  }

  // V4.4 — prop continuity also scoped to view zone when set. A prop
  // bible that's relevant to the scene but not visible in this shot's
  // frame still gets dropped (so a clock-insert prompt doesn't get the
  // closet-door bible).
  const visibleProps = scopeOn
    ? c.props.filter((p) => inFrame(p.name))
    : c.props;
  if (visibleProps.length > 0) {
    parts.push(
      scopeOn
        ? "PROP CONTINUITY IN THIS FRAME (locked across shots):"
        : "PROP CONTINUITY (locked across shots):"
    );
    for (const p of visibleProps) {
      parts.push(
        `  • ${p.name}${p.homeLocation ? ` (${p.homeLocation})` : ""}` +
          (p.orientation ? ` — orientation: ${p.orientation}` : "")
      );
      if (p.visualDetails) parts.push(`      details: ${p.visualDetails}`);
      if (p.handledBy.length > 0) parts.push(`      handled by: ${p.handledBy.join(", ")}`);
      if (p.doNotChange.length > 0) {
        parts.push("      DO NOT CHANGE:");
        for (const d of p.doNotChange) parts.push(`        - ${d}`);
      }
    }
    parts.push("");
  }

  // V4.4 — per-shot view-zone block. This is the production designer's
  // direction to the camera. Tells the model exactly what's IN frame,
  // what's NOT, where the character starts/ends, the movement path, the
  // eyeline target, prop positions for THIS shot, and which practical
  // light is on. All of this is brief-authored (or auto-filled from the
  // Production Design pass).
  if (view) {
    const v = view;
    const hasAny =
      v.cameraViewZone ||
      (v.visibleSetElements?.length ?? 0) > 0 ||
      (v.forbiddenSetElements?.length ?? 0) > 0 ||
      v.characterStartPosition ||
      v.characterEndPosition ||
      v.movementPath ||
      v.eyelineTarget ||
      v.propPositions ||
      v.lightingContinuity;
    if (hasAny) {
      parts.push("SHOT VIEW ZONE (this shot only — composition direction):");
      if (v.cameraViewZone) parts.push(`  • Camera view zone: ${v.cameraViewZone}`);
      if ((v.visibleSetElements?.length ?? 0) > 0) {
        parts.push(`  • VISIBLE in frame: ${(v.visibleSetElements ?? []).join("; ")}`);
      }
      if ((v.forbiddenSetElements?.length ?? 0) > 0) {
        parts.push(
          `  • FORBIDDEN in this frame (must NOT appear): ${(v.forbiddenSetElements ?? []).join("; ")}`
        );
      }
      if (v.characterStartPosition) parts.push(`  • Character start: ${v.characterStartPosition}`);
      if (v.characterEndPosition) parts.push(`  • Character end: ${v.characterEndPosition}`);
      if (v.movementPath) parts.push(`  • Movement path: ${v.movementPath}`);
      if (v.eyelineTarget) parts.push(`  • Eyeline target: ${v.eyelineTarget}`);
      if (v.propPositions) parts.push(`  • Prop positions (this shot): ${v.propPositions}`);
      if (v.lightingContinuity)
        parts.push(`  • Lighting continuity (this shot): ${v.lightingContinuity}`);
      parts.push("");
    }
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
//  V4.7 — Visible Canon Block.
//
//  For EVERY visible element on the brief, look up the approved canon
//  details and emit a compact bullet line. Plus return a requirements
//  map (label → distinctive tokens) so the readiness gate can check
//  that each visible element actually surfaces in the LLM output.
//
//  This is stricter than the existing view-zone scoping in
//  buildContinuityDirective: that function filters which bibles to
//  include; THIS function asserts what MUST appear by name.
// ---------------------------------------------------------------------------

export interface VisibleCharacterEntry {
  name: string;
  presenceType?: string;
  wardrobeByEpisode?: Record<
    string,
    {
      top?: string;
      bottom?: string;
      accessories?: string;
      footwear?: string;
      forbidden?: string[];
    }
  >;
  hmuByEpisode?: Record<
    string,
    {
      hairCondition?: string;
      makeupState?: string;
      faceMarks?: string;
      forbidden?: string[];
    }
  >;
  consistencyPrompt?: string;
}

export interface VisibleCanonBuildArgs {
  visibleSetElements: string[];
  forbiddenSetElements?: string[];
  location?: LocationBible;
  props: PropBible[];
  characters: VisibleCharacterEntry[];
  episodeNumber: number | null;
}

export interface VisibleCanonResult {
  /** Multi-line block to paste into the composer's system prompt. */
  block: string;
  /** Per-visible-element distinctive tokens. Readiness gate checks that
   *  at least ONE token per entry appears in the final prompt body. */
  requirements: Array<{ label: string; tokens: string[] }>;
}

/** Distinctive tokens for the readiness check — strip stopwords / short
 *  words / numerics so we don't false-positive on "the" / "and" / "3". */
function distinctiveTokens(s: string): string[] {
  const STOP = new Set(
    "the and with from into onto over under near her his their its them this " +
      "that these those above below between against through across during after " +
      "before because while there here when then than what which where while who " +
      "does done been being have has had hadnt would could should might must " +
      "only also even just very much many some every each both either neither " +
      "none such other another within without around about across again still " +
      "always never ever they them their our your yours mine ours theirs whose " +
      "side angled toward when face beside dark light cotton color size shape"
        .split(/\s+/)
  );
  const tokens = (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 -]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w) && !/^[0-9]+$/.test(w));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Lowercased helpers for category matching. */
function matches(haystack: string, needles: string[]): boolean {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

export function buildVisibleCanonBlock(
  args: VisibleCanonBuildArgs
): VisibleCanonResult {
  const lines: string[] = [];
  const requirements: VisibleCanonResult["requirements"] = [];
  const seen = new Set<string>(); // dedupe categories already emitted

  const epKey =
    args.episodeNumber != null ? String(args.episodeNumber) : null;

  // Pre-resolve location structured blocks (may be undefined).
  const arch = (args.location as unknown as {
    architecture?: Record<string, string>;
  })?.architecture;
  const furn = (args.location as unknown as {
    furnitureDesign?: Record<string, string>;
  })?.furnitureDesign;
  const sd = (args.location as unknown as {
    setDressing?: Record<string, unknown>;
  })?.setDressing;

  // Helper to push a category once.
  const pushCategory = (label: string, descriptor: string): void => {
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(`  • ${label}: ${descriptor}`);
    requirements.push({ label, tokens: distinctiveTokens(descriptor) });
  };

  for (const raw of args.visibleSetElements ?? []) {
    if (!raw || !raw.trim()) continue;
    const v = raw.toLowerCase();

    // --- Character (Maya, etc.) ------------------------------------
    for (const c of args.characters) {
      const cname = c.name.toLowerCase();
      if (
        v.includes(cname) ||
        (cname === "maya" && /\bwoman\b/.test(v)) // tolerant fallback
      ) {
        if (c.presenceType === "voice_only" || c.presenceType === "text_only") {
          break; // intentionally invisible — skip
        }
        const w = epKey ? c.wardrobeByEpisode?.[epKey] : undefined;
        const h = epKey ? c.hmuByEpisode?.[epKey] : undefined;
        const wardrobeBits: string[] = [];
        if (w?.top) wardrobeBits.push(w.top);
        if (w?.accessories) wardrobeBits.push(w.accessories);
        if (w?.footwear && !/no footwear/i.test(w.footwear) && !/none/i.test(w.footwear))
          wardrobeBits.push(w.footwear);
        const hmuBits: string[] = [];
        if (h?.hairCondition) hmuBits.push(h.hairCondition);
        if (h?.makeupState) hmuBits.push(h.makeupState);
        if (h?.faceMarks) hmuBits.push(h.faceMarks);
        const desc = [
          ...(wardrobeBits.length ? wardrobeBits : []),
          ...(hmuBits.length ? hmuBits : []),
        ]
          .filter(Boolean)
          .join("; ");
        if (desc) pushCategory(c.name, desc);
        break;
      }
    }

    // --- Hand / thumb / partial body parts (when visibleSetElements
    //     names just a hand) — still anchor on character HMU if known.
    if (
      args.characters[0] &&
      /\b(thumb|hand|fingers|wedding band)\b/.test(v) &&
      !seen.has(args.characters[0].name.toLowerCase())
    ) {
      const c = args.characters[0];
      if (c.presenceType !== "voice_only" && c.presenceType !== "text_only") {
        const w = epKey ? c.wardrobeByEpisode?.[epKey] : undefined;
        if (w?.accessories)
          pushCategory(`${c.name} (hand/wedding band)`, w.accessories);
      }
    }

    // --- Bedding / pillows / sheets -------------------------------
    if (matches(v, ["bedding", "comforter", "sheet", "pillow", "duvet"])) {
      if (sd?.bedding) {
        const b = sd.bedding as Record<string, unknown>;
        const parts: string[] = [];
        if (b.comforterColor) parts.push(`${b.comforterColor} comforter`);
        if (b.sheetColor) parts.push(`${b.sheetColor} sheets`);
        if (b.pillowColors) parts.push(String(b.pillowColors));
        if (b.condition) parts.push(String(b.condition));
        const desc = parts.filter(Boolean).join("; ");
        if (desc) pushCategory("bedding", desc);
      }
    }

    // --- Bed / headboard ------------------------------------------
    if (matches(v, ["bed", "headboard"]) && !v.includes("bedding")) {
      const bedParts: string[] = [];
      if (furn?.bedDesign) bedParts.push(furn.bedDesign);
      if (furn?.headboardDesign && v.includes("headboard"))
        bedParts.push(furn.headboardDesign);
      else if (furn?.headboardDesign && v.includes("bed"))
        bedParts.push(furn.headboardDesign);
      const desc = bedParts.filter(Boolean).join("; ");
      if (desc) pushCategory("bed", desc);
    }

    // --- Nightstand ----------------------------------------------
    if (matches(v, ["nightstand", "bedside table", "side table"])) {
      const parts: string[] = [];
      if (furn?.nightstandDesign) parts.push(furn.nightstandDesign);
      const desc = parts.filter(Boolean).join("; ");
      if (desc) pushCategory("nightstand", desc);
    }

    // --- Closet --------------------------------------------------
    if (matches(v, ["closet"])) {
      const parts: string[] = [];
      if (arch?.closetDoorStyle) parts.push(arch.closetDoorStyle);
      if (furn?.closetDesign) parts.push(furn.closetDesign);
      const desc = parts.filter(Boolean).join("; ");
      if (desc) pushCategory("closet door", desc);
    }

    // --- Walls (only if explicitly listed as visible) -------------
    if (matches(v, ["wall", "background"])) {
      const parts: string[] = [];
      if (arch?.wallColor) parts.push(arch.wallColor);
      if (arch?.wallMaterial) parts.push(arch.wallMaterial);
      const desc = parts.filter(Boolean).join(", ");
      if (desc) pushCategory("walls", desc);
    }

    // --- Floor ----------------------------------------------------
    if (matches(v, ["floor"])) {
      const parts: string[] = [];
      if (arch?.floorColor) parts.push(arch.floorColor);
      if (arch?.floorMaterial) parts.push(arch.floorMaterial);
      const desc = parts.filter(Boolean).join(", ");
      if (desc) pushCategory("floor", desc);
    }

    // --- Props (clock, phone, blood smear, etc.) -----------------
    //
    // Filter by homeLocation when a location is provided. This stops
    // EP02's "Daniel's phone" (homeLocation = living room) from
    // leaking into an EP01 bedroom shot just because both prop names
    // contain "phone".
    const locWords = args.location
      ? normalizeKey(args.location.name)
          .split("_")
          .filter((w) => w.length >= 4)
      : [];
    const forbiddenLower = new Set(
      (args.forbiddenSetElements ?? []).map((s) => s.toLowerCase().trim())
    );
    const propBelongs = (p: PropBible): boolean => {
      // Episode filter — if the prop bible declares which episodes it
      // appears in, require the current episode to be in that list.
      // Maya's phone has episodesPresent=[1]; Daniel's phone has [2..10],
      // so on EP01 Maya's phone passes and Daniel's phone is excluded
      // even though both share handledBy="Maya".
      if (
        args.episodeNumber != null &&
        Array.isArray(p.episodesPresent) &&
        p.episodesPresent.length > 0 &&
        !p.episodesPresent.includes(args.episodeNumber)
      ) {
        return false;
      }
      // Location filter — same as resolveShotContinuity's logic.
      if (!args.location) return true;
      const home = normalizeKey(p.homeLocation ?? "");
      if (!home) return true;
      const homeWords = home.split("_").filter((w) => w.length >= 4);
      if (homeWords.length === 0) return true;
      return locWords.some((w) => homeWords.includes(w));
    };
    for (const prop of args.props) {
      if (!propBelongs(prop)) continue;
      const pn = prop.name.toLowerCase();
      const pWords = pn.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
      const propHit =
        v.includes(pn) || pWords.some((w) => v.includes(w));
      if (!propHit) continue;
      // Skip if already emitted.
      const label = prop.name;
      if (seen.has(label.toLowerCase())) continue;
      const bits: string[] = [];
      if (prop.visualDetails) bits.push(prop.visualDetails);
      if (prop.orientation) bits.push(prop.orientation);
      if (prop.doNotChange?.length)
        bits.push(`MUST: ${prop.doNotChange.slice(0, 3).join("; ")}`);
      const desc = bits.filter(Boolean).join(" — ");
      if (desc) pushCategory(label, desc);
    }
  }

  // FORBIDDEN-in-frame echo (separate from the directive's main forbidden
  // block — this version restates it next to the visible canon so the LLM
  // sees them paired).
  const forbidden = (args.forbiddenSetElements ?? []).filter(
    (s) => typeof s === "string" && s.trim().length > 0
  );

  if (lines.length === 0 && forbidden.length === 0) {
    return { block: "", requirements };
  }

  const out: string[] = [];
  if (lines.length > 0) {
    out.push(
      "VISIBLE CANON FOR THIS SHOT (every visible element MUST surface its canon detail — do NOT invent):"
    );
    for (const l of lines) out.push(l);
  }
  if (forbidden.length > 0) {
    out.push("FORBIDDEN IN THIS FRAME (must NOT appear in any form):");
    for (const f of forbidden.slice(0, 12)) out.push(`  • ${f}`);
  }
  out.push("");

  return { block: out.join("\n"), requirements };
}
