// AI Production Queue — derive aggregations + final response shape.

import { supabase } from "../db/client.js";
import type {
  BatchGroupBy,
  GenerationQueue,
  GenerationQueueBatch,
  GenerationQueueItem,
  GenerationQueueResponse,
  GenerationQueueStatus,
  GenerationQueueSummary,
  ModelTarget,
  SceneCompletion,
} from "@toburt/shared";
import { GENERATION_QUEUE_STATUSES, MODEL_TARGETS } from "@toburt/shared";

// ---------------------------------------------------------------------------
// Scene completion
// ---------------------------------------------------------------------------

interface SceneIndex {
  ord: number;
  slugline: string;
}

async function loadSceneIndex(scriptId: string): Promise<SceneIndex[]> {
  if (!scriptId) return [];
  const { data } = await supabase
    .from("script_scenes")
    .select("ord, slugline")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  return ((data as Array<{ ord: number; slugline: string | null }>) ?? []).map((r) => ({
    ord: r.ord,
    slugline: r.slugline ?? `Scene ${r.ord}`,
  }));
}

export function computeSceneCompletion(
  scenes: SceneIndex[],
  items: GenerationQueueItem[]
): SceneCompletion[] {
  const byOrd = new Map<number, GenerationQueueItem[]>();
  for (const it of items) {
    const list = byOrd.get(it.sceneOrd) ?? [];
    list.push(it);
    byOrd.set(it.sceneOrd, list);
  }
  const out: SceneCompletion[] = [];
  for (const s of scenes) {
    const its = byOrd.get(s.ord) ?? [];
    const total = its.length;
    const generated = its.filter((it) => it.outputs.length > 0).length;
    const approved = its.filter(
      (it) => it.status === "approved" || it.status === "final"
    ).length;
    const rejected = its.filter((it) => it.status === "rejected").length;
    const missing = its.filter(
      (it) =>
        it.outputs.length === 0 &&
        (it.status === "not_ready" || it.status === "ready" || it.status === "queued")
    ).length;
    out.push({
      sceneOrd: s.ord,
      slugline: s.slugline,
      totalShots: total,
      generatedShots: generated,
      approvedShots: approved,
      rejectedShots: rejected,
      missingShots: missing,
      completionPct: total === 0 ? 0 : Math.round((approved / total) * 100),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function emptyCounter<T extends string>(keys: readonly T[]): Record<T, number> {
  const o = {} as Record<T, number>;
  for (const k of keys) o[k] = 0;
  return o;
}

export function computeSummary(
  episodeId: string,
  items: GenerationQueueItem[],
  scenes: SceneCompletion[]
): GenerationQueueSummary {
  const byStatus = emptyCounter<GenerationQueueStatus>(GENERATION_QUEUE_STATUSES);
  const byModel = emptyCounter<ModelTarget>(MODEL_TARGETS);
  for (const it of items) {
    byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
    byModel[it.modelTarget] = (byModel[it.modelTarget] ?? 0) + 1;
  }
  const total = items.length;
  const ready = byStatus.ready + byStatus.queued;
  const blocked = byStatus.not_ready;
  const awaitingReview = byStatus.needs_review;
  const totalApprovedAcrossScenes = scenes.reduce((n, s) => n + s.approvedShots, 0);
  return {
    episodeId,
    totalShots: total,
    byStatus,
    byModel,
    scenes,
    overallCompletionPct: total === 0 ? 0 : Math.round((totalApprovedAcrossScenes / total) * 100),
    readyCount: ready,
    blockedCount: blocked,
    awaitingReviewCount: awaitingReview,
  };
}

// ---------------------------------------------------------------------------
// Batches — group items by axis. Items appear in every group that
// matches them (a multi-character shot appears under each character).
// ---------------------------------------------------------------------------

function pushBatch(
  map: Map<string, GenerationQueueBatch>,
  groupBy: BatchGroupBy,
  key: string,
  label: string,
  itemId: string
): void {
  const k = `${groupBy}:${key}`;
  let b = map.get(k);
  if (!b) {
    b = { key, label, groupBy, itemIds: [], itemCount: 0 };
    map.set(k, b);
  }
  b.itemIds.push(itemId);
  b.itemCount += 1;
}

export function computeBatches(items: GenerationQueueItem[]): GenerationQueueResponse["batches"] {
  const byCharacter = new Map<string, GenerationQueueBatch>();
  const byLocation = new Map<string, GenerationQueueBatch>();
  const byModel = new Map<string, GenerationQueueBatch>();
  const byAspect = new Map<string, GenerationQueueBatch>();
  const byTime = new Map<string, GenerationQueueBatch>();
  const byScene = new Map<string, GenerationQueueBatch>();

  for (const it of items) {
    for (const c of it.characters.length ? it.characters : ["(no character)"]) {
      pushBatch(byCharacter, "character", c, c, it.id);
    }
    const loc = it.location || "(no location)";
    pushBatch(byLocation, "location", loc, loc, it.id);
    pushBatch(byModel, "model", it.modelTarget, it.modelTarget, it.id);
    pushBatch(byAspect, "aspect_ratio", it.aspectRatio, it.aspectRatio, it.id);
    const tod = it.timeOfDay || "(unspecified)";
    pushBatch(byTime, "time_of_day", tod, tod, it.id);
    pushBatch(byScene, "scene", `${it.sceneOrd}`, `Scene ${it.sceneOrd}`, it.id);
  }

  const sortGroups = (m: Map<string, GenerationQueueBatch>): GenerationQueueBatch[] =>
    [...m.values()].sort((a, b) => b.itemCount - a.itemCount || a.label.localeCompare(b.label));

  return {
    byCharacter: sortGroups(byCharacter),
    byLocation: sortGroups(byLocation),
    byModel: sortGroups(byModel),
    byAspectRatio: sortGroups(byAspect),
    byTimeOfDay: sortGroups(byTime),
    byScene: sortGroups(byScene).sort((a, b) => parseInt(a.key, 10) - parseInt(b.key, 10)),
  };
}

// ---------------------------------------------------------------------------
// Final response
// ---------------------------------------------------------------------------

export interface BuildResponseInput {
  projectId: string;
  episodeId: string;
  scriptId: string | null;
  queue: GenerationQueue;
  policy: GenerationQueueResponse["policy"];
}

export async function buildQueueResponse(
  input: BuildResponseInput
): Promise<GenerationQueueResponse> {
  const [project, episode, script] = await Promise.all([
    supabase
      .from("projects")
      .select("title")
      .eq("id", input.projectId)
      .maybeSingle(),
    supabase
      .from("episodes")
      .select("number, title")
      .eq("id", input.episodeId)
      .maybeSingle(),
    input.scriptId
      ? supabase
          .from("scripts")
          .select("draft_number, metadata")
          .eq("id", input.scriptId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const sceneIndex = await loadSceneIndex(input.scriptId ?? "");
  const sceneCompletion = computeSceneCompletion(sceneIndex, input.queue.items);
  const summary = computeSummary(input.episodeId, input.queue.items, sceneCompletion);
  const batches = computeBatches(input.queue.items);

  const scriptMeta = ((script as { data: { metadata?: Record<string, unknown> | null } | null }).data?.metadata ??
    null) as Record<string, unknown> | null;
  const scriptIsLocked = (scriptMeta?.lockedWritingDraft as boolean | undefined) === true;

  return {
    projectId: input.projectId,
    projectTitle: ((project as { data: { title?: string | null } | null }).data?.title as string | null) ?? null,
    episodeId: input.episodeId,
    episodeNumber:
      ((episode as { data: { number?: number | null } | null }).data?.number as number | null) ?? null,
    episodeTitle:
      ((episode as { data: { title?: string | null } | null }).data?.title as string | null) ?? null,
    scriptId: input.scriptId,
    scriptDraftNumber:
      ((script as { data: { draft_number?: number | null } | null }).data?.draft_number as number | null) ?? null,
    scriptIsLocked,
    policy: input.policy,
    queue: input.queue,
    summary,
    batches,
  };
}
