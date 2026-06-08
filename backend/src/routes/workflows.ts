import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { advanceWorkflow, decideApproval } from "../orchestrator/runner.js";
import {
  materializeEpisodesFromArc,
  loadSeasonFoundationArtifacts,
} from "../orchestrator/episodes.js";
import { analyzeDevelopmentPackage } from "../draft/devPackage.js";
import { nextStage } from "../orchestrator/graph.js";
import type { SeasonArc } from "@toburt/shared";
import { reassembleLiveFountain } from "../draft/reassemble.js";
import { persistCastFromTreatment } from "../draft/cast.js";
import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";

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

  // Start (or resume) an episode-scoped workflow for one episode. Idempotent:
  // returns the existing episode workflow if one already exists.
  app.post("/episodes/:episodeId/develop", async (req) => {
    const user = await requireUser(req);
    const { episodeId } = req.params as { episodeId: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, project_id, number, title")
      .eq("id", episodeId)
      .maybeSingle();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id);

    const { data: existing } = await supabase
      .from("workflows")
      .select("*")
      .eq("project_id", ep.project_id)
      .eq("episode_id", episodeId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (existing) return existing;

    const { data: wf, error } = await supabase
      .from("workflows")
      .insert({
        project_id: ep.project_id,
        episode_id: episodeId,
        title: `Episode ${ep.number} — ${ep.title ?? "Untitled"}`,
        current_stage: "episode_outline",
      })
      .select("*")
      .single();
    if (error) throw error;
    return wf;
  });

  // Analyze a pasted development package → project/season/scene routing plan
  // (read-only; the writer reviews + applies each part separately).
  app.post("/projects/:projectId/dev-package/analyze", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { packageText, scriptId } = z
      .object({
        packageText: z.string().min(20, "Paste a development package first."),
        scriptId: z.string().uuid(),
      })
      .parse(req.body ?? {});
    return analyzeDevelopmentPackage({ projectId, scriptId, packageText });
  });

  // Apply a provided Season Arc (from the dev-package intake): materialize/
  // refresh episodes from it. Distinct from from-arc, which reads the stored arc.
  app.post("/projects/:projectId/season-arc/apply", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { arc } = z
      .object({
        arc: z.object({
          seasonNumber: z.number().int().positive().default(1),
          title: z.string().default(""),
          premise: z.string().default(""),
          throughline: z.string().default(""),
          episodes: z
            .array(
              z.object({
                number: z.number().int().positive(),
                title: z.string(),
                logline: z.string().default(""),
                tentpole: z.boolean().optional(),
              })
            )
            .min(1),
        }),
      })
      .parse(req.body ?? {});
    return materializeEpisodesFromArc(projectId, arc as SeasonArc);
  });

  // Fallback: (re)materialize episodes from the project's latest approved
  // Season Arc. The Season workflow does this automatically on approval; this
  // covers projects whose arc was approved before episodic support existed.
  app.post("/projects/:projectId/episodes/from-arc", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data: wfs } = await supabase
      .from("workflows")
      .select("id")
      .eq("project_id", projectId)
      .is("episode_id", null);
    const ids = (wfs ?? []).map((w) => w.id as string);
    if (!ids.length) return { created: [], existing: [], seasonId: null };
    const { data: art } = await supabase
      .from("workflow_stage_artifacts")
      .select("body")
      .in("workflow_id", ids)
      .eq("stage_id", "season_arc")
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    const arc = art?.body as SeasonArc | undefined;
    if (!arc) throw new Error("No approved Season Arc found for this project.");
    return materializeEpisodesFromArc(projectId, arc);
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

  // -----------------------------------------------------------------------
  // POST /approvals/:id/revise
  // "Reject with notes" — the user dislikes a stage's output and tells the AI
  // what to change. We reject the current approval, then re-run that same
  // stage feeding the notes back as a binding critique so the regeneration
  // addresses them. The stage produces a fresh artifact + a new approval.
  // -----------------------------------------------------------------------
  app.post("/approvals/:id/revise", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { notes } = z
      .object({ notes: z.string().min(1, "Add a note so the AI knows what to change.") })
      .parse(req.body);

    const { data: app, error } = await supabase
      .from("approvals")
      .select("id, workflow_id, project_id, status")
      .eq("id", id)
      .single();
    if (error) throw error;
    if (!app.workflow_id) throw new Error("This approval is not tied to a workflow.");
    await assertProjectMember(user.id, app.project_id);

    // Record the rejection + the user's notes.
    await supabase
      .from("approvals")
      .update({
        status: "rejected",
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        rationale: notes,
      })
      .eq("id", id);

    // Re-run the current (rejected) stage with the notes as a binding critique.
    return advanceWorkflow(app.workflow_id, {
      userId: user.id,
      revisionNote: notes,
    });
  });

  // -----------------------------------------------------------------------
  // POST /workflows/:id/enrich-scenes
  // ONE LLM call that turns the placeholder scene list into a real writing
  // contract. Keeps the prior revision; marks the new one ready_for_draft.
  // -----------------------------------------------------------------------
  app.post("/workflows/:id/enrich-scenes", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: wf } = await supabase
      .from("workflows")
      .select("project_id, episode_id")
      .eq("id", id)
      .single();
    if (!wf) throw new Error("workflow not found");
    await assertProjectMember(user.id, wf.project_id);

    // Load the latest revision of each prior stage we need as context.
    const { data: artifacts } = await supabase
      .from("workflow_stage_artifacts")
      .select("stage_id, revision, body")
      .eq("workflow_id", id)
      .order("revision", { ascending: false });
    const latest: Record<string, { revision: number; body: unknown }> = {};
    for (const a of artifacts ?? []) {
      if (!(a.stage_id in latest))
        latest[a.stage_id] = { revision: a.revision, body: a.body };
    }
    // Episode workflows don't own treatment/season_arc — backfill from the
    // Season workflow so scene enrichment has the full foundation as context.
    if (wf.episode_id) {
      const foundation = await loadSeasonFoundationArtifacts(wf.project_id);
      for (const k of ["treatment", "season_arc"] as const) {
        if (!(k in latest) && foundation[k])
          latest[k] = { revision: 0, body: foundation[k] };
      }
    }
    const sceneListPrev = latest.scene_list?.body as
      | { scenes: unknown[] }
      | undefined;
    if (!sceneListPrev?.scenes?.length) {
      throw new Error("No scene_list to enrich.");
    }

    // Pull showrunner notes for sticky vision.
    const { data: proj } = await supabase
      .from("projects")
      .select("title, logline, showrunner_notes")
      .eq("id", wf.project_id)
      .single();

    // Build the prompt. One LLM call, structured JSON output.
    const system = [
      "You are the Scene agent in the TOBURT Studios writers' room, doing a",
      "BATCH SCENE-LIST ENRICHMENT pass. You take a list of placeholder",
      "scenes and return the same scenes — same `order` numbers, same count",
      "— with concrete, production-ready metadata.",
      "",
      "Honor the Showrunner notes below as sticky vision.",
      "Lead with the people, not the metaphysics. Ground each scene in a",
      "physical place, a real time of day, and the named characters from",
      "the Treatment / Season Arc / Episode Outline.",
      "",
      "Return ONLY a single JSON object — no prose, no markdown fences:",
      "{",
      '  "scenes": [',
      "    {",
      '      "order": <int, must match input order>,',
      '      "intExt": "INT" | "EXT" | "INT/EXT",',
      '      "location": "<concrete place name, e.g. CASCADIA INSTITUTE - WEST CORRIDOR>",',
      '      "timeOfDay": "DAY" | "NIGHT" | "DUSK" | "DAWN" | "CONTINUOUS" | "LATER",',
      '      "slugline": "<intExt>. <LOCATION> - <TIME>",',
      '      "characters": ["<name>", ...],',
      '      "goal": "<what the POV character is trying to do>",',
      '      "conflict": "<the obstacle, internal or external>",',
      '      "turn": "<the emotional or informational shift by end of scene>",',
      '      "continuityNotes": "<wardrobe/prop/timeline notes; empty string if none>",',
      '      "visualMotif": "<recurring image, color, or framing; empty string if none>"',
      "    },",
      "    ...",
      "  ]",
      "}",
      "",
      proj?.showrunner_notes
        ? `# Showrunner notes (sticky vision):\n${proj.showrunner_notes}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const userPrompt = [
      `Project: ${proj?.title ?? ""} — ${proj?.logline ?? ""}`,
      "",
      "## Treatment",
      JSON.stringify(latest.treatment?.body ?? null, null, 2),
      "",
      "## Season Arc",
      JSON.stringify(latest.season_arc?.body ?? null, null, 2),
      "",
      "## Episode Outline (Episode 1)",
      JSON.stringify(latest.episode_outline?.body ?? null, null, 2),
      "",
      "## Beat Sheet",
      JSON.stringify(latest.beat_sheet?.body ?? null, null, 2),
      "",
      "## Current Scene List (placeholders to enrich)",
      JSON.stringify(sceneListPrev, null, 2),
      "",
      `Return enrichment for all ${sceneListPrev.scenes.length} scenes. Preserve order.`,
    ].join("\n");

    const res = await callLLM({
      model: config.SCENE_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.6,
      maxTokens: 12000,
    });

    let parsed: { scenes?: Record<string, unknown>[] };
    try {
      parsed = extractJSON(res.text);
    } catch (err) {
      throw new Error(
        `Scene agent did not return JSON. Last response (truncated): ${res.text.slice(0, 300)}`
      );
    }
    const enrichedRaw = parsed.scenes ?? [];
    if (!Array.isArray(enrichedRaw) || enrichedRaw.length === 0) {
      throw new Error("Scene agent returned no enriched scenes.");
    }

    // Merge: align by `order` field. Preserve original where the model omitted.
    const byOrder = new Map<number, Record<string, unknown>>();
    for (const e of enrichedRaw) {
      const o =
        typeof e.order === "number"
          ? e.order
          : typeof e.sceneNumber === "number"
          ? (e.sceneNumber as number)
          : null;
      if (o != null) byOrder.set(o, e);
    }
    const enrichedScenes = (sceneListPrev.scenes as Record<string, unknown>[]).map(
      (orig, i) => {
        const e = byOrder.get((orig.order as number) ?? i + 1) ?? {};
        const intExtRaw = typeof e.intExt === "string" ? e.intExt : "INT";
        const intExt = ["INT", "EXT", "INT/EXT"].includes(intExtRaw)
          ? (intExtRaw as "INT" | "EXT" | "INT/EXT")
          : "INT";
        const location =
          typeof e.location === "string" && e.location.trim()
            ? e.location.trim().toUpperCase()
            : (orig.location as string) ?? "PLACEHOLDER";
        const timeOfDay =
          typeof e.timeOfDay === "string" && e.timeOfDay.trim()
            ? e.timeOfDay.trim().toUpperCase()
            : (orig.timeOfDay as string) ?? "DAY";
        const slugline =
          typeof e.slugline === "string" && e.slugline.trim()
            ? e.slugline.trim()
            : `${intExt}. ${location} - ${timeOfDay}`;
        return {
          ...orig,
          intExt,
          location,
          timeOfDay,
          slugline,
          characters: Array.isArray(e.characters)
            ? (e.characters as unknown[]).filter(
                (c): c is string => typeof c === "string"
              )
            : (orig.characters as string[]) ?? [],
          goal: typeof e.goal === "string" ? e.goal : (orig.goal as string) ?? "",
          conflict:
            typeof e.conflict === "string"
              ? e.conflict
              : (orig.conflict as string) ?? "",
          turn: typeof e.turn === "string" ? e.turn : (orig.turn as string) ?? "",
          continuityNotes:
            typeof e.continuityNotes === "string" ? e.continuityNotes : "",
          visualMotif: typeof e.visualMotif === "string" ? e.visualMotif : "",
        };
      }
    );

    // Merge consecutive scenes that share the same slugline — two adjacent
    // beats in the same place/time are ONE scene, not two. Without this, a
    // beat sheet with several beats at the same location produces duplicate
    // scenes that the draft then writes multiple times.
    const mergedScenes = mergeConsecutiveScenes(enrichedScenes);

    const newRevision = (latest.scene_list?.revision ?? 0) + 1;
    const newBody = {
      scenes: mergedScenes,
      ready_for_draft: true,
      enriched_from_revision: latest.scene_list?.revision ?? null,
      enriched_at: new Date().toISOString(),
      merged_scene_count: enrichedScenes.length - mergedScenes.length,
    };

    const { data: art, error: artErr } = await supabase
      .from("workflow_stage_artifacts")
      .insert({
        workflow_id: id,
        stage_id: "scene_list",
        revision: newRevision,
        body: newBody,
        created_by: user.id,
      })
      .select("*")
      .single();
    if (artErr) throw artErr;

    return {
      status: "ok" as const,
      artifactId: art.id,
      revision: newRevision,
      previousRevision: latest.scene_list?.revision ?? null,
      sceneCount: mergedScenes.length,
      mergedAway: enrichedScenes.length - mergedScenes.length,
    };
  });

  // -----------------------------------------------------------------------
  // POST /workflows/:id/prepare-draft
  // Materialize the approved scene plan into a fresh script + PENDING scenes
  // (no prose). This is the shell Hollywood Draft Mode fills one scene at a
  // time with continuity gating — so Draft 1 is continuity-locked from page
  // one, not batch-drafted and cleaned up. Idempotent: if a gated-draft shell
  // with scenes already exists for this project, reuse it (never wipe written
  // scenes).
  // -----------------------------------------------------------------------
  app.post("/workflows/:id/prepare-draft", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: wf } = await supabase
      .from("workflows")
      .select("project_id, episode_id")
      .eq("id", id)
      .single();
    if (!wf) throw new Error("workflow not found");
    await assertProjectMember(user.id, wf.project_id);
    const projectId = wf.project_id as string;
    const episodeId = (wf.episode_id as string | null) ?? null;

    // Reuse an existing gated-draft shell so re-clicking "Write Draft 1" never
    // destroys scenes the user has already written. Scoped to THIS episode so
    // preparing Episode 2 never reuses or overwrites Episode 1's draft.
    const { data: currentScripts } = await supabase
      .from("scripts")
      .select("id, metadata, episode_id")
      .eq("project_id", projectId)
      .eq("current", true);
    for (const s of currentScripts ?? []) {
      const src = (s.metadata as { source?: string } | null)?.source;
      if (src !== "gated_draft") continue;
      if (((s.episode_id as string | null) ?? null) !== episodeId) continue;
      const { count } = await supabase
        .from("script_scenes")
        .select("id", { count: "exact", head: true })
        .eq("script_id", s.id);
      if ((count ?? 0) > 0) {
        return { status: "reused" as const, scriptId: s.id, projectId };
      }
    }

    // Load the latest scene_list; it must be enriched + ready_for_draft.
    const { data: artifacts } = await supabase
      .from("workflow_stage_artifacts")
      .select("stage_id, revision, body")
      .eq("workflow_id", id)
      .order("revision", { ascending: false });
    const latest: Record<string, { revision: number; body: unknown }> = {};
    for (const a of artifacts ?? []) {
      if (!(a.stage_id in latest))
        latest[a.stage_id] = { revision: a.revision, body: a.body };
    }
    const sceneList = latest.scene_list?.body as
      | { scenes?: Record<string, unknown>[]; ready_for_draft?: boolean }
      | undefined;
    if (!sceneList?.ready_for_draft) {
      throw new Error(
        "Scene plan is not ready. Enrich the scene list before writing Draft 1."
      );
    }
    const planScenes = (sceneList.scenes ?? []).filter((s) => {
      const slug = String(s.slugline ?? "");
      return (
        slug &&
        s.location !== "PLACEHOLDER" &&
        !slug.includes("PLACEHOLDER")
      );
    });
    if (planScenes.length === 0) {
      throw new Error("Scene plan has no real scenes to draft.");
    }

    // Safety: make sure the locked cast bible exists before drafting so names
    // can't drift. The treatment stage normally does this; this call is
    // idempotent (skips names already stored).
    const treatment = latest.treatment?.body as
      | { protagonists?: Array<{ name?: string; role?: string; summary?: string }> }
      | undefined;
    if (treatment) {
      try {
        await persistCastFromTreatment(projectId, treatment);
      } catch {
        /* non-fatal */
      }
    }

    // Create a fresh draft shell (mark prior drafts non-current).
    // CRITICAL: draft_number is per-episode, not per-project. A legacy
    // project-scoped draft (episode_id=null) and Episode 1's first draft
    // must BOTH be "Draft 1" within their own scope. Scoping by episode_id
    // (eq for set, is null for legacy) keeps the numbering honest.
    const { data: proj } = await supabase
      .from("projects")
      .select("title")
      .eq("id", projectId)
      .maybeSingle();
    let existingQ = supabase
      .from("scripts")
      .select("draft_number")
      .eq("project_id", projectId)
      .order("draft_number", { ascending: false })
      .limit(1);
    existingQ = episodeId ? existingQ.eq("episode_id", episodeId) : existingQ.is("episode_id", null);
    const { data: existing } = await existingQ;
    const nextNum = (existing?.[0]?.draft_number ?? 0) + 1;
    // Pull the episode info so the script title reflects "Episode N: Title".
    const ep = episodeId
      ? (
          await supabase
            .from("episodes")
            .select("number, title")
            .eq("id", episodeId)
            .maybeSingle()
        ).data
      : null;
    const epLabel = ep
      ? `Episode ${ep.number}${ep.title ? `: ${ep.title}` : ""}`
      : null;
    const seriesTitle = proj?.title ?? "Untitled";
    const draftTitle = epLabel
      ? `${seriesTitle} — ${epLabel} — Draft ${nextNum}`
      : `${seriesTitle} — Draft ${nextNum}`;
    // Demote only the prior current draft FOR THIS EPISODE, so each episode
    // keeps its own current script (season-level scoring reads one per episode).
    const demote = supabase
      .from("scripts")
      .update({ current: false })
      .eq("project_id", projectId);
    await (episodeId ? demote.eq("episode_id", episodeId) : demote.is("episode_id", null));
    const { data: script, error: scriptErr } = await supabase
      .from("scripts")
      .insert({
        project_id: projectId,
        episode_id: episodeId,
        title: draftTitle,
        draft_number: nextNum,
        fountain: "",
        current: true,
        metadata: { source: "gated_draft", workflow_id: id },
      })
      .select("id")
      .single();
    if (scriptErr) throw scriptErr;

    // Insert PENDING scenes carrying the manifest the gated drafter honors.
    const rows = planScenes.map((s, i) => {
      const order = typeof s.order === "number" ? (s.order as number) : i + 1;
      const characters = Array.isArray(s.characters)
        ? (s.characters as unknown[]).filter((c): c is string => typeof c === "string")
        : [];
      const goal = typeof s.goal === "string" ? s.goal : "";
      const conflict = typeof s.conflict === "string" ? s.conflict : "";
      const turn = typeof s.turn === "string" ? s.turn : "";
      const storyPurpose =
        [goal, conflict, turn].filter(Boolean).join(" / ") || null;
      return {
        script_id: script.id,
        ord: order,
        slugline: String(s.slugline ?? `INT. SCENE ${order} - DAY`),
        int_ext: typeof s.intExt === "string" ? s.intExt : "INT",
        time_of_day: typeof s.timeOfDay === "string" ? s.timeOfDay : "DAY",
        // `characters` is uuid[]; character NAMES live in `tags` (text[]),
        // which is where the gated drafter reads the cast for each scene.
        tags: characters,
        summary: goal || null,
        story_purpose: storyPurpose,
        timeline_position: order,
        fountain: null,
        status: "pending" as const,
        canonical: false,
      };
    });
    await supabase.from("script_scenes").insert(rows);

    // Park the workflow on the draft step while the user writes.
    await supabase
      .from("workflows")
      .update({ current_stage: "draft_v1", status: "running" })
      .eq("id", id);

    return {
      status: "prepared" as const,
      scriptId: script.id,
      projectId,
      sceneCount: rows.length,
    };
  });

  // -----------------------------------------------------------------------
  // POST /workflows/:id/complete-draft
  // Called from the writing room when every scene of Draft 1 is written. Pins
  // the assembled fountain as the draft_v1 artifact and advances the workflow
  // to Rewrite & Polish. The user's per-scene approvals during gated drafting
  // stand in for the batch draft_v1 approval.
  // -----------------------------------------------------------------------
  app.post("/workflows/:id/complete-draft", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: wf } = await supabase
      .from("workflows")
      .select("project_id, current_stage, episode_id")
      .eq("id", id)
      .single();
    if (!wf) throw new Error("workflow not found");
    await assertProjectMember(user.id, wf.project_id);
    const projectId = wf.project_id as string;
    const wfEpisodeId = (wf.episode_id as string | null) ?? null;
    if (wf.current_stage && wf.current_stage !== "draft_v1") {
      throw new Error(
        `This workflow's draft is already past Draft 1 (currently: ${wf.current_stage}). Open the workflow you're trying to finalize from the project overview.`
      );
    }

    // Scope to the script for THIS workflow's episode (legacy project-scoped
    // workflows have episode_id null and look up the script with no episode).
    let q = supabase
      .from("scripts")
      .select("id, metadata")
      .eq("project_id", projectId)
      .eq("current", true);
    q = wfEpisodeId ? q.eq("episode_id", wfEpisodeId) : q.is("episode_id", null);
    const { data: script } = await q
      .order("draft_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!script) throw new Error("No current draft to finish.");

    const { data: scenes } = await supabase
      .from("script_scenes")
      .select("status, canonical")
      .eq("script_id", script.id);
    const total = scenes?.length ?? 0;
    const written = (scenes ?? []).filter(
      (s) => s.canonical === true || ["generated", "revised", "locked"].includes(String(s.status))
    ).length;
    if (total === 0 || written < total) {
      throw new Error(
        `Draft 1 isn't finished yet — ${written} of ${total} scenes written.`
      );
    }

    // Rebuild scripts.fountain from the written scenes, then read it back.
    await reassembleLiveFountain(script.id);
    const { data: full } = await supabase
      .from("scripts")
      .select("fountain")
      .eq("id", script.id)
      .single();
    const fountain = (full?.fountain as string) ?? "";

    // Pin as the draft_v1 artifact so downstream stages + exports have it.
    const { data: prev } = await supabase
      .from("workflow_stage_artifacts")
      .select("revision")
      .eq("workflow_id", id)
      .eq("stage_id", "draft_v1")
      .order("revision", { ascending: false })
      .limit(1)
      .maybeSingle();
    const revision = (prev?.revision ?? 0) + 1;
    const { data: art } = await supabase
      .from("workflow_stage_artifacts")
      .insert({
        workflow_id: id,
        stage_id: "draft_v1",
        revision,
        body: { fountain, scriptId: script.id, mode: "gated" },
        created_by: user.id,
      })
      .select("id")
      .single();
    await supabase.from("workflow_stages").insert({
      workflow_id: id,
      stage_id: "draft_v1",
      status: "completed",
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      artifact_id: art?.id ?? null,
    });

    const next = nextStage("draft_v1");
    await supabase
      .from("workflows")
      .update({
        current_stage: next ?? "draft_v1",
        status: next ? "pending" : "completed",
      })
      .eq("id", id);

    return { status: "advanced" as const, nextStage: next, scriptId: script.id };
  });
}

