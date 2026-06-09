// Top-level engine for the AI Video Model Router + Prompt Adapter system.
// Coordinates:
//   • building / reading the Master Shot Brief (immutable per shot)
//   • picking model profiles (defaults + per-project overrides)
//   • running the router (auto-select + reasoning + alternatives)
//   • running per-model adapters (versioned prompts)
//   • feedback intake
//
// Storage lives entirely under script.metadata.aiPrompts to avoid any new
// migrations. Shape:
//   script.metadata.aiPrompts = {
//     briefs: { [sceneOrd]: { [shotIndex]: MasterShotBrief } },
//     prompts: {
//       [sceneOrd]: {
//         [shotIndex]: {
//           [modelKey]: { current: PromptVersion; history: PromptVersion[] }
//         }
//       }
//     }
//   }
//
// project.metadata.modelProfileOverrides — { [modelKey]: Partial<ModelProfile> }

import { supabase } from "../../db/client.js";
import { loadResolvedCanon } from "../../departments/canonResolver.js";
import { adaptPrompt } from "./adapters.js";

/** Stages 7 (Blocking) + 8 (Cinematography) write per-shot textOverrides
 *  at canon paths shaped `shotBriefs.<sceneOrd>.<shotIndex>.<field>`.
 *  Surface those overrides onto the brief object before the composer
 *  reads it so what the Director and DP approved actually shows up in
 *  the generated prompt.
 *
 *  Two special fields carry comprehensive briefs:
 *    - `directorBrief` — full blocking brief (start/end/path/eyeline/
 *      prop handling/performance beat). Surfaced as the brief's
 *      `directorBrief` so the composer can inject it verbatim.
 *    - `dpBrief` — full DP brief (aspect ratio, framing, lens, position,
 *      movement, focus, lighting, out-of-frame). Same pattern. */
async function applyShotCanonOverrides(args: {
  brief: Record<string, unknown>;
  projectId: string;
  sceneOrd: number;
  shotIndex: number;
}): Promise<Record<string, unknown>> {
  const canon = await loadResolvedCanon(args.projectId);
  const prefix = `shotBriefs.${args.sceneOrd}.${args.shotIndex}.`;
  const patched: Record<string, unknown> = { ...args.brief };
  for (const [path, override] of canon.textOverrides) {
    if (!path.startsWith(prefix)) continue;
    const field = path.slice(prefix.length);
    if (!field || field.includes(".")) continue;
    if (override.value && override.value.trim()) {
      patched[field] = override.value.trim();
    }
  }
  return patched;
}
import {
  ALL_MODEL_KEYS,
  DEFAULT_MODEL_PROFILES,
  effectiveProfiles,
} from "./modelProfiles.js";
import { routeModel } from "./router.js";
import { getProductionRules, setProductionRules } from "./productionRules.js";
import { runQualityGate } from "./qualityGate.js";
import {
  autoBuildSceneBriefs,
  regenerateOneBrief as regenerateOneBriefImpl,
  type AutoBuildOptions,
  type AutoBuildReport,
  type RegenerateOneBriefResult,
} from "./autoBuild.js";
import {
  createProductionResult,
  updateProductionResult,
  listProductionResults,
  deleteProductionResult,
} from "./results.js";
import type {
  FeedbackTag,
  MasterShotBrief,
  ModelKey,
  ModelProfile,
  ProductionResult,
  PromptFeedback,
  PromptVersion,
  QualityCategory,
  QualityGateResult,
  RouterResult,
  VisualWeight,
  ShotTag,
} from "./types.js";

type Meta = Record<string, unknown>;

const safeMeta = (m: unknown): Meta => ((m ?? {}) as Meta);

function readBriefs(
  meta: Meta
): Record<number, Record<number, MasterShotBrief>> {
  const ai = safeMeta(meta.aiPrompts);
  return ((ai.briefs as Record<number, Record<number, MasterShotBrief>>) ?? {}) as Record<
    number,
    Record<number, MasterShotBrief>
  >;
}

function readPrompts(
  meta: Meta
): Record<
  number,
  Record<number, Partial<Record<ModelKey, { current: PromptVersion; history: PromptVersion[] }>>>
> {
  const ai = safeMeta(meta.aiPrompts);
  return ((ai.prompts as Record<
    number,
    Record<
      number,
      Partial<Record<ModelKey, { current: PromptVersion; history: PromptVersion[] }>>
    >
  >) ?? {}) as Record<
    number,
    Record<number, Partial<Record<ModelKey, { current: PromptVersion; history: PromptVersion[] }>>>
  >;
}

/**
 * Visual Bible cast library — keyed by uppercased character name. Built
 * once per prompt generation; consumed by the composer to lock visual
 * identity across every shot a character appears in.
 */
