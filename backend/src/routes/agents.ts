import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AGENT_PROFILES, AGENT_ROLES } from "@toburt/shared";
import type { AgentRole } from "@toburt/shared";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { getAgent } from "../agents/registry.js";
import { runAgent } from "../agents/runner.js";
import { runWithArbitration } from "../agents/arbitration.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { postRoomMessage } from "../orchestrator/room.js";

const Invoke = z.object({
  projectId: z.string().uuid(),
  role: z.enum(AGENT_ROLES as readonly [AgentRole, ...AgentRole[]]),
  input: z.unknown(),
  workflowId: z.string().uuid().optional(),
  stage: z.string().optional(),
});

export default async function agentsRoutes(app: FastifyInstance) {
  app.get("/agents", async () => {
    return AGENT_ROLES.map((role) => ({ role, ...AGENT_PROFILES[role] }));
  });

  app.post("/agents/invoke", async (req) => {
    const user = await requireUser(req);
    const body = Invoke.parse(req.body);
    await assertProjectMember(user.id, body.projectId);

    const agent = getAgent(body.role);
    const collaborators = [body.role] as AgentRole[];
    const query =
      typeof body.input === "string"
        ? body.input
        : JSON.stringify(body.input).slice(0, 500);

    const ctx = await hydrateContext({
      projectId: body.projectId,
      workflowId: body.workflowId,
      stage: body.stage as never,
      collaborators,
      query,
      user: { id: user.id },
    });

    const result = await runAgent(agent, body.input, ctx);

    await postRoomMessage({
      projectId: body.projectId,
      workflowId: body.workflowId ?? null,
      stageId: (body.stage as never) ?? null,
      authorKind: "agent",
      authorRole: body.role,
      body: `${agent.label} responded.`,
      payload: result.output,
    });

    return result;
  });

  // Full Showrunner arbitration loop: agent submits → Showrunner reviews →
  // approve / veto / auto-revise. Every step is broadcast to the Writers
  // Room via Supabase Realtime so the UI can render the debate.
  app.post("/agents/arbitrate", async (req) => {
    const user = await requireUser(req);
    const Body = z.object({
      projectId: z.string().uuid(),
      role: z.enum(AGENT_ROLES as readonly [AgentRole, ...AgentRole[]]),
      input: z.unknown(),
      workflowId: z.string().uuid().optional(),
      stage: z.string().optional(),
      maxRevisions: z.number().int().min(0).max(5).optional(),
    });
    const body = Body.parse(req.body);
    await assertProjectMember(user.id, body.projectId);

    // The Showrunner cannot arbitrate itself — short-circuit to a plain
    // invoke so the caller still gets a sensible response.
    if (body.role === "showrunner") {
      const agent = getAgent("showrunner");
      const ctx = await hydrateContext({
        projectId: body.projectId,
        workflowId: body.workflowId,
        stage: body.stage as never,
        collaborators: ["showrunner"],
        query: JSON.stringify(body.input).slice(0, 500),
        user: { id: user.id },
      });
      const result = await runAgent(agent, body.input, ctx);
      return {
        output: result.output,
        decision: {
          decision: "approve",
          rationale: "Showrunner self-call (no arbitration).",
          notes: [],
        },
        approved: true,
        revisions: 0,
        trail: [],
      };
    }

    const agent = getAgent(body.role);
    const ctx = await hydrateContext({
      projectId: body.projectId,
      workflowId: body.workflowId,
      stage: body.stage as never,
      collaborators: [body.role, "showrunner"],
      query: JSON.stringify(body.input).slice(0, 500),
      user: { id: user.id },
    });

    return runWithArbitration(agent, body.input, ctx, {
      maxRevisions: body.maxRevisions ?? 2,
      persistToMemory: true,
    });
  });

  // Writers Room transcript.
  app.get("/projects/:projectId/room", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await (
      await import("../db/client.js")
    ).supabase
      .from("room_messages")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  });

  app.post("/projects/:projectId/room", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const Body = z.object({
      body: z.string().min(1),
      workflowId: z.string().uuid().optional(),
      stage: z.string().optional(),
    });
    const { body, workflowId, stage } = Body.parse(req.body);
    return postRoomMessage({
      projectId,
      workflowId: workflowId ?? null,
      stageId: (stage as never) ?? null,
      authorKind: "user",
      authorUserId: user.id,
      body,
    });
  });
}
