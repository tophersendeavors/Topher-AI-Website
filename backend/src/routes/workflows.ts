import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { advanceWorkflow, decideApproval } from "../orchestrator/runner.js";

const Create = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1),
  episodeId: z.string().uuid().optional(),
  prompt: z.string().optional(),
});

const Advance = z.object({ prompt: z.string().optional() });
const Decide = z.object({
  decision: z.enum(["approved", "rejected", "revised"]),
  rationale: z.string().optional(),
});

export default async function workflowsRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/workflows", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("workflows")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

  app.post("/workflows", async (req) => {
    const user = await requireUser(req);
    const body = Create.parse(req.body);
    await assertProjectMember(user.id, body.projectId);

    const { data: wf, error } = await supabase
      .from("workflows")
      .insert({
        project_id: body.projectId,
        episode_id: body.episodeId ?? null,
        title: body.title,
      })
      .select("*")
      .single();
    if (error) throw error;

    if (body.prompt) {
      await supabase.from("workflow_stage_artifacts").insert({
        workflow_id: wf.id,
        stage_id: "idea",
        revision: 1,
        body: { idea: body.prompt },
        created_by: user.id,
      });
      await supabase
        .from("workflows")
        .update({ current_stage: "logline" })
        .eq("id", wf.id);
    }
    return wf;
  });

  app.post("/workflows/:id/advance", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { prompt } = Advance.parse(req.body ?? {});
    const { data: wf } = await supabase
      .from("workflows")
      .select("project_id")
      .eq("id", id)
      .single();
    if (wf) await assertProjectMember(user.id, wf.project_id);
    return advanceWorkflow(id, { prompt, userId: user.id });
  });

  app.get("/workflows/:id/artifacts", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: wf } = await supabase
      .from("workflows")
      .select("project_id")
      .eq("id", id)
      .single();
    if (wf) await assertProjectMember(user.id, wf.project_id);
    const { data, error } = await supabase
      .from("workflow_stage_artifacts")
      .select("*")
      .eq("workflow_id", id)
      .order("revision", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

  app.get("/workflows/:id/checkpoints", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: wf } = await supabase
      .from("workflows")
      .select("project_id")
      .eq("id", id)
      .single();
    if (wf) await assertProjectMember(user.id, wf.project_id);
    const { data, error } = await supabase
      .from("workflow_checkpoints")
      .select("*")
      .eq("workflow_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

  app.post("/workflows/:id/rollback", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { to } = z.object({ to: z.string().uuid() }).parse(req.body);
    const { data: wf } = await supabase
      .from("workflows")
      .select("project_id")
      .eq("id", id)
      .single();
    if (wf) await assertProjectMember(user.id, wf.project_id);

    const { data: ck, error } = await supabase
      .from("workflow_checkpoints")
      .select("*")
      .eq("id", to)
      .single();
    if (error) throw error;
    await supabase
      .from("workflows")
      .update({ current_stage: ck.stage_id, status: "rolled_back" })
      .eq("id", id);
    return { ok: true };
  });

  // Approvals.
  app.get("/projects/:projectId/approvals", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("approvals")
      .select("*")
      .eq("project_id", projectId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

  app.post("/approvals/:id/decide", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { decision, rationale } = Decide.parse(req.body);
    return decideApproval(id, decision, user.id, rationale);
  });
}
