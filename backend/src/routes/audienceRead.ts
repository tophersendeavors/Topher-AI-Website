// Audience Read routes — the post-final-draft bingeability stage.
// Read-only analysis of the locked draft against a comps-grounded rubric.

import type { FastifyInstance } from "fastify";
import type { AudienceReadReport, AudienceReadResponse } from "@toburt/shared";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { AUDIENCE_READ_RUBRIC } from "../audienceRead/rubric.js";
import {
  getAudienceRead,
  putAudienceRead,
  approveAudienceRead,
  loadCurrentDraft,
  type CurrentDraft,
} from "../audienceRead/store.js";
import { generateAudienceRead } from "../audienceRead/generator.js";

function buildResponse(report: AudienceReadReport | null, draft: CurrentDraft): AudienceReadResponse {
  return {
    report,
    source: {
      scriptId: draft.scriptId,
      draftLabel: draft.draftLabel,
      isLocked: draft.isLocked,
      sceneCount: draft.scenes.length,
    },
    rubric: AUDIENCE_READ_RUBRIC,
  };
}

export default async function audienceReadRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/episodes/:episodeId/audience-read", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
    await assertProjectMember(user.id, projectId);
    const [report, draft] = await Promise.all([
      getAudienceRead(projectId, episodeId),
      loadCurrentDraft(projectId, episodeId),
    ]);
    return buildResponse(report, draft);
  });

  app.post("/projects/:projectId/episodes/:episodeId/audience-read/generate", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
    await assertProjectMember(user.id, projectId);

    const draft = await loadCurrentDraft(projectId, episodeId);
    if (!draft.scriptId || !draft.fountain.trim()) {
      const e = new Error("No draft to read yet for this episode.") as Error & { statusCode?: number };
      e.statusCode = 409;
      throw e;
    }

    const analysis = await generateAudienceRead({ fountain: draft.fountain, scenes: draft.scenes });
    const report: AudienceReadReport = {
      ...analysis,
      sourceScriptId: draft.scriptId,
      sourceDraftLabel: draft.draftLabel ?? "Draft",
      sourceFountainHash: draft.fountainHash,
      rubricVersion: AUDIENCE_READ_RUBRIC.version,
      generatedAt: new Date().toISOString(),
      approvedAt: null,
      approvedBy: null,
    };
    const saved = await putAudienceRead(projectId, episodeId, report);
    return buildResponse(saved, draft);
  });

  app.post("/projects/:projectId/episodes/:episodeId/audience-read/approve", async (req) => {
    const user = await requireUser(req);
    const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
    await assertProjectMember(user.id, projectId);
    const [report, draft] = await Promise.all([
      approveAudienceRead(projectId, episodeId, user.id),
      loadCurrentDraft(projectId, episodeId),
    ]);
    return buildResponse(report, draft);
  });
}
