// Trailer Builder — store helpers. All writes target
// projects.metadata.trailerBuilder[episodeId]. NEVER touches scripts.

import { supabase } from "../db/client.js";
import { emptyTrailerPack, type TrailerPack, type TrailerPlan, type TrailerVariantKey } from "./types.js";

async function loadProjectMeta(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return (data?.metadata as Record<string, unknown> | null) ?? {};
}

async function saveProjectMeta(
  projectId: string,
  patchKey: string,
  patchValue: unknown
): Promise<void> {
  const meta = await loadProjectMeta(projectId);
  const next = { ...meta, [patchKey]: patchValue };
  const { error } = await supabase
    .from("projects")
    .update({ metadata: next })
    .eq("id", projectId);
  if (error) throw error;
}

async function loadTrailerBuilders(
  projectId: string
): Promise<Record<string, TrailerPack>> {
  const meta = await loadProjectMeta(projectId);
  return (meta.trailerBuilder as Record<string, TrailerPack> | undefined) ?? {};
}

export async function getTrailerPack(
  projectId: string,
  episodeId: string
): Promise<TrailerPack> {
  const all = await loadTrailerBuilders(projectId);
  return all[episodeId] ?? emptyTrailerPack(episodeId);
}

export async function putTrailerPack(
  projectId: string,
  pack: TrailerPack
): Promise<TrailerPack> {
  const all = await loadTrailerBuilders(projectId);
  const next: TrailerPack = {
    ...pack,
    version: ((all[pack.episodeId]?.version ?? 0) as number) + 1,
    updatedAt: new Date().toISOString(),
  };
  all[pack.episodeId] = next;
  await saveProjectMeta(projectId, "trailerBuilder", all);
  return next;
}

export async function patchTrailerVariant(
  projectId: string,
  episodeId: string,
  variant: TrailerVariantKey,
  plan: TrailerPlan
): Promise<TrailerPack> {
  const pack = await getTrailerPack(projectId, episodeId);
  const variants = { ...pack.variants, [variant]: plan };
  return putTrailerPack(projectId, { ...pack, variants });
}

export async function approveTrailerVariant(
  projectId: string,
  episodeId: string,
  variant: TrailerVariantKey,
  userId: string
): Promise<TrailerPack> {
  const pack = await getTrailerPack(projectId, episodeId);
  const plan = pack.variants[variant];
  if (!plan) throw new Error(`No ${variant} plan to approve`);
  const next: TrailerPlan = {
    ...plan,
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  };
  return patchTrailerVariant(projectId, episodeId, variant, next);
}

export async function approveTrailerPack(
  projectId: string,
  episodeId: string,
  userId: string
): Promise<TrailerPack> {
  const pack = await getTrailerPack(projectId, episodeId);
  return putTrailerPack(projectId, {
    ...pack,
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  });
}
