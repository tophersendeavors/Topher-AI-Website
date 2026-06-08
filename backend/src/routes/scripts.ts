import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { indexScenes } from "../screenplay/sceneIndex.js";

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

  // POST /scripts/:id/new-draft — explicit "start a new full revision".
  //
  // Draft numbers are ONLY incremented by this route. Decimal versions
  // (v1.1_SubtextPass, v1.2_RhythmEdit) are tracked under metadata via the
  // audit; promoting to "Draft 2" must be a deliberate user action. The new
  // script row is seeded with the current draft's fountain so the writer can
  // start from where they were, demotes the prior draft (same episode scope),
  // and clears audit/title-page settings so they are re-derived freshly.
  app.post("/scripts/:id/new-draft", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: prior, error: gerr } = await supabase
      .from("scripts")
      .select("project_id, episode_id, draft_number, fountain, metadata")
      .eq("id", id)
      .single();
    if (gerr) throw gerr;
    await assertProjectMember(user.id, prior.project_id);

    const projectId = prior.project_id as string;
    const episodeId = (prior.episode_id as string | null) ?? null;
    const nextNum = ((prior.draft_number as number) ?? 0) + 1;

    // Demote prior current drafts within this episode scope only.
    const demote = supabase
      .from("scripts")
      .update({ current: false })
      .eq("project_id", projectId);
    await (episodeId ? demote.eq("episode_id", episodeId) : demote.is("episode_id", null));

    const { data: proj } = await supabase
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .maybeSingle();
    const ep = episodeId
      ? (
          await supabase
            .from("episodes")
            .select("number, title, title_status")
            .eq("id", episodeId)
            .maybeSingle()
        ).data
      : null;
    const epLabel = ep
      ? `Episode ${ep.number}${ep.title_status === "approved" && ep.title ? `: ${ep.title}` : ""}`
      : null;
    const draftTitle = epLabel
      ? `${proj?.title ?? "Untitled"} — ${epLabel} — Draft ${nextNum}`
      : `${proj?.title ?? "Untitled"} — Draft ${nextNum}`;

    // Carry over the writer credits / title-page settings but reset audit
    // history — Draft N+1 should re-prove itself.
    const priorMeta = (prior.metadata as Record<string, unknown>) ?? {};
    const carryMeta: Record<string, unknown> = {
      source: "new_draft",
      promoted_from: id,
    };
    if (priorMeta.titlePage) carryMeta.titlePage = priorMeta.titlePage;
    if (priorMeta.writers) carryMeta.writers = priorMeta.writers;

    const { data: next, error: ierr } = await supabase
      .from("scripts")
      .insert({
        project_id: projectId,
        episode_id: episodeId,
        title: draftTitle,
        draft_number: nextNum,
        fountain: (prior.fountain as string) ?? "",
        current: true,
        metadata: carryMeta,
      })
      .select("*")
      .single();
    if (ierr) throw ierr;
    // Index scenes from the carried fountain so the per-scene workspace
    // can operate immediately on the new draft.
    if (next.fountain) await indexScenes(next.id, next.fountain);
    return next;
  });

  // POST /scripts/:id/credits — record the writer(s) of this draft in metadata.
  // Scene-safe: only touches metadata, never the fountain (so scenes are kept).
  app.post("/scripts/:id/credits", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { writers } = z
      .object({ writers: z.array(z.string().trim().min(1)).max(12) })
      .parse(req.body ?? {});
    const { data: script, error: gerr } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (gerr) throw gerr;
    await assertProjectMember(user.id, script.project_id);
    const meta = {
      ...((script.metadata as Record<string, unknown>) ?? {}),
      writers,
    };
    const { data, error } = await supabase
      .from("scripts")
      .update({ metadata: meta })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });
}

// indexScenes was lifted to backend/src/screenplay/sceneIndex.ts so the
// micro-drama screenplay generator can reuse it without a routes→routes
// import. Keep the call sites above unchanged; the import points at the
// shared module now.
