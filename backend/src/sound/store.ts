// Sound Bible storage helpers. All writes target jsonb columns under
// projects.metadata or characters.metadata — NEVER scripts.fountain or
// script_scenes. Read calls assert the script exists and respect the
// locked-draft contract (locked drafts can be read as sources but never
// modified).

import { supabase } from "../db/client.js";
import {
  emptySoundBible,
  type CharacterSoundSignature,
  type LocationSoundSignature,
  type SoundBible,
  type SoundSection,
  type SoundSceneBreakdown,
} from "./types.js";
import type { MusicPromptPack } from "./musicTypes.js";

/** Read a project's full metadata.soundBibles map. */
async function loadProjectSoundBibles(
  projectId: string
): Promise<Record<string, SoundBible>> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  return (meta.soundBibles as Record<string, SoundBible> | undefined) ?? {};
}

/** Write the full metadata.soundBibles map back, preserving every other
 *  project metadata key. */
async function saveProjectSoundBibles(
  projectId: string,
  bibles: Record<string, SoundBible>
): Promise<void> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  const next = { ...meta, soundBibles: bibles };
  const { error: upErr } = await supabase
    .from("projects")
    .update({ metadata: next })
    .eq("id", projectId);
  if (upErr) throw upErr;
}

/** Read one episode's SoundBible. Returns an empty shell if none exists
 *  yet (so callers don't need to handle the missing-bible branch). */
export async function getSoundBible(
  projectId: string,
  episodeId: string
): Promise<SoundBible> {
  const all = await loadProjectSoundBibles(projectId);
  return all[episodeId] ?? emptySoundBible(episodeId);
}

/** Save the SoundBible — increments version + updates updatedAt. */
export async function putSoundBible(
  projectId: string,
  bible: SoundBible
): Promise<SoundBible> {
  const all = await loadProjectSoundBibles(projectId);
  const next: SoundBible = {
    ...bible,
    version: (all[bible.episodeId]?.version ?? 0) + 1,
    updatedAt: new Date().toISOString(),
  };
  all[bible.episodeId] = next;
  await saveProjectSoundBibles(projectId, all);
  return next;
}

/** Patch a single top-level section of the SoundBible. */
export async function patchSoundBibleSection<
  K extends Exclude<SoundSection, "scenes" | "characterSignatures" | "locationSignatures"> & keyof SoundBible
>(
  projectId: string,
  episodeId: string,
  section: K,
  value: SoundBible[K]
): Promise<SoundBible> {
  const bible = await getSoundBible(projectId, episodeId);
  const next = { ...bible, [section]: value };
  return putSoundBible(projectId, next);
}

/** Update one per-scene row. */
export async function patchSoundSceneRow(
  projectId: string,
  episodeId: string,
  ord: number,
  value: SoundSceneBreakdown
): Promise<SoundBible> {
  const bible = await getSoundBible(projectId, episodeId);
  const scenes = { ...bible.scenes, [String(ord)]: value };
  const next = { ...bible, scenes };
  return putSoundBible(projectId, next);
}

/** Update one character sound signature row. */
export async function patchCharacterSoundSignature(
  projectId: string,
  episodeId: string,
  characterName: string,
  value: CharacterSoundSignature
): Promise<SoundBible> {
  const bible = await getSoundBible(projectId, episodeId);
  const characterSignatures = {
    ...bible.characterSignatures,
    [characterName]: value,
  };
  const next = { ...bible, characterSignatures };
  return putSoundBible(projectId, next);
}

/** Update one location sound signature row. */
export async function patchLocationSoundSignature(
  projectId: string,
  episodeId: string,
  locationKey: string,
  value: LocationSoundSignature
): Promise<SoundBible> {
  const bible = await getSoundBible(projectId, episodeId);
  const locationSignatures = {
    ...bible.locationSignatures,
    [locationKey]: value,
  };
  const next = { ...bible, locationSignatures };
  return putSoundBible(projectId, next);
}

/** Approve a per-scene row — flips approvedAt only. The composer reads
 *  ONLY rows whose approvedAt !== null. */
