import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";

const CharacterCreate = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  archetype: z.string().optional(),
  role: z.string().optional(),
  biography: z.string().optional(),
  wants: z.string().optional(),
  needs: z.string().optional(),
  flaw: z.string().optional(),
  voice_notes: z.string().optional(),
  arc: z.record(z.unknown()).optional(),
});

const EpisodeCreate = z.object({
  projectId: z.string().uuid(),
  seasonId: z.string().uuid().optional(),
  number: z.number().int().positive(),
  title: z.string().optional(),
  logline: z.string().optional(),
});

const SeasonCreate = z.object({
  projectId: z.string().uuid(),
  number: z.number().int().positive(),
  title: z.string().optional(),
  premise: z.string().optional(),
});

const LocationCreate = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  kind: z.string().optional(),
  description: z.string().optional(),
});

export default async function entitiesRoutes(app: FastifyInstance) {
  // ---------- Characters ----------
  app.get("/projects/:projectId/characters", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("characters")
      .select("*")
      .eq("project_id", projectId)
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

  app.post("/characters", async (req) => {
    const user = await requireUser(req);
    const body = CharacterCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, ...rest } = body;
    const { data, error } = await supabase
      .from("characters")
      .insert({ project_id: projectId, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  app.patch("/characters/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id")
      .eq("id", id)
      .single();
    await assertProjectMember(user.id, ch!.project_id);
    const body = CharacterCreate.partial().parse(req.body);
    const { projectId: _p, ...rest } = body;
    const { data, error } = await supabase
      .from("characters")
      .update(rest)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Seasons ----------
  app.get("/projects/:projectId/seasons", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("seasons")
      .select("*")
      .eq("project_id", projectId)
      .order("number");
    if (error) throw error;
    return data ?? [];
  });

  app.post("/seasons", async (req) => {
    const user = await requireUser(req);
    const body = SeasonCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, ...rest } = body;
    const { data, error } = await supabase
      .from("seasons")
      .insert({ project_id: projectId, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Episodes ----------
  app.get("/projects/:projectId/episodes", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("episodes")
      .select("*")
      .eq("project_id", projectId)
      .order("number");
    if (error) throw error;
    return data ?? [];
  });

  app.post("/episodes", async (req) => {
    const user = await requireUser(req);
    const body = EpisodeCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, seasonId, ...rest } = body;
    const { data, error } = await supabase
      .from("episodes")
      .insert({ project_id: projectId, season_id: seasonId ?? null, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Locations ----------
  app.get("/projects/:projectId/locations", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .eq("project_id", projectId)
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

  app.post("/locations", async (req) => {
    const user = await requireUser(req);
    const body = LocationCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, ...rest } = body;
    const { data, error } = await supabase
      .from("locations")
      .insert({ project_id: projectId, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Continuity issues ----------
  app.get("/projects/:projectId/continuity", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("continuity_issues")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });
}
