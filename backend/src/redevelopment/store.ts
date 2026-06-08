// Redevelopment Pass storage — reads / writes
// `projects.metadata.redevelopmentPasses`.

import { supabase } from "../db/client.js";
import { randomUUID } from "crypto";
import {
  REDEV_STAGE_DEPS,
  REDEV_STAGE_ORDER,
  type RedevStageKey,
  type RedevStageStatus,
  type RedevelopmentPass,
  type RedevPassReport,
  type RedevBrief,
  type RedevCharacterBible,
  type RedevProtocolModule,
  type RedevSeasonArcEpisode,
  type RedevPilotStrategy,
  type RedevR6Guardrail,
  type RedevR6GuardrailsBundle,
  type RedevR6RewriteScenePlan,
  type RedevR7PolishItem,
  type RedevR7PolishPlan,
} from "./types.js";
import { normalizeR6Guardrails } from "./types.js";

interface ProjectRow {
  metadata: Record<string, unknown> | null;
}

async function loadProjectMeta(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single<ProjectRow>();
  if (error) throw new Error(`load project failed: ${error.message}`);
  return (data?.metadata ?? {}) as Record<string, unknown>;
}

async function saveProjectMeta(
  projectId: string,
  meta: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase
    .from("projects")
    .update({ metadata: meta })
    .eq("id", projectId);
  if (error) throw new Error(`save project meta failed: ${error.message}`);
}

function readPasses(meta: Record<string, unknown>): RedevelopmentPass[] {
  const arr = meta.redevelopmentPasses;
  if (!Array.isArray(arr)) return [];
  return arr as RedevelopmentPass[];
}

function writePasses(
  meta: Record<string, unknown>,
  passes: RedevelopmentPass[]
): Record<string, unknown> {
  return { ...meta, redevelopmentPasses: passes };
}

// ============================================================================
// Pass lifecycle
// ============================================================================

export async function listPasses(projectId: string): Promise<RedevelopmentPass[]> {
  const meta = await loadProjectMeta(projectId);
  return readPasses(meta);
}