async function loadCastVisualBible(projectId: string): Promise<
  Map<
    string,
    {
      consistencyPrompt?: string;
      referenceImageUrl?: string | null;
      // V3.1 — the approved canonical image; preferred over the candidate
      // referenceImageUrl when threading into image-to-video prompts.
      approvedReferenceImageUrl?: string | null;
      referencePlatform?: string | null;
      klingElementId?: string | null;
      klingElementName?: string | null;
      klingReferenceImages?: Array<{ url: string; angle?: string; label?: string }>;
      // Stage-2 — per-episode wardrobe / HMU. When set and the brief
      // carries an episodeNumber, the composer prefers these blocks over
      // the flat `wardrobe` / `characterConsistencyPrompt` text.
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
      presenceType?: string;
    }
  >
> {
  const { data, error } = await supabase
    .from("characters")
    .select("name, metadata")
    .eq("project_id", projectId);
  const m = new Map<
    string,
    {
      consistencyPrompt?: string;
      referenceImageUrl?: string | null;
      approvedReferenceImageUrl?: string | null;
      referencePlatform?: string | null;
      klingElementId?: string | null;
      klingElementName?: string | null;
      klingReferenceImages?: Array<{ url: string; angle?: string; label?: string }>;
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
      presenceType?: string;
    }
  >();
  if (error || !data) return m;
  for (const row of data) {
    const vb = (row.metadata as Record<string, unknown> | null)?.visualBible as
      | {
          // V2 (flat shape):
          characterConsistencyPrompt?: unknown;
          referenceImageUrl?: unknown;
          // V1 (nested under .fields):
          fields?: { consistencyPrompt?: unknown; referenceImageUrl?: unknown };
          // V3.1
          approvedReferenceImageUrl?: unknown;
          referencePlatform?: unknown;
          klingElementId?: unknown;
          klingElementName?: unknown;
          klingReferenceImages?: unknown;
        }
      | undefined;
    if (!vb) continue;
    // Prefer V2 keys; fall back to V1 keys during migration.
    const cpV2 = typeof vb.characterConsistencyPrompt === "string" && vb.characterConsistencyPrompt.trim()
      ? vb.characterConsistencyPrompt.trim()
      : undefined;
    const cpV1 = typeof vb.fields?.consistencyPrompt === "string" && vb.fields.consistencyPrompt.trim()
      ? vb.fields.consistencyPrompt.trim()
      : undefined;
    const consistencyPrompt = cpV2 ?? cpV1;
    const urlV2 = typeof vb.referenceImageUrl === "string" && vb.referenceImageUrl.trim()
      ? vb.referenceImageUrl.trim()
      : null;
    const urlV1 = typeof vb.fields?.referenceImageUrl === "string" && vb.fields.referenceImageUrl.trim()
      ? vb.fields.referenceImageUrl.trim()
      : null;
    const referenceImageUrl = urlV2 ?? urlV1;
    const approvedReferenceImageUrl =
      typeof vb.approvedReferenceImageUrl === "string" && vb.approvedReferenceImageUrl.trim()
        ? vb.approvedReferenceImageUrl.trim()
        : null;
    const referencePlatform =
      typeof vb.referencePlatform === "string" && vb.referencePlatform.trim()
        ? vb.referencePlatform.trim()
        : null;
    const klingElementId =
      typeof vb.klingElementId === "string" && vb.klingElementId.trim()
        ? vb.klingElementId.trim()
        : null;
    const klingElementName =
      typeof vb.klingElementName === "string" && vb.klingElementName.trim()
        ? vb.klingElementName.trim()
        : null;
    const klingReferenceImages = Array.isArray(vb.klingReferenceImages)
      ? (vb.klingReferenceImages as Array<{ url?: unknown; angle?: unknown; label?: unknown }>)
          .map((r) => ({
            url: typeof r.url === "string" ? r.url.trim() : "",
            angle: typeof r.angle === "string" ? r.angle.trim() : undefined,
            label: typeof r.label === "string" ? r.label.trim() : undefined,
          }))
          .filter((r) => r.url.length > 0)
      : [];
    const rawVb = vb as unknown as {
      wardrobeByEpisode?: unknown;
      hmuByEpisode?: unknown;
      presenceType?: unknown;
    };
    const wardrobeByEpisode =
      rawVb.wardrobeByEpisode && typeof rawVb.wardrobeByEpisode === "object"
        ? (rawVb.wardrobeByEpisode as Record<string, Record<string, unknown>>)
        : undefined;
    const hmuByEpisode =
      rawVb.hmuByEpisode && typeof rawVb.hmuByEpisode === "object"
        ? (rawVb.hmuByEpisode as Record<string, Record<string, unknown>>)
        : undefined;
    const presenceType =
      typeof rawVb.presenceType === "string" ? rawVb.presenceType : undefined;
    if (
      !consistencyPrompt &&
      !referenceImageUrl &&
      !approvedReferenceImageUrl &&
      !klingElementId &&
      klingReferenceImages.length === 0 &&
      !wardrobeByEpisode &&
      !hmuByEpisode
    ) {
      continue;
    }
    m.set(String(row.name).toUpperCase(), {
      consistencyPrompt,
      referenceImageUrl,
      approvedReferenceImageUrl,
      referencePlatform,
      klingElementId,
      klingElementName,
      klingReferenceImages,
      wardrobeByEpisode: wardrobeByEpisode as
        | Record<
            string,
            {
              top?: string;
              bottom?: string;
              accessories?: string;
              footwear?: string;
              forbidden?: string[];
            }
          >
        | undefined,
      hmuByEpisode: hmuByEpisode as
        | Record<
            string,
            {
              hairCondition?: string;
              makeupState?: string;
              faceMarks?: string;
              forbidden?: string[];
            }
          >
        | undefined,
      presenceType,
    });
  }
  return m;
}

