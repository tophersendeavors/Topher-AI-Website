// Writer / Talent Directory routes — account-level (the studio owner's roster).
// Reusable across all projects; not project-scoped.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIVE_PERMISSIONS, TALENT_CATEGORIES } from "@toburt/shared";
import type { LivePermission, TalentCategory } from "@toburt/shared";
import { requireUser } from "../auth/verifyJwt.js";
import {
  listTalent,
  getTalent,
  createTalent,
  updateTalent,
  deleteTalent,
} from "../talent/store.js";

const profileBody = z.object({
  name: z.string().min(1).max(120),
  email: z.string().max(160).nullish(),
  category: z.enum(TALENT_CATEGORIES as unknown as [TalentCategory, ...TalentCategory[]]).optional(),
  role: z.string().max(120).nullish(),
  avatarUrl: z.string().max(2000).nullish(),
  bio: z.string().max(2000).nullish(),
  credits: z.array(z.string().max(160)).max(50).optional(),
  specialties: z.array(z.string().max(80)).max(50).optional(),
  permission: z.enum(LIVE_PERMISSIONS as unknown as [LivePermission, ...LivePermission[]]).optional(),
  inviteStatus: z.enum(["draft", "invited", "active"]).optional(),
});

export default async function talentRoutes(app: FastifyInstance) {
  app.get("/talent", async (req) => {
    const user = await requireUser(req);
    const { category } = req.query as { category?: TalentCategory };
    const profiles = await listTalent(user.id, category);
    return { profiles };
  });

  app.get("/talent/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const profile = await getTalent(user.id, id);
    if (!profile) throw app.httpErrors.notFound("Talent profile not found.");
    return { profile };
  });

  app.post("/talent", async (req) => {
    const user = await requireUser(req);
    const body = profileBody.parse(req.body);
    const profile = await createTalent(user.id, body);
    return { profile };
  });

  app.patch("/talent/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = profileBody.partial().parse(req.body);
    const profile = await updateTalent(user.id, id, body as never);
    return { profile };
  });

  app.delete("/talent/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    await deleteTalent(user.id, id);
    return { ok: true };
  });
}
