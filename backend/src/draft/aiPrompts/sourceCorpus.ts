// Build the canonical source corpus for the brief source-confidence
// classifier. The corpus is the union of:
//   • approved screenplay text (fountain) + slugline
//   • Character Bibles (DNA + Visual Bible canon, wardrobe, movement)
//   • Location Bibles (layout + continuity prompt + camera rules +
//                      eyeline + lighting + anchors)
//   • Prop Bibles (visualDetails + orientation + handledBy + do-not-change)
//   • approved continuity metadata
//
// Anything that appears in this corpus counts as production-canon support.
// This widens the haystack used by classifyBriefFields → fewer false-
// positive "speculative" labels on details that come from a writer-
// approved bible rather than the literal screenplay.

import { supabase } from "../../db/client.js";

interface BiblesText {
  characters: string;
  locations: string;
  props: string;
  continuity: string;
}

export async function buildProjectBiblesCorpus(
  projectId: string
): Promise<BiblesText> {
  const [{ data: chars }, { data: proj }] = await Promise.all([
    supabase
      .from("characters")
      .select("name, biography, metadata")
      .eq("project_id", projectId),
    supabase.from("projects").select("metadata").eq("id", projectId).maybeSingle(),
  ]);
  const meta = (proj?.metadata as Record<string, unknown> | null) ?? {};
  const locationBibles = (meta.locationBibles as Record<string, unknown>) ?? {};
  const propBibles = (meta.propBibles as Record<string, unknown>) ?? {};

  // Characters: name + bio + DNA + visual bible text.
  const characterChunks: string[] = [];
  for (const c of chars ?? []) {
    const m = (c.metadata as Record<string, unknown> | null) ?? {};
    const dna = (m.dna as Record<string, unknown> | undefined) ?? {};
    const vb = (m.visualBible as Record<string, unknown> | undefined) ?? {};
    const visualCanon = (vb.visualCanon as Record<string, unknown> | undefined) ?? {};
    characterChunks.push(
      [
        c.name,
        c.biography ?? "",
        // DNA scalars + tag arrays (skip the structural metadata).
        ...Object.values(dna).map((v) =>
          Array.isArray(v) ? v.join(" ") : typeof v === "string" ? v : ""
        ),
        // Visual Bible scalars.
        typeof visualCanon.description === "string" ? visualCanon.description : "",
        typeof vb.wardrobe === "string" ? (vb.wardrobe as string) : "",
        typeof vb.characterConsistencyPrompt === "string"
          ? (vb.characterConsistencyPrompt as string)
          : "",
        typeof vb.negativeContinuity === "string"
          ? (vb.negativeContinuity as string)
          : "",
        Array.isArray(vb.movementCanon)
          ? (vb.movementCanon as string[]).join(" ")
          : "",
        Array.isArray(vb.doNotChangeTraits)
          ? (vb.doNotChangeTraits as string[]).join(" ")
          : "",
        typeof vb.masterCharacterImagePrompt === "string"
          ? (vb.masterCharacterImagePrompt as string)
          : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
  const characters = characterChunks.join("\n");

  // Locations.
  const locationChunks: string[] = [];
  for (const b of Object.values(locationBibles) as Array<Record<string, unknown>>) {
    const furniture = Array.isArray(b.furniture)
      ? (b.furniture as Array<Record<string, unknown>>)
          .map((f) => `${f.name ?? ""} ${f.position ?? ""} ${f.orientation ?? ""}`)
          .join(" ")
      : "";
    const props = Array.isArray(b.props)
      ? (b.props as Array<Record<string, unknown>>)
          .map((f) => `${f.name ?? ""} ${f.position ?? ""} ${f.orientation ?? ""}`)
          .join(" ")
      : "";
    const doors = Array.isArray(b.doors)
      ? (b.doors as Array<Record<string, unknown>>)
          .map((f) => `${f.name ?? ""} ${f.position ?? ""} ${f.orientation ?? ""}`)
          .join(" ")
      : "";
    const camSafe = Array.isArray(b.cameraSafeAngles)
      ? (b.cameraSafeAngles as Array<Record<string, unknown>>)
          .map((a) => `${a.label ?? ""} ${a.description ?? ""}`)
          .join(" ")
      : "";
    const camForbidden = Array.isArray(b.forbiddenAngles)
      ? (b.forbiddenAngles as Array<Record<string, unknown>>)
          .map((a) => `${a.label ?? ""} ${a.description ?? ""}`)
          .join(" ")
      : "";
    const eyelineRules = Array.isArray(b.eyelineRules)
      ? (b.eyelineRules as string[]).join(" ")
      : "";
    const lighting = Array.isArray(b.lightingSources)
      ? (b.lightingSources as Array<Record<string, unknown>>)
          .map((g) => `${g.name ?? ""} ${g.color ?? ""} ${g.direction ?? ""} ${g.intensity ?? ""}`)
          .join(" ")
      : "";
    const anchors = Array.isArray(b.continuityAnchors)
      ? (b.continuityAnchors as string[]).join(" ")
      : "";
    locationChunks.push(
      [
        b.name ?? "",
        b.layout ?? "",
        b.continuityPrompt ?? "",
        furniture,
        props,
        doors,
        camSafe,
        camForbidden,
        eyelineRules,
        lighting,
        anchors,
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
  const locations = locationChunks.join("\n");

  // Props.
  const propChunks: string[] = [];
  for (const b of Object.values(propBibles) as Array<Record<string, unknown>>) {
    propChunks.push(
      [
        b.name ?? "",
        b.homeLocation ?? "",
        b.startsAt ?? "",
        b.endsAt ?? "",
        b.orientation ?? "",
        Array.isArray(b.handledBy) ? (b.handledBy as string[]).join(" ") : "",
        b.visualDetails ?? "",
        Array.isArray(b.doNotChange) ? (b.doNotChange as string[]).join(" ") : "",
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
  const props = propChunks.join("\n");

  // Continuity metadata (currently passes through the location / prop chunks
  // above; reserve for future bibles).
  const continuity = "";

  return { characters, locations, props, continuity };
}

/**
 * Build the full source corpus the classifier sees: screenplay text +
 * bibles. Caller assembles screenplayText themselves (we don't load it
 * here because it changes per scene). The bibles are project-wide and
 * cached at the caller's discretion.
 */
export function joinSourceCorpus(
  screenplayText: string,
  bibles: BiblesText
): string {
  return [
    screenplayText,
    bibles.characters,
    bibles.locations,
    bibles.props,
    bibles.continuity,
  ]
    .filter(Boolean)
    .join("\n\n");
}
