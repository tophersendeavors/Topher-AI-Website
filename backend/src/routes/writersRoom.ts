// Writers Room routes — seating + collaborator assignment over the reusable
// profile libraries. The room drives the existing writing engine in a later
// phase; this layer manages who sits at the table.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIVE_PERMISSIONS, WRITING_MODES, type LivePermission, type WritersRoomResponse, type WritingMode } from "@toburt/shared";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { getStudioOwner } from "../studio/identityStore.js";
import { STUDIO_AI_WRITER, WRITING_CREATIVES, QUALITY_STAFF } from "../writersRoom/profiles.js";
import { getWritersRoomState, assignSeat, clearSeat, setWritingMode } from "../writersRoom/store.js";
import { runReviewAgent, skipReviewAgent, resetReviewAgent, applyReviewRewrite } from "../writersRoom/review.js";
import { getLockStatus, updateLockSettings, lockFinalDraft, unlockFinalDraft } from "../writersRoom/lock.js";
import { listTalent } from "../talent/store.js";

export default async function writersRoomRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/writers-room", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const [state, owner, talent] = await Promise.all([
      getWritersRoomState(projectId),
      getStudioOwner(user.id),
      listTalent(user.id),
    ]);
    const head =
      owner.name
        ? {
            name: owner.name === "chris" ? "Studio Owner" : owner.name,
            roleLabel: "Lead Writer · Showrunner",
            avatarUrl: owner.avatarUrl,
          }
        : null;
    const res: WritersRoomResponse = {
      state,
      head,
      aiWriter: STUDIO_AI_WRITER,
      creatives: WRITING_CREATIVES,
      qualityStaff: QUALITY_STAFF,
      talent,
    };
    return res;
  });

  app.put("/projects/:projectId/writers-room/mode", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { mode } = z
      .object({ mode: z.enum(WRITING_MODES as unknown as [WritingMode, ...WritingMode[]]) })
      .parse(req.body);
    const state = await setWritingMode(projectId, mode, user.id);
    return { state };
  });

  app.put("/projects/:projectId/writers-room/seats/:seatId", async (req) => {
    const user = await requireUser(req);
    const { projectId, seatId } = req.params as { projectId: string; seatId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        kind: z.enum(["ai_writer", "ai_creative", "live_person"]),
        profileId: z.string().optional(),
        talentId: z.string().optional(),
        name: z.string().max(120).optional(),
        email: z.string().max(160).optional(),
        role: z.string().max(120).optional(),
        permission: z.enum(LIVE_PERMISSIONS as unknown as [LivePermission, ...LivePermission[]]).optional(),
      })
      .parse(req.body);
    const state = await assignSeat(projectId, seatId, body, user.id);
    return { state };
  });

  app.delete("/projects/:projectId/writers-room/seats/:seatId", async (req) => {
    const user = await requireUser(req);
    const { projectId, seatId } = req.params as { projectId: string; seatId: string };
    await assertProjectMember(user.id, projectId);
    const state = await clearSeat(projectId, seatId);
    return { state };
  });

  // --- Review Bench: run / skip / apply / reset a quality agent -------------
  const reviewAction =
    (fn: (projectId: string, agentId: string) => Promise<unknown>) => async (req: import("fastify").FastifyRequest) => {
      const user = await requireUser(req);
      const { projectId, agentId } = req.params as { projectId: string; agentId: string };
      await assertProjectMember(user.id, projectId);
      const state = await fn(projectId, agentId);
      return { state };
    };

  app.post("/projects/:projectId/writers-room/review/:agentId/run", reviewAction(runReviewAgent));
  app.post("/projects/:projectId/writers-room/review/:agentId/skip", reviewAction(skipReviewAgent));
  app.post("/projects/:projectId/writers-room/review/:agentId/apply", reviewAction(applyReviewRewrite));
  app.post("/projects/:projectId/writers-room/review/:agentId/reset", reviewAction(resetReviewAgent));

  // --- Final Draft Lock ----------------------------------------------------
  app.get("/projects/:projectId/writers-room/lock", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return { status: await getLockStatus(projectId) };
  });

  app.put("/projects/:projectId/writers-room/lock/settings", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const patch = z
      .object({
        humanReadStatus: z.enum(["pending", "complete", "skipped"]).optional(),
        notesWaived: z.boolean().optional(),
        creatorApproved: z.boolean().optional(),
      })
      .parse(req.body);
    return { status: await updateLockSettings(projectId, patch) };
  });

  app.post("/projects/:projectId/writers-room/lock", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return { status: await lockFinalDraft(projectId, user.id) };
  });

  app.post("/projects/:projectId/writers-room/lock/unlock", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return { status: await unlockFinalDraft(projectId) };
  });
}
