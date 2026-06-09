// Curated Shot List — store / projection / edits / approvals.
//
// Reads `scripts.metadata.aiPrompts.briefs` and projects it into a
// scene-grouped `ShotListResponse`. Writes:
//   • brief edits     → scripts.metadata.aiPrompts.briefs[ord][shotIndex]
//   • curated rows    → scripts.metadata.aiPrompts.curated[ord][shotIndex]
//   • approval map    → scripts.metadata.shotListApproval
//   • production mode → curated row above
//
// NEVER touches scripts.fountain or script_scenes. The lock guard
// applies to fountain/scenes only; metadata writes are intentionally
// allowed on locked drafts so production can proceed on a locked
// creative source.

import { supabase } from "../db/client.js";
import { resolveProjectTypeConfig } from "@toburt/shared";
import { getSoundBible } from "../sound/store.js";
import type {
  ShotApprovalRecord,
  ShotCurated,
  ShotEditPatch,
  ShotListApproval,
  ShotListResponse,
  ShotListRow,
  ShotListSceneGroup,
  ShotListPolicySummary,
  ShotProductionMode,
  ShotSoundContext,
} from "@toburt/shared";

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

interface ScriptRow {
  id: string;
  project_id: string;
  episode_id: string | null;
  draft_number: number;
  title: string | null;
  metadata: Record<string, unknown> | null;
}

async function loadScript(scriptId: string): Promise<ScriptRow> {
  const { data, error } = await supabase
    .from("scripts")
    .select("id, project_id, episode_id, draft_number, title, metadata")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  return data as ScriptRow;
}

async function loadEpisodeContext(
  episodeId: string | null
): Promise<{ id: string; number: number; title: string | null } | null> {
  if (!episodeId) return null;
  const { data } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("id", episodeId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id as string,
    number: data.number as number,
    title: (data.title as string | null) ?? null,
  };
}

async function loadProjectType(projectId: string): Promise<string> {
  const { data } = await supabase
    .from("projects")
    .select("metadata, kind")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  return (meta.projectType as string | undefined) ?? "prestige_series";
}

// ---------------------------------------------------------------------------
// Curated metadata access — defaults flow from shotPolicy
// ---------------------------------------------------------------------------

function getCurated(
  script: ScriptRow,
  ord: number,
  shotIndex: number
): ShotCurated {
  const meta = script.metadata ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const curated =
    (ai.curated as Record<string, Record<string, ShotCurated>> | undefined) ?? {};
  const sceneRow = curated[String(ord)] ?? {};
  const row = sceneRow[String(shotIndex)];
  if (row) return row;
  return { productionMode: "ai_video", status: "draft" };
}

function buildApprovalMap(metadata: Record<string, unknown> | null | undefined): ShotListApproval {
  const meta = metadata ?? {};
  const raw = (meta.shotListApproval as ShotListApproval | undefined) ?? {
    shots: {},
    scenes: {},
    episode: null,
    updatedAt: new Date().toISOString(),
  };
  return raw;
}

function approvalKey(ord: number, shotIndex: number): string {
  return `${ord}-${shotIndex}`;
}

/** Shot is approved if its own row OR the parent scene OR the episode
 *  is approved. */
function isShotApproved(
  approval: ShotListApproval,
  ord: number,
  shotIndex: number
): string | null {
  const k = approvalKey(ord, shotIndex);
  if (approval.shots[k]) return approval.shots[k].approvedAt;
  if (approval.scenes[String(ord)]) return approval.scenes[String(ord)].approvedAt;
  if (approval.episode) return approval.episode.approvedAt;
  return null;
}

// ---------------------------------------------------------------------------
// Sound context — read-only projection from approved SoundBible rows
// ---------------------------------------------------------------------------

