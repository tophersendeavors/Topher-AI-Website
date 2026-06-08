// Assemble the source manifest for the Pitch Materials generator.
//
// Only approved data is pulled — the latest treatment artifact (one per
// project workflow), season arc, episode outlines, character bibles +
// relationships, and project-level fields (tone, comps if recorded). The
// generator never invents; if a field is empty we surface it on `missing`
// and the slide that depends on it carries a missing-sources warning.

import { supabase } from "../../db/client.js";
import type { SourceCheckResult, SourceField, SourceManifest } from "./types.js";

type Json = Record<string, unknown>;
const j = (v: unknown): Json => ((v ?? {}) as Json);

/** Read the latest treatment artifact for the project (workflow-scoped). */
async function readTreatment(projectId: string): Promise<Json | null> {
  // Find the project-scoped (episode_id null) workflow first.
  const { data: wfs } = await supabase
    .from("workflows")
    .select("id, episode_id")
    .eq("project_id", projectId);
  const wf = (wfs ?? []).find((w) => !w.episode_id) ?? (wfs ?? [])[0];
  if (!wf) return null;
  const { data } = await supabase
    .from("workflow_stage_artifacts")
    .select("body")
    .eq("workflow_id", wf.id)
    .eq("stage_id", "treatment")
    .order("revision", { ascending: false })
    .limit(1);
  return (data?.[0]?.body as Json) ?? null;
}

async function readSeasonArc(projectId: string): Promise<{
  arc: Json | null;
  episodes: Array<{ number: number; title?: string; logline?: string }>;
  episodeDetail: {
    totalCount: number;
    approvedCount: number;
    withLoglineCount: number;
  };
}> {
  const { data: season } = await supabase
    .from("seasons")
    .select("arc")
    .eq("project_id", projectId)
    .order("number", { ascending: true })
    .limit(1);
  const arc = (season?.[0]?.arc as Json) ?? null;
  const { data: eps } = await supabase
    .from("episodes")
    .select("number, title, logline, title_status, status")
    .eq("project_id", projectId)
    .order("number", { ascending: true });
  const rows = eps ?? [];
  const episodes = rows.map((e) => ({
    number: e.number as number,
    title: e.title_status === "approved" ? ((e.title as string) ?? undefined) : undefined,
    logline: (e.logline as string) ?? undefined,
  }));
  // An episode is "approved" for pitch purposes when both its title is
  // approved AND a logline has been written. That's the data a buyer-facing
  // episode breakdown needs.
  const episodeDetail = {
    totalCount: rows.length,
    approvedCount: rows.filter(
      (e) =>
        e.title_status === "approved" &&
        typeof e.logline === "string" &&
        (e.logline as string).trim().length > 0
    ).length,
    withLoglineCount: rows.filter(
      (e) => typeof e.logline === "string" && (e.logline as string).trim().length > 0
    ).length,
  };
  return { arc, episodes, episodeDetail };
}

/**
 * Assemble the full source manifest + presence/missing lists. The manifest
 * is the only data the generator sees — keep this honest.
 */
