// Production Design routes.
//   • Project-level Visual World Rules (CRUD)
//   • Per-script PD pass (POST run, GET cached)

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { runProductionDesignPass } from "../productionDesign/designer.js";
import type { VisualWorldRules } from "../productionDesign/types.js";

const ZVWR = z.object({
  aesthetic: z.array(z.string()).default([]),
  forbidden: z.array(z.string()).default([]),
  lighting: z.array(z.string()).default([]),
  texture: z.array(z.string()).default([]),
  notes: z.string().optional(),
  approved: z.boolean().optional(),
});

export default async function productionDesignRoutes(app: FastifyInstance) {
  // ---- Visual World Rules ------------------------------------------------

  app.get(
    "/projects/:projectId/production-design/visual-world-rules",
    async (req) => {
      const user = await requireUser(req);
      const { projectId } = req.params as { projectId: string };
      await assertProjectMember(user.id, projectId);
      const { data } = await supabase
        .from("projects")
        .select("metadata")
        .eq("id", projectId)
        .maybeSingle();
      const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
      return (meta.visualWorldRules as VisualWorldRules | undefined) ?? null;
    }
  );

  app.post(
    "/projects/:projectId/production-design/visual-world-rules",
    async (req) => {
      const user = await requireUser(req);
      const { projectId } = req.params as { projectId: string };
      await assertProjectMember(user.id, projectId);
      const body = ZVWR.parse(req.body ?? {});
      const { data } = await supabase
        .from("projects")
        .select("metadata")
        .eq("id", projectId)
        .maybeSingle();
      const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
      const now = new Date().toISOString();
      const existing = meta.visualWorldRules as VisualWorldRules | undefined;
      const next: VisualWorldRules = {
        ...body,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      meta.visualWorldRules = next;
      await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
      return next;
    }
  );

  // ---- Per-script PD pass -----------------------------------------------

  app.post("/scripts/:id/production-design/pass", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const result = await runProductionDesignPass(id);
    const meta = (script.metadata as Record<string, unknown> | null) ?? {};
    meta.productionDesign = result;
    await supabase.from("scripts").update({ metadata: meta }).eq("id", id);
    return result;
  });

  app.get("/scripts/:id/production-design/status", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const meta = (script.metadata as Record<string, unknown> | null) ?? {};
    return meta.productionDesign ?? null;
  });
}
