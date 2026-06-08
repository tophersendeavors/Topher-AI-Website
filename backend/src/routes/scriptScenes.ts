import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { draftOneScene } from "../draft/scenePass.js";
import { runScriptDoctor } from "../draft/scriptDoctor.js";
import {
  runContinuityPass,
  resolveContinuityIssue,
  resolveIssueWithNote,
  listResolutions,
} from "../draft/continuityPass.js";
import { runProductionPass } from "../draft/productionPass.js";
import { runSubtextCheck } from "../draft/subtextCheck.js";
import {
  proposeSubtextRevision,
  applySubtextRevision,
  previewSubtextApply,
} from "../draft/subtextRevise.js";
import { scanFountain, dedupeAdjacentLines, checkSceneIntegrity } from "../draft/applyIntegrity.js";
import { routeNotesToScenes } from "../draft/routeNotes.js";
import { adaptSceneForVeo, getVideoAdaptation } from "../draft/videoAdapt.js";
import {
  setMasterShotBrief,
  listMasterBriefs,
  recommendModelForBrief,
  generatePromptForModel,
  generatePromptsForAllModels,
  listPrompts,
  setPromptFeedback,
  approvePrompt,
  getEffectiveProfiles,
  setProjectModelOverrides,
  evaluateQualityGate,
  createResult,
  patchResult,
  listResults,
  removeResult,
  getRules,
  patchRules,
  autoBuildBriefs,
  regenerateOneBrief,
  ALL_MODEL_KEYS,
} from "../draft/aiPrompts/engine.js";
import {
  auditScene,
  auditScript,
  getAuditDashboard,
  setSceneApproval,
  type PassLabel,
} from "../draft/sceneAudit.js";
import {
  generateSceneWounds,
  generateSceneTension,
  generateProjectEmotionalMetadata,
  generateProjectTensions,
  getEmotionalMetadataStatus,
} from "../emotional/metadata.js";
import {
  proposeSceneFix,
  applySceneFix,
  applyTimelineRange,
  applyTimelineRanges,
} from "../draft/sceneFix.js";
import { reassembleLiveFountain } from "../draft/reassemble.js";
import { draftSceneGated, nextSceneToDraft } from "../draft/gatedDraft.js";

const Range = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
});
const Regen = z.object({
  rationale: z.string().optional(),
});

