// AI Production Queue — HTTP routes.
//
// All writes target projects.metadata.generationQueue[episodeId] only.
// Never mutates scripts.fountain or script_scenes.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import {
  GENERATION_QUEUE_STATUSES,
  MODEL_TARGETS,
  type GenerationQueueItem,
  type ModelTarget,
} from "@toburt/shared";
import {
  emptyQueue,
  findItem,
  loadQueue,
  patchItem,
  saveQueue,
} from "../generationQueue/store.js";
import {
  createOutput,
  syncQueueFromArtifacts,
} from "../generationQueue/sync.js";
import { buildQueueResponse } from "../generationQueue/aggregator.js";
import { exportQueue } from "../generationQueue/exporters.js";

const ItemPatch = z.object({
  modelTarget: z.enum(MODEL_TARGETS as unknown as [ModelTarget, ...ModelTarget[]]).optional(),
  status: z.enum(GENERATION_QUEUE_STATUSES as unknown as [string, ...string[]]).optional(),
  reviewNotes: z.string().optional(),
  retryInstruction: z.string().optional(),
  approvedOutputId: z.string().nullable().optional(),
});

const OutputCreate = z.object({
  url: z.string().min(1),
  modelTarget: z.enum(MODEL_TARGETS as unknown as [ModelTarget, ...ModelTarget[]]).optional(),
  versionLabel: z.string().optional(),
  reviewNotes: z.string().optional(),
  retryInstruction: z.string().optional(),
});

const OutputReview = z.object({
  status: z.enum(["candidate", "approved", "rejected"]).optional(),
  reviewNotes: z.string().optional(),
  retryInstruction: z.string().optional(),
  versionLabel: z.string().optional(),
});

