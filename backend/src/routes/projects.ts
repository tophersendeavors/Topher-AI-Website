import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { supabase } from "../db/client.js";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember, listProjectsForUser } from "../db/queries.js";
import { PROTOCOL_PRESETS, mergePreset } from "../draft/protocolPresets.js";
import { recommendNextStep } from "../draft/recommendedStep.js";
import { generateEpisodeChain } from "../microDrama/episodeChainAgent.js";
import { isMicroDramaProject } from "@toburt/shared";
import {
  PROJECT_TYPES,
  MICRO_DRAMA_EMOTIONS,
  MICRO_DRAMA_EPISODE_LENGTHS_SEC,
  MICRO_DRAMA_SEASON_LENGTH_MAX,
  MICRO_DRAMA_SEASON_LENGTH_MIN,
} from "@toburt/shared";
import type {
  MicroDramaBible,
  MicroDramaEpisodePlan,
} from "@toburt/shared";

const Create = z.object({
  title: z.string().min(1),
  kind: z.enum(["feature", "pilot", "miniseries", "short", "series"]).default("feature"),
  logline: z.string().optional(),
  genre: z.array(z.string()).optional(),
  tone: z.array(z.string()).optional(),
  inspirations: z.array(z.string()).optional(),
  showrunner_notes: z.string().optional(),
  /** Optional — when set, stored at projects.metadata.projectType.
   *  Defaults to "prestige_series" when missing. */
  projectType: z.enum(PROJECT_TYPES as unknown as [string, ...string[]]).optional(),
  /** Optional — when set, stored at projects.metadata.redevTemplateId.
   *  Drives the default template that R1-R9 passes resolve under. */
  redevTemplateId: z.string().optional(),
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
    // Fold projectType + redevTemplateId into the jsonb metadata column
    // so the existing read paths (resolveProjectTypeConfig, etc.) pick
    // them up. Strip them from the top-level insert (projects table has
    // no `projectType` column).
    const { projectType, redevTemplateId, ...top } = body;
    const metadata: Record<string, unknown> = {};
    if (projectType) metadata.projectType = projectType;
    if (redevTemplateId) metadata.redevTemplateId = redevTemplateId;
    const insertRow: Record<string, unknown> = { ...top, owner_id: user.id };
    if (Object.keys(metadata).length > 0) insertRow.metadata = metadata;
    const { data, error } = await supabase
      .from("projects")
      .insert(insertRow)
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

  // -------- Project Type (content tier) ---------------------------------
  // Stored at projects.metadata.projectType. Defaults to "prestige_series"
  // when missing so legacy projects continue to behave as before. Switching
  // a project's type does NOT alter its existing artifacts — every reader
  // that branches on projectType simply chooses a different downstream path
  // from this point forward.
  app.patch("/projects/:id/project-type", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const body = z
      .object({
        projectType: z.enum(PROJECT_TYPES as unknown as [string, ...string[]]),
      })
      .parse(req.body ?? {});
    const { data: row } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", id)
      .single();
    const meta = (row?.metadata as Record<string, unknown> | null) ?? {};
    const next = { ...meta, projectType: body.projectType };
    const { data, error } = await supabase
      .from("projects")
      .update({ metadata: next })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // -------- Micro Drama Bible -------------------------------------------
  // Only meaningful when projectType === "micro_drama". Stored at
  // projects.metadata.microDramaBible. Patchable as a whole or per-field.
  const MicroDramaBible = z
    .object({
      hook: z.string().optional(),
      audienceEmotion: z
        .enum(MICRO_DRAMA_EMOTIONS as unknown as [string, ...string[]])
        .optional(),
      episodeLengthSec: z
        .union(
          MICRO_DRAMA_EPISODE_LENGTHS_SEC.map((n) => z.literal(n)) as unknown as [
            z.ZodLiteral<number>,
            z.ZodLiteral<number>,
            ...z.ZodLiteral<number>[]
          ]
        )
        .optional(),
      // Free-form positive integer. Quick-pick presets are exposed in the
      // shared MICRO_DRAMA_SEASON_LENGTHS list for the UI; the backend
      // accepts any int in [MIN..MAX]. The chain generator clamps to MAX
      // internally so prompt/token budgets stay sane.
      seasonLength: z
        .number()
        .int()
        .min(MICRO_DRAMA_SEASON_LENGTH_MIN)
        .max(MICRO_DRAMA_SEASON_LENGTH_MAX)
        .optional(),
      cliffhangerEngine: z.string().optional(),
      // Retention-engine additions (Phase B).
      curiosityGap: z.string().optional(),
      characterRevealTracker: z
        .record(
          z.string(),
          z
            .object({
              known: z.array(z.string()).default([]),
              unknown: z.array(z.string()).default([]),
              falseAssumptions: z.array(z.string()).default([]),
            })
            .strict()
        )
        .optional(),
    })
    .strict();

  app.patch("/projects/:id/micro-drama-bible", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const patch = MicroDramaBible.parse(req.body ?? {});
    const { data: row } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", id)
      .single();
    const meta = (row?.metadata as Record<string, unknown> | null) ?? {};
    const prev = (meta.microDramaBible as Record<string, unknown> | undefined) ?? {};
    meta.microDramaBible = { ...prev, ...patch };
    const { data, error } = await supabase
      .from("projects")
      .update({ metadata: meta })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // -------- Micro Drama Episode Chain Generator -------------------------
  // PLANNING LAYER ONLY. Turns the project's Micro Drama Bible into a
  // complete episode chain (hook / setup / twist / cliffhanger plus reveal
  // accounting per episode). Preview returns the chain + per-episode Binge
  // Score + Viral Test + season-level rollup. Accept persists into
  // episodes.metadata.microDrama, creating EP rows up to seasonLength if
  // any are missing.
  //
  // Never writes screenplay, scenes, dialogue, shot briefs, or production
  // data. Tier-guarded: returns 400 when projectType !== "micro_drama".

  async function loadBibleForGeneration(
    projectId: string
  ): Promise<{ bible: MicroDramaBible; projectMeta: Record<string, unknown> }> {
    const { data: row } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single();
    const meta = (row?.metadata as Record<string, unknown> | null) ?? {};
    if (!isMicroDramaProject(meta.projectType as string | undefined)) {
      throw new Error(
        "Episode Chain generation is only available for micro_drama projects."
      );
    }
    const bibleRaw =
      (meta.microDramaBible as Partial<MicroDramaBible> | undefined) ?? {};
    if (!bibleRaw.hook || !bibleRaw.cliffhangerEngine) {
      throw new Error(
        "Micro Drama Bible incomplete — Hook and Cliffhanger Engine are required before generating the chain."
      );
    }
    if (!bibleRaw.seasonLength) {
      throw new Error(
        "Micro Drama Bible incomplete — Season length is required before generating the chain."
      );
    }
    return { bible: bibleRaw as MicroDramaBible, projectMeta: meta };
  }

  app.post("/projects/:id/micro-drama/episode-chain/preview", async (req, reply) => {
    // The Story Engine runs up to 3 sequential LLM passes (initial + two
    // self-revision passes) for any chain that misses the avg-binge target
    // of 70. For larger seasons that easily exceeds Node's default 2-minute
    // socket idle timeout. Lift the per-request socket timeout to 10 min so
    // the LLM stream isn't cut mid-flight (which the browser sees as
    // ERR_CONTENT_DECODING_FAILED on the gzipped response).
    req.raw.setTimeout(10 * 60 * 1000);
    reply.raw.setTimeout(10 * 60 * 1000);
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const { bible } = await loadBibleForGeneration(id);
    try {
      const preview = await generateEpisodeChain({ bible });
      return preview;
    } catch (err) {
      // Upstream LLM errors (e.g. Anthropic 400 for an oversized prompt or
      // a deprecated parameter) carry the upstream statusCode. Surface a
      // clean 502 so the writer doesn't see a confusing 4xx from our API
      // and so the browser doesn't try to gzip-decode a malformed body.
      const e = err as Error & { status?: number; statusCode?: number };
      const upstreamStatus = e.statusCode ?? e.status;
      req.log.error(
        { err: e, upstreamStatus, projectId: id },
        "Episode Chain generation failed"
      );
      reply.code(502).send({
        error:
          upstreamStatus != null
            ? `Story Engine upstream error (HTTP ${upstreamStatus}): ${e.message}`
            : `Story Engine failed: ${e.message}`,
      });
      return;
    }
  });

  // Accept All — persists a pre-generated chain. The request body carries
  // the planning rows verbatim from the preview the writer just approved
  // (so we never silently re-roll the LLM on accept).
  const AcceptChainPlan = z.object({
    episodeNumber: z.number().int().positive(),
    title: z.string(),
    hook: z.string(),
    setup: z.string(),
    twist: z.string(),
    cliffhanger: z.string(),
    revealedToAudience: z.string(),
    withheldFromAudience: z.string(),
    falseAssumptionReinforcedOrBroken: z.string(),
  });
  const AcceptChainBody = z.object({
    episodes: z.array(AcceptChainPlan).min(1),
  });

  app.post("/projects/:id/micro-drama/episode-chain/accept", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const body = AcceptChainBody.parse(req.body ?? {});
    const { bible } = await loadBibleForGeneration(id);

    // Sort planning rows by number; treat their order as the persisted order.
    const plans = [...body.episodes].sort(
      (a, b) => a.episodeNumber - b.episodeNumber
    );
    if (plans.length > bible.seasonLength) {
      throw new Error(
        `Chain has ${plans.length} entries but season length is ${bible.seasonLength}.`
      );
    }

    // Load the existing episodes (if any). We upsert by `number`.
    const { data: existing } = await supabase
      .from("episodes")
      .select("id, number, metadata")
      .eq("project_id", id);
    const byNumber = new Map<number, { id: string; metadata: unknown }>();
    for (const e of existing ?? []) {
      byNumber.set(e.number as number, {
        id: e.id as string,
        metadata: e.metadata,
      });
    }

    const persisted: MicroDramaEpisodePlan[] = [];

    for (const plan of plans) {
      const existingRow = byNumber.get(plan.episodeNumber);
      const newMetaMicroDrama = {
        hook: plan.hook,
        setup: plan.setup,
        twist: plan.twist,
        cliffhanger: plan.cliffhanger,
        revealedToAudience: plan.revealedToAudience,
        withheldFromAudience: plan.withheldFromAudience,
        falseAssumptionReinforcedOrBroken:
          plan.falseAssumptionReinforcedOrBroken,
        chainGeneratedAt: new Date().toISOString(),
      };

      if (existingRow) {
        const prev =
          (existingRow.metadata as Record<string, unknown> | null) ?? {};
        const nextMeta = {
          ...prev,
          microDrama: {
            ...(((prev.microDrama as Record<string, unknown> | undefined) ??
              {}) as Record<string, unknown>),
            ...newMetaMicroDrama,
          },
        };
        await supabase
          .from("episodes")
          .update({ metadata: nextMeta })
          .eq("id", existingRow.id);
      } else {
        await supabase.from("episodes").insert({
          project_id: id,
          number: plan.episodeNumber,
          title: plan.title || null,
          metadata: { microDrama: newMetaMicroDrama },
        });
      }
      persisted.push(plan);
    }

    return { ok: true, persisted: persisted.length };
  });

  // Recommended Next Step — single AI-derived action the writer should
  // take right now, given the project's current state. Drives the
  // RecommendedNextStep banner across Project Overview / Pitch / etc.
  app.get("/projects/:id/next-step", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    return recommendNextStep(id);
  });

  // List the available named protocols (presets) so the UI can offer them.
  app.get("/protocols", async (req) => {
    await requireUser(req);
    return Object.entries(PROTOCOL_PRESETS).map(([key, p]) => ({
      key,
      tone: p.tone,
      // Preview only — not the whole notes body; the UI fetches the merge result on apply.
      preview: p.showrunnerNotes.split("\n").slice(0, 3).join("\n"),
    }));
  });

  // Apply a named protocol to a project — MERGES into existing tone +
  // showrunner_notes (never overwrites). Idempotent: re-applying does nothing.
  app.post("/projects/:id/load-protocol", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await assertProjectMember(user.id, id);
    const { key } = z
      .object({ key: z.string().min(1) })
      .parse(req.body ?? {});
    const { data: proj, error: pErr } = await supabase
      .from("projects")
      .select("tone, showrunner_notes, metadata")
      .eq("id", id)
      .single();
    if (pErr) throw pErr;
    const merged = mergePreset(
      {
        tone: proj.tone as string[] | null,
        showrunner_notes: proj.showrunner_notes as string | null,
        metadata: proj.metadata,
      },
      key
    );
    const { data, error } = await supabase
      .from("projects")
      .update(merged)
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