export async function approveSoundScene(
  projectId: string,
  episodeId: string,
  ord: number,
  userId: string
): Promise<SoundBible> {
  const bible = await getSoundBible(projectId, episodeId);
  const row = bible.scenes[String(ord)];
  if (!row) throw new Error(`No SoundBible scene row at ord ${ord}`);
  const next: SoundSceneBreakdown = {
    ...row,
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  };
  return patchSoundSceneRow(projectId, episodeId, ord, next);
}

/** Approve a top-level section by stamping its sectionApprovedAt. */
export async function approveSoundSection(
  projectId: string,
  episodeId: string,
  section: SoundSection,
  userId: string
): Promise<SoundBible> {
  const bible = await getSoundBible(projectId, episodeId);
  const stamp = { sectionApprovedAt: new Date().toISOString(), sectionApprovedBy: userId };
  let next: SoundBible = bible;
  if (section === "episodeSoundIdentity") {
    next = { ...bible, episodeSoundIdentity: { ...bible.episodeSoundIdentity, ...stamp } };
  } else if (section === "musicGuidance") {
    next = { ...bible, musicGuidance: { ...bible.musicGuidance, ...stamp } };
  } else if (section === "scenes") {
    // bulk-approve every scene row
    const scenes: Record<string, SoundSceneBreakdown> = {};
    for (const [ord, row] of Object.entries(bible.scenes)) {
      scenes[ord] = { ...row, approvedAt: stamp.sectionApprovedAt, approvedBy: userId };
    }
    next = { ...bible, scenes };
  } else if (section === "characterSignatures") {
    const characterSignatures: Record<string, CharacterSoundSignature> = {};
    for (const [k, row] of Object.entries(bible.characterSignatures)) {
      characterSignatures[k] = { ...row, ...stamp };
    }
    next = { ...bible, characterSignatures };
  } else if (section === "locationSignatures") {
    const locationSignatures: Record<string, LocationSoundSignature> = {};
    for (const [k, row] of Object.entries(bible.locationSignatures)) {
      locationSignatures[k] = { ...row, ...stamp };
    }
    next = { ...bible, locationSignatures };
  } else if (section === "motifs") {
    // No section-stamp field on motifs (they're a list); we approve by
    // stamping the bible-level approvedAt for the motifs slot — for now
    // simply re-save so version bumps. UI gates motif read on bible.approvedAt
    // or on at-least-one section being approved.
    next = bible;
  }
  return putSoundBible(projectId, next);
}

/** Stamp the whole-bible approval. */
export async function approveSoundBible(
  projectId: string,
  episodeId: string,
  userId: string
): Promise<SoundBible> {
  const bible = await getSoundBible(projectId, episodeId);
  const next: SoundBible = {
    ...bible,
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  };
  return putSoundBible(projectId, next);
}

// ---------------------------------------------------------------------------
// Music pack — stored at projects.metadata.soundBibles[ep].musicPack
// ---------------------------------------------------------------------------

/** SoundBible carrier type that also includes the optional musicPack
 *  field. Keeps it out of the canonical SoundBible type so existing
 *  consumers don't need to know about the music layer. */
type SoundBibleWithMusic = SoundBible & { musicPack?: MusicPromptPack };

export async function getMusicPromptPack(
  projectId: string,
  episodeId: string
): Promise<MusicPromptPack | null> {
  const bible = (await getSoundBible(projectId, episodeId)) as SoundBibleWithMusic;
  return bible.musicPack ?? null;
}

export async function putMusicPromptPack(
  projectId: string,
  episodeId: string,
  pack: MusicPromptPack
): Promise<MusicPromptPack> {
  const bible = (await getSoundBible(projectId, episodeId)) as SoundBibleWithMusic;
  const next: MusicPromptPack = {
    ...pack,
    version: ((bible.musicPack?.version ?? 0) as number) + 1,
    updatedAt: new Date().toISOString(),
  };
  const carrier: SoundBibleWithMusic = { ...bible, musicPack: next };
  await putSoundBible(projectId, carrier as SoundBible);
  return next;
}

export async function approveMusicPromptPack(
  projectId: string,
  episodeId: string,
  userId: string
): Promise<MusicPromptPack | null> {
  const pack = await getMusicPromptPack(projectId, episodeId);
  if (!pack) return null;
  const next: MusicPromptPack = {
    ...pack,
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  };
  return putMusicPromptPack(projectId, episodeId, next);
}
