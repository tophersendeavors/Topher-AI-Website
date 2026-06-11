// Human Read Approval Pipeline routes. Converts a Human Read (Audience Read)
// report into approvable Change Proposals, lets the creator decide each, and
// builds a locked Approved Change Set. The rewrite agent (Phase 2) consumes
// ONLY the change set — never the free-form report.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  APPROVAL_STATUSES,
  HUMAN_READ_RULE,
  type ApprovalStatus,
  type HumanReadPipelineResponse,
} from "@toburt/shared";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { getAudienceRead, loadCurrentDraft } from "../audienceRead/store.js";
import { generateChangeProposals } from "../humanReadPipeline/proposalGenerator.js";
import {
  getPipeline,
  replaceProposals,
  patchProposal,
  buildApprovedChangeSet,
  assembleCanonContext,
  runControlledRewrite,
  promoteRewriteJob,
  rejectRewriteJob,
} from "../humanReadPipeline/store.js";

export default async function humanReadPipelineRoutes(app: FastifyInstance) {
  async function buildResponse(projectId: string, episodeId: string): Promise<HumanReadPipelineResponse> {
    const [pipeline, report, draft] = await Promise.all([
      getPipeline(projectId, episodeId),
      getAudienceRead(projectId, episodeId),
      loadCurrentDraft(projectId, episodeId),
    ]);
    return {
      reportRef: report
        ? {
            scriptId: report.sourceScriptId,
            draftLabel: report.sourceDraftLabel,
            bingeScore: report.bingeScore,
            generatedAt: report.generatedAt,
          }
        : null,
      proposals: pipeline.proposals,
      changeSets: pipeline.changeSets,
      rewriteJobs: pipeline.rewriteJobs,
      rule: HUMAN_READ_RULE,
    };
  }

  app.get("/projects/:projectId/episodes/:episodeId/change-proposals", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
    await assertProjectMember(user.id, projectId);
    return buildResponse(projectId, episodeId);
  });

  // Generate Change Proposals from the latest Human Read. This diagnoses —
  // it does NOT rewrite. Every proposal starts as "pending".
  app.post("/projects/:projectId/episodes/:episodeId/change-proposals/generate", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
    await assertProjectMember(user.id, projectId);

    const report = await getAudienceRead(projectId, episodeId);
    if (!report) {
      const e = new Error("Run the Audience Read first — there is nothing to propose from.") as Error & {
        statusCode?: number;
      };
      e.statusCode = 409;
      throw e;
    }
    const [draft, canonContext] = await Promise.all([
      loadCurrentDraft(projectId, episodeId),
      assembleCanonContext(projectId),
    ]);
    const drafts = await generateChangeProposals({ report, scenes: draft.scenes, canonContext });
    await replaceProposals(projectId, episodeId, report.sourceScriptId, drafts);
    return buildResponse(projectId, episodeId);
  });

  // Creator decision on one proposal.
  app.patch("/projects/:projectId/episodes/:episodeId/change-proposals/:proposalId", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId, proposalId } = req.params as {
      projectId: string;
      episodeId: string;
      proposalId: string;
    };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        approvalStatus: z.enum(APPROVAL_STATUSES as [ApprovalStatus, ...ApprovalStatus[]]).optional(),
        creatorDecisionNotes: z.string().max(2000).optional(),
      })
      .parse(req.body);
    await patchProposal(projectId, episodeId, proposalId, body, user.id);
    return buildResponse(projectId, episodeId);
  });

  // Master action: build the locked Approved Change Set from approved /
  // auto_safe proposals only. This is the boundary the rewrite agent reads.
  app.post("/projects/:projectId/episodes/:episodeId/change-proposals/approved-set", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
    await assertProjectMember(user.id, projectId);
    const draft = await loadCurrentDraft(projectId, episodeId);
    if (!draft.scriptId) {
      const e = new Error("No source draft for this episode.") as Error & { statusCode?: number };
      e.statusCode = 409;
      throw e;
    }
    const changeSet = await buildApprovedChangeSet(projectId, episodeId, draft.scriptId, user.id);
    const response = await buildResponse(projectId, episodeId);
    return { ...response, changeSet };
  });

  // --- Phase 2: controlled rewrite (consumes ONLY the locked change set) ---

  app.post("/projects/:projectId/episodes/:episodeId/rewrite/run", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
    await assertProjectMember(user.id, projectId);
    const { changeSetId } = z.object({ changeSetId: z.string() }).parse(req.body);
    const job = await runControlledRewrite(projectId, episodeId, changeSetId, user.id);
    return { ...(await buildResponse(projectId, episodeId)), job };
  });

  app.post("/projects/:projectId/episodes/:episodeId/rewrite/:jobId/promote", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId, jobId } = req.params as {
      projectId: string;
      episodeId: string;
      jobId: string;
    };
    await assertProjectMember(user.id, projectId);
    const job = await promoteRewriteJob(projectId, episodeId, jobId, user.id);
    return { ...(await buildResponse(projectId, episodeId)), job };
  });

  app.post("/projects/:projectId/episodes/:episodeId/rewrite/:jobId/reject", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId, jobId } = req.params as {
      projectId: string;
      episodeId: string;
      jobId: string;
    };
    await assertProjectMember(user.id, projectId);
    const job = await rejectRewriteJob(projectId, episodeId, jobId);
    return { ...(await buildResponse(projectId, episodeId)), job };
  });
}
