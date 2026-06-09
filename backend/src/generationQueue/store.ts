// AI Production Queue — persistence layer.
//
// Lives at `projects.metadata.generationQueue[episodeId]`. Read-only
// against scripts, scenes, briefs, and bibles. The only thing this layer
// writes is its own queue object — never fountain, never script_scenes,
// never the curated shot list.

import { supabase } from "../db/client.js";
import type {
  GenerationQueue,
  GenerationQueueItem,
} from "@toburt/shared";

export interface QueuePersistence {
  load(projectId: string, episodeId: string): Promise<GenerationQueue | null>;
  save(projectId: string, episodeId: string, queue: GenerationQueue): Promise<void>;
}

async function loadProjectMetadata(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return ((data?.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
}

async function saveProjectMetadata(
  projectId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ metadata, updated_at: new Date().toISOString() })
    .eq("id", projectId);
  if (error) throw error;
}

export async function loadQueue(
  projectId: string,
  episodeId: string
): Promise<GenerationQueue | null> {
  const meta = await loadProjectMetadata(projectId);
  const queues = (meta.generationQueue as Record<string, GenerationQueue> | undefined) ?? {};
  return queues[episodeId] ?? null;
}

export async function saveQueue(
  projectId: string,
  episodeId: string,
  queue: GenerationQueue
): Promise<void> {
  const meta = await loadProjectMetadata(projectId);
  const queues =
    ((meta.generationQueue as Record<string, GenerationQueue> | undefined) ?? {}) as Record<string, GenerationQueue>;
  queues[episodeId] = {
    ...queue,
    updatedAt: new Date().toISOString(),
  };
  const next = { ...meta, generationQueue: queues };
  await saveProjectMetadata(projectId, next);
}

export function emptyQueue(
  episodeId: string,
  scriptId: string
): GenerationQueue {
  const now = new Date().toISOString();
  return {
    episodeId,
    scriptId,
    items: [],
    lastSyncedAt: now,
    updatedAt: now,
  };
}

/** Update one item in place. Throws if the item id doesn't exist. */
export function patchItem(
  queue: GenerationQueue,
  itemId: string,
  patch: Partial<GenerationQueueItem>
): GenerationQueue {
  const idx = queue.items.findIndex((it) => it.id === itemId);
  if (idx === -1) throw new Error(`queue item not found: ${itemId}`);
  const next = { ...queue.items[idx], ...patch, updatedAt: new Date().toISOString() };
  const items = queue.items.slice();
  items[idx] = next;
  return { ...queue, items, updatedAt: new Date().toISOString() };
}

export function findItem(
  queue: GenerationQueue,
  itemId: string
): GenerationQueueItem | null {
  return queue.items.find((it) => it.id === itemId) ?? null;
}