async function loadScriptCtx(scriptId: string): Promise<{
  scriptId: string;
  projectId: string;
  metadata: Meta;
  projectTitle: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  projectOverrides?: Partial<Record<ModelKey, Partial<ModelProfile>>>;
}> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("project_id, episode_id, metadata")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  // Defensive read — `projects.metadata` was added by migration 0012; if it
  // hasn't been applied yet we fall back to the title-only query so the
  // panel still works (overrides simply won't be available).
  let proj: { title: string; metadata?: unknown } | null = null;
  try {
    const r = await supabase
      .from("projects")
      .select("title, metadata")
      .eq("id", script.project_id)
      .maybeSingle();
    proj = (r.data as { title: string; metadata?: unknown } | null) ?? null;
  } catch {
    const r = await supabase
      .from("projects")
      .select("title")
      .eq("id", script.project_id)
      .maybeSingle();
    proj = (r.data as { title: string } | null) ?? null;
  }
  let episodeNumber: number | null = null;
  let episodeTitle: string | null = null;
  if (script.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number, title, title_status")
      .eq("id", script.episode_id)
      .maybeSingle();
    if (ep) {
      episodeNumber = ep.number as number;
      // Episode title only shows when approved (per the title-page rules).
      episodeTitle = ep.title_status === "approved" ? ((ep.title as string) ?? null) : null;
    }
  }
  const projectOverrides = (
    (safeMeta(proj?.metadata).modelProfileOverrides ?? {}) as Partial<
      Record<ModelKey, Partial<ModelProfile>>
    >
  );
  return {
    scriptId,
    projectId: script.project_id as string,
    metadata: safeMeta(script.metadata),
    projectTitle: (proj?.title as string) ?? "Untitled",
    episodeNumber,
    episodeTitle,
    projectOverrides,
  };
}

async function persistMeta(scriptId: string, meta: Meta): Promise<void> {
  await supabase.from("scripts").update({ metadata: meta }).eq("id", scriptId);
}

function briefId(args: {
  projectTitle: string;
  episodeNumber: number | null;
  sceneOrd: number;
  shotIndex: number;
}): string {
  const series = args.projectTitle
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  const ep = args.episodeNumber ? `EP${args.episodeNumber}_` : "";
  return `${series}_${ep}SC${String(args.sceneOrd).padStart(2, "0")}_SH${String(args.shotIndex).padStart(2, "0")}`;
}

export interface CreateBriefArgs {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  /** Partial fields the writer supplied; the engine fills sensible defaults. */
  fields: Partial<MasterShotBrief>;
}

/**
 * Create / replace a Master Shot Brief for (scene, shot). Pulls scene +
 * character context from the database so the writer can hand us minimal
 * input. Existing brief versions are overwritten — there's only one current
 * brief per shot.
 */
