import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import {
  runScriptEmotionalPass,
  runSceneEmotionalPass,
} from "../emotional/index.js";
import {
  validateScriptDirectness,
  validateSceneDirectness,
  DIRECTNESS_RULES,
} from "../screenplay/emotionalValidator.js";

const SceneBody = z.object({
  /** When omitted, defaults to the scene's own fountain from the DB. */
  fountain: z.string().optional(),
  characters: z.array(z.string()).optional(),
  relationshipId: z.string().uuid().optional(),
  workflowId: z.string().uuid().optional(),
});

export default async function emotionalRoutes(app: FastifyInstance) {
  // --- Validator (deterministic, no LLM cost) -----------------------------
  app.get("/screenplay/directness/rules", async () => DIRECTNESS_RULES);

  app.post(
    "/scripts/:scriptId/emotional/validate",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId } = req.params as { scriptId: string };
      const { data: script } = await supabase
        .from("scripts")
        .select("project_id, fountain")
        .eq("id", scriptId)
        .single();
      await assertProjectMember(user.id, script!.project_id);
      const { data: project } = await supabase
        .from("projects")
        .select("allow_stylistic_directness")
        .eq("id", script!.project_id)
        .maybeSingle();
      return validateScriptDirectness(script!.fountain ?? "", {
        allowStylistic: project?.allow_stylistic_directness ?? false,
      });
    }
  );

  // --- Single-scene EI pass ------------------------------------------------
  app.post("/scenes/:sceneId/emotional/pass", async (req) => {
    const user = await requireUser(req);
    const { sceneId } = req.params as { sceneId: string };
    const body = SceneBody.parse(req.body ?? {});

    const { data: scene, error } = await supabase
      .from("script_scenes")
      .select("id, fountain, characters, script_id")
      .eq("id", sceneId)
      .single();
    if (error) throw error;

    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", scene.script_id)
      .single();
    await assertProjectMember(user.id, script!.project_id);

    return runSceneEmotionalPass({
      projectId: script!.project_id,
      scriptId: scene.script_id,
      sceneId: scene.id,
      sceneFountain: body.fountain ?? scene.fountain ?? "",
      characters: body.characters ?? scene.characters ?? [],
      relationshipId: body.relationshipId,
      workflowId: body.workflowId,
      userId: user.id,
    });
  });

  // --- Full-script EI pass -------------------------------------------------
  app.post("/scripts/:scriptId/emotional/pass", async (req) => {
    const user = await requireUser(req);
    const { scriptId } = req.params as { scriptId: string };
    const { data: script, error } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", scriptId)
      .single();
    if (error) throw error;
    await assertProjectMember(user.id, script.project_id);
    return runScriptEmotionalPass({
      projectId: script.project_id,
      scriptId,
      userId: user.id,
    });
  });

  // --- Read: current emotional states for a script ------------------------
  app.get(
    "/scripts/:scriptId/emotional/states",
    async (req) => {
      const user = await requireUser(req);
      const { scriptId } = req.params as { scriptId: string };
      const { data: script } = await supabase
        .from("scripts")
        .select("project_id")
        .eq("id", scriptId)
        .single();
      await assertProjectMember(user.id, script!.project_id);
      const { data, error } = await supabase
        .from("scene_emotional_states")
        .select("*")
        .eq("script_id", scriptId)
        .eq("current", true)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    }
  );

  app.get(
    "/scenes/:sceneId/emotional/state",
    async (req) => {
      const user = await requireUser(req);
      const { sceneId } = req.params as { sceneId: string };
      const { data: scene } = await supabase
        .from("script_scenes")
        .select("script_id")
        .eq("id", sceneId)
        .single();
      const { data: script } = await supabase
        .from("scripts")
        .select("project_id")
        .eq("id", scene!.script_id)
        .single();
      await assertProjectMember(user.id, script!.project_id);
      const { data } = await supabase
        .from("scene_emotional_states")
        .select("*")
        .eq("scene_id", sceneId)
        .eq("current", true)
        .maybeSingle();
      return data;
    }
  );

  // --- Character wounds ----------------------------------------------------
  app.get(
    "/characters/:characterId/wound",
    async (req) => {
      const user = await requireUser(req);
      const { characterId } = req.params as { characterId: string };
      const { data: ch } = await supabase
        .from("characters")
        .select("project_id")
        .eq("id", characterId)
        .single();
      await assertProjectMember(user.id, ch!.project_id);
      const { data, error } = await supabase
        .from("character_wounds")
        .select("*")
        .eq("character_id", characterId)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? mapWoundRow(data) : null;
    }
  );

  app.get(
    "/projects/:projectId/wounds",
    async (req) => {
      const user = await requireUser(req);
      const { projectId } = req.params as { projectId: string };
      await assertProjectMember(user.id, projectId);
      const { data, error } = await supabase
        .from("character_wounds")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapWoundRow);
    }
  );

  // Helpers
  function mapWoundRow(row: Record<string, unknown>) {
    return {
      characterId: row.character_id,
      kind: row.kind,
      wound: row.wound,
      fear: row.fear,
      unmetNeed: row.unmet_need,
      shameTrigger: row.shame_trigger,
      defenses: row.defenses ?? [],
      behavioralSignatures: row.behavioral_signatures ?? [],
    };
  }

  // --- Relationship tensions ----------------------------------------------
  app.get(
    "/projects/:projectId/tensions",
    async (req) => {
      const user = await requireUser(req);
      const { projectId } = req.params as { projectId: string };
      await assertProjectMember(user.id, projectId);
      const { data, error } = await supabase
        .from("relationship_tensions")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        relationshipId: row.relationship_id,
        aId: row.a_id,
        bId: row.b_id,
        unsaid: row.unsaid,
        history: row.history,
        currentPower: row.current_power,
        tensionScore: row.tension_score,
        pressurePoints: row.pressure_points ?? [],
      }));
    }
  );

  // --- Toggle stylistic-directness on a project ---------------------------
  app.patch("/projects/:projectId/emotional/settings", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({ allow_stylistic_directness: z.boolean() })
      .parse(req.body);
    const { data, error } = await supabase
      .from("projects")
      .update({ allow_stylistic_directness: body.allow_stylistic_directness })
      .eq("id", projectId)
      .select("id, allow_stylistic_directness")
      .single();
    if (error) throw error;
    return data;
  });
}