export default async function scriptScenesRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------
  // GET /scripts/:id/scenes — list scene rows with status & metadata
  // -------------------------------------------------------------------
  app.get("/scripts/:id/scenes", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const script = await loadScriptAndAuth(id, user.id);
    const { data, error } = await supabase
      .from("script_scenes")
      .select("*")
      .eq("script_id", script.id)
      .order("ord", { ascending: true });
    if (error) throw error;
    return data ?? [];
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/scenes/:ord/generate — generate one scene
  // -------------------------------------------------------------------
  app.post("/scripts/:id/scenes/:ord/generate", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    const script = await loadScriptAndAuth(id, user.id);
    const ordN = parseInt(ord, 10);
    const scene = await loadScene(id, ordN);
    if (scene.status === "locked") {
      throw new Error(
        `Scene ${ordN} is locked. Unlock it before generating, or use /regenerate to overwrite.`
      );
    }
    return runSceneGeneration(script.id, script.project_id, scene, user);
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/scenes/:ord/regenerate — overwrite even if locked
  // -------------------------------------------------------------------
  app.post("/scripts/:id/scenes/:ord/regenerate", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    const { rationale } = Regen.parse(req.body ?? {});
    const script = await loadScriptAndAuth(id, user.id);
    const ordN = parseInt(ord, 10);
    const scene = await loadScene(id, ordN);
    // Note: regenerate force-runs even if locked. Caller acknowledged.
    return runSceneGeneration(script.id, script.project_id, scene, user, rationale);
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/scenes/generate-range — batch by ord range
  // -------------------------------------------------------------------
  app.post("/scripts/:id/scenes/generate-range", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { from, to } = Range.parse(req.body ?? {});
    if (to < from) throw new Error("to must be >= from");
    const script = await loadScriptAndAuth(id, user.id);

    const { data: scenes, error } = await supabase
      .from("script_scenes")
      .select("*")
      .eq("script_id", script.id)
      .gte("ord", from)
      .lte("ord", to)
      .order("ord", { ascending: true });
    if (error) throw error;

    const results: Array<{
      ord: number;
      status: "generated" | "skipped_locked" | "failed";
      lastPass?: string;
      error?: string;
    }> = [];

    for (const scene of scenes ?? []) {
      if (scene.status === "locked") {
        results.push({ ord: scene.ord, status: "skipped_locked" });
        continue;
      }
      try {
        const r = await runSceneGeneration(
          script.id,
          script.project_id,
          scene,
          user
        );
        results.push({ ord: scene.ord, status: "generated", lastPass: r.lastPass });
      } catch (err) {
        results.push({
          ord: scene.ord,
          status: "failed",
          error: (err as Error).message,
        });
      }
    }
    await reassembleScript(script.id);
    return { from, to, results };
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/scenes/:ord/lock and /unlock
  // -------------------------------------------------------------------
  app.post("/scripts/:id/scenes/:ord/lock", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { data, error } = await supabase
      .from("script_scenes")
      .update({ status: "locked", locked_at: new Date().toISOString() })
      .eq("script_id", id)
      .eq("ord", parseInt(ord, 10))
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  app.post("/scripts/:id/scenes/:ord/unlock", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { data, error } = await supabase
      .from("script_scenes")
      .update({
        status: "generated",
        locked_at: null,
      })
      .eq("script_id", id)
      .eq("ord", parseInt(ord, 10))
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/script-doctor — Script Doctor pass against the script
  // -------------------------------------------------------------------
  app.post("/scripts/:id/script-doctor", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const body = (req.body ?? {}) as { focus?: string; notes?: string };
    const focus =
      body.focus === "pacing" || body.focus === "cliché" ||
      body.focus === "structure" || body.focus === "emotional_impact" ||
      body.focus === "all"
        ? body.focus
        : "all";
    const notes = typeof body.notes === "string" ? body.notes.trim() || undefined : undefined;
    return runScriptDoctor(id, user, focus, notes);
  });

  // GET /scripts/:id/veo-adaptation — stored Veo shot lists (per scene).
  app.get("/scripts/:id/veo-adaptation", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    return getVideoAdaptation(id);
  });

  // POST /scripts/:id/scenes/:ord/veo-adapt — derive a Veo shot list for one
  // scene (regenerate-with-notes supported). Stored in metadata; draft untouched.
  app.post("/scripts/:id/scenes/:ord/veo-adapt", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { notes } = z.object({ notes: z.string().optional() }).parse(req.body ?? {});
    return adaptSceneForVeo({ scriptId: id, ord: parseInt(ord, 10), notes: notes?.trim() || undefined });
  });

  // --- 95% Script Quality Protocol routes ---------------------------------
  // GET /scripts/:id/audit — read all current scene audits for the dashboard.
  app.get("/scripts/:id/audit", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    return getAuditDashboard(id);
  });

  // POST /scripts/:id/scenes/:ord/audit — audit one scene against the 10
  // categories. Heuristic-only by default; pass useLLM=true to upgrade.
  app.post("/scripts/:id/scenes/:ord/audit", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { useLLM, passLabel } = z
      .object({
        useLLM: z.boolean().optional(),
        passLabel: z
          .enum([
            "AIBase",
            "SubtextPass",
            "DialogueCompressionPass",
            "VoicePass",
            "PowerShiftPass",
            "VisualBehaviorPass",
            "ContinuityPass",
            "SpecFormatPass",
            "RhythmEdit",
            "SpecReady",
          ])
          .optional(),
      })
      .parse(req.body ?? {});
    const result = await auditScene(id, parseInt(ord, 10), {
      useLLM: useLLM === true,
      passLabel: passLabel as PassLabel | undefined,
    });
    return result.audit;
  });

  // POST /scripts/:id/audit — bulk-audit every scene (heuristic-only by default).
  app.post("/scripts/:id/audit", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const { useLLM } = z.object({ useLLM: z.boolean().optional() }).parse(req.body ?? {});
    const result = await auditScript(id, { useLLM: useLLM === true });
    return { audits: result.audits, totalCost: result.totalCost };
  });

  // POST /scripts/:id/scenes/:ord/approval — flip humanApproved on the latest
  // audit. AI never sets this; only the writer.
  app.post("/scripts/:id/scenes/:ord/approval", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { approved } = z.object({ approved: z.boolean() }).parse(req.body ?? {});
    return setSceneApproval(id, parseInt(ord, 10), approved);
  });

  // ----- AI Video Prompts — Master Shot Brief + Model Router + Adapters --
  // Brief is the source of truth; adapters DERIVE per-model prompts. Manual
  // model override is supported. Safety flags are surfaced — never bypassed.

  // GET /scripts/:id/ai-prompts — read all stored briefs + prompts (drives
  // the comparison view).
  app.get("/scripts/:id/ai-prompts", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const briefs = await listMasterBriefs(id);
    const prompts = await listPrompts(id);
    return { briefs, prompts };
  });

  // POST /scripts/:id/scenes/:ord/shots/:shot/brief — create or replace the
  // Master Shot Brief for one shot. Brief is immutable per generation.
  app.post("/scripts/:id/scenes/:ord/shots/:shot/brief", async (req) => {
    const user = await requireUser(req);
    const { id, ord, shot } = req.params as { id: string; ord: string; shot: string };
    await loadScriptAndAuth(id, user.id);
    const fields = (req.body ?? {}) as Record<string, unknown>;
    return setMasterShotBrief({
      scriptId: id,
      sceneOrd: parseInt(ord, 10),
      shotIndex: parseInt(shot, 10),
      fields: fields as Record<string, never>,
    });
  });

  // GET /scripts/:id/scenes/:ord/shots/:shot/recommend — run the model router.
  app.get("/scripts/:id/scenes/:ord/shots/:shot/recommend", async (req) => {
    const user = await requireUser(req);
    const { id, ord, shot } = req.params as { id: string; ord: string; shot: string };
    await loadScriptAndAuth(id, user.id);
    return recommendModelForBrief(id, parseInt(ord, 10), parseInt(shot, 10));
  });

  // POST /scripts/:id/scenes/:ord/shots/:shot/prompt — generate or
  // regenerate a prompt for one model. Optional notes steer the regeneration.
  app.post("/scripts/:id/scenes/:ord/shots/:shot/prompt", async (req) => {
    const user = await requireUser(req);
    const { id, ord, shot } = req.params as { id: string; ord: string; shot: string };
    await loadScriptAndAuth(id, user.id);
    const body = z
      .object({
        model: z.enum(ALL_MODEL_KEYS as [string, ...string[]]),
        notes: z.string().optional(),
      })
      .parse(req.body ?? {});
    return generatePromptForModel({
      scriptId: id,
      sceneOrd: parseInt(ord, 10),
      shotIndex: parseInt(shot, 10),
      model: body.model as (typeof ALL_MODEL_KEYS)[number],
      notes: body.notes?.trim() || undefined,
    });
  });

  // POST /scripts/:id/scenes/:ord/shots/:shot/prompts/all — generate prompts
  // for every supported model in one call (powers the comparison view).
  app.post("/scripts/:id/scenes/:ord/shots/:shot/prompts/all", async (req) => {
    const user = await requireUser(req);
    const { id, ord, shot } = req.params as { id: string; ord: string; shot: string };
    await loadScriptAndAuth(id, user.id);
    const body = z
      .object({
        notes: z.string().optional(),
        exclude: z.array(z.enum(ALL_MODEL_KEYS as [string, ...string[]])).optional(),
      })
      .parse(req.body ?? {});
    return generatePromptsForAllModels({
      scriptId: id,
      sceneOrd: parseInt(ord, 10),
      shotIndex: parseInt(shot, 10),
      notes: body.notes?.trim() || undefined,
      exclude: body.exclude as (typeof ALL_MODEL_KEYS)[number][] | undefined,
    });
  });

  // POST /scripts/:id/scenes/:ord/shots/:shot/prompt/:model/feedback
  app.post("/scripts/:id/scenes/:ord/shots/:shot/prompt/:model/feedback", async (req) => {
    const user = await requireUser(req);
    const { id, ord, shot, model } = req.params as {
      id: string;
      ord: string;
      shot: string;
      model: string;
    };
    await loadScriptAndAuth(id, user.id);
    if (!ALL_MODEL_KEYS.includes(model as (typeof ALL_MODEL_KEYS)[number])) {
      throw new Error("Unknown model key");
    }
    const body = z
      .object({
        tags: z
          .array(
            z.enum([
              "worked",
              "needs_camera",
              "character_inconsistent",
              "bad_motion",
              "bad_face",
              "wrong_mood",
              "too_stylized",
              "too_generic",
              "safety_blocked",
              "use_as_reference",
            ])
          )
          .optional(),
        comment: z.string().optional(),
        resultLink: z.string().url().optional(),
      })
      .parse(req.body ?? {});
    return setPromptFeedback({
      scriptId: id,
      sceneOrd: parseInt(ord, 10),
      shotIndex: parseInt(shot, 10),
      model: model as (typeof ALL_MODEL_KEYS)[number],
      feedback: body,
    });
  });

  // POST /scripts/:id/scenes/:ord/shots/:shot/prompt/:model/approve
  app.post("/scripts/:id/scenes/:ord/shots/:shot/prompt/:model/approve", async (req) => {
    const user = await requireUser(req);
    const { id, ord, shot, model } = req.params as {
      id: string;
      ord: string;
      shot: string;
      model: string;
    };
    await loadScriptAndAuth(id, user.id);
    if (!ALL_MODEL_KEYS.includes(model as (typeof ALL_MODEL_KEYS)[number])) {
      throw new Error("Unknown model key");
    }
    const { approved } = z.object({ approved: z.boolean() }).parse(req.body ?? {});
    return approvePrompt({
      scriptId: id,
      sceneOrd: parseInt(ord, 10),
      shotIndex: parseInt(shot, 10),
      model: model as (typeof ALL_MODEL_KEYS)[number],
      approved,
    });
  });

  // Model profiles — defaults + per-project overrides.
  app.get("/projects/:projectId/model-profiles", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return getEffectiveProfiles(projectId);
  });

  // PATCH overrides — partial per model (e.g. just update Veo's safety notes).
  app.patch("/projects/:projectId/model-profiles", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const overrides = (req.body ?? {}) as Parameters<typeof setProjectModelOverrides>[1];
    return setProjectModelOverrides(projectId, overrides);
  });

  // POST /scripts/:id/scenes/:ord/auto-build — read the approved scene text
  // and auto-populate the shotlist + Master Shot Briefs for that scene. The
  // router/adapters/etc are untouched; this is purely an upstream layer.
  //
  // Modes:
  //   • replace      (default) — overwrites all briefs in the scene
  //   • fill-empty   — appends new shots after existing ones, no overwrite
  //
  // If the scene contains briefs flagged userEdited=true, "replace" refuses
  // unless confirmOverwriteUserEdits=true is passed.
  app.post("/scripts/:id/scenes/:ord/auto-build", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const body = z
      .object({
        mode: z.enum(["replace", "fill-empty"]).optional(),
        confirmOverwriteUserEdits: z.boolean().optional(),
        notes: z.string().optional(),
        sourceStrict: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    return autoBuildBriefs({
      scriptId: id,
      sceneOrd: parseInt(ord, 10),
      opts: body,
    });
  });

  // POST .../shots/:shot/brief/regenerate — regenerate ONE brief in the
  // scene. Mirrors auto-build but limits the agent to a single shot index,
  // supports sourceStrict, and optionally restricts the regen to a list of
  // fields (rest is preserved). The writer can also pass steering notes.
  app.post(
    "/scripts/:id/scenes/:ord/shots/:shot/brief/regenerate",
    async (req) => {
      const user = await requireUser(req);
      const { id, ord, shot } = req.params as {
        id: string;
        ord: string;
        shot: string;
      };
      await loadScriptAndAuth(id, user.id);
      const body = z
        .object({
          notes: z.string().optional(),
          sourceStrict: z.boolean().optional(),
          fields: z.array(z.string()).optional(),
          force: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      return regenerateOneBrief({
        scriptId: id,
        sceneOrd: parseInt(ord, 10),
        shotIndex: parseInt(shot, 10),
        notes: body.notes?.trim() || undefined,
        sourceStrict: body.sourceStrict,
        fields: body.fields,
        force: body.force,
      });
    }
  );

  // POST .../prompt/:model/quality-gate — score a generated clip on the 10
  // categories and get back outcome + concrete fixes (which feed the next
  // regeneration as steering).
  app.post(
    "/scripts/:id/scenes/:ord/shots/:shot/prompt/:model/quality-gate",
    async (req) => {
      const user = await requireUser(req);
      const { id, ord, shot, model } = req.params as {
        id: string;
        ord: string;
        shot: string;
        model: string;
      };
      await loadScriptAndAuth(id, user.id);
      if (!ALL_MODEL_KEYS.includes(model as (typeof ALL_MODEL_KEYS)[number])) {
        throw new Error("Unknown model key");
      }
      const body = z
        .object({
          scores: z.record(z.number().min(1).max(10)),
          notes: z.string().optional(),
        })
        .parse(req.body ?? {});
      return evaluateQualityGate({
        scriptId: id,
        sceneOrd: parseInt(ord, 10),
        shotIndex: parseInt(shot, 10),
        model: model as (typeof ALL_MODEL_KEYS)[number],
        scores: body.scores as Record<string, number>,
        notes: body.notes,
      });
    }
  );

  // Production results — per-clip persistent records.
  app.get("/scripts/:id/production-results", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    return listResults(id);
  });

  app.post("/scripts/:id/production-results", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const payload = req.body as Parameters<typeof createResult>[1];
    if (!payload || typeof payload.id !== "string") {
      throw new Error("Production result requires an id");
    }
    return createResult(id, payload);
  });

  app.patch("/scripts/:id/production-results/:resultId", async (req) => {
    const user = await requireUser(req);
    const { id, resultId } = req.params as { id: string; resultId: string };
    await loadScriptAndAuth(id, user.id);
    return patchResult(id, resultId, (req.body ?? {}) as Record<string, unknown>);
  });

  app.delete("/scripts/:id/production-results/:resultId", async (req) => {
    const user = await requireUser(req);
    const { id, resultId } = req.params as { id: string; resultId: string };
    await loadScriptAndAuth(id, user.id);
    await removeResult(id, resultId);
    return { ok: true };
  });

  // Per-project production rules (prefer / avoid) — editable.
  app.get("/projects/:projectId/production-rules", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return getRules(projectId);
  });

  app.patch("/projects/:projectId/production-rules", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        prefer: z.array(z.string()).optional(),
        avoid: z.array(z.string()).optional(),
      })
      .parse(req.body ?? {});
    return patchRules(projectId, body);
  });

  // POST /scripts/:id/route-notes — split the writer's freeform rewrite notes
  // and assign each instruction to the scene(s) it targets (no rewriting).
  app.post("/scripts/:id/route-notes", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const { notes } = z
      .object({ notes: z.string().min(1, "Paste your rewrite notes first.") })
      .parse(req.body ?? {});
    return routeNotesToScenes({ scriptId: id, notes });
  });

  // POST /scripts/:id/scenes/:ord/rewrite-preview — generate a proposed scene
  // revision for a Script Doctor diagnosis (DRY RUN): returns before/after +
  // integrity scan. Never commits.
  app.post("/scripts/:id/scenes/:ord/rewrite-preview", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { instruction } = z
      .object({ instruction: z.string().min(1, "A fix instruction is required.") })
      .parse(req.body ?? {});
    const proposed = await proposeSceneFix({ scriptId: id, ord: parseInt(ord, 10), instruction });
    const issues = checkSceneIntegrity(proposed.before, proposed.after);
    return { ...proposed, issues, ok: issues.every((i) => i.severity !== "critical") };
  });

  // POST /scripts/:id/scenes/:ord/rewrite-apply — commit a reviewed scene
  // revision. Re-runs the integrity scan against the CURRENT scene and refuses
  // a corrupting commit; snapshots + reassembles via applySceneFix. Optionally
  // tags the revision with a named pass label (SubtextPass, RhythmEdit, …) and
  // automatically re-runs the heuristic audit so the dashboard reflects the
  // post-apply quality. Human approval is never set here — only the writer can.
  app.post("/scripts/:id/scenes/:ord/rewrite-apply", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { after, instruction, passLabel } = z
      .object({
        after: z.string().min(1),
        instruction: z.string().optional(),
        passLabel: z
          .enum([
            "AIBase",
            "SubtextPass",
            "DialogueCompressionPass",
            "VoicePass",
            "PowerShiftPass",
            "VisualBehaviorPass",
            "ContinuityPass",
            "SpecFormatPass",
            "RhythmEdit",
          ])
          .optional(),
      })
      .parse(req.body ?? {});
    const { data: scene } = await supabase
      .from("script_scenes")
      .select("fountain")
      .eq("script_id", id)
      .eq("ord", parseInt(ord, 10))
      .single();
    const before = (scene?.fountain as string) ?? "";
    const issues = checkSceneIntegrity(before, after);
    const critical = issues.filter((i) => i.severity === "critical");
    if (critical.length) {
      throw new Error(
        `Apply blocked — the rewrite would corrupt the scene: ${critical.map((c) => c.detail).join("; ")}. Regenerate the revision.`
      );
    }
    const result = await applySceneFix({
      scriptId: id,
      ord: parseInt(ord, 10),
      after,
      instruction: instruction ?? "Rewrite & Polish fix",
      passLabel,
    });
    // Re-audit post-apply (heuristic only, free) so the dashboard updates.
    let audit: Awaited<ReturnType<typeof auditScene>>["audit"] | null = null;
    try {
      const r = await auditScene(id, parseInt(ord, 10), {
        passLabel: (passLabel as PassLabel | undefined) ?? "AIBase",
      });
      audit = r.audit;
    } catch {
      /* audit failure is non-blocking — apply already committed */
    }
    return { ...result, audit };
  });

  // -------------------------------------------------------------------
  // Continuity-locked drafting (gated, one scene at a time)
  // -------------------------------------------------------------------
  // Draft a specific scene under the cast lock + canonical context, run the
  // per-scene grounded check, auto-fix violations, commit canonical.
  app.post("/scripts/:id/scenes/:ord/draft-gated", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    return draftSceneGated({ scriptId: id, ord: parseInt(ord, 10), user });
  });

  // Draft the NEXT non-canonical scene (lowest ord). Returns {done:true} when
  // every scene is canonical.
  app.post("/scripts/:id/draft-next", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const ord = await nextSceneToDraft(id);
    if (ord == null) return { done: true as const };
    const result = await draftSceneGated({ scriptId: id, ord, user });
    return { done: false as const, ...result };
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/production-pass — run the Producer agent
  // -------------------------------------------------------------------
  app.post("/scripts/:id/production-pass", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    return runProductionPass(id, user);
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/continuity-pass — run the Continuity agent
  // -------------------------------------------------------------------
  app.post("/scripts/:id/continuity-pass", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const body = (req.body ?? {}) as { notes?: string; mode?: string };
    const notes = typeof body.notes === "string" ? body.notes.trim() || undefined : undefined;
    const mode =
      body.mode === "standard" || body.mode === "supervisor" || body.mode === "strict"
        ? body.mode
        : "strict";
    return runContinuityPass(id, user, notes, mode);
  });

  // -------------------------------------------------------------------
  // Guided targeted fixes (propose -> review diff -> apply).
  // propose-fix returns a proposed scene WITHOUT saving; apply-fix commits
  // the version the user accepted. Surgical by default — preserves prose
  // unless the instruction explicitly asks for a rewrite.
  // -------------------------------------------------------------------
  app.post("/scripts/:id/scenes/:ord/propose-fix", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { instruction } = z
      .object({ instruction: z.string().min(1, "Add a fix instruction.") })
      .parse(req.body ?? {});
    return proposeSceneFix({ scriptId: id, ord: parseInt(ord, 10), instruction });
  });

  app.post("/scripts/:id/scenes/:ord/apply-fix", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { after, instruction } = z
      .object({ after: z.string().min(1), instruction: z.string().optional() })
      .parse(req.body ?? {});
    return applySceneFix({ scriptId: id, ord: parseInt(ord, 10), after, instruction });
  });

  // Apply a day/time marker across a scene range — heading-only, no prose rewrite.
  app.post("/scripts/:id/timeline-range", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const { from, to, marker } = z
      .object({
        from: z.number().int().positive(),
        to: z.number().int().positive(),
        marker: z.string().min(1),
      })
      .parse(req.body ?? {});
    return applyTimelineRange({ scriptId: id, from, to, marker });
  });

  // Apply MULTIPLE day/time markers across ranges in one pass.
  app.post("/scripts/:id/timeline-ranges", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const { ranges } = z
      .object({
        ranges: z
          .array(
            z.object({
              from: z.number().int().positive(),
              to: z.number().int().positive(),
              marker: z.string().min(1),
            })
          )
          .min(1),
      })
      .parse(req.body ?? {});
    return applyTimelineRanges({ scriptId: id, ranges });
  });

  // -------------------------------------------------------------------
  // Emotional metadata generators (fix low Wound/Tension scores caused by
  // MISSING metadata, not bad writing). Never touch scene prose.
  // -------------------------------------------------------------------
  app.post("/scripts/:id/scenes/:ord/generate-wounds", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    return generateSceneWounds({ scriptId: id, ord: parseInt(ord, 10), user });
  });

  app.post("/scripts/:id/scenes/:ord/generate-tension", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    return generateSceneTension({ scriptId: id, ord: parseInt(ord, 10), user });
  });

  // Project-level one-shot: wounds for all main characters + tension for key
  // pairs. The proper way to set up emotional metadata (not scene-by-scene).
  app.post("/scripts/:id/emotional/setup", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const script = await loadScriptAndAuth(id, user.id);
    const result = await generateProjectEmotionalMetadata({ scriptId: id, user });
    const status = await getEmotionalMetadataStatus(script.project_id);
    return { ...result, status };
  });

  app.get("/scripts/:id/emotional/status", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const script = await loadScriptAndAuth(id, user.id);
    return getEmotionalMetadataStatus(script.project_id);
  });

  // Generate ONLY missing relationship tensions (project-level).
  app.post("/scripts/:id/emotional/setup/tensions", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const script = await loadScriptAndAuth(id, user.id);
    const result = await generateProjectTensions({ scriptId: id, user });
    const status = await getEmotionalMetadataStatus(script.project_id);
    return { ...result, status };
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/subtext-check — flag on-the-nose / over-explained
  // dialogue and action. Notes-only; never rewrites.
  // -------------------------------------------------------------------
  app.post("/scripts/:id/subtext-check", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const body = (req.body ?? {}) as { notes?: string };
    const notes = typeof body.notes === "string" ? body.notes.trim() || undefined : undefined;
    return runSubtextCheck(id, user, notes);
  });

  // POST /scripts/:id/subtext-revise — generate a targeted subtext revision for
  // ONE flagged issue (propose only; never applies). Locates the scene/line by
  // the verbatim quote and returns deletion or 2–3 implication levels.
  app.post("/scripts/:id/subtext-revise", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const { quote, problem, sceneRef } = z
      .object({
        quote: z.string().min(1, "A flagged quote is required."),
        problem: z.string().default(""),
        sceneRef: z.string().optional(),
      })
      .parse(req.body ?? {});
    return proposeSubtextRevision({ scriptId: id, quote, problem, sceneRef });
  });

  // POST /scripts/:id/scenes/:ord/subtext-preview — DRY RUN: compute the exact
  // resulting scene + run the integrity check, without committing.
  app.post("/scripts/:id/scenes/:ord/subtext-preview", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { original, replacement } = z
      .object({ original: z.string().min(1), replacement: z.string().default("") })
      .parse(req.body ?? {});
    return previewSubtextApply({ scriptId: id, ord: parseInt(ord, 10), original, replacement });
  });

  // POST /scripts/:id/scenes/:ord/subtext-apply — commit a chosen revision
  // (replace the line, or delete it when replacement is empty). Deterministic,
  // line-anchored, integrity-gated; snapshots first.
  app.post("/scripts/:id/scenes/:ord/subtext-apply", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { original, replacement } = z
      .object({ original: z.string().min(1), replacement: z.string().default("") })
      .parse(req.body ?? {});
    return applySubtextRevision({
      scriptId: id,
      ord: parseInt(ord, 10),
      original,
      replacement,
    });
  });

  // GET /scripts/:id/integrity-scan — scan every scene's CURRENT fountain for
  // corruption (duplicate lines, orphan fragments, repeated lines) + report how
  // many restore snapshots each damaged scene has.
  app.get("/scripts/:id/integrity-scan", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const { data: scenes } = await supabase
      .from("script_scenes")
      .select("id, ord, slugline, fountain")
      .eq("script_id", id)
      .order("ord", { ascending: true });
    const out: Array<{
      ord: number;
      slugline: string;
      issues: ReturnType<typeof scanFountain>;
      snapshots: number;
    }> = [];
    for (const s of (scenes ?? []) as Array<{ id: string; ord: number; slugline: string; fountain: string | null }>) {
      const issues = scanFountain((s.fountain as string) ?? "");
      if (!issues.length) continue;
      const { count } = await supabase
        .from("script_scene_versions")
        .select("id", { count: "exact", head: true })
        .eq("scene_id", s.id);
      out.push({ ord: s.ord, slugline: s.slugline, issues, snapshots: count ?? 0 });
    }
    return { scriptId: id, scenes: out };
  });

  // POST /scripts/:id/scenes/:ord/dedupe-repair — safe mechanical repair:
  // remove adjacent duplicate lines. Snapshots first; reassembles.
  app.post("/scripts/:id/scenes/:ord/dedupe-repair", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const { data: scene } = await supabase
      .from("script_scenes")
      .select("fountain")
      .eq("script_id", id)
      .eq("ord", parseInt(ord, 10))
      .single();
    const { text, removed } = dedupeAdjacentLines((scene?.fountain as string) ?? "");
    if (removed === 0) return { ok: true, removed: 0 };
    await applySceneFix({
      scriptId: id,
      ord: parseInt(ord, 10),
      after: text,
      instruction: "Integrity repair: removed adjacent duplicate lines",
    });
    return { ok: true, removed };
  });

  // GET open continuity issues for a script.
  app.get("/scripts/:id/continuity-issues", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    const { data, error } = await supabase
      .from("continuity_issues")
      .select("*")
      .eq("script_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

  // POST resolve a continuity issue.
  app.post("/continuity-issues/:issueId/resolve", async (req) => {
    const user = await requireUser(req);
    const { issueId } = req.params as { issueId: string };
    // Auth: verify the issue belongs to a project the user can access.
    const { data: issue, error } = await supabase
      .from("continuity_issues")
      .select("project_id")
      .eq("id", issueId)
      .single();
    if (error) throw error;
    await assertProjectMember(user.id, issue.project_id);
    await resolveContinuityIssue(issueId);
    return { status: "ok" as const };
  });

  // POST resolve a continuity issue WITH a note (records user-approved intent).
  app.post("/continuity-issues/:issueId/resolve-with-note", async (req) => {
    const user = await requireUser(req);
    const { issueId } = req.params as { issueId: string };
    const { note } = z
      .object({ note: z.string().min(1, "Add a note explaining why this is intentional.") })
      .parse(req.body ?? {});
    const { data: issue, error } = await supabase
      .from("continuity_issues")
      .select("project_id")
      .eq("id", issueId)
      .single();
    if (error) throw error;
    await assertProjectMember(user.id, issue.project_id);
    await resolveIssueWithNote(issueId, note);
    return { status: "ok" as const };
  });

  // GET the user-approved continuity resolutions for a script.
  app.get("/scripts/:id/resolutions", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await loadScriptAndAuth(id, user.id);
    return listResolutions(id);
  });

  // -------------------------------------------------------------------
  // GET /scripts/:id/scenes/:ord/versions — list snapshots for one scene
  // -------------------------------------------------------------------
  app.get("/scripts/:id/scenes/:ord/versions", async (req) => {
    const user = await requireUser(req);
    const { id, ord } = req.params as { id: string; ord: string };
    await loadScriptAndAuth(id, user.id);
    const scene = await loadScene(id, parseInt(ord, 10));
    const { data, error } = await supabase
      .from("script_scene_versions")
      .select("id, fountain, last_pass, notes, created_at")
      .eq("scene_id", scene.id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

  // -------------------------------------------------------------------
  // POST /scripts/:id/scenes/:ord/restore/:versionId
  // Promotes a version back to current. Snapshots the existing current
  // fountain first so the "restore" itself is reversible.
  // -------------------------------------------------------------------
  app.post("/scripts/:id/scenes/:ord/restore/:versionId", async (req) => {
    const user = await requireUser(req);
    const { id, ord, versionId } = req.params as {
      id: string;
      ord: string;
      versionId: string;
    };
    const script = await loadScriptAndAuth(id, user.id);
    const scene = await loadScene(id, parseInt(ord, 10));
    if (scene.status === "locked") {
      throw new Error(
        `Scene ${scene.ord} is locked. Unlock before restoring a version.`
      );
    }
    const { data: target, error: vErr } = await supabase
      .from("script_scene_versions")
      .select("id, fountain, last_pass")
      .eq("id", versionId)
      .eq("scene_id", scene.id)
      .single();
    if (vErr) throw new Error("Version not found for this scene");

    // Snapshot current before overwrite.
    if (scene.fountain && scene.fountain.trim().length > 0) {
      await supabase.from("script_scene_versions").insert({
        scene_id: scene.id,
        fountain: scene.fountain,
        last_pass: scene.last_pass ?? null,
        notes: "Snapshot before restore",
      });
    }

    const { data: updated, error: uErr } = await supabase
      .from("script_scenes")
      .update({
        fountain: target.fountain,
        last_pass: target.last_pass ?? null,
        status: "revised",
        generated_at: new Date().toISOString(),
        notes: `Restored from version ${target.id}`,
      })
      .eq("id", scene.id)
      .select("*")
      .single();
    if (uErr) throw uErr;
    await reassembleScript(script.id);
    return updated;
  });
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function loadScriptAndAuth(scriptId: string, userId: string) {
  const { data: script, error } = await supabase
    .from("scripts")
    .select("id, project_id")
    .eq("id", scriptId)
    .single();
  if (error) throw error;
  await assertProjectMember(userId, script.project_id);
  return script;
}

async function loadScene(scriptId: string, ord: number) {
  const { data, error } = await supabase
    .from("script_scenes")
    .select("*")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (error) throw new Error(`Scene ${ord} not found on script ${scriptId}`);
  return data;
}

async function runSceneGeneration(
  scriptId: string,
  projectId: string,
  scene: {
    id: string;
    ord: number;
    slugline: string;
    tags?: string[];
    summary?: string;
    fountain?: string;
    last_pass?: string | null;
  },
  user: { id: string },
  rationale?: string
) {
  // Snapshot the existing fountain into versions BEFORE we overwrite, so
  // the user can Restore it from the UI if the regenerate makes things
  // worse. First-ever generation has no prior content to snapshot.
  if (scene.fountain && scene.fountain.trim().length > 0) {
    await supabase.from("script_scene_versions").insert({
      scene_id: scene.id,
      fountain: scene.fountain,
      last_pass: scene.last_pass ?? null,
      notes: rationale ? `Snapshot before regenerate (${rationale})` : "Snapshot before regenerate",
    });
  }

  // Mark generating.
  await supabase
    .from("script_scenes")
    .update({ status: "generating" })
    .eq("id", scene.id);

  try {
    const characters = (scene.tags ?? []).filter(Boolean);
    const goal = scene.summary || `Drive scene ${scene.ord}.`;
    const hasPrior =
      typeof scene.fountain === "string" && scene.fountain.trim().length > 0;
    const result = await draftOneScene(
      projectId,
      {
        slugline: scene.slugline,
        goal,
        conflict: hasPrior ? "(preserve from current scene)" : "TBD",
        turn: hasPrior ? "(preserve from current scene)" : "TBD",
        characters,
        // When prior content + a rationale exist, REVISE rather than rewrite.
        currentFountain: hasPrior && rationale ? scene.fountain : undefined,
        revisionNote: rationale,
      },
      user
    );

    // Append the rationale to notes (don't clobber). Keeps the record of
    // every fix applied to a scene — Doctor + Continuity both persist — so
    // the fix chips don't vanish when a second pass touches the scene.
    const priorNotes =
      typeof (scene as { notes?: string }).notes === "string"
        ? (scene as { notes?: string }).notes!.trim()
        : "";
    const mergedNotes = rationale
      ? [priorNotes, rationale].filter(Boolean).join("\n")
      : priorNotes || null;

    await supabase
      .from("script_scenes")
      .update({
        status: result.lastPass === "subtext" ? "generated" : "revised",
        fountain: result.fountain,
        generated_at: new Date().toISOString(),
        last_pass: result.lastPass,
        notes: mergedNotes,
      })
      .eq("id", scene.id);

    await reassembleScript(scriptId);
    return result;
  } catch (err) {
    await supabase
      .from("script_scenes")
      .update({ status: "pending", notes: `Generate failed: ${(err as Error).message}` })
      .eq("id", scene.id);
    throw err;
  }
}

// reassembleScript is the shared reassembleLiveFountain (imported above).
const reassembleScript = reassembleLiveFountain;