export default async function generationQueueRoutes(app: FastifyInstance) {
  // GET — load + sync + return.
  app.get(
    "/projects/:projectId/episodes/:episodeId/generation-queue",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as {
        projectId: string;
        episodeId: string;
      };
      await assertProjectMember(user.id, projectId);
      const existing = await loadQueue(projectId, episodeId);
      const { queue, policy } = await syncQueueFromArtifacts(
        { projectId, episodeId },
        existing
      );
      await saveQueue(projectId, episodeId, queue);
      return buildQueueResponse({
        projectId,
        episodeId,
        scriptId: queue.scriptId || null,
        queue,
        policy,
      });
    }
  );

  // POST — force a resync against the latest creative artifacts.
  app.post(
    "/projects/:projectId/episodes/:episodeId/generation-queue/sync",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as {
        projectId: string;
        episodeId: string;
      };
      await assertProjectMember(user.id, projectId);
      const existing = await loadQueue(projectId, episodeId);
      const { queue, policy } = await syncQueueFromArtifacts(
        { projectId, episodeId },
        existing
      );
      await saveQueue(projectId, episodeId, queue);
      return buildQueueResponse({
        projectId,
        episodeId,
        scriptId: queue.scriptId || null,
        queue,
        policy,
      });
    }
  );

  // PATCH item — modelTarget / status / notes / approvedOutputId.
  app.patch(
    "/projects/:projectId/episodes/:episodeId/generation-queue/items/:itemId",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId, itemId } = req.params as {
        projectId: string;
        episodeId: string;
        itemId: string;
      };
      await assertProjectMember(user.id, projectId);
      const body = ItemPatch.parse(req.body);
      const queue = (await loadQueue(projectId, episodeId)) ?? emptyQueue(episodeId, "");
      if (!findItem(queue, itemId)) {
        reply.code(404);
        return { error: "item_not_found" };
      }
      const next = patchItem(queue, itemId, body as unknown as Partial<GenerationQueueItem>);
      await saveQueue(projectId, episodeId, next);
      return buildQueueResponse({
        projectId,
        episodeId,
        scriptId: next.scriptId || null,
        queue: next,
        policy: await loadPolicyFromProjectType(projectId),
      });
    }
  );

  // POST output — attach a generated artifact (URL/file reference).
  app.post(
    "/projects/:projectId/episodes/:episodeId/generation-queue/items/:itemId/outputs",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId, itemId } = req.params as {
        projectId: string;
        episodeId: string;
        itemId: string;
      };
      await assertProjectMember(user.id, projectId);
      const body = OutputCreate.parse(req.body);
      const queue = await loadQueue(projectId, episodeId);
      if (!queue) {
        reply.code(404);
        return { error: "queue_not_initialised" };
      }
      const item = findItem(queue, itemId);
      if (!item) {
        reply.code(404);
        return { error: "item_not_found" };
      }
      const output = createOutput(
        body.url,
        body.modelTarget ?? item.modelTarget,
        {
          versionLabel: body.versionLabel,
          reviewNotes: body.reviewNotes,
          retryInstruction: body.retryInstruction,
        }
      );
      const nextItem = {
        ...item,
        outputs: [...item.outputs, output],
        // First attached output moves the item from queued/ready → needs_review.
        status:
          item.status === "queued" || item.status === "ready" || item.status === "generating"
            ? "needs_review"
            : item.status,
      } as typeof item;
      const next = patchItem(queue, itemId, nextItem);
      await saveQueue(projectId, episodeId, next);
      return buildQueueResponse({
        projectId,
        episodeId,
        scriptId: next.scriptId || null,
        queue: next,
        policy: await loadPolicyFromProjectType(projectId),
      });
    }
  );

  // PATCH output — review (approve/reject/notes).
  app.patch(
    "/projects/:projectId/episodes/:episodeId/generation-queue/items/:itemId/outputs/:outputId",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId, itemId, outputId } = req.params as {
        projectId: string;
        episodeId: string;
        itemId: string;
        outputId: string;
      };
      await assertProjectMember(user.id, projectId);
      const body = OutputReview.parse(req.body);
      const queue = await loadQueue(projectId, episodeId);
      if (!queue) {
        reply.code(404);
        return { error: "queue_not_initialised" };
      }
      const item = findItem(queue, itemId);
      if (!item) {
        reply.code(404);
        return { error: "item_not_found" };
      }
      const outputs = item.outputs.map((o) =>
        o.id === outputId ? { ...o, ...body } : o
      );
      const reviewed = outputs.find((o) => o.id === outputId);
      if (!reviewed) {
        reply.code(404);
        return { error: "output_not_found" };
      }
      const nextItem = {
        ...item,
        outputs,
        // Reviewing an output to "approved" promotes the item to approved
        // and pins approvedOutputId. Reviewing to "rejected" surfaces
        // retry_needed if the user supplied an instruction.
        status:
          reviewed.status === "approved"
            ? "approved"
            : reviewed.status === "rejected"
              ? reviewed.retryInstruction
                ? "retry_needed"
                : "rejected"
              : item.status,
        approvedOutputId:
          reviewed.status === "approved" ? reviewed.id : item.approvedOutputId,
      } as typeof item;
      const next = patchItem(queue, itemId, nextItem);
      await saveQueue(projectId, episodeId, next);
      return buildQueueResponse({
        projectId,
        episodeId,
        scriptId: next.scriptId || null,
        queue: next,
        policy: await loadPolicyFromProjectType(projectId),
      });
    }
  );

  // DELETE output — remove from history (rare; mostly for typo'd URLs).
  app.delete(
    "/projects/:projectId/episodes/:episodeId/generation-queue/items/:itemId/outputs/:outputId",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId, itemId, outputId } = req.params as {
        projectId: string;
        episodeId: string;
        itemId: string;
        outputId: string;
      };
      await assertProjectMember(user.id, projectId);
      const queue = await loadQueue(projectId, episodeId);
      if (!queue) {
        reply.code(404);
        return { error: "queue_not_initialised" };
      }
      const item = findItem(queue, itemId);
      if (!item) {
        reply.code(404);
        return { error: "item_not_found" };
      }
      const outputs = item.outputs.filter((o) => o.id !== outputId);
      const nextItem = {
        ...item,
        outputs,
        approvedOutputId: item.approvedOutputId === outputId ? undefined : item.approvedOutputId,
      } as typeof item;
      const next = patchItem(queue, itemId, nextItem);
      await saveQueue(projectId, episodeId, next);
      return buildQueueResponse({
        projectId,
        episodeId,
        scriptId: next.scriptId || null,
        queue: next,
        policy: await loadPolicyFromProjectType(projectId),
      });
    }
  );

  // GET export — CSV / JSON / Markdown / model-specific batch / trailer batch.
  app.get(
    "/projects/:projectId/episodes/:episodeId/generation-queue/export",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as {
        projectId: string;
        episodeId: string;
      };
      await assertProjectMember(user.id, projectId);
      const qs = (req.query ?? {}) as { format?: string; model?: string };
      const format = qs.format ?? "queue_csv";
      const queue = (await loadQueue(projectId, episodeId)) ?? emptyQueue(episodeId, "");
      const resp = await buildQueueResponse({
        projectId,
        episodeId,
        scriptId: queue.scriptId || null,
        queue,
        policy: await loadPolicyFromProjectType(projectId),
      });
      const out = exportQueue(resp, format, qs.model as ModelTarget | undefined);
      reply.header("content-type", out.contentType);
      reply.header(
        "content-disposition",
        `attachment; filename="${out.filename}"`
      );
      return out.body;
    }
  );
}

// Helper — load shotPolicy on demand for response assembly. (Pulled out
// to avoid a circular import with sync.ts's `resolveProjectTypeConfig` call.)
async function loadPolicyFromProjectType(
  projectId: string
): Promise<import("@toburt/shared").GenerationQueueResponse["policy"]> {
  const { resolveProjectTypeConfig } = await import("@toburt/shared");
  const { supabase } = await import("../db/client.js");
  const { data } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .maybeSingle();
  const meta = ((data as { metadata: Record<string, unknown> | null } | null)?.metadata ??
    {}) as Record<string, unknown>;
  const projectType = (meta.projectType as string | undefined) ?? "prestige_series";
  const cfg = resolveProjectTypeConfig(projectType);
  return {
    projectType,
    defaultAspectRatio: cfg.shotPolicy.defaultAspectRatio,
    defaultDurationSec: cfg.shotPolicy.defaultDurationSec,
    composerKey: cfg.shotPolicy.composerKey,
    isMicroDramaTier: cfg.shotPolicy.isMicroDramaTier,
  };
}
