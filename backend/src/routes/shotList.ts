// Curated Shot List — HTTP routes.
//
// Every write targets scripts.metadata only (briefs / curated rows /
// shotListApproval). No writes to fountain or script_scenes. Regenerate
// endpoints proxy to the existing autoBuildBriefs / regenerateOneBrief
// — we never build a parallel shot-list generator.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import {
  addShot,
  approveEpisode,
  approveScene,
  approveShot,
  duplicateShot,
  editShot,
  exportShotListCSV,
  exportShotListJSON,
  exportShotListMarkdown,
  getShotList,
  removeShot,
  reorderShots,
} from "../shotList/store.js";
import {
  autoBuildSceneBriefs,
  regenerateOneBrief,
} from "../draft/aiPrompts/autoBuild.js";

async function assertScriptMember(scriptId: string, userId: string): Promise<void> {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("project_id")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  await assertProjectMember(userId, script.project_id as string);
}

const ShotEditSchema = z
  .object({
    primaryImage: z.string().optional(),
    shotType: z.string().optional(),
    cameraLanguage: z.string().optional(),
    subject: z.string().optional(),
    action: z.string().optional(),
    emotionalBeat: z.string().optional(),
    visualMotif: z.string().optional(),
    location: z.string().optional(),
    characters: z.array(z.string()).optional(),
    props: z.array(z.string()).optional(),
    durationSec: z.number().optional(),
    aspectRatio: z.string().optional(),
    aiModelHint: z.string().nullable().optional(),
    productionMode: z
      .enum(["ai_video", "live_action", "hybrid", "storyboard_only"])
      .optional(),
    status: z.enum(["draft", "needs_review", "approved"]).optional(),
    notes: z.string().optional(),
  })
  .strict();

export default async function shotListRoutes(app: FastifyInstance) {
  // GET full shot list
  app.get("/scripts/:scriptId/shot-list", async (req) => {
    const user = await requireUser(req);
    const { scriptId } = req.params as { scriptId: string };
    await assertScriptMember(scriptId, user.id);
    return getShotList(scriptId);
  });

  // PATCH one shot — edit fields.
  app.patch(
    "/scripts/:scriptId/scenes/:ord/shots/:shot/curated",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId, ord, shot } = req.params as {
        scriptId: string;
        ord: string;
        shot: string;
      };
      await assertScriptMember(scriptId, user.id);
      const patch = ShotEditSchema.parse(req.body ?? {});
      const row = await editShot(scriptId, parseInt(ord, 10), parseInt(shot, 10), patch);
      return { row };
    }
  );

  // POST add shot.
  app.post("/scripts/:scriptId/scenes/:ord/shots", async (req) => {
    const user = await requireUser(req);
    const { scriptId, ord } = req.params as { scriptId: string; ord: string };
    await assertScriptMember(scriptId, user.id);
    const seed = ShotEditSchema.optional().parse(req.body ?? {});
    const row = await addShot(scriptId, parseInt(ord, 10), seed);
    return { row };
  });

  // DELETE remove shot.
  app.delete(
    "/scripts/:scriptId/scenes/:ord/shots/:shot",
    async (req, reply) => {
      const user = await requireUser(req);
      const { scriptId, ord, shot } = req.params as {
        scriptId: string;
        ord: string;
        shot: string;
      };
      await assertScriptMember(scriptId, user.id);
      await removeShot(scriptId, parseInt(ord, 10), parseInt(shot, 10));
      reply.code(204).send();
    }
  );

  // POST duplicate.
  app.post(
    "/scripts/:scriptId/scenes/:ord/shots/:shot/duplicate",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId, ord, shot } = req.params as {
        scriptId: string;
        ord: string;
        shot: string;
      };
      await assertScriptMember(scriptId, user.id);
      const row = await duplicateShot(
        scriptId,
        parseInt(ord, 10),
        parseInt(shot, 10)
      );
      return { row };
    }
  );

  // PATCH reorder.
  app.patch(
    "/scripts/:scriptId/scenes/:ord/shots/reorder",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId, ord } = req.params as { scriptId: string; ord: string };
      await assertScriptMember(scriptId, user.id);
      const body = z
        .object({ order: z.array(z.number()).min(1) })
        .parse(req.body ?? {});
      await reorderShots(scriptId, parseInt(ord, 10), body.order);
      return { ok: true };
    }
  );

  // POST regenerate one shot — PROXIES to existing regenerateOneBrief.
  app.post(
    "/scripts/:scriptId/scenes/:ord/shots/:shot/regenerate",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId, ord, shot } = req.params as {
        scriptId: string;
        ord: string;
        shot: string;
      };
      await assertScriptMember(scriptId, user.id);
      const body = z
        .object({
          notes: z.string().optional(),
          sourceStrict: z.boolean().optional(),
          fields: z.array(z.string()).optional(),
          force: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const out = await regenerateOneBrief({
        scriptId,
        sceneOrd: parseInt(ord, 10),
        shotIndex: parseInt(shot, 10),
        notes: body.notes?.trim() || undefined,
        sourceStrict: body.sourceStrict,
        fields: body.fields,
        force: body.force,
      });
      return out;
    }
  );

  // POST regenerate full scene shot list — PROXIES to existing autoBuildSceneBriefs.
  app.post(
    "/scripts/:scriptId/scenes/:ord/shots/regenerate-scene",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId, ord } = req.params as { scriptId: string; ord: string };
      await assertScriptMember(scriptId, user.id);
      const body = z
        .object({
          mode: z.enum(["replace", "fill-empty"]).optional(),
          confirmOverwriteUserEdits: z.boolean().optional(),
          notes: z.string().optional(),
          sourceStrict: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      const out = await autoBuildSceneBriefs({
        scriptId,
        sceneOrd: parseInt(ord, 10),
        opts: body,
      });
      return out;
    }
  );

  // POST approve one shot.
  app.post(
    "/scripts/:scriptId/scenes/:ord/shots/:shot/approve",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId, ord, shot } = req.params as {
        scriptId: string;
        ord: string;
        shot: string;
      };
      await assertScriptMember(scriptId, user.id);
      await approveShot(scriptId, parseInt(ord, 10), parseInt(shot, 10), user.id);
      return { ok: true };
    }
  );

  // POST approve scene.
  app.post(
    "/scripts/:scriptId/scenes/:ord/shots/approve-scene",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId, ord } = req.params as { scriptId: string; ord: string };
      await assertScriptMember(scriptId, user.id);
      await approveScene(scriptId, parseInt(ord, 10), user.id);
      return { ok: true };
    }
  );

  // POST approve episode.
  app.post("/scripts/:scriptId/shot-list/approve", async (req) => {
    const user = await requireUser(req);
    const { scriptId } = req.params as { scriptId: string };
    await assertScriptMember(scriptId, user.id);
    await approveEpisode(scriptId, user.id);
    return { ok: true };
  });

  // GET export.
  app.get("/scripts/:scriptId/shot-list/export", async (req, reply) => {
    const user = await requireUser(req);
    const { scriptId } = req.params as { scriptId: string };
    await assertScriptMember(scriptId, user.id);
    const q = req.query as { format?: string };
    const format = (q.format ?? "markdown").toLowerCase();
    const list = await getShotList(scriptId);
    if (format === "json") {
      reply.header("content-type", "application/json");
      return exportShotListJSON(list);
    }
    if (format === "csv") {
      reply.header("content-type", "text/csv; charset=utf-8");
      return exportShotListCSV(list);
    }
    reply.header("content-type", "text/markdown; charset=utf-8");
    return exportShotListMarkdown(list);
  });
}
