import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { supabase } from "../db/client.js";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember, listProjectsForUser } from "../db/queries.js";

const Create = z.object({
  title: z.string().min(1),
  kind: z.enum(["feature", "pilot", "miniseries", "short", "series"]).default("feature"),
  logline: z.string().optional(),
  genre: z.array(z.string()).optional(),
  tone: z.array(z.string()).optional(),
  inspirations: z.array(z.string()).optional(),
  showrunner_notes: z.string().optional(),
});

const Update = Create.partial();

export default async function projectsRoutes(app: FastifyInstance) {
  app.get("/projects", async (req) => {
    const user = await requireUser(req);
    return listProjectsForUser(user.id);
  });

  app.get("/projects/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    return data;
  });

  app.post("/projects", async (req) => {
    const user = await requireUser(req);
    const body = Create.parse(req.body);
    const { data, error } = await supabase
      .from("projects")
      .insert({ ...body, owner_id: user.id })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  app.patch("/projects/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const body = Update.parse(req.body);
    const { data, error } = await supabase
      .from("projects")
      .update(body)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  app.delete("/projects/:id", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const { error } = await supabase.from("projects").delete().eq("id", id);
    if (error) throw error;
    return reply.code(204).send();
  });
}
