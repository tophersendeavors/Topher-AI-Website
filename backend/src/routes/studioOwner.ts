// Studio Owner routes — the account-level creator identity (Phase 1 of the
// studio experience). Reused across every project; not project-scoped.

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { getStudioOwner, saveStudioOwner } from "../studio/identityStore.js";
import { generateStudioConcepts } from "../studio/conceptGenerator.js";
import {
  getStudioConfig,
  saveGeneratedConcepts,
  approveStudioConcept,
} from "../studio/configStore.js";

const ROLE = z.enum([
  "producer",
  "writer",
  "director",
  "showrunner",
  "executive_producer",
  "solo_creator",
]);

const PREFS = z.object({
  style: z
    .enum([
      "classic_hollywood",
      "modern_luxury",
      "futuristic",
      "rustic",
      "coastal",
      "european",
      "minimalist",
      "theme_park",
      "fantasy",
      "industrial",
    ])
    .nullable(),
  location: z
    .enum(["los_angeles", "malibu", "mountains", "forest", "desert", "island", "europe", "tokyo"])
    .nullable(),
  atmosphere: z
    .array(
      z.enum([
        "inspirational",
        "prestigious",
        "cozy",
        "grand",
        "magical",
        "innovative",
        "artistic",
        "bold",
      ])
    )
    .max(8),
  scale: z.enum(["boutique", "independent", "mid_size", "major_studio", "empire"]).nullable(),
});

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

  // --- Studio Builder (Phase 3) ---

  app.get("/me/studio-config", async (req) => {
    const user = await requireUser(req);
    return { config: await getStudioConfig(user.id) };
  });

  app.post("/me/studio-config/generate", async (req) => {
    const user = await requireUser(req);
    const prefs = PREFS.parse((req.body as { preferences?: unknown })?.preferences ?? req.body);
    const owner = await getStudioOwner(user.id);
    const prior = await getStudioConfig(user.id);
    const drafts = await generateStudioConcepts({
      preferences: prefs,
      ownerName: owner.name,
      avoidNames: (prior?.concepts ?? []).map((c) => c.name),
    });
    return { config: await saveGeneratedConcepts(user.id, prefs, drafts) };
  });

  app.post("/me/studio-config/approve", async (req) => {
    const user = await requireUser(req);
    const { conceptId } = z.object({ conceptId: z.string() }).parse(req.body);
    return { config: await approveStudioConcept(user.id, conceptId) };
  });
}