export async function createPass(args: {
  projectId: string;
  title: string;
  createdBy: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const pass: RedevelopmentPass = {
    id: randomUUID(),
    title: args.title,
    createdAt: new Date().toISOString(),
    createdBy: args.createdBy,
    status: "in_progress",
    brief: null,
    characterBibles: [],
    protocolModules: [],
    seasonArc: null,
    pilotStrategy: null,
    pilotRewrite: null,
  };
  passes.push(pass);
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return pass;
}

export async function getPass(
  projectId: string,
  passId: string
): Promise<RedevelopmentPass | null> {
  const passes = await listPasses(projectId);
  return passes.find((p) => p.id === passId) ?? null;
}

export async function abandonPass(
  projectId: string,
  passId: string
): Promise<void> {
  const meta = await loadProjectMeta(projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === passId);
  if (ix < 0) throw new Error("pass not found");
  passes[ix].status = "abandoned";
  await saveProjectMeta(projectId, writePasses(meta, passes));
}

// ============================================================================
// R1 — Brief
// ============================================================================

export async function saveBrief(args: {
  projectId: string;
  passId: string;
  brief: RedevBrief;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  passes[ix].brief = args.brief;
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

export async function approveBrief(args: {
  projectId: string;
  passId: string;
  approvedBy: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const pass = passes[ix];
  if (!pass.brief) throw new Error("brief not yet saved");
  pass.brief = {
    ...pass.brief,
    approvedAt: new Date().toISOString(),
    approvedBy: args.approvedBy,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return pass;
}

// ============================================================================
// R2 — Character Bibles
// ============================================================================

export async function setCharacterBibles(args: {
  projectId: string;
  passId: string;
  bibles: RedevCharacterBible[];
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  passes[ix].characterBibles = args.bibles;
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

export async function approveCharacterBible(args: {
  projectId: string;
  passId: string;
  characterName: string;
  approvedBy: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const pass = passes[ix];
  const cb = pass.characterBibles.find((b) => b.characterName === args.characterName);
  if (!cb) throw new Error(`character "${args.characterName}" not in pass`);
  cb.approvedAt = new Date().toISOString();
  cb.approvedBy = args.approvedBy;
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return pass;
}

// ============================================================================
// R3 — Protocol Modules
// ============================================================================

export async function setProtocolModules(args: {
  projectId: string;
  passId: string;
  modules: RedevProtocolModule[];
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  passes[ix].protocolModules = args.modules;
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

export async function approveProtocolModule(args: {
  projectId: string;
  passId: string;
  moduleId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const m = passes[ix].protocolModules.find((m) => m.id === args.moduleId);
  if (!m) throw new Error(`module "${args.moduleId}" not in pass`);
  m.approvedAt = new Date().toISOString();
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

// ============================================================================
// R4 — Season One Arc
// ============================================================================

export async function setSeasonArc(args: {
  projectId: string;
  passId: string;
  episodes: RedevSeasonArcEpisode[];
  /** Metadata fields — never drop approval when only these change. */
  supportingModuleUsageNotes?: string;
  steeringNote?: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  // Approval is preserved iff the EPISODE PAYLOAD is structurally
  // unchanged. Metadata-only updates (supportingModuleUsageNotes /
  // steeringNote) never drop approval — they're showrunner accounting,
  // not arc content.
  const prior = passes[ix].seasonArc;
  const sameEpisodes =
    prior &&
    prior.episodes.length === args.episodes.length &&
    canonicalize(prior.episodes) === canonicalize(args.episodes);
  passes[ix].seasonArc = {
    episodes: args.episodes,
    approvedAt: sameEpisodes ? prior!.approvedAt : null,
    // Carry through whichever value is set: the new one if the caller
    // explicitly passed one, otherwise the prior one if it existed.
    supportingModuleUsageNotes:
      args.supportingModuleUsageNotes !== undefined
        ? args.supportingModuleUsageNotes
        : prior?.supportingModuleUsageNotes,
    steeringNote:
      args.steeringNote !== undefined
        ? args.steeringNote
        : prior?.steeringNote,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

export async function approveSeasonArc(args: {
  projectId: string;
  passId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const arc = passes[ix].seasonArc;
  if (!arc) throw new Error("season arc not yet generated");
  passes[ix].seasonArc = { ...arc, approvedAt: new Date().toISOString() };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

// ============================================================================
// R5 — Pilot Strategy
// ============================================================================
//
// Same approval-preservation pattern as the season arc: approval is kept
// when the structural payload (the nine string-lists) is unchanged.
// Metadata-only updates (`steeringNote`, `anchorScriptId`) never drop
// approval — they're showrunner accounting, not strategy content.

export async function setPilotStrategy(args: {
  projectId: string;
  passId: string;
  strategy: Omit<RedevPilotStrategy, "approvedAt">;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const prior = passes[ix].pilotStrategy;
  // Compare only the nine content lists for approval-preservation. Metadata
  // (steeringNote, anchorScriptId) is intentionally excluded.
  const contentKeys: Array<keyof RedevPilotStrategy> = [
    "whatMustChange",
    "whatMustRemain",
    "newSeedsToPlant",
    "oldBeatsToRemove",
    "characterIntroAdjustments",
    "protocolPhilosophyMoments",
    "mysteryPlants",
    "characterArcPlants",
    "finalHookOptions",
  ];
  const priorContent: Record<string, unknown> = {};
  const nextContent: Record<string, unknown> = {};
  for (const k of contentKeys) {
    priorContent[k] = prior ? (prior as unknown as Record<string, unknown>)[k] : [];
    nextContent[k] = (args.strategy as unknown as Record<string, unknown>)[k];
  }
  const sameContent =
    !!prior && canonicalize(priorContent) === canonicalize(nextContent);
  passes[ix].pilotStrategy = {
    whatMustChange: args.strategy.whatMustChange,
    whatMustRemain: args.strategy.whatMustRemain,
    newSeedsToPlant: args.strategy.newSeedsToPlant,
    oldBeatsToRemove: args.strategy.oldBeatsToRemove,
    characterIntroAdjustments: args.strategy.characterIntroAdjustments,
    protocolPhilosophyMoments: args.strategy.protocolPhilosophyMoments,
    mysteryPlants: args.strategy.mysteryPlants,
    characterArcPlants: args.strategy.characterArcPlants,
    finalHookOptions: args.strategy.finalHookOptions,
    // Carry through metadata. The caller may pass a new value; if not,
    // keep whatever was previously stored.
    steeringNote:
      args.strategy.steeringNote !== undefined
        ? args.strategy.steeringNote
        : prior?.steeringNote,
    anchorScriptId:
      args.strategy.anchorScriptId !== undefined
        ? args.strategy.anchorScriptId
        : prior?.anchorScriptId,
    approvedAt: sameContent ? prior!.approvedAt : null,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

export async function approvePilotStrategy(args: {
  projectId: string;
  passId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const strat = passes[ix].pilotStrategy;
  if (!strat) throw new Error("pilot strategy not yet generated");
  passes[ix].pilotStrategy = {
    ...strat,
    approvedAt: new Date().toISOString(),
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

// ============================================================================
// R6 — Guardrails (per-character protection contract honored by the rewrite)
// ============================================================================
//
// Pure metadata writes. Do NOT touch pilotStrategy.approvedAt — these
// guardrails are downstream of R5 strategy approval; updating them is
// not the same as editing the strategy text.

/** Save the full R6 guardrails bundle (perCharacter + globalRule +
 *  approvedAt). Edits to the bundle drop approval — caller can re-set
 *  approvedAt by calling `approveR6Guardrails`. */
export async function setR6Guardrails(args: {
  projectId: string;
  passId: string;
  bundle: RedevR6GuardrailsBundle;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  // Approval is preserved if the structural payload (perCharacter +
  // globalRule + globalPlants) hasn't changed. Lets the user edit
  // metadata without dropping approval. Compare canonicalized strings.
  const prior = normalizeR6Guardrails(passes[ix].r6Guardrails);
  const sameContent =
    canonicalize({
      perCharacter: prior.perCharacter,
      globalRule: prior.globalRule,
      globalPlants: prior.globalPlants ?? [],
    }) ===
    canonicalize({
      perCharacter: args.bundle.perCharacter,
      globalRule: args.bundle.globalRule,
      globalPlants: args.bundle.globalPlants ?? [],
    });
  passes[ix].r6Guardrails = {
    perCharacter: args.bundle.perCharacter,
    globalRule: args.bundle.globalRule,
    globalPlants: args.bundle.globalPlants ?? [],
    approvedAt: sameContent
      ? args.bundle.approvedAt ?? prior.approvedAt
      : null,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

// ============================================================================
// R6 Rewrite Plan (Pass 1)
// ============================================================================

export async function setR6RewritePlan(args: {
  projectId: string;
  passId: string;
  plan: RedevR6RewriteScenePlan[];
  approachSummary: string;
  priorScriptId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const prior = passes[ix].pilotRewrite;
  const priorPlanKey = canonicalize({
    plan: prior?.plan ?? [],
    approachSummary: prior?.approachSummary ?? "",
  });
  const nextPlanKey = canonicalize({
    plan: args.plan,
    approachSummary: args.approachSummary,
  });
  const samePlan = !!prior && priorPlanKey === nextPlanKey;
  passes[ix].pilotRewrite = {
    priorScriptId: args.priorScriptId,
    plan: args.plan,
    approachSummary: args.approachSummary,
    planApprovedAt: samePlan
      ? prior?.planApprovedAt ?? null
      : null,
    proposedDraftText: prior?.proposedDraftText ?? null,
    changeNotes: prior?.changeNotes ?? [],
    approvedAt: prior?.approvedAt ?? null,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

export async function approveR6RewritePlan(args: {
  projectId: string;
  passId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const rewrite = passes[ix].pilotRewrite;
  if (!rewrite || !rewrite.plan || rewrite.plan.length === 0) {
    throw new Error("no rewrite plan to approve — generate one first");
  }
  passes[ix].pilotRewrite = {
    ...rewrite,
    planApprovedAt: new Date().toISOString(),
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

// ----- R6 Rewrite Pass 2 (Scene text) ---------------------------------

export async function setR6Pass2Draft(args: {
  projectId: string;
  passId: string;
  compiledFountain: string;
  sceneActionSummary: {
    kept: number;
    revised: number;
    moved: number;
    merged: number;
    cut: number;
    added: number;
  };
  changeNotes?: string[];
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const prior = passes[ix].pilotRewrite;
  if (!prior) {
    throw new Error("cannot set Pass 2 draft — no rewrite plan in this pass");
  }
  passes[ix].pilotRewrite = {
    ...prior,
    proposedDraftText: args.compiledFountain,
    proposedDraftAt: new Date().toISOString(),
    sceneActionSummary: args.sceneActionSummary,
    changeNotes: args.changeNotes ?? prior.changeNotes ?? [],
    // Setting a fresh Pass 2 draft drops any prior final-draft approval —
    // the showrunner must re-approve the new draft.
    approvedAt: null,
    promotedScriptId: prior.promotedScriptId ?? null,
    promotedDraftNumber: prior.promotedDraftNumber ?? null,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

/** Promote the proposed Pass 2 draft to a new `scripts` row.
 *
 *  Sequence (mirrors the existing "new draft" pattern used by
 *  routes/entities.ts micro-drama path):
 *    1. Find the EP01 episode.
 *    2. Demote any existing `current = true` script for that episode.
 *    3. Find the highest `draft_number` and add 1.
 *    4. Insert a new `scripts` row with the compiled fountain.
 *    5. (Caller is responsible for indexScenes() to populate
 *       `script_scenes` for downstream pipelines.)
 *    6. Set `pilotRewrite.promotedScriptId` + `promotedDraftNumber` +
 *       `approvedAt` on the pass.
 *
 *  This is conservative — we DO NOT touch the existing EP01 script's
 *  rows at all beyond setting `current = false`. The original draft
 *  remains intact and selectable via the existing Draft Picker UI.
 */
export async function promoteR6Pass2Draft(args: {
  projectId: string;
  passId: string;
  approvedBy: string;
}): Promise<{
  pass: RedevelopmentPass;
  scriptId: string;
  draftNumber: number;
}> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const rewrite = passes[ix].pilotRewrite;
  if (!rewrite || !rewrite.proposedDraftText) {
    throw new Error(
      "no Pass 2 draft to approve — generate the draft first"
    );
  }
  if (!rewrite.planApprovedAt) {
    throw new Error(
      "Pass 1 plan must be approved before promoting the Pass 2 draft"
    );
  }

  // 1. Find EP01 (lowest-numbered episode).
  const { data: eps, error: epErr } = await supabase
    .from("episodes")
    .select("id, number, title, project_id")
    .eq("project_id", args.projectId)
    .order("number", { ascending: true })
    .limit(1);
  if (epErr) throw new Error(`load episode failed: ${epErr.message}`);
  const ep = eps?.[0];
  if (!ep) {
    throw new Error(
      "no EP01 episode found for this project — cannot promote rewrite"
    );
  }

  // 2. Demote any current script for this episode.
  await supabase
    .from("scripts")
    .update({ current: false })
    .eq("project_id", args.projectId)
    .eq("episode_id", ep.id)
    .eq("current", true);

  // 3. Find next draft number.
  const { data: priorScripts } = await supabase
    .from("scripts")
    .select("draft_number")
    .eq("project_id", args.projectId)
    .eq("episode_id", ep.id)
    .order("draft_number", { ascending: false })
    .limit(1);
  const nextDraft =
    priorScripts && priorScripts.length > 0
      ? ((priorScripts[0].draft_number as number) ?? 0) + 1
      : 1;

  const title = `Episode ${ep.number} — ${ep.title ?? "Untitled"} (R6 rewrite)`;

  // 4. Insert the new script.
  const { data: newScript, error: insertErr } = await supabase
    .from("scripts")
    .insert({
      project_id: args.projectId,
      episode_id: ep.id,
      title,
      draft_number: nextDraft,
      current: true,
      fountain: rewrite.proposedDraftText,
      metadata: {
        source: "r6_pass2_rewrite",
        priorScriptId: rewrite.priorScriptId,
        redevelopmentPassId: args.passId,
        sceneActionSummary: rewrite.sceneActionSummary ?? null,
        approachSummary: rewrite.approachSummary ?? null,
        promotedAt: new Date().toISOString(),
        promotedBy: args.approvedBy,
      },
    })
    .select("*")
    .single();
  if (insertErr) throw new Error(`promote failed: ${insertErr.message}`);
  if (!newScript) throw new Error("promote failed: no script returned");

  // 6. Set approval state on the pass.
  passes[ix].pilotRewrite = {
    ...rewrite,
    approvedAt: new Date().toISOString(),
    promotedScriptId: newScript.id as string,
    promotedDraftNumber: nextDraft,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));

  return {
    pass: passes[ix],
    scriptId: newScript.id as string,
    draftNumber: nextDraft,
  };
}

export async function approveR6Guardrails(args: {
  projectId: string;
  passId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const bundle = normalizeR6Guardrails(passes[ix].r6Guardrails);
  if (bundle.perCharacter.length === 0) {
    throw new Error("no guardrails to approve — generate them first");
  }
  passes[ix].r6Guardrails = {
    ...bundle,
    approvedAt: new Date().toISOString(),
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

// ============================================================================
// R7 Pilot Polish Pass (plan-only for now; apply ships next)
// ============================================================================

export async function setR7PolishPlan(args: {
  projectId: string;
  passId: string;
  items: RedevR7PolishItem[];
  approachSummary: string;
  priorScriptId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const prior = passes[ix].r7Polish;
  // Preserve plan-approval only if the structural payload is unchanged.
  const sameStructure =
    !!prior &&
    canonicalize({ items: prior.items, approachSummary: prior.approachSummary }) ===
      canonicalize({ items: args.items, approachSummary: args.approachSummary });
  const next: RedevR7PolishPlan = {
    priorScriptId: args.priorScriptId,
    approachSummary: args.approachSummary,
    items: args.items,
    planApprovedAt: sameStructure ? prior?.planApprovedAt ?? null : null,
    // Preserve any downstream (Pass 2) state if present.
    polishedDraftText: prior?.polishedDraftText ?? null,
    polishedDraftAt: prior?.polishedDraftAt ?? null,
    changeNotes: prior?.changeNotes ?? [],
    promotedScriptId: prior?.promotedScriptId ?? null,
    promotedDraftNumber: prior?.promotedDraftNumber ?? null,
    approvedAt: prior?.approvedAt ?? null,
  };
  passes[ix].r7Polish = next;
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

export async function approveR7PolishPlan(args: {
  projectId: string;
  passId: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const plan = passes[ix].r7Polish;
  if (!plan || !plan.items || plan.items.length === 0) {
    throw new Error("no polish plan to approve — generate one first");
  }
  passes[ix].r7Polish = {
    ...plan,
    planApprovedAt: new Date().toISOString(),
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

// ----- R7 Pass 2 (apply) ----------------------------------------------

export async function setR7Pass2Draft(args: {
  projectId: string;
  passId: string;
  polishedFountain: string;
}): Promise<RedevelopmentPass> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const prior = passes[ix].r7Polish;
  if (!prior) {
    throw new Error("cannot set R7 Pass 2 draft — no R7 polish plan in pass");
  }
  if (!prior.planApprovedAt) {
    throw new Error(
      "R7 polish plan must be APPROVED before applying Pass 2"
    );
  }
  passes[ix].r7Polish = {
    ...prior,
    polishedDraftText: args.polishedFountain,
    polishedDraftAt: new Date().toISOString(),
    // A fresh apply pass drops any prior final-draft approval.
    approvedAt: null,
    promotedScriptId: prior.promotedScriptId ?? null,
    promotedDraftNumber: prior.promotedDraftNumber ?? null,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));
  return passes[ix];
}

/** Promote the R7-polished draft to a NEW `scripts` row (Draft N+1).
 *  Mirrors `promoteR6Pass2Draft` — never touches the existing Draft N
 *  beyond setting `current = false`. */
export async function promoteR7Pass2Draft(args: {
  projectId: string;
  passId: string;
  approvedBy: string;
}): Promise<{
  pass: RedevelopmentPass;
  scriptId: string;
  draftNumber: number;
}> {
  const meta = await loadProjectMeta(args.projectId);
  const passes = readPasses(meta);
  const ix = passes.findIndex((p) => p.id === args.passId);
  if (ix < 0) throw new Error("pass not found");
  const plan = passes[ix].r7Polish;
  if (!plan || !plan.polishedDraftText) {
    throw new Error(
      "no R7 polished draft to approve — apply the polish first"
    );
  }
  if (!plan.planApprovedAt) {
    throw new Error(
      "R7 plan must be approved before promoting the polished draft"
    );
  }

  const { data: eps, error: epErr } = await supabase
    .from("episodes")
    .select("id, number, title, project_id")
    .eq("project_id", args.projectId)
    .order("number", { ascending: true })
    .limit(1);
  if (epErr) throw new Error(`load episode failed: ${epErr.message}`);
  const ep = eps?.[0];
  if (!ep) throw new Error("no EP01 episode found for this project");

  await supabase
    .from("scripts")
    .update({ current: false })
    .eq("project_id", args.projectId)
    .eq("episode_id", ep.id)
    .eq("current", true);

  const { data: priorScripts } = await supabase
    .from("scripts")
    .select("draft_number")
    .eq("project_id", args.projectId)
    .eq("episode_id", ep.id)
    .order("draft_number", { ascending: false })
    .limit(1);
  const nextDraft =
    priorScripts && priorScripts.length > 0
      ? ((priorScripts[0].draft_number as number) ?? 0) + 1
      : 1;

  const title = `Episode ${ep.number} — ${ep.title ?? "Untitled"} (R7 polish)`;

  const { data: newScript, error: insertErr } = await supabase
    .from("scripts")
    .insert({
      project_id: args.projectId,
      episode_id: ep.id,
      title,
      draft_number: nextDraft,
      current: true,
      fountain: plan.polishedDraftText,
      metadata: {
        source: "r7_pass2_polish",
        priorScriptId: plan.priorScriptId,
        redevelopmentPassId: args.passId,
        promotedAt: new Date().toISOString(),
        promotedBy: args.approvedBy,
        polishItemCount: plan.items.length,
      },
    })
    .select("*")
    .single();
  if (insertErr) throw new Error(`promote failed: ${insertErr.message}`);
  if (!newScript) throw new Error("promote failed: no script returned");

  passes[ix].r7Polish = {
    ...plan,
    approvedAt: new Date().toISOString(),
    promotedScriptId: newScript.id as string,
    promotedDraftNumber: nextDraft,
  };
  await saveProjectMeta(args.projectId, writePasses(meta, passes));

  return {
    pass: passes[ix],
    scriptId: newScript.id as string,
    draftNumber: nextDraft,
  };
}

/** Key-order-independent canonical form (matches the routes helper).
 *  Used here so set-seasonArc can detect "structurally same payload"
 *  even when Postgres jsonb and zod produce different key orders. */
function canonicalize(v: unknown): string {
  if (v === null || v === undefined) return JSON.stringify(v ?? null);
  if (typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + canonicalize(obj[k])).join(",") +
    "}"
  );
}

// ============================================================================
// Gate computation
// ============================================================================

function isStageApproved(pass: RedevelopmentPass, stage: RedevStageKey): boolean {
  switch (stage) {
    case "r1_brief":
      return !!pass.brief?.approvedAt;
    case "r2_character_bibles":
      // R2 is "approved" when EVERY character bible has an approvedAt.
      // An empty character list means R2 is still pending.
      return (
        pass.characterBibles.length > 0 &&
        pass.characterBibles.every((b) => !!b.approvedAt)
      );
    case "r3_protocol_modules":
      return (
        pass.protocolModules.length > 0 &&
        pass.protocolModules.every((m) => !!m.approvedAt)
      );
    case "r4_season_arc":
      return !!pass.seasonArc?.approvedAt;
    case "r5_pilot_strategy":
      return !!pass.pilotStrategy?.approvedAt;
    case "r6_pilot_rewrite":
      return !!pass.pilotRewrite?.approvedAt;
    case "r7_pilot_polish":
      // R7 is "approved" only when its plan is approved AND (eventually)
      // its applied polish has been promoted. For now (plan-only build),
      // we treat planApproved as the approval signal so the gate logic
      // can compute downstream stage states even before Pass 2 ships.
      return !!pass.r7Polish?.approvedAt || !!pass.r7Polish?.planApprovedAt;
  }
}

function isStageStarted(pass: RedevelopmentPass, stage: RedevStageKey): boolean {
  switch (stage) {
    case "r1_brief":
      return !!pass.brief;
    case "r2_character_bibles":
      return pass.characterBibles.length > 0;
    case "r3_protocol_modules":
      return pass.protocolModules.length > 0;
    case "r4_season_arc":
      return !!pass.seasonArc;
    case "r5_pilot_strategy":
      return !!pass.pilotStrategy;
    case "r6_pilot_rewrite":
      return !!pass.pilotRewrite;
    case "r7_pilot_polish":
      return !!pass.r7Polish;
  }
}

export function computePassReport(pass: RedevelopmentPass): RedevPassReport {
  const stages: RedevPassReport["stages"] = {} as RedevPassReport["stages"];
  for (const key of REDEV_STAGE_ORDER) {
    const deps = REDEV_STAGE_DEPS[key];
    const unsatisfiedDeps = deps.filter((d) => !isStageApproved(pass, d));
    let status: RedevStageStatus;
    if (isStageApproved(pass, key)) {
      status = "approved";
    } else if (unsatisfiedDeps.length > 0) {
      status = "locked";
    } else if (isStageStarted(pass, key)) {
      status = "in_progress";
    } else {
      status = "available";
    }
    stages[key] = { status, blockedBy: unsatisfiedDeps };
  }
  return { passId: pass.id, pass, stages };
}
