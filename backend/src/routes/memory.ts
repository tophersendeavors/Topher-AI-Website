import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { approveMemory, searchMemory, writeMemory } from "../memory/index.js";
import { MEMORY_KINDS, MEMORY_SCOPES } from "@toburt/shared";

const Write = z.object({
  projectId: z.string().uuid(),
  scope: z.enum(MEMORY_SCOPES),
  scopeRef: z.string().uuid().optional(),
  kind: z.enum(MEMORY_KINDS),
  text: z.string().min(1),
  body: z.record(z.unknown()).optional(),
  approved: z.boolean().optional(),
  supersedesId: z.string().uuid().optional(),
});

const Search = z.object({
  projectId: z.string().uuid(),
  query: z.string().min(1),
  scope: z.enum(MEMORY_SCOPES).optional(),
  scopeRef: z.string().uuid().optional(),
  kind: z.enum(MEMORY_KINDS).optional(),
  approvedOnly: z.boolean().optional(),
  k: z.number().int().positive().optional(),
});

export default async function memoryRoutes(app: FastifyInstance) {
  app.post("/memory", async (req) => {
    const user = await requireUser(req);
    const body = Write.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    return writeMemory({
      projectId: body.projectId,
      scope: body.scope,
      scopeRef: body.scopeRef ?? null,
      kind: body.kind,
      text: body.text,
      body: body.body ?? { text: body.text },
      approved: body.approved ?? false,
      authoredBy: user.id,
      authoredRole: "user",
      supersedesId: body.supersedesId,
    });
  });

  app.post("/memory/search", async (req) => {
    const user = await requireUser(req);
    const body = Search.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    return searchMemory(body);
  });

  app.post("/memory/:id/approve", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await approveMemory(id, user.id);
    return { ok: true };
  });
}
