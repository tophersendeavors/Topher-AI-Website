// Production Package Export — HTTP routes.
//
// Read-only. Never writes scripts.fountain or script_scenes. Never
// regenerates scenes. Reads from every approved canon source and
// streams a single ZIP back.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { buildProductionPackage } from "../productionPackage/builder.js";

export default async function productionPackageRoutes(app: FastifyInstance) {
  // GET dry-run — returns the manifest only (no zip body). Used by the
  // UI to surface warnings BEFORE the user clicks download.
  app.get(
    "/projects/:projectId/episodes/:episodeId/production-package/preview",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const { manifest, filename } = await buildProductionPackage({
        projectId,
        episodeId,
      });
      return { manifest, filename };
    }
  );

  app.get(
    "/projects/:projectId/production-package/preview",
    async (req) => {
      const user = await requireUser(req);
      const { projectId } = req.params as { projectId: string };
      await assertProjectMember(user.id, projectId);
      const { manifest, filename } = await buildProductionPackage({
        projectId,
        episodeId: null,
      });
      return { manifest, filename };
    }
  );

  // GET zip — streams the actual binary back.
  app.get(
    "/projects/:projectId/episodes/:episodeId/production-package/export",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const { zip, filename } = await buildProductionPackage({
        projectId,
        episodeId,
      });
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      return zip;
    }
  );

  app.get(
    "/projects/:projectId/production-package/export",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId } = req.params as { projectId: string };
      await assertProjectMember(user.id, projectId);
      const { zip, filename } = await buildProductionPackage({
        projectId,
        episodeId: null,
      });
      reply.header("content-type", "application/zip");
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      return zip;
    }
  );
}
