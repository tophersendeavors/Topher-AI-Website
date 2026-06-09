// Trailer / Teaser Asset Builder — HTTP routes.
//
// All writes target projects.metadata.trailerBuilder. NO writes to
// scripts.fountain or script_scenes. Reads use the approved shot list,
// approved Sound Bible, episode chain (when present), bibles.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import {
  approveTrailerPack,
  approveTrailerVariant,
  getTrailerPack,
  patchTrailerVariant,
  putTrailerPack,
} from "../trailer/store.js";
import {
  buildTrailerContext,
  generateFullTrailerPack,
  generateTrailerVariant,
} from "../trailer/generator.js";
import {
  exportTrailerPackJSON,
  exportTrailerPackMarkdown,
  exportTrailerVariantMarkdown,
  exportTrailerVariantMusicPrompt,
  exportTrailerVariantVideoPrompts,
} from "../trailer/exporter.js";
import type { TrailerPlan, TrailerVariantKey } from "../trailer/types.js";

const VARIANTS: TrailerVariantKey[] = ["teaser15", "teaser30", "trailer60", "social"];
function assertVariant(s: string): TrailerVariantKey {
  if (VARIANTS.includes(s as TrailerVariantKey)) return s as TrailerVariantKey;
  throw new Error(`unknown trailer variant: ${s}`);
}

export default async function trailerRoutes(app: FastifyInstance) {
  // GET pack
  app.get(
    "/projects/:projectId/episodes/:episodeId/trailer-builder",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const pack = await getTrailerPack(projectId, episodeId);
      const ctx = await buildTrailerContext(projectId, episodeId);
      return {
        pack,
        source: {
          projectType: ctx.projectType,
          projectTypeLabel: ctx.projectTypeLabel,
          episodeNumber: ctx.episodeNumber,
          episodeTitle: ctx.episodeTitle,
          scriptId: ctx.scriptId,
          scriptDraftNumber: ctx.scriptDraftNumber,
          scriptIsLocked: ctx.scriptIsLocked,
          approvedShotCount: ctx.approvedShots.length,
          totalShotCount: ctx.allShots.length,
          approvedMusic: ctx.approvedTrailerMusic != null,
          approvedSonicPhilosophy: ctx.approvedSonicPhilosophy != null,
          hasEpisodeChain: ctx.episodeChain != null,
          whatNotToReveal: ctx.whatNotToReveal,
        },
      };
    }
  );

  // POST full generate
  app.post(
    "/projects/:projectId/episodes/:episodeId/trailer-builder/generate",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const body = z
        .object({ includeSocial: z.boolean().optional() })
        .parse(req.body ?? {});
      const ctx = await buildTrailerContext(projectId, episodeId);
      const prior = await getTrailerPack(projectId, episodeId);
      const next = await generateFullTrailerPack(ctx, prior, body.includeSocial === true);
      const saved = await putTrailerPack(projectId, next);
      return { pack: saved };
    }
  );

  // POST per-variant generate (with optional notes)
  app.post(
    "/projects/:projectId/episodes/:episodeId/trailer-builder/variant/:variant/generate",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, variant } = req.params as {
        projectId: string;
        episodeId: string;
        variant: string;
      };
      await assertProjectMember(user.id, projectId);
      const v = assertVariant(variant);
      const body = z.object({ notes: z.string().optional() }).parse(req.body ?? {});
      const ctx = await buildTrailerContext(projectId, episodeId);
      const plan = await generateTrailerVariant(ctx, v, body.notes);
      const saved = await patchTrailerVariant(projectId, episodeId, v, plan);
      return { pack: saved };
    }
  );

  // PUT save a variant directly (inline edits).
  app.put(
    "/projects/:projectId/episodes/:episodeId/trailer-builder/variant/:variant",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, variant } = req.params as {
        projectId: string;
        episodeId: string;
        variant: string;
      };
      await assertProjectMember(user.id, projectId);
      const v = assertVariant(variant);
      const body = (req.body ?? {}) as Partial<TrailerPlan>;
      const pack = await getTrailerPack(projectId, episodeId);
      const prior = pack.variants[v];
      if (!prior) throw new Error(`No ${v} plan yet — generate it first`);
      const next: TrailerPlan = { ...prior, ...body, variantKey: v };
      const saved = await patchTrailerVariant(projectId, episodeId, v, next);
      return { pack: saved };
    }
  );

  // POST approve variant.
  app.post(
    "/projects/:projectId/episodes/:episodeId/trailer-builder/variant/:variant/approve",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, variant } = req.params as {
        projectId: string;
        episodeId: string;
        variant: string;
      };
      await assertProjectMember(user.id, projectId);
      const v = assertVariant(variant);
      const saved = await approveTrailerVariant(projectId, episodeId, v, user.id);
      return { pack: saved };
    }
  );

  // POST approve full pack.
  app.post(
    "/projects/:projectId/episodes/:episodeId/trailer-builder/approve",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const saved = await approveTrailerPack(projectId, episodeId, user.id);
      return { pack: saved };
    }
  );

  // GET export.
  app.get(
    "/projects/:projectId/episodes/:episodeId/trailer-builder/export",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const q = req.query as { format?: string; variant?: string; kind?: string };
      const format = (q.format ?? "markdown").toLowerCase();
      const variant = q.variant ? assertVariant(q.variant) : null;
      const pack = await getTrailerPack(projectId, episodeId);

      const { data: ep } = await supabase
        .from("episodes")
        .select("number, title")
        .eq("id", episodeId)
        .maybeSingle();
      const epLabel = ep
        ? `Episode ${ep.number}${ep.title ? `: ${ep.title}` : ""}`
        : "Untitled episode";

      if (format === "json") {
        reply.header("content-type", "application/json");
        return exportTrailerPackJSON(pack);
      }
      if (variant) {
        const plan = pack.variants[variant];
        if (!plan) {
          reply.code(404);
          return { error: `No ${variant} plan generated yet.` };
        }
        if (q.kind === "video_prompts") {
          reply.header("content-type", "text/markdown; charset=utf-8");
          return exportTrailerVariantVideoPrompts(plan);
        }
        if (q.kind === "music_prompt") {
          reply.header("content-type", "text/markdown; charset=utf-8");
          return exportTrailerVariantMusicPrompt(plan);
        }
        reply.header("content-type", "text/markdown; charset=utf-8");
        return exportTrailerVariantMarkdown(plan);
      }
      reply.header("content-type", "text/markdown; charset=utf-8");
      return exportTrailerPackMarkdown(pack, epLabel);
    }
  );
}
