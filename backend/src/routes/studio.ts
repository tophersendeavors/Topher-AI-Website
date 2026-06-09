// Studio Timeline — HTTP routes. Read-only.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { resolveStudioTimeline } from "../studio/timeline.js";

export default async function studioRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/studio-timeline", async (req, reply) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const timeline = await resolveStudioTimeline(projectId);
    if (!timeline) {
      reply.code(404);
      return { error: "project_not_found" };
    }
    return timeline;
  });
}
