// Wayfinder — HTTP routes. Read-only.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { resolveWayfinder } from "../wayfinder/resolver.js";

export default async function wayfinderRoutes(app: FastifyInstance) {
  // Project-scope; optional ?episodeId=… narrows to that episode.
  app.get("/projects/:projectId/wayfinder", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const qs = (req.query ?? {}) as { episodeId?: string };
    return resolveWayfinder(projectId, qs.episodeId ?? null);
  });

  // Episode-scope; explicit episodeId in the path.
  app.get(
    "/projects/:projectId/episodes/:episodeId/wayfinder",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as {
        projectId: string;
        episodeId: string;
      };
      await assertProjectMember(user.id, projectId);
      return resolveWayfinder(projectId, episodeId);
    }
  );
}
