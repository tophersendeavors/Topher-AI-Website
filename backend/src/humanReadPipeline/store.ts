// Human Read Approval Pipeline store. Models the pipeline entities as typed
// jsonb under projects.metadata.humanReadPipeline[episodeId], preserving
// every other project metadata key. The guardrail lives here: only
// approved/auto_safe proposals are ever placed into an Approved Change Set.

import { randomUUID } from "node:crypto";
import { supabase } from "../db/client.js";
import {
  REWRITE_ELIGIBLE_STATUSES,
  HUMAN_READ_RULE,
  type ApprovalStatus,
  type ApprovedChangeSet,
  type ChangeProposal,
  type RewriteJob,
  type RewriteSceneDiff,
} from "@toburt/shared";
import type { ProposalDraft } from "./proposalGenerator.js";
import { runControlledRewriteAgent } from "./rewriteAgent.js";

interface EpisodePipeline {
  proposals: ChangeProposal[];
  changeSets: ApprovedChangeSet[];
  rewriteJobs: RewriteJob[];
}

function emptyPipeline(): EpisodePipeline {
  return { proposals: [], changeSets: [], rewriteJobs: [] };
}

async function loadMeta(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return (data?.metadata as Record<string, unknown> | null) ?? {};
}

export async function getPipeline(projectId: string, episodeId: string): Promise<EpisodePipeline> {
  const meta = await loadMeta(projectId);
  const all = (meta.humanReadPipeline as Record<string, EpisodePipeline> | undefined) ?? {};
  return { ...emptyPipeline(), ...(all[episodeId] ?? {}) };
}

async function savePipeline(
  projectId: string,
  episodeId: string,
  pipeline: EpisodePipeline
): Promise<EpisodePipeline> {
  const meta = await loadMeta(projectId);
  const all = (meta.humanReadPipeline as Record<string, EpisodePipeline> | undefined) ?? {};
  const next = { ...meta, humanReadPipeline: { ...all, [episodeId]: pipeline } };
  const { error } = await supabase.from("projects").update({ metadata: next }).eq("id", projectId);
  if (error) throw error;
  return pipeline;
}

/** Replace the proposal list from freshly generated drafts. Decisions are
 *  reset because the proposals are regenerated from a new read. */