export async function setMasterShotBrief(args: CreateBriefArgs): Promise<MasterShotBrief> {
  const ctx = await loadScriptCtx(args.scriptId);
  const { data: scene } = await supabase
    .from("script_scenes")
    .select("slugline, fountain, time_of_day, int_ext, tags")
    .eq("script_id", args.scriptId)
    .eq("ord", args.sceneOrd)
    .maybeSingle();
  const slug = (scene?.slugline as string) ?? `SCENE ${args.sceneOrd}`;
  const time = (scene?.time_of_day as string) ?? "DAY";
  // Character cast — names from the scene tags, descriptions from the
  // character bible / DNA where available.
  const sceneCharNames: string[] = Array.isArray(scene?.tags)
    ? ((scene!.tags as unknown[]).filter((x): x is string => typeof x === "string"))
    : [];
  const { data: bibleChars } = await supabase
    .from("characters")
    .select("name, biography, voice_notes, metadata")
    .eq("project_id", ctx.projectId);
  const briefChars = sceneCharNames.map((name) => {
    const bib = (bibleChars ?? []).find(
      (c) => (c.name as string).toUpperCase() === name.toUpperCase()
    );
    const dna = (
      (bib?.metadata as Record<string, unknown>)?.dna as
        | Record<string, unknown>
        | undefined
    ) ?? {};
    const description =
      ((dna.public_mask as string) ??
        (bib?.biography as string) ??
        "").slice(0, 160);
    return { name, description };
  });

  const now = new Date().toISOString();
  const id = briefId({
    projectTitle: ctx.projectTitle,
    episodeNumber: ctx.episodeNumber,
    sceneOrd: args.sceneOrd,
    shotIndex: args.shotIndex,
  });

  // Preserve provenance flags from any existing brief so a writer edit on
  // top of an auto-generated brief flips userEdited=true (subsequent
  // Auto-build runs will then require explicit confirmation to overwrite).
  const briefsExisting = readBriefs(ctx.metadata);
  const prior = briefsExisting[args.sceneOrd]?.[args.shotIndex];
  const wasAuto = prior?.autoGenerated ?? false;
  const wasEdited = prior?.userEdited ?? false;

  const brief: MasterShotBrief = {
    id,
    projectTitle: ctx.projectTitle,
    episodeNumber: ctx.episodeNumber,
    episodeTitle: ctx.episodeTitle,
    sceneOrd: args.sceneOrd,
    shotIndex: args.shotIndex,
    primaryImage: args.fields.primaryImage ?? prior?.primaryImage,
    shotPurpose: args.fields.shotPurpose ?? "(define the shot purpose)",
    storyBeat: args.fields.storyBeat ?? "",
    emotionalBeat: args.fields.emotionalBeat ?? "",
    characters: args.fields.characters ?? briefChars,
    location: args.fields.location ?? slug,
    timeOfDay: args.fields.timeOfDay ?? time,
    lighting: args.fields.lighting ?? "",
    colorPalette: args.fields.colorPalette ?? "",
    cameraFraming: args.fields.cameraFraming ?? "MS",
    lensSuggestion: args.fields.lensSuggestion ?? "35mm",
    cameraMovement: args.fields.cameraMovement ?? "static",
    action: args.fields.action ?? "",
    performanceDirection: args.fields.performanceDirection,
    dialogue: args.fields.dialogue,
    continuityNotes: args.fields.continuityNotes,
    props: args.fields.props,
    productionDesign: args.fields.productionDesign,
    visualMotif: args.fields.visualMotif,
    aspectRatio: args.fields.aspectRatio ?? "16:9",
    durationSec: args.fields.durationSec ?? 8,
    outputType: args.fields.outputType ?? "video",
    safetyNotes: args.fields.safetyNotes,
    referenceAssets: args.fields.referenceAssets,
    shotTags: args.fields.shotTags ?? prior?.shotTags,
    visualWeight: args.fields.visualWeight ?? prior?.visualWeight,
    longerDurationApproved:
      args.fields.longerDurationApproved ?? prior?.longerDurationApproved,
    autoGenerated: wasAuto,
    // Any writer-driven save flips userEdited true. (Auto-build writes via
    // autoBuildSceneBriefs, NOT through this code path, so it doesn't trigger.)
    userEdited: true || wasEdited,
    createdAt: prior?.createdAt ?? now,
    updatedAt: now,
  };

  const meta = { ...ctx.metadata };
  const ai = { ...(safeMeta(meta.aiPrompts)) };
  const briefs = readBriefs(meta);
  briefs[args.sceneOrd] = briefs[args.sceneOrd] ?? {};
  briefs[args.sceneOrd][args.shotIndex] = brief;
  ai.briefs = briefs;
  meta.aiPrompts = ai;
  await persistMeta(args.scriptId, meta);
  return brief;
}

/** Read all briefs for a script (for the panel). */
export async function listMasterBriefs(scriptId: string): Promise<MasterShotBrief[]> {
  const ctx = await loadScriptCtx(scriptId);
  const briefs = readBriefs(ctx.metadata);
  const out: MasterShotBrief[] = [];
  for (const [, byShot] of Object.entries(briefs)) {
    for (const [, brief] of Object.entries(byShot)) {
      out.push(brief);
    }
  }
  return out.sort((a, b) =>
    a.sceneOrd !== b.sceneOrd ? a.sceneOrd - b.sceneOrd : a.shotIndex - b.shotIndex
  );
}

/** Run the router on a stored brief and return the recommendation. */
export async function recommendModelForBrief(
  scriptId: string,
  sceneOrd: number,
  shotIndex: number
): Promise<RouterResult> {
  const ctx = await loadScriptCtx(scriptId);
  const briefs = readBriefs(ctx.metadata);
  const brief = briefs[sceneOrd]?.[shotIndex];
  if (!brief) throw new Error("Brief not found — create the Master Shot Brief first.");
  const profiles = effectiveProfiles(ctx.projectOverrides);
  const rules = await getProductionRules(ctx.projectId);
  return routeModel(brief, profiles, rules);
}

function aggregateFeedback(
  history: PromptVersion[],
  current?: PromptVersion
): FeedbackTag[] {
  const tags = new Set<FeedbackTag>();
  const all = current ? [current, ...history] : history;
  for (const v of all) {
    for (const t of v.feedback?.tags ?? []) tags.add(t);
  }
  return [...tags];
}

