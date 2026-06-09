// Brief Router context loader — assembles every canonical input the
// three brief builders need for one episode. Read-only.

import { supabase } from "../db/client.js";
import { resolveProjectTypeConfig } from "@toburt/shared";
import { normalizeKey } from "../continuity/types.js";
import { getShotList } from "../shotList/store.js";
import { getSoundBible } from "../sound/store.js";
import { loadTeamState } from "../team/store.js";
import {
  allRoleDefinitions,
  coreRoleByKey,
} from "../team/registry.js";
import type { RoleAssignment, RoleDefinition, ShotListRow } from "@toburt/shared";

type Json = Record<string, unknown>;
const j = (v: unknown): Json => ((v ?? {}) as Json);

export interface ShotContext {
  shot: ShotListRow;
  rawBrief: Json;
  slugline: string;
  timeOfDay: string | null;
}

export interface CharacterCanon {
  id: string;
  name: string;
  description: string;
  consistencyPrompt: string | null;
  approvedReferenceUrl: string | null;
  referenceUrl: string | null;
  wardrobeForEpisode: string | null;
  hmuForEpisode: string | null;
}

export interface LocationCanon {
  key: string;
  name: string;
  approved: boolean;
  description: string;
  forbiddenAngles: string[];
  eyelineRules: string[];
}

export interface PropCanon {
  key: string;
  name: string;
  approved: boolean;
  description: string;
  doNotChange: string[];
}

export interface SoundCanon {
  ambientBed: string;
  keyDiegetic: string[];
  nonDiegeticMusic: string;
  audioField: string | null;
  approved: boolean;
}

export interface EpisodeBriefContext {
  projectId: string;
  projectTitle: string | null;
  projectType: string;
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scriptId: string | null;
  defaultAspectRatio: string;
  defaultDurationSec: number;
  composerKey: string;
  isMicroDramaTier: boolean;
  shots: ShotContext[];
  characters: Map<string, CharacterCanon>;
  /** Lookup by character name (lowercase). */
  charactersByName: Map<string, CharacterCanon>;
  locations: Map<string, LocationCanon>;
  props: Map<string, PropCanon>;
  /** Sound canon per scene ord (only includes approved scenes). */
  soundByOrd: Map<number, SoundCanon>;
  assignments: Record<string, RoleAssignment>;
  rolesByKey: Map<string, RoleDefinition>;
  avoidList: string[];
}

async function loadProjectRow(projectId: string): Promise<{ title: string | null; metadata: Json } | null> {
  const { data } = await supabase
    .from("projects")
    .select("title, metadata")
    .eq("id", projectId)
    .maybeSingle();
  if (!data) return null;
  return {
    title: (data.title as string | null) ?? null,
    metadata: j((data as { metadata?: unknown }).metadata),
  };
}

async function loadEpisode(episodeId: string) {
  const { data } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("id", episodeId)
    .maybeSingle();
  return data
    ? {
        id: data.id as string,
        number: (data.number as number | null) ?? null,
        title: (data.title as string | null) ?? null,
      }
    : null;
}

