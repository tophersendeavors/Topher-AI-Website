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
} from "@toburt/shared";
import type { ProposalDraft } from "./proposalGenerator.js";

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