/**
 * Generate (or regenerate) a prompt for a (brief, model). Bumps the version
 * number; keeps history. The brief is never mutated.
 */
export async function generatePromptForModel(args: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  model: ModelKey;
  notes?: string;
}): Promise<PromptVersion> {
  const ctx = await loadScriptCtx(args.scriptId);
  const briefs = readBriefs(ctx.metadata);
  let brief = briefs[args.sceneOrd]?.[args.shotIndex];
  if (!brief) throw new Error("Brief not found — create the Master Shot Brief first.");
  // Workflow Stages 7 + 8 — apply per-shot canon overrides for the
  // Director's blocking decisions and the DP's framing decisions.
  // Approvals on these stages write textOverrides at paths like
  // shotBriefs.<sceneOrd>.<shotIndex>.<field>; we surface them here so
  // the prompt visibly bakes in what the Director/DP approved.
  brief = await applyShotCanonOverrides({
    brief: brief as Record<string, unknown>,
    projectId: ctx.projectId,
    sceneOrd: args.sceneOrd,
    shotIndex: args.shotIndex,
  }) as typeof brief;
  const profile = effectiveProfiles(ctx.projectOverrides)[args.model];

  const meta = { ...ctx.metadata };
  const ai = { ...(safeMeta(meta.aiPrompts)) };
  const prompts = readPrompts(meta);
  prompts[args.sceneOrd] = prompts[args.sceneOrd] ?? {};
  prompts[args.sceneOrd][args.shotIndex] = prompts[args.sceneOrd][args.shotIndex] ?? {};
  const slot = prompts[args.sceneOrd][args.shotIndex][args.model];

  const priorFeedback = slot
    ? aggregateFeedback(slot.history ?? [], slot.current)
    : [];
  const nextVersion = slot
    ? (parseInt(slot.current.versionId.replace(/[^0-9]/g, ""), 10) || 0) + 1
    : 1;

  const productionRules = await getProductionRules(ctx.projectId);
  const castLibrary = await loadCastVisualBible(ctx.projectId);
  // V3.4 — Resolve continuity for this shot. Pulls the Location Bible by
  // scene slugline + any matching Prop Bibles for props referenced in
  // brief.props. The directive is the verbatim system-prompt block; the
  // composer injects it without paraphrasing.
  const { resolveShotContinuity, buildContinuityDirective, buildVisibleCanonBlock } = await import(
    "../../continuity/loader.js"
  );
  const { data: sceneRow } = await supabase
    .from("script_scenes")
    .select("slugline")
    .eq("script_id", args.scriptId)
    .eq("ord", args.sceneOrd)
    .maybeSingle();
  const continuity = await resolveShotContinuity(
    ctx.projectId,
    (sceneRow?.slugline as string | undefined) ?? null,
    (brief.props ?? []) as string[]
  );
  // V4.4 — pass view-zone metadata so the directive is scoped to what
  // the lens actually sees on THIS shot, plus an explicit
  // FORBIDDEN-IN-FRAME block.
  const continuityDirective = buildContinuityDirective(continuity, {
    cameraViewZone: brief.cameraViewZone,
    visibleSetElements: brief.visibleSetElements,
    forbiddenSetElements: brief.forbiddenSetElements,
    characterStartPosition: brief.characterStartPosition,
    characterEndPosition: brief.characterEndPosition,
    movementPath: brief.movementPath,
    eyelineTarget: brief.eyelineTarget,
    propPositions: brief.propPositions,
    lightingContinuity: brief.lightingContinuity,
  });
  // V4.7 — Visible Canon block. Per-visible-element approved descriptors
  // + a requirements list the readiness gate uses to enforce that each
  // visible element actually surfaces.
  //
  // Note: we pass the project's FULL prop bibles here, not the brief-
  // filtered list. The brief-filtered list is anchored on
  // brief.props[] which is often empty (the writer didn't list every
  // visible object as a "prop"). The Visible Canon builder filters by
  // visibleSetElements directly, which is the authoritative signal for
  // "what's in this frame".
  const { data: projForCanon } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", ctx.projectId)
    .maybeSingle();
  const allProps = Object.values(
    ((projForCanon?.metadata as Record<string, unknown> | null)?.propBibles ?? {}) as Record<
      string,
      unknown
    >
  ) as Array<{ name: string; [k: string]: unknown }>;
  const visibleCanon = buildVisibleCanonBlock({
    visibleSetElements: brief.visibleSetElements ?? [],
    forbiddenSetElements: brief.forbiddenSetElements,
    location: continuity.location,
    props: allProps as Parameters<typeof buildVisibleCanonBlock>[0]["props"],
    characters: (brief.characters ?? []).map((c) => {
      const lib = castLibrary?.get(c.name.toUpperCase());
      return {
        name: c.name,
        presenceType: lib?.presenceType,
        wardrobeByEpisode: lib?.wardrobeByEpisode,
        hmuByEpisode: lib?.hmuByEpisode,
        consistencyPrompt: lib?.consistencyPrompt,
      };
    }),
    episodeNumber: brief.episodeNumber ?? null,
  });
  // Concatenate the visible canon block onto the continuity directive so
  // the composer's existing system-prompt assembly picks it up unchanged.
  let continuityWithVisible = visibleCanon.block
    ? `${continuityDirective}\n${visibleCanon.block}`
    : continuityDirective;
  // Stages 7 + 8 — when the Director / DP have approved a per-shot
  // brief, inject it as an AUTHORITATIVE directive the composer can't
  // ignore. These read verbatim from canon textOverrides and carry the
  // full structured brief (start/end/eyeline; aspect/lens/lighting/etc.).
  const directorBrief = (brief as Record<string, unknown>).directorBrief as string | undefined;
  if (directorBrief && directorBrief.trim()) {
    continuityWithVisible =
      `${continuityWithVisible}\n\n[DIRECTOR'S BLOCKING BRIEF — APPROVED CANON, OBEY VERBATIM]\n${directorBrief.trim()}`;
  }
  const dpBrief = (brief as Record<string, unknown>).dpBrief as string | undefined;
  if (dpBrief && dpBrief.trim()) {
    continuityWithVisible =
      `${continuityWithVisible}\n\n[DP BRIEF — APPROVED CANON, OBEY VERBATIM]\n${dpBrief.trim()}`;
  }
  // Sound Bible — composer injection, GATED ON APPROVAL.
  //
  // The Sound Bible lives in projects.metadata.soundBibles[episodeId]
  // and is owned by the new "sound" department. The composer reads ONLY
  // approved per-scene rows (and only an approved episodeSoundIdentity).
  // Unapproved rows / drafts do NOT influence prompts — the build plan's
  // "approval gate before AI prompt injection" requirement is enforced
  // here at the single read point. Zero regression for projects that
  // haven't built a Sound Bible yet — the directive is empty.
  try {
    const { buildSoundDirective } = await import("../../sound/composerDirective.js");
    const { getSoundBible } = await import("../../sound/store.js");
    // Resolve which episodeId this script belongs to (some legacy scripts
    // have episode_id=null; in that case the SoundBible is empty and the
    // builder returns empty strings).
    const { data: scriptForEp } = await supabase
      .from("scripts")
      .select("episode_id")
      .eq("id", args.scriptId)
      .maybeSingle();
    const episodeId = (scriptForEp?.episode_id as string | null) ?? null;
    if (episodeId) {
      const bible = await getSoundBible(ctx.projectId, episodeId);
      const sd = buildSoundDirective({
        bible,
        sceneOrd: args.sceneOrd,
        // First-shot detection: scene ord 1 + shot index 0/1 is the
        // canonical "first shot of the episode". We use a simple heuristic
        // so the preamble only fires once per episode.
        isFirstShotOfEpisode: args.sceneOrd === 1 && args.shotIndex <= 1,
      });
      if (sd.episodePreamble) {
        continuityWithVisible = `${continuityWithVisible}\n\n${sd.episodePreamble}`;
      }
      if (sd.shotBlock) {
        continuityWithVisible = `${continuityWithVisible}\n\n${sd.shotBlock}`;
      }
      // Veo / Kling audio-field hook — attach the approved audio note onto
      // the brief so the model-specific adapter can route it into the
      // platform's audio field. Unapproved scenes never touch this.
      if (sd.audioField) {
        (brief as Record<string, unknown>).soundAudioField = sd.audioField;
      }
    }
  } catch (err) {
    // Soft fail — sound canon is additive; if anything errors here we
    // log and keep the existing prompts unchanged.
    // eslint-disable-next-line no-console
    console.warn("[aiPrompts] Sound Bible injection skipped:", (err as Error).message);
  }
  // Stage 4 — collect approved canon references that touch this shot's
  // bibles, so the composer's referenceMetadata.canonReferences[] picks
  // them up. Each reference is an approved image / URL / color attached
  // to a bible field path (e.g. bedDesign, comforterColor).
  const sceneLocKey = sceneRow?.slugline
    ? (await import("../../continuity/types.js")).normalizeKey(sceneRow.slugline as string)
    : null;
  const canonReferencesForShot = (continuity.canon?.references ?? []).filter((r) => {
    if (sceneLocKey && r.fieldPath.startsWith(`locationBibles.${sceneLocKey}.`)) return true;
    if (r.fieldPath.startsWith("propBibles.")) {
      // Only include props that ACTUALLY surface in this brief's
      // visibleSetElements (avoids dumping every approved prop image
      // into every prompt).
      const visibleRaw = (brief.visibleSetElements ?? []).join(" ").toLowerCase();
      const propKey = r.fieldPath.split(".")[1] ?? "";
      const propWords = propKey
        .split("_")
        .filter((w) => w.length >= 4)
        .map((w) => w.toLowerCase());
      return propWords.some((w) => visibleRaw.includes(w));
    }
    if (r.fieldPath.startsWith("characters.")) {
      // Char references only if that character is in this brief.
      const charName = (brief.characters ?? [])
        .map((c) => c.name.toLowerCase())
        .join(" ");
      return r.fieldPath.toLowerCase().includes(charName.split(" ")[0] ?? "");
    }
    return false;
  });

  const version = await adaptPrompt({
    brief,
    model: args.model,
    profile,
    priorFeedback,
    notes: args.notes,
    versionNumber: nextVersion,
    productionRules,
    castLibrary,
    continuityDirective: continuityWithVisible,
    visibleCanonRequirements: visibleCanon.requirements,
    canonReferences: canonReferencesForShot,
  });

  const history = slot ? [slot.current, ...(slot.history ?? [])].slice(0, 9) : [];
  // Preserve any writer-set per-slot flags across regenerations. klingVariant
  // is set by the UI's Kling v2.5 / v3.0 dropdown; without this carry-forward
  // it silently reverts to the default on every Regenerate click.
  const carry: Partial<Record<string, unknown>> = {};
  const priorKV = (slot?.current as unknown as { klingVariant?: string } | undefined)
    ?.klingVariant;
  if (priorKV) carry.klingVariant = priorKV;
  prompts[args.sceneOrd][args.shotIndex][args.model] = {
    current: { ...version, ...carry } as typeof version,
    history,
  };
  ai.prompts = prompts;
  meta.aiPrompts = ai;
  await persistMeta(args.scriptId, meta);
  return version;
}