async function loadCurrentScriptId(
  projectId: string,
  episodeId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("scripts")
    .select("id")
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .eq("current", true)
    .maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

async function loadCharacterCanon(
  projectId: string,
  episodeId: string
): Promise<Map<string, CharacterCanon>> {
  const { data } = await supabase
    .from("characters")
    .select("id, name, description, metadata")
    .eq("project_id", projectId);
  const m = new Map<string, CharacterCanon>();
  for (const row of (data as Array<{
    id: string;
    name: string;
    description: string | null;
    metadata: Json | null;
  }>) ?? []) {
    const meta = j(row.metadata);
    const vb = j(meta.visualBible);
    const consistency =
      (typeof vb.characterConsistencyPrompt === "string" && vb.characterConsistencyPrompt.trim()) ||
      (j(vb.fields).consistencyPrompt as string | undefined)?.trim() ||
      null;
    const approvedUrl =
      (typeof vb.approvedReferenceImageUrl === "string" && vb.approvedReferenceImageUrl.trim()) ||
      null;
    const refUrl =
      (typeof vb.referenceImageUrl === "string" && vb.referenceImageUrl.trim()) ||
      (j(vb.fields).referenceImageUrl as string | undefined)?.trim() ||
      null;

    // Per-episode wardrobe + HMU when present.
    const wardrobeByEpisode = j(vb.wardrobeByEpisode);
    const hmuByEpisode = j(vb.hmuByEpisode);
    const wardrobeEntry = j(wardrobeByEpisode[episodeId]);
    const hmuEntry = j(hmuByEpisode[episodeId]);
    const wardrobePieces = [
      typeof wardrobeEntry.top === "string" ? wardrobeEntry.top : null,
      typeof wardrobeEntry.bottom === "string" ? wardrobeEntry.bottom : null,
      typeof wardrobeEntry.footwear === "string" ? wardrobeEntry.footwear : null,
      typeof wardrobeEntry.accessories === "string" ? wardrobeEntry.accessories : null,
    ].filter((s): s is string => !!s);
    const hmuPieces = [
      typeof hmuEntry.hairCondition === "string" ? hmuEntry.hairCondition : null,
      typeof hmuEntry.makeupState === "string" ? hmuEntry.makeupState : null,
      typeof hmuEntry.faceMarks === "string" ? hmuEntry.faceMarks : null,
    ].filter((s): s is string => !!s);

    m.set(row.id, {
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      consistencyPrompt: consistency || null,
      approvedReferenceUrl: approvedUrl || null,
      referenceUrl: refUrl || null,
      wardrobeForEpisode: wardrobePieces.length > 0 ? wardrobePieces.join("; ") : null,
      hmuForEpisode: hmuPieces.length > 0 ? hmuPieces.join("; ") : null,
    });
  }
  return m;
}

function buildLocationMap(meta: Json): Map<string, LocationCanon> {
  const m = new Map<string, LocationCanon>();
  const bibles = j(meta.locationBibles);
  for (const [key, raw] of Object.entries(bibles)) {
    const b = j(raw);
    m.set(key, {
      key,
      name: (b.name as string | undefined) ?? key,
      approved: b.approved === true,
      description: (b.continuityPrompt as string | undefined) ?? "",
      forbiddenAngles: Array.isArray(b.forbiddenAngles)
        ? (b.forbiddenAngles as string[])
        : [],
      eyelineRules: Array.isArray(b.eyelineRules) ? (b.eyelineRules as string[]) : [],
    });
  }
  return m;
}

function buildPropMap(meta: Json): Map<string, PropCanon> {
  const m = new Map<string, PropCanon>();
  const bibles = j(meta.propBibles);
  for (const [key, raw] of Object.entries(bibles)) {
    const b = j(raw);
    m.set(key, {
      key,
      name: (b.name as string | undefined) ?? key,
      approved: b.approved === true,
      description: (b.visualDetails as string | undefined) ?? "",
      doNotChange: Array.isArray(b.doNotChange) ? (b.doNotChange as string[]) : [],
    });
  }
  return m;
}

function lookupLocation(
  locations: Map<string, LocationCanon>,
  slugline: string
): LocationCanon | null {
  const norm = normalizeKey(slugline);
  if (!norm) return null;
  if (locations.has(norm)) return locations.get(norm)!;
  const slugWords = norm.split("_").filter(Boolean);
  for (const [k, v] of locations) {
    const kWords = k.split("_").filter(Boolean);
    if (kWords.every((w) => slugWords.includes(w))) return v;
  }
  return null;
}

function lookupProp(
  props: Map<string, PropCanon>,
  raw: string
): PropCanon | null {
  const norm = normalizeKey(raw);
  if (!norm) return null;
  if (props.has(norm)) return props.get(norm)!;
  for (const [k, v] of props) {
    if (k.includes(norm) || norm.includes(k) || v.name.toLowerCase().includes(raw.toLowerCase())) {
      return v;
    }
  }
  return null;
}

async function loadShots(scriptId: string | null): Promise<ShotContext[]> {
  if (!scriptId) return [];
  const list = await getShotList(scriptId);
  const briefsMap = await loadRawBriefs(scriptId);
  const sceneInfo = await loadSceneInfo(scriptId);

  const out: ShotContext[] = [];
  for (const scene of list.scenes) {
    for (const shot of scene.shots) {
      const raw = briefsMap.get(`${shot.sceneOrd}:${shot.shotIndex}`) ?? {};
      const info = sceneInfo.get(shot.sceneOrd) ?? null;
      out.push({
        shot,
        rawBrief: raw,
        slugline: scene.slugline,
        timeOfDay: info?.time_of_day ?? null,
      });
    }
  }
  return out;
}

async function loadRawBriefs(scriptId: string): Promise<Map<string, Json>> {
  const { data } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .single();
  const meta = j((data as { metadata?: unknown } | null)?.metadata);
  const ai = j(meta.aiPrompts);
  const briefs = (ai.briefs as Record<string, Record<string, Json>>) ?? {};
  const m = new Map<string, Json>();
  for (const [ord, perScene] of Object.entries(briefs)) {
    for (const [idx, brief] of Object.entries(perScene)) {
      m.set(`${ord}:${idx}`, brief);
    }
  }
  return m;
}

async function loadSceneInfo(scriptId: string) {
  const { data } = await supabase
    .from("script_scenes")
    .select("ord, time_of_day")
    .eq("script_id", scriptId);
  const m = new Map<number, { time_of_day: string | null }>();
  for (const r of (data as Array<{ ord: number; time_of_day: string | null }>) ?? []) {
    m.set(r.ord, { time_of_day: r.time_of_day ?? null });
  }
  return m;
}

function buildSoundByOrd(
  bible: Awaited<ReturnType<typeof getSoundBible>>
): Map<number, SoundCanon> {
  const m = new Map<number, SoundCanon>();
  for (const row of Object.values(bible.scenes ?? {})) {
    m.set(row.ord, {
      ambientBed: row.ambientBed ?? "",
      keyDiegetic: Array.isArray(row.keyDiegetic) ? row.keyDiegetic : [],
      nonDiegeticMusic: row.nonDiegeticMusic ?? "",
      audioField: row.aiVideoPromptAudioNotes ?? null,
      approved: row.approvedAt !== null,
    });
  }
  return m;
}

function buildAvoidList(projectMeta: Json, projectType: string): string[] {
  const cfg = resolveProjectTypeConfig(projectType);
  const out = new Set<string>();
  for (const v of cfg.shotPolicy.promptAvoidList ?? []) out.add(v);
  const rules = j(projectMeta.productionRules);
  for (const v of (rules.avoid as string[] | undefined) ?? []) out.add(v);
  return [...out];
}

export async function loadEpisodeBriefContext(
  projectId: string,
  episodeId: string
): Promise<EpisodeBriefContext | null> {
  const project = await loadProjectRow(projectId);
  if (!project) return null;
  const episode = await loadEpisode(episodeId);
  if (!episode) return null;

  const projectType = (project.metadata.projectType as string | undefined) ?? "prestige_series";
  const cfg = resolveProjectTypeConfig(projectType);

  const scriptId = await loadCurrentScriptId(projectId, episodeId);

  const [characters, sound, team] = await Promise.all([
    loadCharacterCanon(projectId, episodeId),
    getSoundBible(projectId, episodeId),
    loadTeamState(projectId),
  ]);
  const shots = await loadShots(scriptId);

  const charactersByName = new Map<string, CharacterCanon>();
  for (const c of characters.values()) {
    charactersByName.set(c.name.toLowerCase(), c);
  }

  const locations = buildLocationMap(project.metadata);
  const props = buildPropMap(project.metadata);
  const soundByOrd = buildSoundByOrd(sound);

  const assignments = team?.assignments ?? {};
  const definitions = await allRoleDefinitions(projectId);
  const rolesByKey = new Map(definitions.map((d) => [d.key, d] as const));
  void coreRoleByKey; // referenced indirectly via allRoleDefinitions

  const avoidList = buildAvoidList(project.metadata, projectType);

  // Helpers attached lazily — keep on the context for builders.
  Object.assign(rolesByKey, {});

  // Surface lookup helpers via plain functions on context.
  (locations as unknown as { _lookup?: typeof lookupLocation })._lookup = lookupLocation;
  (props as unknown as { _lookup?: typeof lookupProp })._lookup = lookupProp;

  return {
    projectId,
    projectTitle: project.title,
    projectType,
    episodeId,
    episodeNumber: episode.number,
    episodeTitle: episode.title,
    scriptId,
    defaultAspectRatio: cfg.shotPolicy.defaultAspectRatio,
    defaultDurationSec: cfg.shotPolicy.defaultDurationSec,
    composerKey: cfg.shotPolicy.composerKey,
    isMicroDramaTier: cfg.shotPolicy.isMicroDramaTier,
    shots,
    characters,
    charactersByName,
    locations,
    props,
    soundByOrd,
    assignments,
    rolesByKey,
    avoidList,
  };
}

// Re-export helpers — the builders import these by name.
export { lookupLocation, lookupProp };