/**
 * Collapse consecutive scenes that share the same slugline into one. Two
 * adjacent beats in the same place/time are a single scene split across
 * beats, not two scenes. Merges goal/conflict/turn/continuity/motif text
 * and unions character lists; re-numbers `order` sequentially. A later
 * non-adjacent return to the same location is preserved as its own scene.
 */
function mergeConsecutiveScenes(
  scenes: Record<string, unknown>[]
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const slug = (s: Record<string, unknown>) =>
    String(s.slugline ?? "")
      .toUpperCase()
      .replace(/[—–-]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
  const joinField = (a: unknown, b: unknown) => {
    const av = typeof a === "string" ? a.trim() : "";
    const bv = typeof b === "string" ? b.trim() : "";
    if (!av) return bv;
    if (!bv || av === bv) return av;
    return `${av} ${bv}`;
  };

  for (const scene of scenes) {
    const prev = out[out.length - 1];
    if (prev && slug(prev) === slug(scene) && slug(scene).length > 0) {
      // Merge into prev.
      prev.goal = joinField(prev.goal, scene.goal);
      prev.conflict = joinField(prev.conflict, scene.conflict);
      prev.turn = joinField(prev.turn, scene.turn);
      prev.continuityNotes = joinField(prev.continuityNotes, scene.continuityNotes);
      prev.visualMotif = joinField(prev.visualMotif, scene.visualMotif);
      const pc = Array.isArray(prev.characters) ? (prev.characters as string[]) : [];
      const sc = Array.isArray(scene.characters) ? (scene.characters as string[]) : [];
      prev.characters = Array.from(new Set([...pc, ...sc]));
    } else {
      out.push({ ...scene });
    }
  }
  // Re-number sequentially.
  return out.map((s, i) => ({ ...s, order: i + 1 }));
}