/** Generate prompts for ALL supported models (handy for the comparison view). */
export async function generatePromptsForAllModels(args: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  notes?: string;
  /** Skip these (e.g. "custom" until configured). */
  exclude?: ModelKey[];
}): Promise<PromptVersion[]> {
  const out: PromptVersion[] = [];
  const skip = new Set(args.exclude ?? ["custom"]);
  for (const model of ALL_MODEL_KEYS) {
    if (skip.has(model)) continue;
    out.push(
      await generatePromptForModel({
        scriptId: args.scriptId,
        sceneOrd: args.sceneOrd,
        shotIndex: args.shotIndex,
        model,
        notes: args.notes,
      })
    );
  }
  return out;
}

/** Read every persisted prompt for a script — backing the comparison view. */
export async function listPrompts(scriptId: string): Promise<
  Array<{
    sceneOrd: number;
    shotIndex: number;
    model: ModelKey;
    current: PromptVersion;
    history: PromptVersion[];
  }>
> {
  const ctx = await loadScriptCtx(scriptId);
  const prompts = readPrompts(ctx.metadata);
  const out: Array<{
    sceneOrd: number;
    shotIndex: number;
    model: ModelKey;
    current: PromptVersion;
    history: PromptVersion[];
  }> = [];
  for (const [sceneOrdStr, byShot] of Object.entries(prompts)) {
    for (const [shotIdxStr, byModel] of Object.entries(byShot)) {
      for (const [model, slot] of Object.entries(byModel)) {
        if (!slot) continue;
        out.push({
          sceneOrd: parseInt(sceneOrdStr, 10),
          shotIndex: parseInt(shotIdxStr, 10),
          model: model as ModelKey,
          current: slot.current,
          history: slot.history ?? [],
        });
      }
    }
  }
  return out;
}

