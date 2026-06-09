// AI Production Queue — sync from approved creative artifacts.
//
// Reads (never writes):
//   • curated shot list (scripts.metadata.aiPrompts.briefs + .curated +
//     .shotListApproval)
//   • script_scenes (slugline / time_of_day / characters)
//   • character visual bibles (characters.metadata.visualBible)
//   • location + prop bibles (projects.metadata.{locationBibles,propBibles})
//   • sound bible (projects.metadata.soundBibles[episodeId])
//
// Writes only: an in-memory Queue object (caller persists via store.ts).

import { supabase } from "../db/client.js";
import { resolveProjectTypeConfig } from "@toburt/shared";
import { normalizeKey } from "../continuity/types.js";
import { getShotList } from "../shotList/store.js";
import { getSoundBible } from "../sound/store.js";
import { emptyQueue } from "./store.js";
import type {
  GenerationOutputReview,
  GenerationQueue,
  GenerationQueueItem,
  GenerationQueueStatus,
  ModelTarget,
  QueueReadinessCheck,
  ShotListResponse,
  ShotListRow,
} from "@toburt/shared";

// ---------------------------------------------------------------------------
// Bible loaders — read-only, mirrors how the composer resolves bibles.
// ---------------------------------------------------------------------------

interface CharacterRef {
  name: string;
  hasConsistencyPrompt: boolean;
  hasReferenceImage: boolean;
}

async function loadCharacterRefs(projectId: string): Promise<Map<string, CharacterRef>> {
  const m = new Map<string, CharacterRef>();
  const { data } = await supabase
    .from("characters")
    .select("name, metadata")
    .eq("project_id", projectId);
  for (const row of (data as Array<{ name: string; metadata: Record<string, unknown> | null }>) ?? []) {
    const meta = row.metadata ?? {};
    const vb = (meta.visualBible as Record<string, unknown> | undefined) ?? {};
    const cpV2 =
      typeof vb.characterConsistencyPrompt === "string" && (vb.characterConsistencyPrompt as string).trim()
        ? true
        : false;
    const cpV1 = (() => {
      const f = vb.fields as Record<string, unknown> | undefined;
      return f && typeof f.consistencyPrompt === "string" && (f.consistencyPrompt as string).trim() ? true : false;
    })();
    const urlV2 = typeof vb.referenceImageUrl === "string" && (vb.referenceImageUrl as string).trim() ? true : false;
    const urlApproved =
      typeof vb.approvedReferenceImageUrl === "string" && (vb.approvedReferenceImageUrl as string).trim() ? true : false;
    const urlV1 = (() => {
      const f = vb.fields as Record<string, unknown> | undefined;
      return f && typeof f.referenceImageUrl === "string" && (f.referenceImageUrl as string).trim() ? true : false;
    })();
    m.set(row.name.toLowerCase(), {
      name: row.name,
      hasConsistencyPrompt: cpV2 || cpV1,
      hasReferenceImage: urlApproved || urlV2 || urlV1,
    });
  }
  return m;
}

interface LocationLookup {
  byKey: Map<string, { name: string; approved: boolean }>;
}

async function loadLocationBibles(projectId: string): Promise<LocationLookup> {
  const { data } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  const locs = (meta.locationBibles as Record<string, { name?: string; approved?: boolean }> | undefined) ?? {};
  const byKey = new Map<string, { name: string; approved: boolean }>();
  for (const [k, v] of Object.entries(locs)) {
    byKey.set(k, { name: v?.name ?? k, approved: v?.approved === true });
  }
  return { byKey };
}

function locationMatch(
  lookup: LocationLookup,
  slugline: string
): { name: string; approved: boolean } | null {
  const norm = normalizeKey(slugline);
  if (!norm) return null;
  if (lookup.byKey.has(norm)) return lookup.byKey.get(norm)!;
  const slugWords = norm.split("_").filter(Boolean);
  for (const [k, v] of lookup.byKey) {
    const kWords = k.split("_").filter(Boolean);
    if (kWords.every((w) => slugWords.includes(w))) return v;
  }
  return null;
}

