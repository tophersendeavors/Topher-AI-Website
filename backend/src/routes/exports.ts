import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { parseFountain, formatFountain } from "../screenplay/fountain.js";
import { exportFDX } from "../screenplay/fdx.js";
import { exportPDF } from "../screenplay/pdf.js";
import { exportMarkdown } from "../screenplay/markdown.js";

const FORMATS = ["pdf", "fdx", "fountain", "markdown"] as const;
type Format = (typeof FORMATS)[number];

export default async function exportsRoutes(app: FastifyInstance) {
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

    const parsed = parseFountain(script.fountain ?? "");
    parsed.title = parsed.title ?? script.title;

    switch (format as Format) {
      case "fountain":
        reply.header("Content-Type", "text/x-fountain");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${safeName(script.title)}.fountain"`
        );
        return formatFountain(parsed);

      case "markdown":
        reply.header("Content-Type", "text/markdown");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${safeName(script.title)}.md"`
        );
        return exportMarkdown(parsed);

      case "fdx":
        reply.header("Content-Type", "application/vnd.finaldraft+xml");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${safeName(script.title)}.fdx"`
        );
        return exportFDX(parsed);

      case "pdf":
        reply.header("Content-Type", "application/pdf");
        reply.header(
          "Content-Disposition",
          `attachment; filename="${safeName(script.title)}.pdf"`
        );
        return Buffer.from(exportPDF(parsed));
    }
  });
}

function safeName(t: string): string {
  return t.replace(/[^a-z0-9_-]+/gi, "_").slice(0, 80) || "screenplay";
}