/**
 * Attach writer feedback to the current prompt version. Feedback influences
 * future prompt regenerations for that (model, project).
 */
export async function setPromptFeedback(args: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  model: ModelKey;
  feedback: Partial<PromptFeedback>;
}): Promise<PromptVersion> {
  const ctx = await loadScriptCtx(args.scriptId);
  const meta = { ...ctx.metadata };
  const prompts = readPrompts(meta);
  const slot = prompts[args.sceneOrd]?.[args.shotIndex]?.[args.model];
  if (!slot) throw new Error("No prompt to attach feedback to.");
  slot.current.feedback = {
    tags: args.feedback.tags ?? [],
    comment: args.feedback.comment,
    resultLink: args.feedback.resultLink,
    taggedAt: new Date().toISOString(),
  };
  slot.current.updatedAt = new Date().toISOString();
  prompts[args.sceneOrd][args.shotIndex][args.model] = slot;
  const ai = { ...(safeMeta(meta.aiPrompts)) };
  ai.prompts = prompts;
  meta.aiPrompts = ai;
  await persistMeta(args.scriptId, meta);
  return slot.current;
}

/** The writer marks a specific prompt version approved for use. */
export async function approvePrompt(args: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  model: ModelKey;
  approved: boolean;
}): Promise<PromptVersion> {
  const ctx = await loadScriptCtx(args.scriptId);
  const meta = { ...ctx.metadata };
  const prompts = readPrompts(meta);
  const slot = prompts[args.sceneOrd]?.[args.shotIndex]?.[args.model];
  if (!slot) throw new Error("No prompt to approve.");
  slot.current.approved = args.approved;
  slot.current.updatedAt = new Date().toISOString();
  prompts[args.sceneOrd][args.shotIndex][args.model] = slot;
  const ai = { ...(safeMeta(meta.aiPrompts)) };
  ai.prompts = prompts;
  meta.aiPrompts = ai;
  await persistMeta(args.scriptId, meta);
  return slot.current;
}

