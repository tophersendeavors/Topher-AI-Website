import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { parseFountain } from "../screenplay/fountain.js";
import { buildShotlist } from "../production/shotlist.js";
import { buildStoryboardPrompts } from "../production/storyboard.js";
import { buildFlowPrompt } from "../production/flow.js";

const Tool = z.enum(["shotlist", "storyboard", "flow"]);

export default async function productionRoutes(app: FastifyInstance) {
  app.get("/scripts/:id/production/:tool", async (req, reply) => {
    const user = await requireUser(req);
    const { id, tool } = req.params as { id: string; tool: string };
    const parsedTool = Tool.safeParse(tool);
    if (!parsedTool.success)
      return reply.code(400).send({ error: "unknown_tool" });

    const { data: script, error } = await supabase
      .from("scripts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    await assertProjectMember(user.id, script.project_id);

    const parsed = parseFountain(script.fountain ?? "");

    switch (parsedTool.data) {
      case "shotlist":
        return parsed.scenes.map(buildShotlist);
      case "storyboard":
        return parsed.scenes.flatMap((s) => buildStoryboardPrompts(s));
      case "flow":
        return parsed.scenes.map((s) => buildFlowPrompt(s));
    }
  });

  // Persist a generated production asset.
  app.post("/scripts/:id/production/:tool", async (req) => {
    const user = await requireUser(req);
    const { id, tool } = req.params as { id: string; tool: string };
    const parsedTool = Tool.parse(tool);
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    await assertProjectMember(user.id, script!.project_id);

    const Body = z.object({ body: z.unknown(), sceneId: z.string().uuid().optional() });
    const { body, sceneId } = Body.parse(req.body);
    const kindMap = {
      shotlist: "shotlist",
      storyboard: "storyboard_prompt",
      flow: "flow_prompt",
    } as const;
    const { data, error } = await supabase
      .from("production_assets")
      .insert({
        project_id: script!.project_id,
        script_id: id,
        scene_id: sceneId ?? null,
        kind: kindMap[parsedTool],
        body: body as object,
      })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });
}
