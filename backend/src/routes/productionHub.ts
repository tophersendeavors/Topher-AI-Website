// Production Hub — single GET endpoint that returns a per-episode
// readiness summary. Read-only.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { buildProductionHub } from "../productionHub/readiness.js";

export default async function productionHubRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/production-hub", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return buildProductionHub(projectId);
  });
}