/** Read the effective model profiles for a project (defaults + overrides). */
export async function getEffectiveProfiles(
  projectId: string
): Promise<Record<ModelKey, ModelProfile>> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const ov = (safeMeta(proj?.metadata).modelProfileOverrides ?? {}) as Partial<
    Record<ModelKey, Partial<ModelProfile>>
  >;
  return effectiveProfiles(ov);
}

/** Persist per-project overrides (admin / writer editable). */
export async function setProjectModelOverrides(
  projectId: string,
  overrides: Partial<Record<ModelKey, Partial<ModelProfile>>>
): Promise<Record<ModelKey, ModelProfile>> {
  const { data: proj } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = (safeMeta(proj?.metadata) ?? {}) as Meta;
  // Merge each model's existing overrides with the incoming patch so the UI
  // can edit one field at a time.
  const existing = (meta.modelProfileOverrides ?? {}) as Partial<
    Record<ModelKey, Partial<ModelProfile>>
  >;
  const merged: Partial<Record<ModelKey, Partial<ModelProfile>>> = { ...existing };
  for (const [k, patch] of Object.entries(overrides)) {
    if (!patch) continue;
    merged[k as ModelKey] = { ...(existing[k as ModelKey] ?? {}), ...patch };
  }
  meta.modelProfileOverrides = merged;
  await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
  return effectiveProfiles(merged);
}

// --- Quality Gate + Production Result wrappers (engine-facade) ------------

/**
 * Score a generated clip against the 10-category gate. The scores are
 * writer-supplied; the engine computes the outcome + concrete fixes
 * (those flow back as steering on the next regeneration).
 */
export async function evaluateQualityGate(args: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  model: ModelKey;
  scores: Partial<Record<QualityCategory, number>>;
  notes?: string;
}): Promise<QualityGateResult> {
  const ctx = await loadScriptCtx(args.scriptId);
  const briefs = readBriefs(ctx.metadata);
  const brief = briefs[args.sceneOrd]?.[args.shotIndex];
  if (!brief) throw new Error("Brief not found — cannot evaluate gate without a brief.");
  const profile = effectiveProfiles(ctx.projectOverrides)[args.model];
  return runQualityGate({
    brief,
    profile,
    scores: args.scores,
    notes: args.notes,
  });
}

export async function createResult(
  scriptId: string,
  payload: Omit<ProductionResult, "createdAt" | "updatedAt">
): Promise<ProductionResult> {
  return createProductionResult(scriptId, payload);
}

export async function patchResult(
  scriptId: string,
  id: string,
  patch: Partial<ProductionResult>
): Promise<ProductionResult> {
  return updateProductionResult(scriptId, id, patch);
}

export async function listResults(scriptId: string): Promise<ProductionResult[]> {
  return listProductionResults(scriptId);
}

export async function removeResult(scriptId: string, id: string): Promise<void> {
  await deleteProductionResult(scriptId, id);
}

export async function getRules(projectId: string) {
  return getProductionRules(projectId);
}

export async function patchRules(
  projectId: string,
  patch: Parameters<typeof setProductionRules>[1]
) {
  return setProductionRules(projectId, patch);
}

/**
 * Auto-build the shotlist + Master Shot Briefs from an approved scene
 * fountain. Thin wrapper over the autoBuild module — the engine surfaces
 * the same return shape so the route layer doesn't need to import autoBuild
 * directly.
 */
export async function autoBuildBriefs(args: {
  scriptId: string;
  sceneOrd: number;
  opts?: AutoBuildOptions;
}): Promise<AutoBuildReport> {
  return autoBuildSceneBriefs(args);
}

/**
 * Regenerate a single Master Shot Brief in a scene. Thin wrapper so the
 * route layer can call this without importing autoBuild directly.
 */
export async function regenerateOneBrief(args: {
  scriptId: string;
  sceneOrd: number;
  shotIndex: number;
  notes?: string;
  sourceStrict?: boolean;
  fields?: string[];
  force?: boolean;
}): Promise<RegenerateOneBriefResult> {
  return regenerateOneBriefImpl(args);
}

export { DEFAULT_MODEL_PROFILES, ALL_MODEL_KEYS };
export type {
  VisualWeight,
  ShotTag,
  AutoBuildOptions,
  AutoBuildReport,
  RegenerateOneBriefResult,
};
