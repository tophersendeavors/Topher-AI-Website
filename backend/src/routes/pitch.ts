// Pitch Materials routes. Separate from the 95% Script Quality Protocol
// and from the AI Video Prompts router — this module is buyer-facing.
//
// All persistence lives under project.metadata.pitch (jsonb), so applying
// migration 0012 (projects.metadata) is a prerequisite.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { assembleSources, setPitchSources } from "../draft/pitchMaterials/sources.js";
import {
  addCustomSlide,
  createDeck,
  deleteDeck,
  deleteSlide,
  generateFullDeck,
  getDeck,
  listDecks,
  markExported,
  patchDeck,
  patchSlide,
  regenerateOneSlide,
  reorderSlides,
} from "../draft/pitchMaterials/storage.js";
import { exportDeck } from "../draft/pitchMaterials/exporters.js";
import type { PitchFormat } from "../draft/pitchMaterials/exporters.js";

const DECK_KINDS = [
  "series_pitch_deck",
  "film_pitch_deck",
  "lookbook",
  "one_sheet",
  "buyer_treatment",
  "internal_production_deck",
] as const;

const DECK_STATUSES = [
  "not_started",
  "draft_generated",
  "needs_review",
  "notes_applied",
  "approved",
  "final_exported",
] as const;

const PITCH_FORMATS: PitchFormat[] = ["pdf", "markdown", "html", "text"];

function safeName(t: string): string {
  return t.replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "pitch";
}

export default async function pitchRoutes(app: FastifyInstance) {
  // --- Source manifest ----------------------------------------------------
  app.get("/projects/:projectId/pitch/sources", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return assembleSources(projectId);
  });

  // Patch writer-editable source fields not covered by existing bibles.
  app.patch("/projects/:projectId/pitch/sources", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        audience: z.string().optional(),
        creatorStatement: z.string().optional(),
        productionApproach: z.string().optional(),
        comps: z.array(z.string()).optional(),
      })
      .parse(req.body ?? {});
    await setPitchSources(projectId, body);
    return assembleSources(projectId);
  });

  // --- Decks: CRUD --------------------------------------------------------
  app.get("/projects/:projectId/pitch/decks", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    return listDecks(projectId);
  });

  app.post("/projects/:projectId/pitch/decks", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        kind: z.enum(DECK_KINDS),
        title: z.string().optional(),
      })
      .parse(req.body ?? {});
    return createDeck({ projectId, kind: body.kind, title: body.title });
  });

  app.get("/projects/:projectId/pitch/decks/:deckId", async (req) => {
    const user = await requireUser(req);
    const { projectId, deckId } = req.params as { projectId: string; deckId: string };
    await assertProjectMember(user.id, projectId);
    return getDeck(projectId, deckId);
  });

  app.delete("/projects/:projectId/pitch/decks/:deckId", async (req) => {
    const user = await requireUser(req);
    const { projectId, deckId } = req.params as { projectId: string; deckId: string };
    await assertProjectMember(user.id, projectId);
    await deleteDeck(projectId, deckId);
    return { ok: true };
  });

  // --- Generation --------------------------------------------------------
  app.post("/projects/:projectId/pitch/decks/:deckId/generate", async (req) => {
    const user = await requireUser(req);
    const { projectId, deckId } = req.params as { projectId: string; deckId: string };
    await assertProjectMember(user.id, projectId);
    const { writerNotes } = z.object({ writerNotes: z.string().optional() }).parse(req.body ?? {});
    return generateFullDeck({ projectId, deckId, writerNotes });
  });

  app.post(
    "/projects/:projectId/pitch/decks/:deckId/slides/:slideId/regenerate",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, deckId, slideId } = req.params as {
        projectId: string;
        deckId: string;
        slideId: string;
      };
      await assertProjectMember(user.id, projectId);
      const { writerNotes } = z
        .object({ writerNotes: z.string().optional() })
        .parse(req.body ?? {});
      return regenerateOneSlide({ projectId, deckId, slideId, writerNotes });
    }
  );

  // --- Slide / deck mutations --------------------------------------------
  app.patch("/projects/:projectId/pitch/decks/:deckId", async (req) => {
    const user = await requireUser(req);
    const { projectId, deckId } = req.params as { projectId: string; deckId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        title: z.string().optional(),
        status: z.enum(DECK_STATUSES).optional(),
      })
      .parse(req.body ?? {});
    return patchDeck({ projectId, deckId, patch: body });
  });

  app.patch(
    "/projects/:projectId/pitch/decks/:deckId/slides/:slideId",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, deckId, slideId } = req.params as {
        projectId: string;
        deckId: string;
        slideId: string;
      };
      await assertProjectMember(user.id, projectId);
      const body = z
        .object({
          title: z.string().optional(),
          copy: z.string().optional(),
          speakerNotes: z.string().optional(),
          visualDirection: z.string().optional(),
          imagePrompt: z.string().optional(),
          locked: z.boolean().optional(),
          needsRevision: z.boolean().optional(),
          approved: z.boolean().optional(),
        })
        .parse(req.body ?? {});
      return patchSlide({ projectId, deckId, slideId, patch: body });
    }
  );

  app.post("/projects/:projectId/pitch/decks/:deckId/slides", async (req) => {
    const user = await requireUser(req);
    const { projectId, deckId } = req.params as { projectId: string; deckId: string };
    await assertProjectMember(user.id, projectId);
    const { title, copy } = z
      .object({ title: z.string().min(1), copy: z.string().optional() })
      .parse(req.body ?? {});
    return addCustomSlide({ projectId, deckId, title, copy });
  });

  app.delete(
    "/projects/:projectId/pitch/decks/:deckId/slides/:slideId",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, deckId, slideId } = req.params as {
        projectId: string;
        deckId: string;
        slideId: string;
      };
      await assertProjectMember(user.id, projectId);
      return deleteSlide({ projectId, deckId, slideId });
    }
  );

  app.post("/projects/:projectId/pitch/decks/:deckId/reorder", async (req) => {
    const user = await requireUser(req);
    const { projectId, deckId } = req.params as { projectId: string; deckId: string };
    await assertProjectMember(user.id, projectId);
    const { order } = z.object({ order: z.array(z.string()) }).parse(req.body ?? {});
    return reorderSlides({ projectId, deckId, order });
  });

  // --- Export ------------------------------------------------------------
  app.get(
    "/projects/:projectId/pitch/decks/:deckId/export/:format",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, deckId, format } = req.params as {
        projectId: string;
        deckId: string;
        format: string;
      };
      if (!PITCH_FORMATS.includes(format as PitchFormat)) {
        return reply.code(400).send({ error: "unsupported_format", message: `Unsupported format. PPTX is coming soon — for now use PDF / Markdown / HTML / text.` });
      }
      await assertProjectMember(user.id, projectId);
      const deck = await getDeck(projectId, deckId);
      const { data, mime, ext } = exportDeck(deck, format as PitchFormat);
      reply.header("Content-Type", mime);
      reply.header(
        "Content-Disposition",
        `attachment; filename="${safeName(deck.currentVersionLabel)}.${ext}"`
      );
      // Mark export status without flipping approval (approval is the writer's call).
      try {
        if (deck.status === "approved" || deck.status === "notes_applied") {
          await markExported(projectId, deckId);
        }
      } catch {
        /* non-fatal */
      }
      if (typeof data === "string") return data;
      return Buffer.from(data);
    }
  );
}
