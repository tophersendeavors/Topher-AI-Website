// Wayfinder — HTTP routes. Read-only.
//
// ?scope=production keeps dev-phase warnings out of the primary next
// step. Dev findings are returned as nonProductionWarnings so the
// frontend can show them in a secondary "story cleanup" panel.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { resolveWayfinder } from "../wayfinder/resolver.js";
import type { WayfinderScope } from "@toburt/shared";

function parseScope(raw: unknown): WayfinderScope {
  return raw === "production" ? "production" : "general";
}

export default async function wayfinderRoutes(app: FastifyInstance) {
  // Project-scope; optional ?episodeId=… narrows to that episode.
  app.get("/projects/:projectId/wayfinder", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const qs = (req.query ?? {}) as { episodeId?: string; scope?: string };
    return resolveWayfinder(projectId, qs.episodeId ?? null, parseScope(qs.scope));
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
      const qs = (req.query ?? {}) as { scope?: string };
      return resolveWayfinder(projectId, episodeId, parseScope(qs.scope));
    }
  );
}
