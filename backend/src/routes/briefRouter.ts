// Brief Router — HTTP routes. Read-only.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { routeEpisodeBriefs } from "../brief/router.js";
import {
  exportRoleBriefsJson,
  exportRoleBriefsMarkdown,
} from "../brief/exporters.js";

export default async function briefRouterRoutes(app: FastifyInstance) {
  // GET role-routed briefs for an episode (optionally narrowed to a
  // single shot via ?shotKey=<sceneOrd>-<shotIndex> and/or a single role
  // via ?roleKey=…).
  app.get(
    "/projects/:projectId/episodes/:episodeId/role-briefs",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as {
        projectId: string;
        episodeId: string;
      };
      await assertProjectMember(user.id, projectId);
      const qs = (req.query ?? {}) as {
        shotKey?: string;
        roleKey?: string;
      };
      const resp = await routeEpisodeBriefs(projectId, episodeId, {
        shotKey: qs.shotKey,
        roleKey: qs.roleKey,
      });
      if (!resp) {
        reply.code(404);
        return { error: "project_or_episode_not_found" };
      }
      return resp;
    }
  );

  // GET role-routed briefs exported as a single file (?format=json|markdown).
  app.get(
    "/projects/:projectId/episodes/:episodeId/role-briefs/export",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as {
        projectId: string;
        episodeId: string;
      };
      await assertProjectMember(user.id, projectId);
      const qs = (req.query ?? {}) as { format?: string };
      const format = qs.format === "markdown" ? "markdown" : "json";
      const resp = await routeEpisodeBriefs(projectId, episodeId, {});
      if (!resp) {
        reply.code(404);
        return { error: "project_or_episode_not_found" };
      }
      const body = format === "markdown" ? exportRoleBriefsMarkdown(resp) : exportRoleBriefsJson(resp);
      const epSlug =
        resp.episodeNumber !== null
          ? `EP${String(resp.episodeNumber).padStart(2, "0")}`
          : resp.episodeId.slice(0, 6);
      const filename = `role-briefs_${epSlug}.${format === "markdown" ? "md" : "json"}`;
      reply.header(
        "content-type",
        format === "markdown"
          ? "text/markdown; charset=utf-8"
          : "application/json; charset=utf-8"
      );
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      return body;
    }
  );
}
