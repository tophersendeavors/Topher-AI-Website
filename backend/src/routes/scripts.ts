import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { parseFountain } from "../screenplay/fountain.js";

const Create = z.object({
  projectId: z.string().uuid(),
  title: z.string().min(1),
  fountain: z.string().default(""),
  episodeId: z.string().uuid().optional(),
});

const Update = z.object({
  fountain: z.string().optional(),
  title: z.string().optional(),
});

export default async function scriptsRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/scripts", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("scripts")
      .select("*")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

  app.get("/scripts/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script, error } = await supabase
      .from("scripts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    await assertProjectMember(user.id, script.project_id);
    return script;
  });

  app.post("/scripts", async (req) => {
    const user = await requireUser(req);
    const body = Create.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { data, error } = await supabase
      .from("scripts")
      .insert({
        project_id: body.projectId,
        episode_id: body.episodeId ?? null,
        title: body.title,
        fountain: body.fountain,
      })
      .select("*")
      .single();
    if (error) throw error;
    if (body.fountain) await indexScenes(data.id, body.fountain);
    return data;
  });

  app.patch("/scripts/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = Update.parse(req.body);

    const { data: script, error: gerr } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (gerr) throw gerr;
    await assertProjectMember(user.id, script.project_id);

    const { data, error } = await supabase
      .from("scripts")
      .update(body)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    if (body.fountain !== undefined) await indexScenes(id, body.fountain);
    return data;
  });
}

async function indexScenes(scriptId: string, fountain: string) {
  const parsed = parseFountain(fountain);

  await supabase.from("script_scenes").delete().eq("script_id", scriptId);
  if (parsed.scenes.length === 0) return;

  const rows = parsed.scenes.map((s) => ({
    script_id: scriptId,
    ord: s.order,
    slugline: s.slugline,
    int_ext: s.intExt,
    time_of_day: s.timeOfDay,
    characters: [],          // resolved to character ids by a later pass
    summary: null,
    fountain: s.fountain,
    tags: [],
  }));
  await supabase.from("script_scenes").insert(rows);
}
