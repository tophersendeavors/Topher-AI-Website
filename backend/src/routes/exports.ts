import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { parseFountain, formatFountain } from "../screenplay/fountain.js";
import { exportFDX } from "../screenplay/fdx.js";
import { exportPDF } from "../screenplay/pdf.js";
import { exportMarkdown } from "../screenplay/markdown.js";
import {
  resolveTitlePage,
  renderFountainTitlePage,
  setTitlePage,
  exportReadiness,
} from "../screenplay/titlePage.js";
import { fileLabel } from "@toburt/shared";
import { z } from "zod";

const FORMATS = ["pdf", "fdx", "fountain", "markdown"] as const;
type Format = (typeof FORMATS)[number];

export default async function exportsRoutes(app: FastifyInstance) {
  // --- Title Page settings ----------------------------------------------
  // GET current resolved title page (script.metadata + project + episode merged).
  app.get("/scripts/:id/title-page", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id);
    const tp = await resolveTitlePage(id);
    return { titlePage: tp, readiness: exportReadiness(tp) };
  });

  // PATCH the user-editable title-page fields. AI never calls this.
  app.patch("/scripts/:id/title-page", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!script) throw new Error("script not found");
    await assertProjectMember(user.id, script.project_id);
    const body = z
      .object({
        writers: z.array(z.string()).optional(),
        creators: z.array(z.string()).optional(),
        basedOn: z.string().optional(),
        draftDate: z.string().optional(),
        contact: z.string().optional(),
        studio: z.string().optional(),
        copyright: z.string().optional(),
        includeContact: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const tp = await setTitlePage(id, body);
    return { titlePage: tp, readiness: exportReadiness(tp) };
  });

  app.get("/scripts/:id/export/:format", async (req, reply) => {
    const user = await requireUser(req);
    const { id, format } = req.params as { id: string; format: string };
    if (!FORMATS.includes(format as Format)) {
      return reply.code(400).send({ error: "unsupported_format" });
    }

    const { data: script, error } = await supabase
      .from("scripts")
      .select("*")
      .eq("id", id)
      .single();
    if (error) throw error;
    await assertProjectMember(user.id, script.project_id);

    // Resolve the title page from project + episode + script.metadata.
    // Refuse the export unless the writer has set Written by / Created by.
    // (Use ?force=1 to bypass for previews.)
    const tp = await resolveTitlePage(id);
    const readiness = exportReadiness(tp);
    const force = String((req.query as Record<string, string>)?.force ?? "") === "1";
    if (!readiness.ready && !force) {
      return reply.code(409).send({
        error: "title_page_incomplete",
        missing: readiness.missing,
        hint: "Open Title Page Settings and confirm writer + creator credits, or re-export with ?force=1 to bypass.",
      });
    }

    // Resolve episode info (for filename + title-page).
    let episode: { number: number; title: string | null; title_status: string } | null = null;
    if (script.episode_id) {
      const { data: ep } = await supabase
        .from("episodes")
        .select("number, title, title_status")
        .eq("id", script.episode_id)
        .maybeSingle();
      if (ep) episode = ep as typeof episode;
    }

    const parsed = parseFountain(script.fountain ?? "");
    parsed.title = parsed.title ?? script.title;
    parsed.titlePage = tp;

    const fileStem = fileLabel({
      seriesTitle: tp.seriesTitle,
      episode: episode
        ? {
            number: episode.number,
            title: episode.title,
            titleStatus: episode.title_status as "untitled" | "suggested" | "approved",
          }
        : null,
      draftNumber: script.draft_number as number,
    });

    switch (format as Format) {
      case "fountain": {
        const block = renderFountainTitlePage(tp);
        const body = formatFountain(parsed);
        // CRITICAL: title-page block at the top; ONE blank line; then body.
        // The script body never starts before the title page metadata.
        const out = `${block}\n\n${body}`;
        reply.header("Content-Type", "text/x-fountain");
        reply.header("Content-Disposition", `attachment; filename="${fileStem}.fountain"`);
        return out;
      }

      case "markdown":
        reply.header("Content-Type", "text/markdown");
        reply.header("Content-Disposition", `attachment; filename="${fileStem}.md"`);
        return exportMarkdown(parsed);

      case "fdx":
        reply.header("Content-Type", "application/vnd.finaldraft+xml");
        reply.header("Content-Disposition", `attachment; filename="${fileStem}.fdx"`);
        return exportFDX(parsed);

      case "pdf":
        reply.header("Content-Type", "application/pdf");
        reply.header("Content-Disposition", `attachment; filename="${fileStem}.pdf"`);
        return Buffer.from(exportPDF(parsed));
    }
  });
}