export async function replaceProposals(
  projectId: string,
  episodeId: string,
  scriptVersionId: string,
  drafts: ProposalDraft[]
): Promise<ChangeProposal[]> {
  const now = new Date().toISOString();
  const proposals: ChangeProposal[] = drafts.map((d) => ({
    id: randomUUID(),
    humanReadNoteId: randomUUID(),
    projectId,
    episodeId,
    scriptVersionId,
    title: d.title,
    problem: d.problem,
    evidence: d.evidence,
    proposedSolution: d.proposedSolution,
    scenesAffected: d.scenesAffected,
    rewriteScope: d.rewriteScope,
    protectedElements: d.protectedElements,
    riskLevel: d.riskLevel,
    approvalStatus: "pending",
    creatorDecisionNotes: "",
    approvedBy: null,
    approvedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  const prior = await getPipeline(projectId, episodeId);
  // Regenerating proposals invalidates any prior change sets built from the
  // old proposal ids.
  return (await savePipeline(projectId, episodeId, { ...prior, proposals, changeSets: [] })).proposals;
}

export async function patchProposal(
  projectId: string,
  episodeId: string,
  proposalId: string,
  patch: { approvalStatus?: ApprovalStatus; creatorDecisionNotes?: string },
  userId: string
): Promise<ChangeProposal> {
  const pipeline = await getPipeline(projectId, episodeId);
  const idx = pipeline.proposals.findIndex((p) => p.id === proposalId);
  if (idx === -1) throw new Error("Change proposal not found.");
  const prior = pipeline.proposals[idx];
  const nextStatus = patch.approvalStatus ?? prior.approvalStatus;
  const isApproved = nextStatus === "approved" || nextStatus === "auto_safe";
  const updated: ChangeProposal = {
    ...prior,
    approvalStatus: nextStatus,
    creatorDecisionNotes: patch.creatorDecisionNotes ?? prior.creatorDecisionNotes,
    approvedBy: isApproved ? userId : null,
    approvedAt: isApproved ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
  const proposals = [...pipeline.proposals];
  proposals[idx] = updated;
  await savePipeline(projectId, episodeId, { ...pipeline, proposals });
  return updated;
}

/**
 * GUARDRAIL. Build an Approved Change Set from the CURRENT approved/auto_safe
 * proposals — and nothing else. Pending, rejected, held, and revise-status
 * proposals are excluded by construction. The returned set's
 * lockedPromptPayload is the ONLY thing the rewrite agent may consume.
 */
export async function buildApprovedChangeSet(
  projectId: string,
  episodeId: string,
  sourceScriptVersionId: string,
  userId: string
): Promise<ApprovedChangeSet> {
  const pipeline = await getPipeline(projectId, episodeId);
  const eligible = pipeline.proposals.filter((p) =>
    REWRITE_ELIGIBLE_STATUSES.includes(p.approvalStatus)
  );
  if (eligible.length === 0) {
    throw new Error("No approved or auto-safe proposals — nothing may enter a rewrite.");
  }

  const protectedElements = Array.from(
    new Set(eligible.flatMap((p) => p.protectedElements).filter(Boolean))
  );
  const rewriteBoundaries = Array.from(
    new Set(eligible.map((p) => p.rewriteScope).filter(Boolean))
  );

  const changeSet: ApprovedChangeSet = {
    id: randomUUID(),
    projectId,
    episodeId,
    sourceScriptVersionId,
    approvedProposalIds: eligible.map((p) => p.id),
    lockedPromptPayload: {
      sourceScriptId: sourceScriptVersionId,
      rule: HUMAN_READ_RULE,
      approvedChanges: eligible.map((p) => ({
        proposalId: p.id,
        title: p.title,
        proposedSolution: p.proposedSolution,
        scenesAffected: p.scenesAffected,
        rewriteScope: p.rewriteScope,
        protectedElements: p.protectedElements,
        riskLevel: p.riskLevel,
        creatorDecisionNotes: p.creatorDecisionNotes,
      })),
      protectedElements,
      rewriteBoundaries,
    },
    createdBy: userId,
    createdAt: new Date().toISOString(),
  };

  await savePipeline(projectId, episodeId, {
    ...pipeline,
    changeSets: [...pipeline.changeSets, changeSet],
  });
  return changeSet;
}

// ---------------------------------------------------------------------------
// Phase 2 — controlled rewrite (consumes ONLY an Approved Change Set)
// ---------------------------------------------------------------------------

interface SourceScene {
  ord: number;
  heading: string;
  fountain: string;
  status: string;
}

async function loadSourceScenes(scriptId: string): Promise<SourceScene[]> {
  const { data } = await supabase
    .from("script_scenes")
    .select("ord, slugline, fountain, status")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  return (data ?? []).map((r) => ({
    ord: Number(r.ord),
    heading: (r.slugline as string) ?? `Scene ${r.ord}`,
    fountain: (r.fountain as string) ?? "",
    status: (r.status as string) ?? "generated",
  }));
}

/** Run a controlled rewrite from an Approved Change Set. The agent receives
 *  ONLY the locked payload + the in-scope scenes. Out-of-scope scenes are
 *  carried through byte-identical. Produces a RewriteJob — it does NOT touch
 *  the source draft. */
export async function runControlledRewrite(
  projectId: string,
  episodeId: string,
  changeSetId: string,
  _userId: string
): Promise<RewriteJob> {
  const pipeline = await getPipeline(projectId, episodeId);
  const changeSet = pipeline.changeSets.find((c) => c.id === changeSetId);
  if (!changeSet) throw new Error("Approved Change Set not found.");

  const sourceScriptId = changeSet.sourceScriptVersionId;
  const scenes = await loadSourceScenes(sourceScriptId);
  if (scenes.length === 0) throw new Error("Source draft has no scenes.");

  const inScopeOrds = new Set(
    changeSet.lockedPromptPayload.approvedChanges.flatMap((c) => c.scenesAffected)
  );
  const inScope = scenes.filter((s) => inScopeOrds.has(s.ord));
  if (inScope.length === 0) throw new Error("Approved changes name no scenes to rewrite.");

  const result = await runControlledRewriteAgent({
    payload: changeSet.lockedPromptPayload,
    scenes: inScope.map((s) => ({ ord: s.ord, heading: s.heading, fountain: s.fountain })),
    neighborHeadings: scenes.map((s) => ({ ord: s.ord, heading: s.heading })),
  });
  const newByOrd = new Map(result.scenes.map((s) => [s.ord, s]));

  // Reassemble: out-of-scope scenes are byte-identical (same join the app uses).
  const newFountain = scenes
    .map((s) => (newByOrd.get(s.ord)?.newFountain ?? s.fountain).trim())
    .filter((t) => t.length > 0)
    .join("\n\n");

  const diff: RewriteSceneDiff[] = inScope.map((s) => {
    const r = newByOrd.get(s.ord);
    const after = (r?.newFountain ?? s.fountain).trim();
    return {
      ord: s.ord,
      heading: s.heading,
      before: s.fountain.trim(),
      after,
      changed: after !== s.fountain.trim(),
      changeSummary: r?.changeSummary ?? "",
      satisfies: r?.satisfies ?? [],
      protectedTouched: r?.protectedTouched ?? false,
      continuityRisks: r?.continuityRisks ?? [],
    };
  });
  const rewritten = diff.filter((d) => d.changed).length;

  const job: RewriteJob = {
    id: randomUUID(),
    projectId,
    episodeId,
    sourceScriptVersionId: sourceScriptId,
    approvedChangeSetId: changeSetId,
    rewriteStatus: "complete",
    newScriptVersionId: null,
    newDraftNumber: null,
    changeLog: diff
      .filter((d) => d.changed)
      .map((d) => `Scene ${d.ord}: ${d.changeSummary}`)
      .join("\n"),
    continuityRisks: Array.from(new Set(diff.flatMap((d) => d.continuityRisks).filter(Boolean))),
    diff,
    newFountain,
    scenesRewritten: rewritten,
    scenesUntouched: scenes.length - rewritten,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
  };
  await savePipeline(projectId, episodeId, { ...pipeline, rewriteJobs: [...pipeline.rewriteJobs, job] });
  return job;
}

export async function rejectRewriteJob(
  projectId: string,
  episodeId: string,
  jobId: string
): Promise<RewriteJob> {
  const pipeline = await getPipeline(projectId, episodeId);
  const idx = pipeline.rewriteJobs.findIndex((j) => j.id === jobId);
  if (idx === -1) throw new Error("Rewrite job not found.");
  const job = { ...pipeline.rewriteJobs[idx], rewriteStatus: "rejected" as const, completedAt: new Date().toISOString() };
  const jobs = [...pipeline.rewriteJobs];
  jobs[idx] = job;
  await savePipeline(projectId, episodeId, { ...pipeline, rewriteJobs: jobs });
  return job;
}

/** Promote a rewrite into a NEW draft version. The source draft's content is
 *  never modified — a fresh draft_number is minted and becomes current. */
export async function promoteRewriteJob(
  projectId: string,
  episodeId: string,
  jobId: string,
  userId: string
): Promise<RewriteJob> {
  const pipeline = await getPipeline(projectId, episodeId);
  const idx = pipeline.rewriteJobs.findIndex((j) => j.id === jobId);
  if (idx === -1) throw new Error("Rewrite job not found.");
  const job = pipeline.rewriteJobs[idx];
  if (job.newScriptVersionId) throw new Error("This rewrite has already been promoted.");

  const sourceScenes = await loadSourceScenes(job.sourceScriptVersionId);
  const afterByOrd = new Map(job.diff.map((d) => [d.ord, d.after]));

  // Next draft number for this episode.
  const { data: prior } = await supabase
    .from("scripts")
    .select("draft_number, title")
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .order("draft_number", { ascending: false })
    .limit(1);
  const nextDraft = prior && prior.length > 0 ? ((prior[0].draft_number as number) ?? 0) + 1 : 1;

  // Demote the current draft (content untouched — only the `current` pointer).
  await supabase
    .from("scripts")
    .update({ current: false })
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .eq("current", true);

  const { data: newScript, error: insErr } = await supabase
    .from("scripts")
    .insert({
      project_id: projectId,
      episode_id: episodeId,
      title: `Draft ${nextDraft} (controlled rewrite)`,
      draft_number: nextDraft,
      current: true,
      fountain: job.newFountain,
      metadata: {
        source: "controlled_rewrite",
        priorScriptId: job.sourceScriptVersionId,
        approvedChangeSetId: job.approvedChangeSetId,
        rewriteJobId: job.id,
        promotedAt: new Date().toISOString(),
        promotedBy: userId,
      },
    })
    .select("id")
    .single();
  if (insErr || !newScript) throw new Error(`Promote failed: ${insErr?.message ?? "no row"}`);
  const newScriptId = newScript.id as string;

  // Clone every scene into the new draft, swapping in the rewritten fountain
  // for in-scope scenes. Out-of-scope scenes are copied verbatim.
  const sceneRows = sourceScenes.map((s) => ({
    script_id: newScriptId,
    ord: s.ord,
    slugline: s.heading,
    fountain: afterByOrd.get(s.ord) ?? s.fountain,
    status: s.status,
  }));
  const { error: scErr } = await supabase.from("script_scenes").insert(sceneRows);
  if (scErr) throw new Error(`Promote failed writing scenes: ${scErr.message}`);

  const promoted: RewriteJob = {
    ...job,
    rewriteStatus: "promoted",
    newScriptVersionId: newScriptId,
    newDraftNumber: nextDraft,
    completedAt: new Date().toISOString(),
  };
  const jobs = [...pipeline.rewriteJobs];
  jobs[idx] = promoted;
  await savePipeline(projectId, episodeId, { ...pipeline, rewriteJobs: jobs });
  return promoted;
}

/**
 * Generic canon/guardrail context for the proposal generator. Pulls only
 * what the project actually has (R1 redevelopment brief, character bible
 * summary). Reusable across projects — show-specific nothing is hard-coded.
 */
export async function assembleCanonContext(projectId: string): Promise<string> {
  const meta = await loadMeta(projectId);
  const lines: string[] = [];

  const passes = (meta.redevelopmentPasses as Array<Record<string, unknown>> | undefined) ?? [];
  const r1 = passes.find((p) => (p.stage as string) === "r1_brief" || p.brief);
  const brief = (r1?.brief ?? r1) as Record<string, unknown> | undefined;
  if (brief) {
    for (const key of ["newCorePrinciple", "mustNotChange", "forbiddenTones", "solanoRule", "audiencePromise"]) {
      const v = brief[key];
      if (typeof v === "string" && v.trim()) lines.push(`- ${v.trim()}`);
    }
  }
  const charSummary = (meta.characterBibleSummary as Record<string, unknown> | undefined)?.text;
  if (typeof charSummary === "string" && charSummary.trim()) {
    lines.push(`- Ensemble: ${charSummary.trim()}`);
  }
  return lines.join("\n");
}