export async function assembleSources(projectId: string): Promise<SourceCheckResult> {
  const { data: proj } = await supabase
    .from("projects")
    .select("title, kind, logline, genre, tone, inspirations, showrunner_notes, metadata")
    .eq("id", projectId)
    .single();
  if (!proj) throw new Error("project not found");

  const treatment = await readTreatment(projectId);
  const { arc, episodes, episodeDetail } = await readSeasonArc(projectId);
  const { data: chars } = await supabase
    .from("characters")
    .select("name, role, biography, wants, needs, flaw, voice_notes")
    .eq("project_id", projectId);
  const { data: rels } = await supabase
    .from("relationships")
    .select("id, nature, tension, a_id, b_id, metadata")
    .eq("project_id", projectId);

  // Map character ids → names so we can render relationships.
  const charMap = new Map<string, string>();
  const { data: charIds } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);
  for (const c of charIds ?? []) charMap.set(c.id as string, c.name as string);
  // Relationships carry rich rendering content + an approval status under
  // metadata.fields (no schema migration). The pitch generator only sees
  // approved relationships with buyer-summary content — drafts don't leak.
  const relationshipDetailRows = (rels ?? []).map((r) => {
    const meta = j(r.metadata);
    const f = (meta.fields as Json) ?? {};
    return {
      id: r.id as string,
      a: charMap.get(r.a_id as string) ?? "?",
      b: charMap.get(r.b_id as string) ?? "?",
      nature: ((f.nature as string) || (r.nature as string)) ?? undefined,
      tension: ((f.coreTension as string) || (r.tension as string)) ?? undefined,
      buyerSummary: (f.buyerSummary as string) ?? undefined,
      approvalStatus: (f.approvalStatus as string) ?? "draft",
      importance: ((f.importance as string) ?? "secondary"),
    };
  });
  // Only APPROVED records with CORE or SECONDARY importance feed the slide.
  // Optional / background drafts never reach the deck even when approved.
  const approvedRels = relationshipDetailRows.filter(
    (r) =>
      r.approvalStatus === "approved" &&
      (r.importance === "core" || r.importance === "secondary") &&
      ((r.buyerSummary && r.buyerSummary.trim().length > 0) ||
        (r.tension && r.tension.trim().length > 0))
  );
  // The manifest only shows approved relationships to the LLM generator.
  const relationships = approvedRels.map((r) => ({
    a: r.a,
    b: r.b,
    nature: r.nature,
    tension: r.buyerSummary || r.tension,
  }));

  // Optional per-project pitch-source overrides (audience, comps, creator
  // statement, production approach) live under project.metadata.pitchSources
  // so the writer can fill what isn't covered by the existing bibles without
  // a new migration.
  const pitchMeta = (j(proj.metadata).pitchSources as Json) ?? {};

  // The treatment body keys come from the Treatment zod schema in agents.ts.
  const t = treatment ?? {};
  const manifest: SourceManifest = {
    title: (proj.title as string) || undefined,
    genre: ((proj.genre as string[] | null) ?? undefined) ||
      (typeof t.genre === "string" && t.genre ? [t.genre as string] : undefined),
    format: ((proj.kind as string) ?? (t.format as string)) || undefined,
    logline: (proj.logline as string) || (t.logline as string) || undefined,
    synopsis:
      (t.treatmentProse as string) ||
      (t.shortSynopsis as string) ||
      undefined,
    tone: (proj.tone as string[] | null) ?? undefined,
    toneStatement: (t.tone as string) || undefined,
    themes: Array.isArray(t.themes) ? (t.themes as string[]) : undefined,
    world: (t.worldStatement as string) || undefined,
    characters: (chars ?? []).map((c) => ({
      name: c.name as string,
      role: (c.role as string) ?? undefined,
      bio: (c.biography as string) ?? undefined,
      wants: (c.wants as string) ?? undefined,
      needs: (c.needs as string) ?? undefined,
      flaw: (c.flaw as string) ?? undefined,
    })),
    relationships,
    seasonArc: arc ? ((arc.throughline as string) || (arc.premise as string) || undefined) : undefined,
    episodes,
    visualLanguage: (t.visualTone as string) || undefined,
    comps:
      (pitchMeta.comps as string[]) ??
      ((proj.inspirations as string[] | null) ?? undefined),
    audience: (pitchMeta.audience as string) ?? undefined,
    creatorStatement: (pitchMeta.creatorStatement as string) ?? undefined,
    productionApproach: (pitchMeta.productionApproach as string) ?? undefined,
    showrunnerNotes: (proj.showrunner_notes as string) ?? undefined,
  };

  // Presence / missing assessment.
  const ALL: SourceField[] = [
    "title",
    "genre",
    "format",
    "logline",
    "synopsis",
    "tone",
    "themes",
    "world",
    "characters",
    "relationships",
    "season_arc",
    "episodes",
    "visual_language",
    "comps",
    "audience",
    "creator_statement",
    "production_approach",
  ];
  const isPresent = (k: SourceField): boolean => {
    switch (k) {
      case "title":
        return !!(manifest.title && manifest.title.trim());
      case "genre":
        return (manifest.genre ?? []).filter(Boolean).length > 0;
      case "format":
        return !!(manifest.format && manifest.format.trim());
      case "logline":
        return !!(manifest.logline && manifest.logline.trim());
      case "synopsis":
        return !!(manifest.synopsis && manifest.synopsis.trim().length > 40);
      case "tone":
        return (
          (manifest.tone ?? []).filter(Boolean).length > 0 ||
          !!(manifest.toneStatement && manifest.toneStatement.trim())
        );
      case "themes":
        return (manifest.themes ?? []).filter(Boolean).length > 0;
      case "world":
        return !!(manifest.world && manifest.world.trim().length > 20);
      case "characters":
        return (manifest.characters ?? []).filter((c) => c.bio || c.wants).length > 0;
      case "relationships":
        // The manifest already only contains APPROVED relationships
        // (drafts are filtered before assembly), so length > 0 here is the
        // honest "approved-and-usable" check.
        return (manifest.relationships ?? []).length > 0;
      case "season_arc":
        return !!(manifest.seasonArc && manifest.seasonArc.trim());
      case "episodes":
        return (manifest.episodes ?? []).filter((e) => e.logline).length > 0;
      case "visual_language":
        return !!(manifest.visualLanguage && manifest.visualLanguage.trim().length > 20);
      case "comps":
        return (manifest.comps ?? []).filter(Boolean).length > 0;
      case "audience":
        return !!(manifest.audience && manifest.audience.trim());
      case "creator_statement":
        return !!(manifest.creatorStatement && manifest.creatorStatement.trim());
      case "production_approach":
        return !!(manifest.productionApproach && manifest.productionApproach.trim());
    }
  };

  const present: SourceField[] = [];
  const missing: SourceField[] = [];
  for (const f of ALL) (isPresent(f) ? present : missing).push(f);

  // Per-field detail — used by the UI to explain WHY a field is missing
  // and where to fix it. Episodes get a richer state (no records vs records
  // unapproved vs records without loglines).
  const characterDetail = {
    hasRecords: (manifest.characters ?? []).length > 0,
    totalCount: (manifest.characters ?? []).length,
    usableCount: (manifest.characters ?? []).filter((c) => c.bio || c.wants).length,
  };
  const relationshipDetail = {
    hasRecords: relationshipDetailRows.length > 0,
    totalCount: relationshipDetailRows.length,
    usableCount: relationshipDetailRows.filter(
      (r) => (r.buyerSummary && r.buyerSummary.trim()) || (r.tension && r.tension.trim())
    ).length,
    approvedCount: approvedRels.length,
  };
  const details: Partial<Record<SourceField, import("./types.js").FieldDetail>> = {
    episodes: {
      hasRecords: episodeDetail.totalCount > 0,
      totalCount: episodeDetail.totalCount,
      approvedCount: episodeDetail.approvedCount,
      usableCount: episodeDetail.withLoglineCount,
      reason:
        episodeDetail.totalCount === 0
          ? "No episode records exist for this project."
          : episodeDetail.withLoglineCount === 0
          ? "Episode records exist but none have a logline / summary yet."
          : episodeDetail.approvedCount === 0
          ? "Episode summaries exist but no episode titles have been approved yet."
          : undefined,
    },
    characters: {
      hasRecords: characterDetail.hasRecords,
      totalCount: characterDetail.totalCount,
      usableCount: characterDetail.usableCount,
      reason:
        characterDetail.totalCount === 0
          ? "No characters in the bible yet."
          : characterDetail.usableCount === 0
          ? "Characters exist but none have a bio / want — the deck needs at least one fleshed-out lead."
          : undefined,
    },
    relationships: {
      hasRecords: relationshipDetail.hasRecords,
      totalCount: relationshipDetail.totalCount,
      usableCount: relationshipDetail.usableCount,
      approvedCount: relationshipDetail.approvedCount,
      reason:
        relationshipDetail.totalCount === 0
          ? "No relationship records exist yet."
          : relationshipDetail.usableCount === 0
          ? "Relationship pairings exist but need generated or approved descriptions."
          : relationshipDetail.approvedCount === 0
          ? "Relationship dynamics exist but are not approved yet."
          : undefined,
    },
  };

  return { manifest, present, missing, details };
}

/**
 * Persist writer-editable pitch source fields that don't live in the
 * existing bibles (comps / audience / creator statement / production
 * approach). Stored under project.metadata.pitchSources.
 */
export async function setPitchSources(
  projectId: string,
  patch: Partial<{
    audience: string;
    creatorStatement: string;
    productionApproach: string;
    comps: string[];
  }>
): Promise<void> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (j(proj?.metadata) ?? {}) as Json;
  const prev = (j(meta.pitchSources) ?? {}) as Json;
  meta.pitchSources = { ...prev, ...patch };
  await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
}
