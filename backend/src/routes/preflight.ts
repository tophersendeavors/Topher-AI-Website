// Production Preflight routes (Stage 1).
//
// GET /scripts/:id/preflight — runs the 10-department aggregator over
// the given script and returns the report. Read-only.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import { runPreflight } from "../preflight/preflight.js";

export default async function preflightRoutes(app: FastifyInstance) {
  app.get("/scripts/:id/preflight", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: script, error } = await supabase
      .from("scripts")
      .select("project_id")
      .eq("id", id)
      .single();
    if (error || !script) throw new Error(`Script ${id} not found`);
    await assertProjectMember(user.id, script.project_id as string);
    return runPreflight(id);
  });
}
