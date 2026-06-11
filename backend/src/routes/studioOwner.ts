// Studio Owner routes — the account-level creator identity (Phase 1 of the
// studio experience). Reused across every project; not project-scoped.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { getStudioOwner, saveStudioOwner } from "../studio/identityStore.js";

const ROLE = z.enum([
  "producer",
  "writer",
  "director",
  "showrunner",
  "executive_producer",
  "solo_creator",
]);

export default async function studioOwnerRoutes(app: FastifyInstance) {
  app.get("/me/studio-owner", async (req) => {
    const user = await requireUser(req);
    return { owner: await getStudioOwner(user.id) };
  });

  app.put("/me/studio-owner", async (req) => {
    const user = await requireUser(req);
    const body = z
      .object({
        name: z.string().max(120).optional(),
        role: ROLE.nullable().optional(),
        bio: z.string().max(2000).optional(),
        // Resized data URL or storage URL. Capped to keep user_metadata small.
        avatarUrl: z.string().max(400_000).nullable().optional(),
        onboardingComplete: z.boolean().optional(),
      })
      .parse(req.body);
    return { owner: await saveStudioOwner(user.id, body) };
  });
}
