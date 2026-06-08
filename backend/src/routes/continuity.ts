// Continuity Department routes.
// Reads/writes Location + Prop bibles under projects.metadata, and runs
// the heuristic Continuity Pass over a script.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { runContinuityPass } from "../continuity/validator.js";
import { normalizeKey } from "../continuity/types.js";
import type { LocationBible, PropBible } from "../continuity/types.js";

const ZFurniture = z.object({
  name: z.string().min(1),
  position: z.string().min(1),
  orientation: z.string().optional(),
  locked: z.boolean().optional(),
});
const ZCameraRule = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});
const ZLighting = z.object({
  name: z.string().min(1),
  color: z.string().min(1),
  direction: z.string().optional(),
  intensity: z.string().optional(),
});
const ZLocationBible = z.object({
  name: z.string().min(1),
  layout: z.string().default(""),
  furniture: z.array(ZFurniture).default([]),
  props: z.array(ZFurniture).default([]),
  doors: z.array(ZFurniture).default([]),
  windows: z.array(ZFurniture).default([]),
  cameraSafeAngles: z.array(ZCameraRule).default([]),
  forbiddenAngles: z.array(ZCameraRule).default([]),
  eyelineRules: z.array(z.string()).default([]),
  lightingSources: z.array(ZLighting).default([]),
  continuityAnchors: z.array(z.string()).default([]),
  doNotFlip: z.boolean().default(true),
  continuityPrompt: z.string().default(""),
  notes: z.string().optional(),
  approved: z.boolean().optional(),
});
const ZPropBible = z.object({
  name: z.string().min(1),
  homeLocation: z.string().optional(),
  startsAt: z.string().default(""),
  endsAt: z.string().default(""),
  orientation: z.string().optional(),
  handledBy: z.array(z.string()).default([]),
  visualDetails: z.string().default(""),
  episodesPresent: z.array(z.number().int()).default([]),
  doNotChange: z.array(z.string()).default([]),
  notes: z.string().optional(),
  approved: z.boolean().optional(),
});

export default async function continuityRoutes(app: FastifyInstance) {
  // ---- Location bibles ---------------------------------------------------

  app.get("/projects/:projectId/continuity/locations", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single();
    const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    const bibles = (meta.locationBibles as Record<string, LocationBible>) ?? {};
    return Object.values(bibles);
  });

  app.post("/projects/:projectId/continuity/locations", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = ZLocationBible.parse(req.body ?? {});
    const { data } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single();
    const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    const bibles = (meta.locationBibles as Record<string, LocationBible>) ?? {};
    const now = new Date().toISOString();
    const key = normalizeKey(body.name);
    const existing = bibles[key];
    const next: LocationBible = {
      ...body,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    bibles[key] = next;
    meta.locationBibles = bibles;
    await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
    return next;
  });

  app.delete("/projects/:projectId/continuity/locations/:key", async (req) => {
    const user = await requireUser(req);
    const { projectId, key } = req.params as { projectId: string; key: string };
    await assertProjectMember(user.id, projectId);
    const { data } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single();
    const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    const bibles = (meta.locationBibles as Record<string, LocationBible>) ?? {};
    const norm = normalizeKey(key);
    delete bibles[norm];
    meta.locationBibles = bibles;
    await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
    return { deleted: norm };
  });

  // ---- Prop bibles -------------------------------------------------------

  app.get("/projects/:projectId/continuity/props", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single();
    const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    const bibles = (meta.propBibles as Record<string, PropBible>) ?? {};
    return Object.values(bibles);
  });

  app.post("/projects/:projectId/continuity/props", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = ZPropBible.parse(req.body ?? {});
    const { data } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single();
    const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    const bibles = (meta.propBibles as Record<string, PropBible>) ?? {};
    const now = new Date().toISOString();
    const key = normalizeKey(body.name);
    const existing = bibles[key];
    const next: PropBible = {
      ...body,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    bibles[key] = next;
    meta.propBibles = bibles;
    await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
    return next;
  });

  app.delete("/projects/:projectId/continuity/props/:key", async (req) => {
    const user = await requireUser(req);
    const { projectId, key } = req.params as { projectId: string; key: string };
    await assertProjectMember(user.id, projectId);
    const { data } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single();
    const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
    const bibles = (meta.propBibles as Record<string, PropBible>) ?? {};
    const norm = normalizeKey(key);
    delete bibles[norm];
    meta.propBibles = bibles;
    await supabase.from("projects").update({ metadata: meta }).eq("id", projectId);
    return { deleted: norm };
  });

  // ---- Continuity Pass --------------------------------------------------

  // POST: run + persist on script.metadata.continuity.
  app.post("/scripts/:id/continuity/pass", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const result = await runContinuityPass(id);
    const meta = (script.metadata as Record<string, unknown> | null) ?? {};
    meta.continuity = result;
    await supabase.from("scripts").update({ metadata: meta }).eq("id", id);
    return result;
  });

  // GET: cached result (if any).
  app.get("/scripts/:id/continuity/status", async (req) => {
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
    const cont = (meta.continuity ?? null) as Record<string, unknown> | null;
    const manualFindings = ((meta.continuityManualFindings as Array<unknown> | undefined) ?? []);
    if (cont) {
      // Merge manual findings into the issues list so the panel renders
      // them alongside heuristic findings. Tag them so we know which is
      // which (manual ones display "Logged by Script Supervisor").
      return { ...cont, manualFindings };
    }
    return manualFindings.length > 0 ? { manualFindings } : null;
  });

  // Manual finding — the Script Supervisor logs something the
  // heuristic missed (wardrobe drift, DP brief contradiction, etc.).
  app.post("/scripts/:id/continuity/manual-finding", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const body = z
      .object({
        category: z.enum([
          "character",
          "location",
          "prop",
          "eyeline",
          "reference",
          "story_containment",
          "other",
        ]),
        severity: z.enum(["warning", "fail"]),
        message: z.string().min(1),
        sceneOrd: z.number().int().min(0).nullable().optional(),
        shotIndex: z.number().int().min(0).nullable().optional(),
        suggestedFix: z.string().optional(),
      })
      .parse(req.body ?? {});
    const meta = (script.metadata as Record<string, unknown> | null) ?? {};
    const arr = ((meta.continuityManualFindings as Array<unknown> | undefined) ?? []) as Array<Record<string, unknown>>;
    const id_ = `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    arr.push({
      id: id_,
      category: body.category,
      severity: body.severity,
      message: body.message,
      where: {
        sceneOrd: body.sceneOrd ?? null,
        shotIndex: body.shotIndex ?? null,
      },
      suggestedFix: body.suggestedFix ?? "",
      loggedBy: user.id,
      loggedAt: new Date().toISOString(),
      source: "manual",
    });
    meta.continuityManualFindings = arr;
    await supabase.from("scripts").update({ metadata: meta }).eq("id", id);
    return { ok: true, id: id_ };
  });

  app.delete("/scripts/:id/continuity/manual-finding/:findingId", async (req) => {
    const user = await requireUser(req);
    const { id, findingId } = req.params as { id: string; findingId: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id as string);
    const meta = (script.metadata as Record<string, unknown> | null) ?? {};
    const arr = ((meta.continuityManualFindings as Array<unknown> | undefined) ?? []) as Array<Record<string, unknown>>;
    meta.continuityManualFindings = arr.filter((x) => (x as { id?: string }).id !== findingId);
    await supabase.from("scripts").update({ metadata: meta }).eq("id", id);
    return { ok: true };
  });
}