interface PropLookup {
  byKey: Map<string, { name: string; approved: boolean }>;
}

async function loadPropBibles(projectId: string): Promise<PropLookup> {
  const { data } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  const props = (meta.propBibles as Record<string, { name?: string; approved?: boolean }> | undefined) ?? {};
  const byKey = new Map<string, { name: string; approved: boolean }>();
  for (const [k, v] of Object.entries(props)) {
    byKey.set(k, { name: v?.name ?? k, approved: v?.approved === true });
  }
  return { byKey };
}

function propMatch(lookup: PropLookup, raw: string): { name: string; approved: boolean } | null {
  const norm = normalizeKey(raw);
  if (!norm) return null;
  if (lookup.byKey.has(norm)) return lookup.byKey.get(norm)!;
  for (const [k, v] of lookup.byKey) {
    if (k.includes(norm) || norm.includes(k) || v.name.toLowerCase().includes(raw.toLowerCase())) {
      return v;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Readiness — every check returns true OR contributes a blocker string.
// ---------------------------------------------------------------------------

interface BibleContext {
  characters: Map<string, CharacterRef>;
  locations: LocationLookup;
  props: PropLookup;
  soundScenes: Map<number, { approved: boolean; audioField: string | null; nonDiegeticMusic: string; ambientBed: string; keyDiegetic: string[] }>;
}

function computeReadiness(
  shot: ShotListRow,
  briefRow: Record<string, unknown> | undefined,
  ctx: BibleContext
): QueueReadinessCheck {
  const blockers: string[] = [];

  // 1) Brief approved at shot or scene or episode level.
  const approvedShotBrief = shot.approvedAt !== null;
  if (!approvedShotBrief) blockers.push("Shot brief is not approved.");

  // 2) Composed prompt text. The brief carries action/cameraLanguage etc.
  //    Treat "prompt generated" as: brief has a non-empty action or primaryImage.
  const promptText = composePromptText(shot, briefRow);
  const promptGenerated = promptText.trim().length > 0;
  if (!promptGenerated) blockers.push("Prompt text has not been generated for this shot.");

  // 3) Character refs: every named character on the shot must have at
  //    least a consistency prompt OR a reference image. Missing → blocker.
  let characterRefsReady = true;
  if (shot.characters.length > 0) {
    const missing: string[] = [];
    for (const c of shot.characters) {
      const ref = ctx.characters.get(c.toLowerCase());
      if (!ref || (!ref.hasConsistencyPrompt && !ref.hasReferenceImage)) missing.push(c);
    }
    if (missing.length) {
      characterRefsReady = false;
      blockers.push(`Visual bible missing for: ${missing.join(", ")}.`);
    }
  }

  // 4) Location bible: a location bible row must exist for the shot's
  //    slugline. We accept partial-word match (same as the composer).
  let locationBibleReady = true;
  const loc = locationMatch(ctx.locations, shot.location || "");
  if (!loc) {
    locationBibleReady = false;
    blockers.push("Location bible not found for this scene.");
  }

  // 5) Prop continuity: every prop on the shot must have a prop bible row.
  let propContinuityReady = true;
  if (shot.props.length > 0) {
    const missing: string[] = [];
    for (const p of shot.props) {
      if (!propMatch(ctx.props, p)) missing.push(p);
    }
    if (missing.length) {
      propContinuityReady = false;
      blockers.push(`Prop bible missing for: ${missing.join(", ")}.`);
    }
  }

  // 6) Sound notes: scene row must be approved (composer reads only
  //    approved). When the project has no sound bible yet we surface it
  //    as a missing piece rather than a hard blocker.
  let soundNotesReady = true;
  const sound = ctx.soundScenes.get(shot.sceneOrd);
  if (!sound) {
    soundNotesReady = false;
    blockers.push("Sound bible has no entry for this scene.");
  } else if (!sound.approved) {
    soundNotesReady = false;
    blockers.push("Sound bible scene row is not approved.");
  }

  return {
    approvedShotBrief,
    promptGenerated,
    characterRefsReady,
    locationBibleReady,
    propContinuityReady,
    soundNotesReady,
    blockers,
  };
}

function composePromptText(
  shot: ShotListRow,
  brief: Record<string, unknown> | undefined
): string {
  // We don't need to compose a perfect model prompt here — that's
  // composer.ts's job at handoff time. We just need a stable, non-empty
  // string that proves prompt material exists so readiness can pass.
  // Prefer brief-stored composed prompt when present.
  const composed = (brief?.composedPrompt as string | undefined) ?? null;
  if (composed && composed.trim()) return composed.trim();
  const bits: string[] = [];
  if (shot.primaryImage) bits.push(shot.primaryImage);
  if (shot.action) bits.push(shot.action);
  if (shot.cameraLanguage) bits.push(shot.cameraLanguage);
  if (shot.emotionalBeat) bits.push(shot.emotionalBeat);
  return bits.filter(Boolean).join(". ");
}

function deriveInitialStatus(readiness: QueueReadinessCheck): GenerationQueueStatus {
  return readiness.blockers.length === 0 ? "ready" : "not_ready";
}

// ---------------------------------------------------------------------------
// Sync — idempotent merge with the existing persisted queue.
//
// User-set fields (modelTarget, status, outputs, reviewNotes,
// retryInstruction, approvedOutputId) are preserved across syncs.
// Source-of-truth fields (shotDescription, characters, location, props,
// timeOfDay, aspectRatio, durationSec, promptText, soundNotes,
// readiness) are overwritten from the latest brief.
// ---------------------------------------------------------------------------

export interface SyncContext {
  projectId: string;
  episodeId: string;
  /** Optional override — when omitted, sync resolves the current script for
   *  the episode. */
  scriptId?: string;
}

export interface SyncResult {
  queue: GenerationQueue;
  shotList: ShotListResponse;
  policy: {
    projectType: string;
    defaultAspectRatio: string;
    defaultDurationSec: number;
    composerKey: string;
    isMicroDramaTier: boolean;
  };
}

async function resolveCurrentScriptId(
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

async function loadProjectType(projectId: string): Promise<string> {
  const { data } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  return (meta.projectType as string | undefined) ?? "prestige_series";
}

export async function syncQueueFromArtifacts(
  ctx: SyncContext,
  existing: GenerationQueue | null
): Promise<SyncResult> {
  const scriptId = ctx.scriptId ?? (await resolveCurrentScriptId(ctx.projectId, ctx.episodeId));
  if (!scriptId) {
    // No script yet — return an empty queue but keep the structure.
    const q = existing ?? emptyQueue(ctx.episodeId, "");
    const projectType = await loadProjectType(ctx.projectId);
    const cfg = resolveProjectTypeConfig(projectType);
    return {
      queue: { ...q, scriptId: "", lastSyncedAt: new Date().toISOString(), items: [] },
      shotList: {
        scriptId: "",
        scriptTitle: null,
        draftNumber: null,
        episodeId: ctx.episodeId,
        episodeNumber: null,
        episodeTitle: null,
        policy: {
          projectType,
          label: cfg.label,
          defaultAspectRatio: cfg.shotPolicy.defaultAspectRatio,
          defaultDurationSec: cfg.shotPolicy.defaultDurationSec,
          minDurationSec: cfg.shotPolicy.minDurationSec,
          maxDurationSec: cfg.shotPolicy.maxDurationSec,
          coverageDensity: cfg.shotPolicy.coverageDensity,
          composerKey: cfg.shotPolicy.composerKey,
          isMicroDramaTier: cfg.shotPolicy.isMicroDramaTier,
        },
        scenes: [],
        approval: {
          episodeApprovedAt: null,
          sceneApprovedCount: 0,
          sceneTotalCount: 0,
          shotApprovedCount: 0,
          shotTotalCount: 0,
        },
        scriptIsLocked: false,
      },
      policy: {
        projectType,
        defaultAspectRatio: cfg.shotPolicy.defaultAspectRatio,
        defaultDurationSec: cfg.shotPolicy.defaultDurationSec,
        composerKey: cfg.shotPolicy.composerKey,
        isMicroDramaTier: cfg.shotPolicy.isMicroDramaTier,
      },
    };
  }

  // Load every input. Parallelize the network-bound ones.
  const [shotList, characters, locations, props, soundBible, projectType, sceneRows, briefsContainer] =
    await Promise.all([
      getShotList(scriptId),
      loadCharacterRefs(ctx.projectId),
      loadLocationBibles(ctx.projectId),
      loadPropBibles(ctx.projectId),
      getSoundBible(ctx.projectId, ctx.episodeId),
      loadProjectType(ctx.projectId),
      loadSceneTimeOfDay(scriptId),
      loadRawBriefs(scriptId),
    ]);
  const cfg = resolveProjectTypeConfig(projectType);

  const soundScenes = new Map<
    number,
    { approved: boolean; audioField: string | null; nonDiegeticMusic: string; ambientBed: string; keyDiegetic: string[] }
  >();
  if (soundBible) {
    for (const s of Object.values(soundBible.scenes ?? {})) {
      soundScenes.set(s.ord, {
        approved: s.approvedAt !== null,
        audioField: s.aiVideoPromptAudioNotes ?? null,
        nonDiegeticMusic: s.nonDiegeticMusic ?? "",
        ambientBed: s.ambientBed ?? "",
        keyDiegetic: Array.isArray(s.keyDiegetic) ? s.keyDiegetic : [],
      });
    }
  }

  const bibleCtx: BibleContext = { characters, locations, props, soundScenes };

  // Existing items by id for user-field preservation.
  const prior = new Map<string, GenerationQueueItem>();
  for (const it of existing?.items ?? []) prior.set(it.id, it);

  const items: GenerationQueueItem[] = [];
  for (const scene of shotList.scenes) {
    const tod = sceneRows.get(scene.sceneOrd) ?? null;
    for (const shot of scene.shots) {
      const id = `${shot.sceneOrd}-${shot.shotIndex}`;
      const briefRow = briefsContainer.get(`${shot.sceneOrd}:${shot.shotIndex}`);
      const readiness = computeReadiness(shot, briefRow, bibleCtx);
      const sound = soundScenes.get(shot.sceneOrd);
      const priorItem = prior.get(id);

      const base: GenerationQueueItem = {
        id,
        episodeId: ctx.episodeId,
        scriptId,
        sceneOrd: shot.sceneOrd,
        shotIndex: shot.shotIndex,
        shotDescription: buildShotDescription(shot),
        characters: shot.characters,
        location: shot.location,
        props: shot.props,
        timeOfDay: tod,
        aspectRatio: shot.aspectRatio || cfg.shotPolicy.defaultAspectRatio,
        durationSec: shot.durationSec || cfg.shotPolicy.defaultDurationSec,
        promptText: composePromptText(shot, briefRow),
        promptHasModelHint: shot.aiModelHint,
        soundNotes:
          sound && sound.approved
            ? {
                ambientBed: sound.ambientBed,
                keyDiegetic: sound.keyDiegetic,
                nonDiegeticMusic: sound.nonDiegeticMusic,
                audioField: sound.audioField,
              }
            : null,
        continuityRequirements: {
          characters: shot.characters,
          location: shot.location || null,
          props: shot.props,
        },
        modelTarget: priorItem?.modelTarget ?? defaultModelTarget(cfg.shotPolicy.composerKey),
        status: priorItem
          ? reconcileStatus(priorItem.status, readiness)
          : deriveInitialStatus(readiness),
        reviewNotes: priorItem?.reviewNotes,
        retryInstruction: priorItem?.retryInstruction,
        outputs: priorItem?.outputs ?? [],
        approvedOutputId: priorItem?.approvedOutputId,
        readiness,
        briefApprovedAt: shot.approvedAt,
        createdAt: priorItem?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      items.push(base);
    }
  }

  const now = new Date().toISOString();
  const queue: GenerationQueue = {
    episodeId: ctx.episodeId,
    scriptId,
    items,
    lastSyncedAt: now,
    updatedAt: now,
  };

  return {
    queue,
    shotList,
    policy: {
      projectType,
      defaultAspectRatio: cfg.shotPolicy.defaultAspectRatio,
      defaultDurationSec: cfg.shotPolicy.defaultDurationSec,
      composerKey: cfg.shotPolicy.composerKey,
      isMicroDramaTier: cfg.shotPolicy.isMicroDramaTier,
    },
  };
}

function defaultModelTarget(composerKey: string): ModelTarget {
  // Micro-drama vertical pipelines do well on Veo/Kling; everything else
  // defaults to manual_external so the user is forced to pick before queueing.
  if (composerKey === "vertical_micro") return "veo";
  return "manual_external";
}

/** If the user previously approved/finalled a shot but the underlying brief
 *  has changed (so readiness now has blockers), demote to needs_review so
 *  the drift is visible. Otherwise preserve the user's last state. */
function reconcileStatus(
  prior: GenerationQueueStatus,
  readiness: QueueReadinessCheck
): GenerationQueueStatus {
  if (readiness.blockers.length > 0) {
    if (prior === "approved" || prior === "final") return "needs_review";
    if (prior === "ready" || prior === "queued") return "not_ready";
  } else {
    if (prior === "not_ready") return "ready";
  }
  return prior;
}

function buildShotDescription(shot: ShotListRow): string {
  const bits = [shot.shotType, shot.subject, shot.action].filter((s) => s && s.trim());
  if (bits.length === 0) return shot.primaryImage || `Shot ${shot.shotIndex + 1}`;
  return bits.join(" — ");
}

async function loadSceneTimeOfDay(scriptId: string): Promise<Map<number, string | null>> {
  const { data } = await supabase
    .from("script_scenes")
    .select("ord, time_of_day")
    .eq("script_id", scriptId);
  const m = new Map<number, string | null>();
  for (const r of (data as Array<{ ord: number; time_of_day: string | null }>) ?? []) {
    m.set(r.ord, r.time_of_day ?? null);
  }
  return m;
}

async function loadRawBriefs(
  scriptId: string
): Promise<Map<string, Record<string, unknown>>> {
  const { data } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .single();
  const meta = ((data as { metadata: Record<string, unknown> | null } | null)?.metadata as Record<
    string,
    unknown
  > | null) ?? {};
  const ai = (meta.aiPrompts as Record<string, unknown> | undefined) ?? {};
  const briefs =
    (ai.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
  const m = new Map<string, Record<string, unknown>>();
  for (const [ord, perScene] of Object.entries(briefs)) {
    for (const [idx, brief] of Object.entries(perScene)) {
      m.set(`${ord}:${idx}`, brief);
    }
  }
  return m;
}

// ---------------------------------------------------------------------------
// Output review helpers
// ---------------------------------------------------------------------------

export function createOutput(
  url: string,
  modelTarget: ModelTarget,
  opts: { versionLabel?: string; reviewNotes?: string; retryInstruction?: string }
): GenerationOutputReview {
  return {
    id: cryptoRandomId(),
    url,
    modelTarget,
    versionLabel: opts.versionLabel,
    status: "candidate",
    reviewNotes: opts.reviewNotes,
    retryInstruction: opts.retryInstruction,
    uploadedAt: new Date().toISOString(),
    uploadedBy: null,
  };
}

function cryptoRandomId(): string {
  // Small ULID-ish id. Avoids importing crypto.randomUUID for cross-runtime
  // safety. 12 chars of base36 from a 64-bit number is fine for our scale.
  const t = Date.now().toString(36);
  const r = Math.floor(Math.random() * 0xffffffff).toString(36);
  return `${t}_${r}`;
}