async function buildSoundContextMap(
  projectId: string,
  episodeId: string | null
): Promise<Map<number, ShotSoundContext>> {
  if (!episodeId) return new Map();
  const bible = await getSoundBible(projectId, episodeId);
  const out = new Map<number, ShotSoundContext>();
  for (const [ordStr, row] of Object.entries(bible.scenes)) {
    if (row.approvedAt == null) continue;
    const ord = parseInt(ordStr, 10);
    if (!Number.isFinite(ord)) continue;
    out.set(ord, {
      ambientBed: row.ambientBed,
      keyDiegetic: row.keyDiegetic,
      nonDiegeticMusic: row.nonDiegeticMusic,
      motifIds: row.motifIds,
      audioField: row.aiVideoPromptAudioNotes ?? null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Brief → ShotListRow projection
// ---------------------------------------------------------------------------

function projectBriefToRow(
  brief: Record<string, unknown>,
  ord: number,
  shotIndex: number,
  curated: ShotCurated,
  approvedAt: string | null,
  soundContext: ShotSoundContext | null
): ShotListRow {
  const characters = Array.isArray(brief.characters)
    ? (brief.characters as Array<{ name?: string }>)
        .map((c) => c?.name ?? "")
        .filter(Boolean)
    : [];
  // Determine shotType from cameraFraming first sentence; fall back to "".
  const cameraFraming = (brief.cameraFraming as string) ?? "";
  const shotType = cameraFraming.split(/[,.]/)[0]?.trim() ?? "";
  // Subject = primary character or "environment" if none.
  const subject =
    characters.length > 0
      ? characters.join(", ")
      : ((brief.location as string) ?? "environment");
  return {
    id: (brief.id as string) ?? `SC${ord}_SH${shotIndex}`,
    sceneOrd: ord,
    shotIndex,
    primaryImage: (brief.primaryImage as string) ?? "",
    shotType,
    cameraLanguage: [
      brief.cameraFraming,
      brief.lensSuggestion,
      brief.cameraMovement,
    ]
      .filter(Boolean)
      .join(" · "),
    subject,
    action: (brief.action as string) ?? "",
    emotionalBeat: (brief.emotionalBeat as string) ?? "",
    visualMotif: ((brief.visualMotif as string) ?? (brief.texture as string)) ?? "",
    location: (brief.location as string) ?? "",
    characters,
    props: Array.isArray(brief.props) ? (brief.props as string[]) : [],
    durationSec: (brief.durationSec as number) ?? 0,
    aspectRatio: (brief.aspectRatio as string) ?? "",
    aiModelHint:
      ((brief.aiModelHint as string | null) ?? null) ||
      ((brief.recommendedModel as string | null) ?? null) ||
      null,
    curated,
    approvedAt,
    soundContext,
    userEdited: brief.userEdited === true,
  };
}

// ---------------------------------------------------------------------------
// Main read: full ShotListResponse
// ---------------------------------------------------------------------------

export async function getShotList(scriptId: string): Promise<ShotListResponse> {
  const script = await loadScript(scriptId);
  const episode = await loadEpisodeContext(script.episode_id);
  const projectType = await loadProjectType(script.project_id);
  const cfg = resolveProjectTypeConfig(projectType);
  const policy: ShotListPolicySummary = {
    projectType,
    label: cfg.label,
    defaultAspectRatio: cfg.shotPolicy.defaultAspectRatio,
    defaultDurationSec: cfg.shotPolicy.defaultDurationSec,
    minDurationSec: cfg.shotPolicy.minDurationSec,
    maxDurationSec: cfg.shotPolicy.maxDurationSec,
    coverageDensity: cfg.shotPolicy.coverageDensity,
    composerKey: cfg.shotPolicy.composerKey,
    isMicroDramaTier: cfg.shotPolicy.isMicroDramaTier,
  };

  const meta = script.metadata ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs =
    (ai.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
  const approval = buildApprovalMap(meta);

  // Pull script_scenes for slugline + summary + status (read-only).
  const { data: sceneRows } = await supabase
    .from("script_scenes")
    .select("ord, slugline, summary, status")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  const sceneInfo = new Map<number, { slugline: string; summary: string | null; status: string | null }>();
  for (const r of sceneRows ?? []) {
    sceneInfo.set(r.ord as number, {
      slugline: (r.slugline as string) ?? `Scene ${r.ord}`,
      summary: (r.summary as string | null) ?? null,
      status: (r.status as string | null) ?? null,
    });
  }

  const soundCtx = await buildSoundContextMap(script.project_id, script.episode_id);

  // Build groups for every scene that has briefs OR has a script_scenes row.
  // Order by ord ascending.
  const allOrds = new Set<number>([
    ...Object.keys(briefs).map((k) => parseInt(k, 10)).filter((n) => Number.isFinite(n)),
    ...Array.from(sceneInfo.keys()),
  ]);
  const ords = Array.from(allOrds).sort((a, b) => a - b);

  let shotApprovedCount = 0;
  let shotTotalCount = 0;
  let sceneApprovedCount = 0;
  let sceneTotalCount = ords.length;

  const scenes: ShotListSceneGroup[] = ords.map((ord) => {
    const info = sceneInfo.get(ord);
    const sceneBriefs = briefs[String(ord)] ?? {};
    const shotIndices = Object.keys(sceneBriefs)
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const rows: ShotListRow[] = shotIndices.map((idx) => {
      const brief = sceneBriefs[String(idx)] ?? {};
      const curated = getCurated(script, ord, idx);
      const approvedAt = isShotApproved(approval, ord, idx);
      if (approvedAt) shotApprovedCount += 1;
      shotTotalCount += 1;
      return projectBriefToRow(
        brief,
        ord,
        idx,
        curated,
        approvedAt,
        soundCtx.get(ord) ?? null
      );
    });
    const sceneApprovedAt = approval.scenes[String(ord)]?.approvedAt ?? null;
    if (sceneApprovedAt) sceneApprovedCount += 1;
    return {
      sceneOrd: ord,
      slugline: info?.slugline ?? `Scene ${ord}`,
      summary: info?.summary ?? null,
      status: info?.status ?? null,
      shotCount: rows.length,
      shots: rows,
      sceneApprovedAt,
    };
  });

  return {
    scriptId,
    scriptTitle: script.title,
    draftNumber: script.draft_number,
    episodeId: script.episode_id,
    episodeNumber: episode?.number ?? null,
    episodeTitle: episode?.title ?? null,
    policy,
    scenes,
    approval: {
      episodeApprovedAt: approval.episode?.approvedAt ?? null,
      sceneApprovedCount,
      sceneTotalCount,
      shotApprovedCount,
      shotTotalCount,
    },
    scriptIsLocked:
      ((script.metadata as Record<string, unknown> | null)?.lockedWritingDraft as boolean | undefined) === true,
  };
}

// ---------------------------------------------------------------------------
// Write helpers — mutate scripts.metadata
// ---------------------------------------------------------------------------

async function writeMetadata(
  scriptId: string,
  next: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("scripts")
    .update({ metadata: next, updated_at: new Date().toISOString() })
    .eq("id", scriptId);
  if (error) throw error;
}

function deepGet<T = unknown>(
  meta: Record<string, unknown>,
  path: string[]
): T | undefined {
  let cur: unknown = meta;
  for (const seg of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur as T | undefined;
}

function deepSet(meta: Record<string, unknown>, path: string[], value: unknown): Record<string, unknown> {
  const next = { ...meta };
  let cur: Record<string, unknown> = next;
  for (let i = 0; i < path.length - 1; i++) {
    const seg = path[i];
    const existing = cur[seg];
    cur[seg] =
      existing && typeof existing === "object" && !Array.isArray(existing)
        ? { ...(existing as Record<string, unknown>) }
        : {};
    cur = cur[seg] as Record<string, unknown>;
  }
  cur[path[path.length - 1]] = value;
  return next;
}

// ---------------------------------------------------------------------------
// Edit / Add / Remove / Duplicate / Reorder
// ---------------------------------------------------------------------------

export async function editShot(
  scriptId: string,
  ord: number,
  shotIndex: number,
  patch: ShotEditPatch
): Promise<ShotListRow> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs = (ai.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
  const sceneBriefs = briefs[String(ord)] ?? {};
  const prior = sceneBriefs[String(shotIndex)];
  if (!prior) throw new Error(`No brief at scene ${ord}, shot ${shotIndex}`);

  // Map patch fields onto the canonical brief shape.
  const updatedBrief: Record<string, unknown> = { ...prior };
  if (patch.primaryImage !== undefined) updatedBrief.primaryImage = patch.primaryImage;
  if (patch.shotType !== undefined) updatedBrief.cameraFraming = patch.shotType;
  if (patch.cameraLanguage !== undefined) {
    // Curated cameraLanguage is a writer-facing combined string; back it
    // into cameraFraming if shotType isn't set explicitly.
    if (patch.shotType === undefined) updatedBrief.cameraFraming = patch.cameraLanguage;
  }
  if (patch.action !== undefined) updatedBrief.action = patch.action;
  if (patch.emotionalBeat !== undefined) updatedBrief.emotionalBeat = patch.emotionalBeat;
  if (patch.visualMotif !== undefined) updatedBrief.visualMotif = patch.visualMotif;
  if (patch.location !== undefined) updatedBrief.location = patch.location;
  if (patch.characters !== undefined) {
    updatedBrief.characters = patch.characters.map((name) => ({ name }));
  }
  if (patch.props !== undefined) updatedBrief.props = patch.props;
  if (patch.durationSec !== undefined) updatedBrief.durationSec = patch.durationSec;
  if (patch.aspectRatio !== undefined) updatedBrief.aspectRatio = patch.aspectRatio;
  if (patch.aiModelHint !== undefined) updatedBrief.aiModelHint = patch.aiModelHint;
  // userEdited so autoBuild won't silently overwrite without confirm.
  updatedBrief.userEdited = true;

  // Write back.
  let nextMeta = deepSet(meta, ["aiPrompts", "briefs", String(ord), String(shotIndex)], updatedBrief);

  // Curated patch.
  const priorCurated = getCurated(script, ord, shotIndex);
  const nextCurated: ShotCurated = {
    productionMode: patch.productionMode ?? priorCurated.productionMode,
    status: patch.status ?? priorCurated.status,
    notes: patch.notes ?? priorCurated.notes,
  };
  nextMeta = deepSet(
    nextMeta,
    ["aiPrompts", "curated", String(ord), String(shotIndex)],
    nextCurated
  );

  await writeMetadata(scriptId, nextMeta);

  // Re-project for return.
  const list = await getShotList(scriptId);
  const sceneGroup = list.scenes.find((s) => s.sceneOrd === ord);
  const row = sceneGroup?.shots.find((s) => s.shotIndex === shotIndex);
  if (!row) throw new Error("edit succeeded but re-project failed");
  return row;
}

export async function addShot(
  scriptId: string,
  ord: number,
  seed?: ShotEditPatch
): Promise<ShotListRow> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs = (ai.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
  const sceneBriefs = briefs[String(ord)] ?? {};
  const indices = Object.keys(sceneBriefs)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n));
  const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;

  const projectType = await loadProjectType(script.project_id);
  const cfg = resolveProjectTypeConfig(projectType);
  const newBrief: Record<string, unknown> = {
    id: `SC${ord}_SH${nextIndex}`,
    sceneOrd: ord,
    shotIndex: nextIndex,
    projectTitle: "",
    primaryImage: seed?.primaryImage ?? "",
    cameraFraming: seed?.shotType ?? seed?.cameraLanguage ?? "",
    lensSuggestion: "",
    cameraMovement: "",
    action: seed?.action ?? "",
    emotionalBeat: seed?.emotionalBeat ?? "",
    visualMotif: seed?.visualMotif ?? "",
    location: seed?.location ?? "",
    timeOfDay: "",
    lighting: "",
    colorPalette: "",
    characters: (seed?.characters ?? []).map((name) => ({ name })),
    props: seed?.props ?? [],
    durationSec: seed?.durationSec ?? cfg.shotPolicy.defaultDurationSec,
    aspectRatio: seed?.aspectRatio ?? cfg.shotPolicy.defaultAspectRatio,
    outputType: "video",
    userEdited: true,
    shotPurpose: "",
    storyBeat: "",
  };
  let nextMeta = deepSet(meta, ["aiPrompts", "briefs", String(ord), String(nextIndex)], newBrief);
  nextMeta = deepSet(
    nextMeta,
    ["aiPrompts", "curated", String(ord), String(nextIndex)],
    {
      productionMode: seed?.productionMode ?? "ai_video",
      status: seed?.status ?? "draft",
      notes: seed?.notes,
    } as ShotCurated
  );
  await writeMetadata(scriptId, nextMeta);

  const list = await getShotList(scriptId);
  const row = list.scenes
    .find((s) => s.sceneOrd === ord)
    ?.shots.find((s) => s.shotIndex === nextIndex);
  if (!row) throw new Error("add succeeded but re-project failed");
  return row;
}

export async function removeShot(
  scriptId: string,
  ord: number,
  shotIndex: number
): Promise<void> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs = (ai.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
  if (!briefs[String(ord)] || !briefs[String(ord)][String(shotIndex)]) {
    throw new Error(`No brief at scene ${ord}, shot ${shotIndex}`);
  }
  const sceneBriefs = { ...briefs[String(ord)] };
  delete sceneBriefs[String(shotIndex)];
  let nextMeta = deepSet(meta, ["aiPrompts", "briefs", String(ord)], sceneBriefs);
  // Drop curated row + approval row too.
  const curated =
    ((nextMeta.aiPrompts as Record<string, unknown> | undefined)?.curated as
      | Record<string, Record<string, ShotCurated>>
      | undefined) ?? {};
  const sceneCurated = { ...(curated[String(ord)] ?? {}) };
  delete sceneCurated[String(shotIndex)];
  nextMeta = deepSet(nextMeta, ["aiPrompts", "curated", String(ord)], sceneCurated);
  const approval = buildApprovalMap(nextMeta);
  const k = approvalKey(ord, shotIndex);
  if (approval.shots[k]) {
    const shots = { ...approval.shots };
    delete shots[k];
    nextMeta = deepSet(nextMeta, ["shotListApproval"], {
      ...approval,
      shots,
      updatedAt: new Date().toISOString(),
    });
  }
  await writeMetadata(scriptId, nextMeta);
}

export async function duplicateShot(
  scriptId: string,
  ord: number,
  shotIndex: number
): Promise<ShotListRow> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs = (ai.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
  const prior = briefs[String(ord)]?.[String(shotIndex)];
  if (!prior) throw new Error(`No brief at scene ${ord}, shot ${shotIndex}`);
  const sceneBriefs = briefs[String(ord)] ?? {};
  const indices = Object.keys(sceneBriefs)
    .map((k) => parseInt(k, 10))
    .filter((n) => Number.isFinite(n));
  const nextIndex = indices.length > 0 ? Math.max(...indices) + 1 : 1;
  const clone = { ...prior, id: `SC${ord}_SH${nextIndex}`, shotIndex: nextIndex, userEdited: true };
  let nextMeta = deepSet(meta, ["aiPrompts", "briefs", String(ord), String(nextIndex)], clone);
  // Carry curated row.
  const curated = getCurated(script, ord, shotIndex);
  nextMeta = deepSet(
    nextMeta,
    ["aiPrompts", "curated", String(ord), String(nextIndex)],
    { ...curated, status: "draft" }
  );
  await writeMetadata(scriptId, nextMeta);
  const list = await getShotList(scriptId);
  const row = list.scenes
    .find((s) => s.sceneOrd === ord)
    ?.shots.find((s) => s.shotIndex === nextIndex);
  if (!row) throw new Error("duplicate succeeded but re-project failed");
  return row;
}

/** Reorder shots within a scene. `order` is the new shotIndex sequence
 *  (e.g. [2, 1, 3]). Shots are RENUMBERED to 1..N in the new order. */
export async function reorderShots(
  scriptId: string,
  ord: number,
  order: number[]
): Promise<void> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs = (ai.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
  const sceneBriefs = briefs[String(ord)] ?? {};
  const existing = new Set(
    Object.keys(sceneBriefs)
      .map((k) => parseInt(k, 10))
      .filter((n) => Number.isFinite(n))
  );
  for (const idx of order) {
    if (!existing.has(idx)) {
      throw new Error(`reorder: shot ${idx} doesn't exist in scene ${ord}`);
    }
  }
  if (order.length !== existing.size) {
    throw new Error(`reorder: order has ${order.length} entries, scene has ${existing.size} shots`);
  }
  const newSceneBriefs: Record<string, Record<string, unknown>> = {};
  const oldCurated =
    ((meta.aiPrompts as Record<string, unknown> | undefined)?.curated as
      | Record<string, Record<string, ShotCurated>>
      | undefined)?.[String(ord)] ?? {};
  const newCurated: Record<string, ShotCurated> = {};
  const approval = buildApprovalMap(meta);
  const newApprovalShots: Record<string, ShotApprovalRecord> = { ...approval.shots };
  // Clear scene's existing approvals first; we'll re-add at the new indices.
  for (const k of Object.keys(newApprovalShots)) {
    const [oOrdStr] = k.split("-");
    if (parseInt(oOrdStr, 10) === ord) delete newApprovalShots[k];
  }
  order.forEach((oldIdx, i) => {
    const newIdx = i + 1;
    const brief = { ...(sceneBriefs[String(oldIdx)] ?? {}) };
    brief.shotIndex = newIdx;
    brief.id = `SC${ord}_SH${newIdx}`;
    newSceneBriefs[String(newIdx)] = brief;
    if (oldCurated[String(oldIdx)]) newCurated[String(newIdx)] = oldCurated[String(oldIdx)];
    const oldApproval = approval.shots[approvalKey(ord, oldIdx)];
    if (oldApproval) newApprovalShots[approvalKey(ord, newIdx)] = oldApproval;
  });
  let nextMeta = deepSet(meta, ["aiPrompts", "briefs", String(ord)], newSceneBriefs);
  nextMeta = deepSet(nextMeta, ["aiPrompts", "curated", String(ord)], newCurated);
  nextMeta = deepSet(nextMeta, ["shotListApproval"], {
    ...approval,
    shots: newApprovalShots,
    updatedAt: new Date().toISOString(),
  });
  await writeMetadata(scriptId, nextMeta);
}

// ---------------------------------------------------------------------------
// Approvals
// ---------------------------------------------------------------------------

export async function approveShot(
  scriptId: string,
  ord: number,
  shotIndex: number,
  userId: string
): Promise<void> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const approval = buildApprovalMap(meta);
  const shots = { ...approval.shots };
  shots[approvalKey(ord, shotIndex)] = {
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  };
  // Also flip curated.status → "approved" for visibility.
  let nextMeta = deepSet(meta, ["shotListApproval"], {
    ...approval,
    shots,
    updatedAt: new Date().toISOString(),
  });
  const curated = getCurated(script, ord, shotIndex);
  nextMeta = deepSet(
    nextMeta,
    ["aiPrompts", "curated", String(ord), String(shotIndex)],
    { ...curated, status: "approved" as const }
  );
  await writeMetadata(scriptId, nextMeta);
}

export async function approveScene(
  scriptId: string,
  ord: number,
  userId: string
): Promise<void> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const approval = buildApprovalMap(meta);
  const scenes = { ...approval.scenes };
  scenes[String(ord)] = {
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  };
  const nextMeta = deepSet(meta, ["shotListApproval"], {
    ...approval,
    scenes,
    updatedAt: new Date().toISOString(),
  });
  await writeMetadata(scriptId, nextMeta);
}

export async function approveEpisode(
  scriptId: string,
  userId: string
): Promise<void> {
  const script = await loadScript(scriptId);
  const meta = script.metadata ?? {};
  const approval = buildApprovalMap(meta);
  const nextApproval: ShotListApproval = {
    ...approval,
    episode: { approvedAt: new Date().toISOString(), approvedBy: userId },
    updatedAt: new Date().toISOString(),
  };
  const nextMeta = deepSet(meta, ["shotListApproval"], nextApproval);
  await writeMetadata(scriptId, nextMeta);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function exportShotListMarkdown(list: ShotListResponse): string {
  const lines: string[] = [];
  const epLabel = list.episodeNumber
    ? `Episode ${list.episodeNumber}${list.episodeTitle ? `: ${list.episodeTitle}` : ""}`
    : list.scriptTitle ?? "Untitled";
  lines.push(`# Shot List — ${epLabel}`);
  lines.push("");
  lines.push(`*${list.policy.label} · ${list.policy.defaultAspectRatio} · ${list.policy.coverageDensity} coverage*`);
  lines.push("");
  lines.push(
    `*${list.approval.shotApprovedCount} of ${list.approval.shotTotalCount} shots approved · ${list.approval.sceneApprovedCount} of ${list.approval.sceneTotalCount} scenes approved · episode ${list.approval.episodeApprovedAt ? "APPROVED" : "draft"}*`
  );
  lines.push("");
  lines.push("---");
  for (const scene of list.scenes) {
    lines.push("");
    lines.push(
      `## Scene ${scene.sceneOrd} — ${scene.slugline}${scene.sceneApprovedAt ? " ✓" : ""}`
    );
    if (scene.summary) lines.push(`*${scene.summary}*`);
    lines.push("");
    for (const shot of scene.shots) {
      const approvedMark = shot.approvedAt ? "✓" : shot.curated.status === "needs_review" ? "?" : "·";
      lines.push(
        `### ${approvedMark} Shot ${shot.shotIndex} — ${shot.shotType || "(no shot type)"} (${shot.durationSec}s · ${shot.aspectRatio})`
      );
      if (shot.primaryImage) lines.push(`**Primary image.** ${shot.primaryImage}`);
      if (shot.cameraLanguage) lines.push(`**Camera.** ${shot.cameraLanguage}`);
      if (shot.action) lines.push(`**Action.** ${shot.action}`);
      if (shot.emotionalBeat) lines.push(`**Emotional beat.** ${shot.emotionalBeat}`);
      if (shot.visualMotif) lines.push(`**Visual motif.** ${shot.visualMotif}`);
      if (shot.characters.length > 0) lines.push(`**Characters.** ${shot.characters.join(", ")}`);
      if (shot.props.length > 0) lines.push(`**Props.** ${shot.props.join(", ")}`);
      if (shot.soundContext) {
        lines.push(`**Sound (approved).** Ambient: ${shot.soundContext.ambientBed}; music: ${shot.soundContext.nonDiegeticMusic}`);
      }
      lines.push(
        `*Mode: ${shot.curated.productionMode} · Status: ${shot.curated.status}${shot.aiModelHint ? ` · Model hint: ${shot.aiModelHint}` : ""}*`
      );
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function exportShotListCSV(list: ShotListResponse): string {
  const rows: string[][] = [];
  rows.push([
    "scene_ord",
    "slugline",
    "shot_index",
    "shot_type",
    "primary_image",
    "camera_language",
    "subject",
    "action",
    "emotional_beat",
    "visual_motif",
    "location",
    "characters",
    "props",
    "duration_sec",
    "aspect_ratio",
    "ai_model_hint",
    "production_mode",
    "status",
    "approved_at",
  ]);
  for (const scene of list.scenes) {
    for (const shot of scene.shots) {
      rows.push([
        String(scene.sceneOrd),
        scene.slugline,
        String(shot.shotIndex),
        shot.shotType,
        shot.primaryImage,
        shot.cameraLanguage,
        shot.subject,
        shot.action,
        shot.emotionalBeat,
        shot.visualMotif,
        shot.location,
        shot.characters.join("; "),
        shot.props.join("; "),
        String(shot.durationSec),
        shot.aspectRatio,
        shot.aiModelHint ?? "",
        shot.curated.productionMode,
        shot.curated.status,
        shot.approvedAt ?? "",
      ]);
    }
  }
  return rows
    .map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
}

export function exportShotListJSON(list: ShotListResponse): string {
  return JSON.stringify(list, null, 2);
}

/** Re-export for the production-mode union so route handlers can validate. */
export type { ShotProductionMode };
