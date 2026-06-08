import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import {
  suggestEpisodeTitle,
  approveEpisodeTitle,
  resetEpisodeTitle,
} from "../draft/episodeTitle.js";
import {
  generateAndStore,
  approveRelationship,
  patchAndSnapshot,
} from "../draft/relationships/store.js";
import { ALL_GEN_FIELDS } from "../draft/relationships/generator.js";
import { suggestSpineCandidates } from "../draft/relationships/spine.js";
import { qualityCheckRelationship } from "../draft/relationships/qualityCheck.js";
import { computeBingeMomentum, viralTest } from "../microDrama/scoring.js";

const CharacterCreate = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  archetype: z.string().optional(),
  role: z.string().optional(),
  biography: z.string().optional(),
  wants: z.string().optional(),
  needs: z.string().optional(),
  flaw: z.string().optional(),
  voice_notes: z.string().optional(),
  arc: z.record(z.unknown()).optional(),
});

const EpisodeCreate = z.object({
  projectId: z.string().uuid(),
  seasonId: z.string().uuid().optional(),
  number: z.number().int().positive(),
  title: z.string().optional(),
  logline: z.string().optional(),
});

const SeasonCreate = z.object({
  projectId: z.string().uuid(),
  number: z.number().int().positive(),
  title: z.string().optional(),
  premise: z.string().optional(),
});

const LocationCreate = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1),
  kind: z.string().optional(),
  description: z.string().optional(),
});

export default async function entitiesRoutes(app: FastifyInstance) {
  // ---------- Characters ----------
  app.get("/projects/:projectId/characters", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("characters")
      .select("*")
      .eq("project_id", projectId)
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

  app.post("/characters", async (req) => {
    const user = await requireUser(req);
    const body = CharacterCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, ...rest } = body;
    const { data, error } = await supabase
      .from("characters")
      .insert({ project_id: projectId, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  app.patch("/characters/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id")
      .eq("id", id)
      .single();
    await assertProjectMember(user.id, ch!.project_id);
    const body = CharacterCreate.partial().parse(req.body);
    const { projectId: _p, ...rest } = body;
    const { data, error } = await supabase
      .from("characters")
      .update(rest)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Character DNA ----------
  // The DNA sheet lives under characters.metadata.dna so we never need a
  // migration to enrich a character. The audit's Character Voice check reads
  // these fields; the structured prompt builder injects them into every scene
  // generation. AI never edits DNA — only the user does, here.
  const Dna = z
    .object({
      core_wound: z.string().optional(),
      public_mask: z.string().optional(),
      private_fear: z.string().optional(),
      speech_cadence: z.string().optional(),
      behavioral_tics: z.array(z.string()).optional(),
      emotional_triggers: z.array(z.string()).optional(),
      defensive_strategies: z.array(z.string()).optional(),
      avoids_saying: z.array(z.string()).optional(),
      how_lies: z.string().optional(),
      shows_vulnerability: z.string().optional(),
      // Keyed by the OTHER character's name — free-form relationship line.
      relationships: z.record(z.string()).optional(),
    })
    .strict();

  app.patch("/characters/:id/dna", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);
    const patch = Dna.parse(req.body ?? {});
    const meta = { ...((ch.metadata as Record<string, unknown>) ?? {}) };
    const prevDna = ((meta.dna as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    meta.dna = { ...prevDna, ...patch };
    const { data, error } = await supabase
      .from("characters")
      .update({ metadata: meta })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Character Visual Bible ----------
  // The Visual Bible lives under characters.metadata.visualBible. The
  // composer reads consistencyPrompt + referenceImageUrl off this object
  // on every shot prompt generation, so adding a URL here locks the
  // character's visual identity across every future shot for that model.
  // Only the writer edits the reference URL; the rest of the Visual Bible
  // is approved at creation time.
  const VisualBibleUrl = z
    .object({
      referenceImageUrl: z.string().url().nullable().optional(),
    })
    .strict();

  app.patch("/characters/:id/visual-bible", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);
    const patch = VisualBibleUrl.parse(req.body ?? {});
    const meta = { ...((ch.metadata as Record<string, unknown>) ?? {}) };
    const prevVb = (meta.visualBible as Record<string, unknown> | undefined) ?? {};
    // V2 schema: referenceImageUrl is a top-level key on visualBible, not
    // under .fields. We still merge in patches additively so the rest of
    // the V2 visualBible (visualCanon, movementCanon, the rendered
    // characterConsistencyPrompt, masterImagePrompt) is preserved.
    meta.visualBible = { ...prevVb, ...patch };
    const { data, error } = await supabase
      .from("characters")
      .update({ metadata: meta })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Visual Bible v3 — Master Image Prompt + status workflow ----
  //
  // Stores everything under characters.metadata.visualBible. The new fields
  // (masterCharacterImagePrompt, masterCharacterImageNegative, master
  // CharacterImageAspectRatio, referenceImageStatus, episodeWardrobeNotes,
  // profileStatus, manualEdits) sit alongside the existing V2 fields
  // (visualCanon, movementCanon, characterConsistencyPrompt, wardrobe,
  // doNotChangeTraits, negativeContinuity, referenceImageUrl).
  //
  // manualEdits: Record<fieldName, true> — tracks which fields the writer
  // hand-edited. Future auto-extractions consult this map and skip any
  // field that's been marked, so writer-typed bibles are protected from
  // being silently overwritten by an LLM pass.

  // Status workflow.
  const PROFILE_STATUSES = [
    "incomplete",
    "needs_review",
    "production_ready",
  ] as const;
  // V3.1 adds "generated", "uploaded", "bound_to_element" to track the
  // Midjourney → Kling lifecycle: missing → generated (writer rendered the
  // image) → uploaded (writer pushed it into Kling) → bound_to_element
  // (writer wired it to a Kling Element ID so it's reusable) → approved
  // (writer signs off as canonical). pending_approval stays for the
  // simple Midjourney-only flow; not_applicable is voice/text-only chars.
  const REFERENCE_IMAGE_STATUSES = [
    "missing",
    "generated",
    "uploaded",
    "pending_approval",
    "approved",
    "bound_to_element",
    "not_applicable",
  ] as const;
  // The image-gen target platform the writer is actively using for this
  // character. Drives which fields the UI surfaces and how the composer
  // emits structured reference metadata downstream.
  const REFERENCE_PLATFORMS = [
    "midjourney",
    "kling_image",
    "kling_element",
    "runway",
    "generic",
  ] as const;

  // POST — generate the Master Character Image Prompt via LLM. One-shot;
  // overwrites the existing master prompt (it's an asset, not a story
  // field — re-generating it is not a continuity risk).
  app.post("/characters/:id/visual-bible/master-image-prompt", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        episodeNumber: z.number().int().positive().optional(),
        episodeWardrobeNotes: z.string().optional(),
      })
      .strict()
      .optional()
      .parse(req.body ?? {}) ?? {};
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, name, role, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);

    const meta = (ch.metadata as Record<string, unknown>) ?? {};
    const vb = (meta.visualBible as Record<string, unknown> | undefined) ?? {};
    const presence: "principal" | "voice_or_text" =
      ch.role === "voice / text" || ch.role === "voice_or_text"
        ? "voice_or_text"
        : "principal";

    const { generateMasterImagePrompt } = await import(
      "../microDrama/masterImagePromptAgent.js"
    );
    const visualCanonObj = (vb.visualCanon as Record<string, unknown> | undefined) ?? {};
    const result = await generateMasterImagePrompt({
      characterName: ch.name as string,
      presence,
      visualCanon: (visualCanonObj.description as string) ?? "",
      wardrobe: (vb.wardrobe as string) ?? "",
      doNotChangeTraits: ((vb.doNotChangeTraits as string[]) ?? []).filter(Boolean),
      movementCanon: ((vb.movementCanon as string[]) ?? []).filter(Boolean),
      negativeContinuity: (vb.negativeContinuity as string) ?? "",
      episodeNumber: body.episodeNumber ?? 1,
      episodeWardrobeNotes: body.episodeWardrobeNotes,
    });

    // Persist alongside the rest of the Visual Bible.
    const nextVb = {
      ...vb,
      masterCharacterImagePrompt: result.prompt,
      masterCharacterImageNegative: result.negativePrompt,
      masterCharacterImageAspectRatio: result.aspectRatio,
      masterImagePromptGeneratedAt: new Date().toISOString(),
    };
    meta.visualBible = nextVb;
    await supabase
      .from("characters")
      .update({ metadata: meta })
      .eq("id", id);
    return {
      prompt: result.prompt,
      negativePrompt: result.negativePrompt,
      aspectRatio: result.aspectRatio,
    };
  });

  // PATCH — set the reference image URL + status + (V3.1) platform + Kling
  // fields. Idempotent. Only the keys present in the request body are
  // touched; everything else on visualBible is preserved.
  //
  // V3.1 fields:
  //   referencePlatform        — "midjourney" | "kling_image" | "kling_element" | "runway" | "generic"
  //   approvedReferenceImageUrl — the writer-approved canonical image URL
  //                               (separate from referenceImageUrl, which is
  //                               the "current candidate" for review)
  //   klingElementId           — when bound to a Kling Element (multi-angle
  //                               reusable identity), this is the ID the
  //                               composer threads into every shot prompt
  //   klingElementName         — human-readable name (e.g. "Maya — EP01")
  //   klingReferenceImages     — Array<{url, angle?, label?}> for multi-angle
  //                               reference sets (face, 3/4, full body, etc.)
  app.patch("/characters/:id/visual-bible/reference-image", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    // URL fields use min(1) rather than .url() because writers paste
    // signed URLs / storage URLs with query strings that often confuse
    // Zod's URL parser — and we trust the writer at this boundary.
    const body = z
      .object({
        referenceImageUrl: z.string().min(1).nullable().optional(),
        referenceImageStatus: z
          .enum(REFERENCE_IMAGE_STATUSES as unknown as [string, ...string[]])
          .optional(),
        // V3.1 additions
        referencePlatform: z
          .enum(REFERENCE_PLATFORMS as unknown as [string, ...string[]])
          .optional(),
        approvedReferenceImageUrl: z.string().min(1).nullable().optional(),
        klingElementId: z.string().nullable().optional(),
        klingElementName: z.string().nullable().optional(),
        klingReferenceImages: z
          .array(
            z.object({
              url: z.string().min(1),
              angle: z.string().optional(),
              label: z.string().optional(),
            })
          )
          .optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);
    const meta = (ch.metadata as Record<string, unknown>) ?? {};
    const vb = (meta.visualBible as Record<string, unknown> | undefined) ?? {};
    const nextVb = { ...vb };
    if (body.referenceImageUrl !== undefined) {
      nextVb.referenceImageUrl = body.referenceImageUrl;
    }
    if (body.referenceImageStatus !== undefined) {
      nextVb.referenceImageStatus = body.referenceImageStatus;
    }
    if (body.referencePlatform !== undefined) {
      nextVb.referencePlatform = body.referencePlatform;
    }
    if (body.approvedReferenceImageUrl !== undefined) {
      nextVb.approvedReferenceImageUrl = body.approvedReferenceImageUrl;
    }
    if (body.klingElementId !== undefined) {
      nextVb.klingElementId = body.klingElementId;
    }
    if (body.klingElementName !== undefined) {
      nextVb.klingElementName = body.klingElementName;
    }
    if (body.klingReferenceImages !== undefined) {
      nextVb.klingReferenceImages = body.klingReferenceImages;
    }
    meta.visualBible = nextVb;
    await supabase.from("characters").update({ metadata: meta }).eq("id", id);
    return {
      referenceImageUrl: nextVb.referenceImageUrl ?? null,
      referenceImageStatus: nextVb.referenceImageStatus ?? null,
      referencePlatform: nextVb.referencePlatform ?? null,
      approvedReferenceImageUrl: nextVb.approvedReferenceImageUrl ?? null,
      klingElementId: nextVb.klingElementId ?? null,
      klingElementName: nextVb.klingElementName ?? null,
      klingReferenceImages: nextVb.klingReferenceImages ?? [],
    };
  });

  // GET — production-ready validator. A visible character is ready for
  // video only when all five gates pass:
  //   visualCanon.description, characterConsistencyPrompt, wardrobe,
  //   negativeContinuity, AND (approvedReferenceImageUrl OR klingElementId).
  // Voice-or-text-only characters bypass the reference gate; the bible
  // text alone is the asset.
  app.get("/characters/:id/visual-bible/production-ready", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, role, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);
    const vb = ((ch.metadata as Record<string, unknown>)?.visualBible ??
      {}) as Record<string, unknown>;
    const isVoiceOrText =
      ch.role === "voice / text" ||
      ch.role === "voice_or_text" ||
      vb.referenceImageStatus === "not_applicable";
    const visualCanonDesc =
      ((vb.visualCanon as Record<string, unknown> | undefined)?.description as
        | string
        | undefined) ?? "";
    const blockers: Array<{ field: string; message: string }> = [];
    if (!visualCanonDesc.trim()) {
      blockers.push({
        field: "visualCanon.description",
        message: "Visual Canon description is empty.",
      });
    }
    if (!String(vb.characterConsistencyPrompt ?? "").trim()) {
      blockers.push({
        field: "characterConsistencyPrompt",
        message: "Character Consistency Prompt is empty.",
      });
    }
    if (!String(vb.negativeContinuity ?? "").trim()) {
      blockers.push({
        field: "negativeContinuity",
        message: "Negative Continuity is empty.",
      });
    }
    // Wardrobe + reference gates only apply to visible characters. Voice/
    // text-only characters (Daniel in EP01) have no clothing and no actor
    // image — the bible text alone is the asset, so those gates are skipped.
    if (!isVoiceOrText) {
      if (!String(vb.wardrobe ?? "").trim()) {
        blockers.push({
          field: "wardrobe",
          message: "Wardrobe is empty.",
        });
      }
      const approvedUrl = String(vb.approvedReferenceImageUrl ?? "").trim();
      const klingId = String(vb.klingElementId ?? "").trim();
      if (!approvedUrl && !klingId) {
        blockers.push({
          field: "approvedReferenceImageUrl|klingElementId",
          message:
            "No approved reference image URL OR Kling Element ID. Generate the master image, paste/approve the URL, or bind a Kling Element.",
        });
      }
    }
    return {
      ready: blockers.length === 0,
      voiceOrText: isVoiceOrText,
      blockers,
    };
  });

  // PATCH — set the profile status (incomplete / needs_review / production_ready).
  app.patch("/characters/:id/visual-bible/profile-status", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        profileStatus: z.enum(PROFILE_STATUSES as unknown as [string, ...string[]]),
      })
      .strict()
      .parse(req.body ?? {});
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);
    const meta = (ch.metadata as Record<string, unknown>) ?? {};
    const vb = (meta.visualBible as Record<string, unknown> | undefined) ?? {};
    vb.profileStatus = body.profileStatus;
    meta.visualBible = vb;
    await supabase.from("characters").update({ metadata: meta }).eq("id", id);
    return { profileStatus: body.profileStatus };
  });

  // PATCH — write per-field visual bible edits, with manual-edit tracking.
  // Each key the writer changes is recorded in vb.manualEdits so the next
  // extractor pass skips it. Pass { force: true } to clear the mark on a
  // field (i.e. "yes, let the agent rewrite this next time").
  app.patch("/characters/:id/visual-bible/fields", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = z
      .object({
        visualCanon: z
          .object({
            ageRange: z.string().optional(),
            description: z.string().optional(),
          })
          .partial()
          .optional(),
        movementCanon: z.array(z.string()).optional(),
        wardrobe: z.string().optional(),
        characterConsistencyPrompt: z.string().optional(),
        doNotChangeTraits: z.array(z.string()).optional(),
        negativeContinuity: z.string().optional(),
        episodeWardrobeNotes: z.record(z.string()).optional(),
        // Stage-2 — structured per-episode wardrobe / HMU. Composer prefers
        // these over the flat string fields when the brief's episode
        // number is known.
        wardrobeByEpisode: z
          .record(
            z.object({
              top: z.string().optional(),
              bottom: z.string().optional(),
              accessories: z.string().optional(),
              footwear: z.string().optional(),
              forbidden: z.array(z.string()).optional(),
            })
          )
          .optional(),
        hmuByEpisode: z
          .record(
            z.object({
              hairCondition: z.string().optional(),
              makeupState: z.string().optional(),
              faceMarks: z.string().optional(),
              forbidden: z.array(z.string()).optional(),
            })
          )
          .optional(),
        masterCharacterImagePrompt: z.string().optional(),
        masterCharacterImageNegative: z.string().optional(),
        // V3.4 — Continuity flags. presenceType controls the story-
        // containment check (voice_only / text_only / visible /
        // physically_present); cameraGazeAllowed says whether direct-to-
        // lens is permitted for THIS character anywhere.
        presenceType: z
          .enum([
            "visible",
            "physically_present",
            "voice_only",
            "text_only",
          ] as unknown as [string, ...string[]])
          .optional(),
        cameraGazeAllowed: z.boolean().optional(),
        // If true, every field in this patch is cleared from the
        // manualEdits map (releasing it back to the extractor). If false
        // or omitted, every field is marked as manually edited.
        clearManualMark: z.boolean().optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);
    const meta = (ch.metadata as Record<string, unknown>) ?? {};
    const vb = (meta.visualBible as Record<string, unknown> | undefined) ?? {};
    const manualEdits = (vb.manualEdits as Record<string, boolean> | undefined) ?? {};
    const clear = body.clearManualMark === true;
    const touched: string[] = [];
    for (const [k, v] of Object.entries(body)) {
      if (k === "clearManualMark") continue;
      if (v === undefined) continue;
      (vb as Record<string, unknown>)[k] = v;
      touched.push(k);
      if (clear) delete manualEdits[k];
      else manualEdits[k] = true;
    }
    vb.manualEdits = manualEdits;
    meta.visualBible = vb;
    await supabase.from("characters").update({ metadata: meta }).eq("id", id);
    return { touched, manualEdits, clearedMarks: clear };
  });

  // ---------- Seasons ----------
  app.get("/projects/:projectId/seasons", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("seasons")
      .select("*")
      .eq("project_id", projectId)
      .order("number");
    if (error) throw error;
    return data ?? [];
  });

  app.post("/seasons", async (req) => {
    const user = await requireUser(req);
    const body = SeasonCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, ...rest } = body;
    const { data, error } = await supabase
      .from("seasons")
      .insert({ project_id: projectId, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Episodes ----------
  app.get("/projects/:projectId/episodes", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("episodes")
      .select("*")
      .eq("project_id", projectId)
      .order("number");
    if (error) throw error;
    return data ?? [];
  });

  // --- Episode title suggest → approve workflow ---------------------------
  // AI proposes; the writer approves. Until approved, the title never reaches
  // display labels, exports, or file names — it sits in title_suggestion.
  app.post("/episodes/:id/suggest-title", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id);
    return suggestEpisodeTitle(id);
  });

  app.post("/episodes/:id/approve-title", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { title } = z.object({ title: z.string().min(1) }).parse(req.body ?? {});
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id);
    return approveEpisodeTitle(id, title);
  });

  app.post("/episodes/:id/reset-title", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id);
    await resetEpisodeTitle(id);
    return { ok: true };
  });

  app.post("/episodes", async (req) => {
    const user = await requireUser(req);
    const body = EpisodeCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, seasonId, ...rest } = body;
    const { data, error } = await supabase
      .from("episodes")
      .insert({ project_id: projectId, season_id: seasonId ?? null, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Micro Drama: per-episode story structure ----------
  // HOOK / SETUP / TWIST / CLIFFHANGER lives on episodes.metadata.microDrama.
  // The project-side cliffhangerMap is denormalised from these on read so
  // every micro-drama UI can show the season at a glance without a join.
  const MicroDramaEpisode = z
    .object({
      hook: z.string().optional(),
      setup: z.string().optional(),
      twist: z.string().optional(),
      cliffhanger: z.string().optional(),
    })
    .strict();

  app.patch("/episodes/:id/micro-drama", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id);
    const patch = MicroDramaEpisode.parse(req.body ?? {});
    const meta = ((ep.metadata as Record<string, unknown> | null) ?? {}) as Record<string, unknown>;
    const prev = (meta.microDrama as Record<string, unknown> | undefined) ?? {};
    meta.microDrama = { ...prev, ...patch };
    const { data, error } = await supabase
      .from("episodes")
      .update({ metadata: meta })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // GET /episodes/:id/binge-score — recompute on demand from the episode's
  // current microDrama fields + the project's curiosityGap. Deterministic;
  // safe to call as often as the UI wants.
  app.get("/episodes/:id/binge-score", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id);
    const epMeta = (ep.metadata as Record<string, unknown> | null) ?? {};
    const md = (epMeta.microDrama as Record<string, unknown> | undefined) ?? {};
    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", ep.project_id)
      .maybeSingle();
    const projMeta = (proj?.metadata as Record<string, unknown> | null) ?? {};
    const projBible =
      (projMeta.microDramaBible as Record<string, unknown> | undefined) ?? {};
    const curiosityGap =
      typeof projBible.curiosityGap === "string" ? projBible.curiosityGap : undefined;
    const score = computeBingeMomentum(
      {
        hook: typeof md.hook === "string" ? md.hook : undefined,
        setup: typeof md.setup === "string" ? md.setup : undefined,
        twist: typeof md.twist === "string" ? md.twist : undefined,
        cliffhanger: typeof md.cliffhanger === "string" ? md.cliffhanger : undefined,
      },
      curiosityGap
    );
    return score;
  });

  // GET /episodes/:id/viral-test — runs the binge score through the viral
  // test gate. UI flags episodes where passes === false.
  app.get("/episodes/:id/viral-test", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id);
    const epMeta = (ep.metadata as Record<string, unknown> | null) ?? {};
    const md = (epMeta.microDrama as Record<string, unknown> | undefined) ?? {};
    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", ep.project_id)
      .maybeSingle();
    const projMeta = (proj?.metadata as Record<string, unknown> | null) ?? {};
    const projBible =
      (projMeta.microDramaBible as Record<string, unknown> | undefined) ?? {};
    const score = computeBingeMomentum(
      {
        hook: typeof md.hook === "string" ? md.hook : undefined,
        setup: typeof md.setup === "string" ? md.setup : undefined,
        twist: typeof md.twist === "string" ? md.twist : undefined,
        cliffhanger: typeof md.cliffhanger === "string" ? md.cliffhanger : undefined,
      },
      typeof projBible.curiosityGap === "string" ? projBible.curiosityGap : undefined
    );
    return { score, test: viralTest(score) };
  });

  // ---------- Generate screenplay from approved micro-drama chain ----------
  // Tier-guarded to micro_drama projects. Reads episodes.metadata.microDrama
  // as the hard constraint, calls the screenplay agent, runs the five-point
  // validator, persists into the existing `scripts` table with episode_id.
  // Does NOT regenerate the chain. Does NOT touch the prestige TV pipeline.
  // Body schema for generate / regenerate-with-notes / patch-with-notes.
  // All fields optional; defaults to fresh generation with no notes.
  const GenerateMicroDramaScreenplayBody = z
    .object({
      notes: z.string().max(4000).optional(),
      mode: z.enum(["fresh", "patch"]).optional(),
    })
    .strict()
    .optional();

  app.post("/episodes/:id/generate-micro-drama-screenplay", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = GenerateMicroDramaScreenplayBody.parse(req.body ?? {}) ?? {};
    const notes = body.notes?.trim() ? body.notes.trim() : undefined;
    const mode = body.mode ?? "fresh";

    // Long LLM call — lift the per-request socket timeout the way the chain
    // preview route does, so a slow generation doesn't get cut mid-stream.
    req.raw.setTimeout(10 * 60 * 1000);
    reply.raw.setTimeout(10 * 60 * 1000);

    // Load episode + project together so we can tier-guard + read the chain.
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, project_id, number, title, metadata")
      .eq("id", id)
      .maybeSingle();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id as string);

    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", ep.project_id)
      .maybeSingle();
    const projMeta = (proj?.metadata as Record<string, unknown> | null) ?? {};
    if (projMeta.projectType !== "micro_drama") {
      reply.code(400).send({
        error:
          "This endpoint is only for micro_drama projects. Use the standard develop-episode flow for prestige/mini series.",
      });
      return;
    }

    const md = ((ep.metadata as Record<string, unknown> | null) ?? {}).microDrama as
      | Record<string, unknown>
      | undefined;
    if (
      !md ||
      typeof md.hook !== "string" ||
      typeof md.setup !== "string" ||
      typeof md.twist !== "string" ||
      typeof md.cliffhanger !== "string"
    ) {
      reply.code(400).send({
        error:
          "Episode is missing approved chain beats (hook/setup/twist/cliffhanger). Approve the chain before generating a screenplay.",
      });
      return;
    }

    // Pull principal cast names so the agent uses approved characters only.
    const { data: characters } = await supabase
      .from("characters")
      .select("name")
      .eq("project_id", ep.project_id);
    const castNames = (characters ?? [])
      .map((c) => (c.name ?? "").trim())
      .filter((n) => n.length > 0);

    const bibleRaw = (projMeta.microDramaBible as Record<string, unknown> | undefined) ?? {};

    // Patch mode needs the current screenplay as the base material. Fresh
    // mode doesn't read it. Fetch up-front so we can fail fast with a clear
    // error if patch mode is requested with no prior screenplay.
    let priorFountain: string | undefined;
    if (mode === "patch") {
      const { data: priorScript } = await supabase
        .from("scripts")
        .select("fountain")
        .eq("project_id", ep.project_id)
        .eq("episode_id", id)
        .eq("current", true)
        .maybeSingle();
      const priorText = (priorScript?.fountain as string | undefined) ?? "";
      if (!priorText.trim()) {
        reply.code(400).send({
          error:
            "Patch mode requires an existing screenplay. Generate one first (fresh mode), then use patch to edit it.",
        });
        return;
      }
      priorFountain = priorText;
    }

    let agentResult;
    try {
      const { generateMicroDramaScreenplay } = await import(
        "../microDrama/screenplayAgent.js"
      );
      agentResult = await generateMicroDramaScreenplay({
        notes,
        mode,
        priorFountain,
        chain: {
          episodeNumber: ep.number as number,
          title: (ep.title as string | null) ?? `EP${String(ep.number).padStart(2, "0")}`,
          hook: md.hook as string,
          setup: md.setup as string,
          twist: md.twist as string,
          cliffhanger: md.cliffhanger as string,
          revealedToAudience:
            typeof md.revealedToAudience === "string" ? md.revealedToAudience : "",
          withheldFromAudience:
            typeof md.withheldFromAudience === "string"
              ? md.withheldFromAudience
              : "",
          falseAssumptionReinforcedOrBroken:
            typeof md.falseAssumptionReinforcedOrBroken === "string"
              ? md.falseAssumptionReinforcedOrBroken
              : "",
        },
        bible: {
          hook: typeof bibleRaw.hook === "string" ? bibleRaw.hook : "",
          audienceEmotion:
            // @ts-expect-error — runtime-checked enum value
            typeof bibleRaw.audienceEmotion === "string"
              ? bibleRaw.audienceEmotion
              : "suspense",
          // @ts-expect-error — runtime-checked enum value
          episodeLengthSec:
            typeof bibleRaw.episodeLengthSec === "number"
              ? bibleRaw.episodeLengthSec
              : 60,
          cliffhangerEngine:
            typeof bibleRaw.cliffhangerEngine === "string"
              ? bibleRaw.cliffhangerEngine
              : "",
          curiosityGap:
            typeof bibleRaw.curiosityGap === "string"
              ? bibleRaw.curiosityGap
              : undefined,
        },
        castNames,
      });
    } catch (err) {
      const e = err as Error & { status?: number; statusCode?: number };
      const upstream = e.statusCode ?? e.status;
      req.log.error(
        { err: e, upstream, episodeId: id },
        "Micro-drama screenplay generation failed"
      );
      reply.code(502).send({
        error:
          upstream != null
            ? `Screenplay agent upstream error (HTTP ${upstream}): ${e.message}`
            : `Screenplay agent failed: ${e.message}`,
      });
      return;
    }

    const { validateScreenplay } = await import(
      "../microDrama/screenplayValidator.js"
    );
    const validation = validateScreenplay(agentResult.fountain, {
      hook: md.hook as string,
      setup: md.setup as string,
      twist: md.twist as string,
      cliffhanger: md.cliffhanger as string,
      withheldFromAudience:
        typeof md.withheldFromAudience === "string"
          ? md.withheldFromAudience
          : "",
    });

    // Demote any prior current scripts for this episode so the new draft
    // is the live one. Matches the existing scripts.new-draft pattern.
    await supabase
      .from("scripts")
      .update({ current: false })
      .eq("project_id", ep.project_id)
      .eq("episode_id", id)
      .eq("current", true);

    const { data: prior } = await supabase
      .from("scripts")
      .select("draft_number")
      .eq("project_id", ep.project_id)
      .eq("episode_id", id)
      .order("draft_number", { ascending: false })
      .limit(1);
    const nextDraft =
      prior && prior.length > 0 ? (prior[0].draft_number as number) + 1 : 1;

    const title = `Episode ${ep.number} — ${ep.title ?? "Untitled"}`;
    const chainSnapshot = {
      hook: md.hook,
      setup: md.setup,
      twist: md.twist,
      cliffhanger: md.cliffhanger,
      revealedToAudience: md.revealedToAudience ?? "",
      withheldFromAudience: md.withheldFromAudience ?? "",
      falseAssumptionReinforcedOrBroken:
        md.falseAssumptionReinforcedOrBroken ?? "",
    };

    const { data: script, error: insertErr } = await supabase
      .from("scripts")
      .insert({
        project_id: ep.project_id,
        episode_id: id,
        title,
        draft_number: nextDraft,
        current: true,
        fountain: agentResult.fountain,
        metadata: {
          source: "micro_drama_chain",
          chainSnapshot,
          validation,
          generatedAt: new Date().toISOString(),
          usage: agentResult.usage ?? null,
          // Track what writer feedback this draft was generated against, so
          // the UI can show "Draft 2 — patched with notes" etc.
          generationMode: mode,
          writerNotes: notes ?? null,
          // Each new draft starts in pending_approval — the writer must
          // explicitly approve via PATCH /scripts/:id/micro-drama-approval.
          microDramaApproval: {
            status: "pending",
            notes: null,
            approvedAt: null,
            approvedBy: null,
          },
        },
      })
      .select("*")
      .single();
    if (insertErr) throw insertErr;

    // Blocker A fix — populate script_scenes so the downstream production
    // pipeline (auto-build briefs → AI video prompts) has scene rows to
    // run against. Before this fix, micro-drama screenplays were inserted
    // directly and bypassed indexScenes(), leaving every script with 0
    // scene rows. parseFountain + the script_scenes insert are idempotent
    // (delete-then-insert), so re-generations stay clean.
    try {
      const { indexScenes } = await import("../screenplay/sceneIndex.js");
      const indexed = await indexScenes(script.id, agentResult.fountain);
      req.log.info(
        { scriptId: script.id, episodeId: id, scenes: indexed.count },
        "indexScenes ran on micro-drama screenplay"
      );
    } catch (err) {
      // Indexing failure shouldn't tank the screenplay save — log and move
      // on. The writer can re-trigger via Save/regenerate.
      req.log.error(
        { err, scriptId: script.id, episodeId: id },
        "indexScenes failed on micro-drama screenplay (script still saved)"
      );
    }

    return { script, validation };
  });

  // ---------- Production pipeline status + run for an episode ----------
  // Tier-guarded to micro_drama. Reports per-stage completion + runs the
  // five-stage pipeline (cast extract → location extract → autoBuildBriefs
  // → micro-drama prompt composer per shot) when invoked. Character Bible
  // merge-protection: every existing populated DNA/visualBible/biography/
  // wants/needs/flaw/voice_notes slot stays intact; only empty slots get
  // filled. Approved screenplays are NEVER touched.

  app.get("/episodes/:id/production-pipeline-status", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("id, project_id, number, title")
      .eq("id", id)
      .maybeSingle();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id as string);

    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", ep.project_id)
      .maybeSingle();
    const projType =
      ((proj?.metadata as Record<string, unknown> | null) ?? {}).projectType;

    const { data: script } = await supabase
      .from("scripts")
      .select("id, fountain, metadata")
      .eq("project_id", ep.project_id)
      .eq("episode_id", id)
      .eq("current", true)
      .maybeSingle();
    const md = (script?.metadata as Record<string, unknown> | null) ?? {};
    const approval = (md.microDramaApproval as { status?: string } | undefined)?.status;
    const screenplayApproved = approval === "approved";

    let scenesIndexed = 0;
    if (script?.id) {
      const { count } = await supabase
        .from("script_scenes")
        .select("id", { count: "exact", head: true })
        .eq("script_id", script.id);
      scenesIndexed = count ?? 0;
    }

    const { count: characterCount } = await supabase
      .from("characters")
      .select("id", { count: "exact", head: true })
      .eq("project_id", ep.project_id);
    const { count: locationCount } = await supabase
      .from("locations")
      .select("id", { count: "exact", head: true })
      .eq("project_id", ep.project_id);

    const ap = (md.aiPrompts as Record<string, unknown> | undefined) ?? {};
    const briefs = (ap.briefs as Record<string, Record<string, unknown>> | undefined) ?? {};
    const prompts = (ap.prompts as Record<string, Record<string, unknown>> | undefined) ?? {};
    let briefsCount = 0;
    for (const sceneOrd of Object.keys(briefs)) {
      briefsCount += Object.keys(briefs[sceneOrd] ?? {}).length;
    }
    let promptsCount = 0;
    for (const sceneOrd of Object.keys(prompts)) {
      const sceneShots = prompts[sceneOrd] ?? {};
      for (const shotIdx of Object.keys(sceneShots)) {
        const shot = (sceneShots[shotIdx] as Record<string, unknown> | undefined) ?? {};
        if (shot.kling || shot.microDrama) promptsCount += 1;
      }
    }

    return {
      projectType: projType ?? "prestige_series",
      screenplayApproved,
      approvalStatus: approval ?? null,
      scriptId: script?.id ?? null,
      scenesIndexed,
      charactersInProject: characterCount ?? 0,
      locationsInProject: locationCount ?? 0,
      briefsForEpisode: briefsCount,
      promptsForEpisode: promptsCount,
      // Heuristic "complete" gate: every stage produced at least one row.
      pipelineComplete:
        screenplayApproved &&
        scenesIndexed > 0 &&
        (characterCount ?? 0) > 0 &&
        (locationCount ?? 0) > 0 &&
        briefsCount > 0 &&
        promptsCount > 0,
    };
  });

  // POST — run the pipeline. body: { force?: boolean } (optional). The
  // route refuses to re-run a complete pipeline unless force=true.
  app.post("/episodes/:id/run-production-pipeline", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = z
      .object({ force: z.boolean().optional() })
      .strict()
      .optional()
      .parse(req.body ?? {}) ?? {};
    const force = body.force ?? false;

    // Long LLM run — same socket-timeout lift the other generators use.
    req.raw.setTimeout(15 * 60 * 1000);
    reply.raw.setTimeout(15 * 60 * 1000);

    const { data: ep } = await supabase
      .from("episodes")
      .select("id, project_id, number, title")
      .eq("id", id)
      .maybeSingle();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id as string);

    const { data: proj } = await supabase
      .from("projects")
      .select("metadata")
      .eq("id", ep.project_id)
      .maybeSingle();
    const projMeta = (proj?.metadata as Record<string, unknown> | null) ?? {};
    if (projMeta.projectType !== "micro_drama") {
      reply.code(400).send({
        error:
          "Production pipeline is only available for micro_drama projects.",
      });
      return;
    }

    const { data: script } = await supabase
      .from("scripts")
      .select("id, fountain, metadata, episode_id")
      .eq("project_id", ep.project_id)
      .eq("episode_id", id)
      .eq("current", true)
      .maybeSingle();
    if (!script) {
      reply.code(400).send({
        error:
          "No current screenplay for this episode. Generate + approve the screenplay first.",
      });
      return;
    }
    const sMeta = (script.metadata as Record<string, unknown>) ?? {};
    const approval =
      (sMeta.microDramaApproval as { status?: string } | undefined)?.status;
    if (approval !== "approved") {
      reply.code(400).send({
        error:
          "Current screenplay is not approved. Approve the screenplay on the Episodes page before running the pipeline.",
      });
      return;
    }
    const chain = (sMeta.chainSnapshot as Record<string, unknown>) ?? {};

    // Idempotency / re-run guard.
    const ap = (sMeta.aiPrompts as Record<string, unknown> | undefined) ?? {};
    const existingBriefs = ap.briefs as Record<string, Record<string, unknown>> | undefined;
    const existingPrompts = ap.prompts as Record<string, Record<string, unknown>> | undefined;
    const hasBriefs = !!existingBriefs && Object.keys(existingBriefs).length > 0;
    const hasPrompts = !!existingPrompts && Object.keys(existingPrompts).length > 0;
    if ((hasBriefs || hasPrompts) && !force) {
      reply.code(409).send({
        error: "Episode already has production assets. Pass { force: true } to re-run.",
        alreadyProduced: { briefs: hasBriefs, prompts: hasPrompts },
      });
      return;
    }

    // Ensure scene rows are indexed. (Blocker A wired this for new
    // screenplays; older ones may still be empty.)
    let { count: sceneCount } = await supabase
      .from("script_scenes")
      .select("id", { count: "exact", head: true })
      .eq("script_id", script.id);
    if ((sceneCount ?? 0) === 0) {
      const { indexScenes } = await import("../screenplay/sceneIndex.js");
      const { count } = await indexScenes(script.id, script.fountain ?? "");
      sceneCount = count;
    }

    const { data: scenes } = await supabase
      .from("script_scenes")
      .select("ord")
      .eq("script_id", script.id)
      .order("ord");
    if (!scenes || scenes.length === 0) {
      reply.code(500).send({
        error: "Screenplay has no parseable scenes — check the Fountain.",
      });
      return;
    }

    // Dynamic imports keep startup fast.
    const [
      { extractCast },
      { extractLocations },
      { composeMicroDramaPrompt },
      { autoBuildBriefs },
    ] = await Promise.all([
      import("../microDrama/castExtractor.js"),
      import("../microDrama/locationExtractor.js"),
      import("../microDrama/promptComposer.js"),
      import("../draft/aiPrompts/engine.js"),
    ]);

    // ---- Stage 2: cast extract → merge-protect ----
    const { data: knownChars } = await supabase
      .from("characters")
      .select("name, role")
      .eq("project_id", ep.project_id);
    const castResult = await extractCast({
      episodeNumber: ep.number as number,
      episodeTitle: (ep.title as string) ?? "",
      fountain: script.fountain ?? "",
      chain: {
        hook: String(chain.hook ?? ""),
        setup: String(chain.setup ?? ""),
        twist: String(chain.twist ?? ""),
        cliffhanger: String(chain.cliffhanger ?? ""),
        revealedToAudience: String(chain.revealedToAudience ?? ""),
        withheldFromAudience: String(chain.withheldFromAudience ?? ""),
      },
      knownCast: (knownChars ?? []).map((c) => ({
        name: c.name,
        role: c.role ?? undefined,
      })),
    });

    const isEmptyVal = (v: unknown): boolean => {
      if (v == null) return true;
      if (typeof v === "string") return v.trim() === "";
      if (Array.isArray(v)) return v.length === 0;
      return false;
    };
    const stripTrailingPeriod = (s: string): string => s.replace(/\.\s*$/, "");
    const cleanArr = (a: unknown): string[] =>
      Array.isArray(a) ? (a as string[]).filter((s) => typeof s === "string" && s.trim()) : [];

    const charactersWritten: string[] = [];
    for (const c of castResult.characters) {
      // Defensive defaults so persistence never sees undefined.
      const cc = c as unknown as Record<string, unknown>;
      for (const k of [
        "archetype","role","biography","want","need","flaw","voiceNotes",
        "coreWound","publicMask","privateFear","speechCadence","howLies",
        "showsVulnerability","ageRange","visualCanon","characterConsistencyPrompt",
        "wardrobe","negativeContinuity",
      ]) cc[k] = typeof cc[k] === "string" ? cc[k] : "";
      for (const k of [
        "behavioralTics","emotionalTriggers","defensiveStrategies","avoidsSaying",
        "movementCanon","doNotChangeTraits",
      ]) cc[k] = Array.isArray(cc[k]) ? (cc[k] as string[]).filter((s) => typeof s === "string" && s.trim()) : [];

      const isPrincipal = c.presence === "principal";
      const builtConsistency =
        (typeof cc.characterConsistencyPrompt === "string" && (cc.characterConsistencyPrompt as string).trim())
          ? (cc.characterConsistencyPrompt as string).trim()
          : (() => {
              const parts: string[] = [];
              if (typeof cc.visualCanon === "string" && (cc.visualCanon as string).trim())
                parts.push(stripTrailingPeriod((cc.visualCanon as string).trim()));
              if (typeof cc.wardrobe === "string" && (cc.wardrobe as string).trim())
                parts.push(`Wardrobe: ${stripTrailingPeriod((cc.wardrobe as string).trim())}`);
              const dnc = cc.doNotChangeTraits as string[];
              if (dnc.length > 0) parts.push(`Locked: ${dnc.join("; ")}`);
              return parts.length > 0 ? parts.join(". ") + "." : "";
            })();

      const visualBible = {
        visualCanon: {
          ageRange: cc.ageRange,
          description: cc.visualCanon,
        },
        movementCanon: cleanArr(cc.movementCanon),
        characterConsistencyPrompt: builtConsistency,
        wardrobe: cc.wardrobe,
        doNotChangeTraits: cleanArr(cc.doNotChangeTraits),
        negativeContinuity: cc.negativeContinuity,
      };
      const dna = {
        core_wound: cc.coreWound,
        public_mask: cc.publicMask,
        private_fear: cc.privateFear,
        speech_cadence: cc.speechCadence,
        how_lies: cc.howLies,
        shows_vulnerability: cc.showsVulnerability,
        behavioral_tics: cleanArr(cc.behavioralTics),
        emotional_triggers: cleanArr(cc.emotionalTriggers),
        defensive_strategies: cleanArr(cc.defensiveStrategies),
        avoids_saying: cleanArr(cc.avoidsSaying),
      };

      const { data: existing } = await supabase
        .from("characters")
        .select("id, metadata, archetype, role, biography, wants, needs, flaw, voice_notes")
        .eq("project_id", ep.project_id)
        .eq("name", c.name)
        .maybeSingle();

      const update: Record<string, unknown> = {};
      if (existing) {
        // Merge-protect populated columns — empty slots only.
        if (isEmptyVal(existing.archetype)) update.archetype = cc.archetype;
        if (isEmptyVal(existing.role))
          update.role = isPrincipal ? "principal" : "voice / text";
        if (isPrincipal) {
          if (isEmptyVal(existing.biography) && cc.biography) update.biography = cc.biography;
          if (isEmptyVal(existing.wants) && cc.want) update.wants = cc.want;
          if (isEmptyVal(existing.needs) && cc.need) update.needs = cc.need;
          if (isEmptyVal(existing.flaw) && cc.flaw) update.flaw = cc.flaw;
          if (isEmptyVal(existing.voice_notes) && cc.voiceNotes)
            update.voice_notes = cc.voiceNotes;
        } else {
          if (isEmptyVal(existing.voice_notes) && cc.voiceNotes)
            update.voice_notes = cc.voiceNotes;
        }
        const prevMeta = (existing.metadata as Record<string, unknown>) ?? {};
        const prevDna = (prevMeta.dna as Record<string, unknown>) ?? {};
        const prevVB = (prevMeta.visualBible as Record<string, unknown>) ?? {};
        const mergedDna: Record<string, unknown> = { ...prevDna };
        for (const [k, v] of Object.entries(dna)) {
          if (isEmptyVal(prevDna[k])) mergedDna[k] = v;
        }
        const mergedVB: Record<string, unknown> = { ...prevVB };
        for (const [k, v] of Object.entries(visualBible)) {
          if (isEmptyVal(prevVB[k])) mergedVB[k] = v;
        }
        const nextMeta = {
          ...prevMeta,
          entityType: (prevMeta.entityType as string) ?? "individual",
          dna: mergedDna,
          visualBible: mergedVB,
        };
        await supabase
          .from("characters")
          .update({ ...update, metadata: nextMeta })
          .eq("id", existing.id);
      } else {
        await supabase.from("characters").insert({
          project_id: ep.project_id,
          name: c.name,
          archetype: cc.archetype,
          role: isPrincipal ? "principal" : "voice / text",
          biography: isPrincipal ? cc.biography || null : null,
          wants: isPrincipal ? cc.want || null : null,
          needs: isPrincipal ? cc.need || null : null,
          flaw: isPrincipal ? cc.flaw || null : null,
          voice_notes: cc.voiceNotes || null,
          metadata: { entityType: "individual", dna, visualBible },
        });
      }
      charactersWritten.push(c.name);
    }

    // ---- Stage 3: location extract → merge-protect ----
    const { data: knownLocs } = await supabase
      .from("locations")
      .select("name, kind")
      .eq("project_id", ep.project_id);
    const locResult = await extractLocations({
      episodeNumber: ep.number as number,
      episodeTitle: (ep.title as string) ?? "",
      fountain: script.fountain ?? "",
      chain: {
        hook: String(chain.hook ?? ""),
        setup: String(chain.setup ?? ""),
        twist: String(chain.twist ?? ""),
        cliffhanger: String(chain.cliffhanger ?? ""),
        revealedToAudience: String(chain.revealedToAudience ?? ""),
        withheldFromAudience: String(chain.withheldFromAudience ?? ""),
      },
      knownLocations: (knownLocs ?? []).map((l) => ({
        name: l.name,
        kind: l.kind ?? undefined,
      })),
    });
    const locationsWritten: string[] = [];
    for (const l of locResult.locations) {
      l.kind = (l.kind as "interior" | "exterior" | "mixed") ?? "interior";
      l.timeOfDay = l.timeOfDay ?? "";
      l.roomLayout = l.roomLayout ?? "";
      l.lighting = l.lighting ?? "";
      l.props = Array.isArray(l.props) ? l.props : [];
      l.continuityAnchors = Array.isArray(l.continuityAnchors)
        ? l.continuityAnchors
        : [];
      l.cameraAngleOpportunities = Array.isArray(l.cameraAngleOpportunities)
        ? l.cameraAngleOpportunities
        : [];
      l.continuityNotes = l.continuityNotes ?? "";

      const locMeta = {
        kind: l.kind,
        timeOfDay: l.timeOfDay,
        roomLayout: l.roomLayout,
        lighting: l.lighting,
        props: l.props,
        continuityAnchors: l.continuityAnchors,
        cameraAngleOpportunities: l.cameraAngleOpportunities,
        continuityNotes: l.continuityNotes,
      };
      const { data: existing } = await supabase
        .from("locations")
        .select("id, metadata")
        .eq("project_id", ep.project_id)
        .eq("name", l.name)
        .maybeSingle();
      if (existing) {
        const meta = (existing.metadata as Record<string, unknown>) ?? {};
        const prevMD = (meta.microDrama as Record<string, unknown>) ?? {};
        const mergedMD: Record<string, unknown> = { ...prevMD };
        for (const [k, v] of Object.entries(locMeta)) {
          if (isEmptyVal(prevMD[k])) mergedMD[k] = v;
        }
        meta.microDrama = mergedMD;
        await supabase
          .from("locations")
          .update({ metadata: meta })
          .eq("id", existing.id);
      } else {
        await supabase.from("locations").insert({
          project_id: ep.project_id,
          name: l.name,
          kind: l.kind,
          description: l.roomLayout,
          metadata: { microDrama: locMeta },
        });
      }
      locationsWritten.push(l.name);
    }

    // ---- Stage 4: auto-build briefs per scene ----
    let briefCount = 0;
    for (const s of scenes) {
      await autoBuildBriefs({
        scriptId: script.id,
        sceneOrd: s.ord as number,
        opts: {
          mode: "replace",
          confirmOverwriteUserEdits: true,
          sourceStrict: true,
        },
      });
    }

    // ---- Stage 5: micro-drama prompts per shot ----
    const { data: afterBriefs } = await supabase
      .from("scripts")
      .select("metadata")
      .eq("id", script.id)
      .single();
    const afterMeta = (afterBriefs!.metadata as Record<string, unknown>) ?? {};
    const afterAP = (afterMeta.aiPrompts as Record<string, unknown>) ?? {};
    const briefsByScene =
      (afterAP.briefs as Record<string, Record<string, Record<string, unknown>>>) ?? {};
    const promptsByScene: Record<string, Record<string, Record<string, unknown>>> =
      (afterAP.prompts as Record<string, Record<string, Record<string, unknown>>>) ?? {};

    const allCast = castResult.characters;
    const firstLoc = locResult.locations[0] ?? null;
    let promptCount = 0;
    for (const sceneOrd of Object.keys(briefsByScene)) {
      const shotMap = briefsByScene[sceneOrd] ?? {};
      promptsByScene[sceneOrd] = promptsByScene[sceneOrd] ?? {};
      for (const shotIdx of Object.keys(shotMap)) {
        const brief = shotMap[shotIdx] as Record<string, unknown>;
        if (!firstLoc) continue;
        const out = await composeMicroDramaPrompt({
          brief: {
            id: (brief.id as string) ?? `EP${ep.number}_${sceneOrd}_${shotIdx}`,
            primaryImage: (brief.primaryImage as string) ?? "",
            cameraSees: (brief.cameraSees as string) ?? "",
            frame: (brief.frame as string) ?? "",
            light: (brief.light as string) ?? "",
            texture: (brief.texture as string) ?? "",
            lockedDetails: (brief.lockedDetails as string) ?? "",
            action: (brief.action as string) ?? "",
            dialogue: brief.dialogue as string | undefined,
            emotionalBeat: brief.emotionalBeat as string | undefined,
          },
          cast: allCast,
          location: firstLoc,
          withheldFromAudience: String(chain.withheldFromAudience ?? ""),
          durationSec: 4,
        });
        // Persist under BOTH kling (existing panel surfaces it) and
        // microDrama (raw backup).
        // Auto-classify which Kling variant best fits this shot:
        //   • character shot (Maya on screen)         → kling-v3.0
        //     (Improved Element Consistency — Maya looks the same across clips)
        //   • insert / object shot (clock, phone, etc.) → kling-v2.5-turbo
        //     (Max Creativity at Exceptional Value — no recurring face needed)
        const klingVariant = (() => {
          const frame = String(brief.frame ?? "").toUpperCase();
          const primary = String(brief.primaryImage ?? "").toLowerCase();
          if (/\b(INSERT|MACRO|ECU INSERT)\b/.test(frame))
            return "kling-v2.5-turbo";
          const personLed =
            /\b(maya|a woman|a man|her face|his face|a person|a hand|a thumb)\b/.test(
              primary
            );
          return personLed ? "kling-v3.0" : "kling-v2.5-turbo";
        })();

        const promptObj = {
          versionId: `EP${ep.number}_SH${shotIdx}_kling_v1`,
          versionLabel: `Kling v1 (micro-drama EP${ep.number})`,
          model: "kling",
          klingVariant,
          promptType: "text_to_video",
          mainPrompt: out.prompt,
          negativePrompt: out.negativePrompt,
          aspectRatio: out.aspectRatio,
          durationSec: out.durationSec,
          inputMode: "text_only",
          // notes is string[] (steering notes per regeneration). Initial
          // generation has no writer notes — empty array.
          notes: [] as string[],
          safetyWarnings: [],
          sourceBriefId: brief.id ?? null,
          userEdits: [],
          approved: false,
          feedback: [],
          adapterIngredients: null,
          usageNotes: null,
          readiness: { score: 95, ready: true, issues: [] },
        };
        // IMPORTANT shape: the AI Video Prompts panel + listPrompts expect
        // each modelKey slot to be { current: PromptVersion, history: [...] }
        // — NOT a bare PromptVersion. listPrompts iterates EVERY key in
        // the slot map and reads `slot.current`, so any extra key with a
        // different shape (e.g. a "backup" object) crashes the UI. We
        // store under `kling` only — the full prompt + negative + aspect
        // + duration are already inside kling.current.
        promptsByScene[sceneOrd][shotIdx] = {
          ...(promptsByScene[sceneOrd][shotIdx] ?? {}),
          kling: { current: promptObj, history: [] },
        };
        promptCount++;
      }
      briefCount += Object.keys(shotMap).length;
    }

    afterAP.prompts = promptsByScene;
    afterMeta.aiPrompts = afterAP;
    await supabase
      .from("scripts")
      .update({ metadata: afterMeta })
      .eq("id", script.id);

    return {
      ok: true,
      episode: { id, number: ep.number, title: ep.title },
      stages: {
        scenesIndexed: sceneCount ?? 0,
        charactersWritten,
        locationsWritten,
        briefsGenerated: briefCount,
        promptsGenerated: promptCount,
      },
    };
  });

  // ---------- Current micro-drama screenplay for an episode ----------
  // Returns the latest current=true script for this episode, or null when
  // no screenplay has been generated yet. Lets the EpisodesPage retention
  // panel render the prior draft + approval status on page load.
  app.get("/episodes/:id/current-screenplay", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id")
      .eq("id", id)
      .maybeSingle();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id as string);
    const { data: script } = await supabase
      .from("scripts")
      .select("*")
      .eq("project_id", ep.project_id)
      .eq("episode_id", id)
      .eq("current", true)
      .maybeSingle();
    return { script: script ?? null };
  });

  // ---------- All micro-drama screenplay drafts for an episode ----------
  // Returns every script row tied to this episode, ordered newest draft first.
  // Powers the draft-history viewer in the Screenplay block — writers can
  // flip between Draft 1, Draft 2, … and Restore an older one as current.
  app.get("/episodes/:id/screenplay-drafts", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: ep } = await supabase
      .from("episodes")
      .select("project_id")
      .eq("id", id)
      .maybeSingle();
    if (!ep) throw new Error("episode not found");
    await assertProjectMember(user.id, ep.project_id as string);
    const { data, error } = await supabase
      .from("scripts")
      .select(
        "id, title, draft_number, current, fountain, metadata, created_at, updated_at"
      )
      .eq("project_id", ep.project_id)
      .eq("episode_id", id)
      .order("draft_number", { ascending: false });
    if (error) throw error;
    return { drafts: data ?? [] };
  });

  // ---------- Restore a past draft as the current cut ----------
  // Promotes the named script to current=true and demotes every other
  // script for the same episode. Does NOT regenerate or modify the
  // screenplay text — the older draft becomes live again, byte-identical.
  app.post("/scripts/:id/restore-as-current", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: target, error: gerr } = await supabase
      .from("scripts")
      .select("project_id, episode_id")
      .eq("id", id)
      .single();
    if (gerr) throw gerr;
    await assertProjectMember(user.id, target.project_id as string);
    if (!target.episode_id) {
      throw new Error(
        "This script has no episode link — restoring only applies to per-episode scripts."
      );
    }
    // Demote every other script for the same episode, then promote this one.
    await supabase
      .from("scripts")
      .update({ current: false })
      .eq("project_id", target.project_id)
      .eq("episode_id", target.episode_id);
    const { data: promoted, error: perr } = await supabase
      .from("scripts")
      .update({ current: true })
      .eq("id", id)
      .select("*")
      .single();
    if (perr) throw perr;
    return { script: promoted };
  });

  // ---------- Micro-drama screenplay approval ----------
  // Writer-driven approval gate. Status persisted on the script's metadata
  // (no schema change). "approved" locks the script as the canonical Season
  // 1 cut for that episode; "needs_changes" hands it back with notes so
  // the writer (or a regen-with-notes pass) can revise.
  const ApprovalBody = z
    .object({
      status: z.enum(["pending", "approved", "needs_changes"]),
      notes: z.string().max(4000).optional(),
    })
    .strict();

  app.patch("/scripts/:id/micro-drama-approval", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const body = ApprovalBody.parse(req.body ?? {});

    const { data: script, error: gerr } = await supabase
      .from("scripts")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (gerr) throw gerr;
    await assertProjectMember(user.id, script.project_id as string);

    const prevMeta = (script.metadata as Record<string, unknown> | null) ?? {};
    const nextApproval = {
      status: body.status,
      notes: body.notes?.trim() ? body.notes.trim() : null,
      approvedAt: body.status === "approved" ? new Date().toISOString() : null,
      approvedBy: body.status === "approved" ? user.id : null,
    };
    const nextMeta = {
      ...prevMeta,
      microDramaApproval: nextApproval,
    };

    const { data: updated, error: uerr } = await supabase
      .from("scripts")
      .update({ metadata: nextMeta })
      .eq("id", id)
      .select("*")
      .single();
    if (uerr) throw uerr;
    return { script: updated };
  });

  // ---------- Per-prompt Kling variant override ----------
  // Lets the writer pick a specific Kling model variant for an individual
  // shot's prompt (e.g. force v3.0 on a face-shot the auto-classifier put
  // on v2.5 Turbo, or downgrade to v2.1 Master if the negative prompt
  // needs harder adherence). Persists onto the prompt's current version.
  const KLING_VARIANTS = [
    "kling-v3.0",
    "kling-v2.6",
    "kling-v2.5-turbo",
    "kling-v2.1",
    "kling-v2.1-master",
    "kling-v1.6",
    "kling-v1.5",
  ] as const;
  app.patch(
    "/scripts/:id/scenes/:ord/shots/:shot/prompt/:model/variant",
    async (req) => {
      const user = await requireUser(req);
      const { id, ord, shot, model } = req.params as {
        id: string;
        ord: string;
        shot: string;
        model: string;
      };
      if (model !== "kling") {
        throw new Error("Variant override is currently only defined for Kling.");
      }
      const body = z
        .object({
          variant: z.enum(KLING_VARIANTS as unknown as [string, ...string[]]),
        })
        .strict()
        .parse(req.body ?? {});
      const { data: script } = await supabase
        .from("scripts")
        .select("project_id, metadata")
        .eq("id", id)
        .single();
      if (!script) throw new Error("script not found");
      await assertProjectMember(user.id, script.project_id as string);
      const meta = (script.metadata as Record<string, unknown>) ?? {};
      const ap = ((meta.aiPrompts as Record<string, unknown> | undefined) ?? {}) as Record<
        string,
        unknown
      >;
      const prompts = ((ap.prompts as Record<string, unknown> | undefined) ?? {}) as Record<
        string,
        Record<string, Record<string, { current?: Record<string, unknown>; history?: unknown[] }>>
      >;
      const slot = prompts?.[ord]?.[shot]?.[model];
      if (!slot?.current) {
        throw new Error(
          `No ${model} prompt at scene ${ord} shot ${shot} — generate one first.`
        );
      }
      slot.current.klingVariant = body.variant;
      ap.prompts = prompts;
      meta.aiPrompts = ap;
      await supabase.from("scripts").update({ metadata: meta }).eq("id", id);
      return { variant: body.variant };
    }
  );

  // ---------- Locations ----------
  app.get("/projects/:projectId/locations", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .eq("project_id", projectId)
      .order("name");
    if (error) throw error;
    return data ?? [];
  });

  app.post("/locations", async (req) => {
    const user = await requireUser(req);
    const body = LocationCreate.parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    const { projectId, ...rest } = body;
    const { data, error } = await supabase
      .from("locations")
      .insert({ project_id: projectId, ...rest })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // ---------- Relationships ----------
  // Relationships carry rich descriptive fields under metadata.fields:
  //   { pairingName, nature, aWants, bWants, aWithholds, bWithholds,
  //     coreTension, powerDynamic, emotionalCost, dramaticFunction,
  //     buyerSummary, internalNotes, approvalStatus }
  // We persist via the existing `relationships` table (a_id / b_id / nature
  // / tension / metadata) — no schema migration needed.

  const RelFields = z
    .object({
      pairingName: z.string().optional(),
      nature: z.string().optional(),
      aWants: z.string().optional(),
      bWants: z.string().optional(),
      aWithholds: z.string().optional(),
      bWithholds: z.string().optional(),
      coreTension: z.string().optional(),
      powerDynamic: z.string().optional(),
      emotionalCost: z.string().optional(),
      dramaticFunction: z.string().optional(),
      buyerSummary: z.string().optional(),
      internalNotes: z.string().optional(),
      approvalStatus: z.enum(["draft", "needs_review", "approved"]).optional(),
      importance: z.enum(["core", "secondary", "optional", "background"]).optional(),
    })
    .strict();

  app.get("/projects/:projectId/relationships", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("relationships")
      .select("*")
      .eq("project_id", projectId);
    if (error) throw error;
    return data ?? [];
  });

  app.post("/relationships", async (req) => {
    const user = await requireUser(req);
    const body = z
      .object({
        projectId: z.string().uuid(),
        aId: z.string().uuid(),
        bId: z.string().uuid(),
        fields: RelFields.optional(),
      })
      .parse(req.body);
    await assertProjectMember(user.id, body.projectId);
    if (body.aId === body.bId) {
      throw new Error("A relationship needs two distinct characters.");
    }
    const fields = body.fields ?? {};
    const { data, error } = await supabase
      .from("relationships")
      .insert({
        project_id: body.projectId,
        a_id: body.aId,
        b_id: body.bId,
        nature: fields.nature ?? null,
        tension: fields.coreTension ?? null,
        metadata: { fields: { approvalStatus: "draft", ...fields } },
      })
      .select("*")
      .single();
    if (error) {
      // Surface uniqueness constraint cleanly: there's a uniq on (project,
      // a, b) per the schema, so the same pair can't be inserted twice.
      if (/duplicate key/i.test(error.message ?? "")) {
        throw new Error("That pairing already exists.");
      }
      throw error;
    }
    return data;
  });

  app.patch("/relationships/:id", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: cur, error: gerr } = await supabase
      .from("relationships")
      .select("project_id")
      .eq("id", id)
      .single();
    if (gerr) throw gerr;
    await assertProjectMember(user.id, cur.project_id);
    const patch = RelFields.parse(req.body ?? {});
    return patchAndSnapshot(id, patch);
  });

  app.delete("/relationships/:id", async (req, reply) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: cur } = await supabase
      .from("relationships")
      .select("project_id, a_id, b_id")
      .eq("id", id)
      .single();
    if (!cur) throw new Error("relationship not found");
    await assertProjectMember(user.id, cur.project_id);
    // Remember the pair so suggest-preview doesn't resurrect it. The writer
    // can opt in to "Show all possible pairings" to see deleted ones again.
    try {
      const { data: proj } = await supabase
        .from("projects")
        .select("metadata")
        .eq("id", cur.project_id)
        .maybeSingle();
      const meta = ((proj?.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
      const pairKey = [cur.a_id as string, cur.b_id as string].sort().join("|");
      const list = Array.isArray(meta.relationshipsDeleted)
        ? (meta.relationshipsDeleted as string[])
        : [];
      if (!list.includes(pairKey)) {
        meta.relationshipsDeleted = [...list, pairKey].slice(-200);
        await supabase
          .from("projects")
          .update({ metadata: meta })
          .eq("id", cur.project_id);
      }
    } catch {
      /* non-fatal — the delete still proceeds */
    }
    const { error } = await supabase.from("relationships").delete().eq("id", id);
    if (error) throw error;
    return reply.code(204).send();
  });

  // PATCH /characters/:id/entity-type — set characters.metadata.entityType.
  // Only "individual" characters are eligible for relationship pair
  // generation. "group" (e.g. "Claire and Paul Beaumont" as a single record)
  // or "relationship_note" entries are excluded.
  app.patch("/characters/:id/entity-type", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { entityType } = z
      .object({ entityType: z.enum(["individual", "group", "relationship_note"]) })
      .parse(req.body ?? {});
    const { data: ch } = await supabase
      .from("characters")
      .select("project_id, metadata")
      .eq("id", id)
      .single();
    if (!ch) throw new Error("character not found");
    await assertProjectMember(user.id, ch.project_id);
    const meta = ((ch.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
    meta.entityType = entityType;
    const { data, error } = await supabase
      .from("characters")
      .update({ metadata: meta })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  });

  // Curated auto-suggest. Pairings are dramaturgically meaningful — NOT
  // every n*(n-1)/2 combo:
  //   • Only `individual` entities are eligible. Groups + relationship-notes
  //     are skipped (treats "Claire and Paul Beaumont" as a duo, not a
  //     person to pair with everyone).
  //   • Each protagonist pairs with each other MAJOR character (antagonist,
  //     supporting, lead, co-lead, mirror).
  //   • Bios are scanned for spouse / marriage / partner cues to pull in
  //     marital pairs between non-protagonists.
  //   • Pairs not falling into the above are skipped — the writer adds them
  //     manually via "Add Relationship".
  // Caps at 10 new pairs per run.
  app.post("/projects/:projectId/relationships/auto-suggest", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data: chars } = await supabase
      .from("characters")
      .select("id, name, role, biography, metadata")
      .eq("project_id", projectId);
    const cast = chars ?? [];
    const { data: existing } = await supabase
      .from("relationships")
      .select("a_id, b_id")
      .eq("project_id", projectId);
    const have = new Set<string>();
    for (const r of existing ?? []) {
      const a = r.a_id as string;
      const b = r.b_id as string;
      have.add([a, b].sort().join("|"));
    }

    // Filter to eligible individuals.
    const eligible = cast.filter((c) => {
      const meta = ((c.metadata as Record<string, unknown>) ?? {}) as Record<string, unknown>;
      const type = (meta.entityType as string) ?? "individual";
      if (type !== "individual") return false;
      // Conservative defense: compound names ("Claire and Paul Beaumont")
      // are almost certainly groups. We exclude them and rely on the
      // frontend warning to nudge the writer to either split or mark group.
      if (/ and | & /i.test(c.name as string)) return false;
      return true;
    });

    const roleOf = (c: { role: string | null }) =>
      ((c.role as string) ?? "").toLowerCase().trim();
    const isProtagonist = (c: { role: string | null }) =>
      /protag/.test(roleOf(c));
    const isMajor = (c: { role: string | null }) => {
      const r = roleOf(c);
      return (
        !r ||
        /protag|antag|support|lead|co-?lead|mirror|rival/.test(r)
      );
    };

    const protags = eligible.filter(isProtagonist);
    // When no character is explicitly tagged protagonist, treat the FIRST
    // character as the de-facto protagonist so auto-suggest still produces
    // something useful.
    const effectiveProtags = protags.length ? protags : eligible.slice(0, 1);
    const majors = eligible.filter(isMajor);

    // Detect marital / spouse / partner pairs from bios. Cheap heuristic:
    // if character A's bio mentions character B's first name AND the bio
    // contains a marital cue, suggest the pair.
    const MARITAL_CUE = /\b(spouse|husband|wife|married|marriage|partner|fianc)/i;
    const firstName = (full: string) => (full.split(/\s+/)[0] ?? "").trim();
    const maritalHints: Array<[string, string]> = [];
    for (const c of eligible) {
      const bio = (c.biography as string) ?? "";
      if (!MARITAL_CUE.test(bio)) continue;
      for (const other of eligible) {
        if (other.id === c.id) continue;
        const fn = firstName(other.name as string);
        if (!fn || fn.length < 3) continue;
        const re = new RegExp(`\\b${fn}\\b`, "i");
        if (re.test(bio)) {
          maritalHints.push([c.id as string, other.id as string]);
        }
      }
    }

    // Candidate factory shared with /suggest-preview. Each pairing carries
    // importance + a preliminary type so the writer-confirmation UI can show
    // them without another LLM call.
    type Candidate = {
      a_id: string;
      b_id: string;
      project_id: string;
      metadata: Record<string, unknown>;
      // Lightweight echo for the preview UI:
      _preview: {
        aName: string;
        bName: string;
        pairingName: string;
        importance: "core" | "secondary" | "optional" | "background";
        nature: string;
        reason: string;
      };
    };
    const candidates: Candidate[] = [];
    const seen = new Set<string>();
    const add = (
      aId: string,
      bId: string,
      aName: string,
      bName: string,
      reason: string,
      importance: "core" | "secondary" | "optional" | "background",
      nature: string
    ) => {
      const key = [aId, bId].sort().join("|");
      if (have.has(key) || seen.has(key)) return;
      seen.add(key);
      candidates.push({
        project_id: projectId,
        a_id: aId,
        b_id: bId,
        metadata: {
          fields: {
            pairingName: `${aName} ↔ ${bName}`,
            approvalStatus: "draft",
            autoGenerated: true,
            suggestionReason: reason,
            importance,
            nature,
          },
        },
        _preview: {
          aName,
          bName,
          pairingName: `${aName} ↔ ${bName}`,
          importance,
          nature,
          reason,
        },
      });
    };

    // Tier 1: protagonist × each other major. Pairs that involve the
    // protagonist are CORE; pairs between two majors that don't involve the
    // protagonist are SECONDARY.
    for (const p of effectiveProtags) {
      for (const m of majors) {
        if (m.id === p.id) continue;
        const role = roleOf(m);
        const reason = isProtagonist(m)
          ? "co-lead pairing"
          : /antag/.test(role)
          ? "protagonist ↔ antagonist"
          : /mirror/.test(role)
          ? "protagonist ↔ mirror"
          : "protagonist ↔ major supporting";
        const nature = /antag/.test(role)
          ? "adversarial"
          : /mirror/.test(role)
          ? "mirror"
          : /rival/.test(role)
          ? "rivalry"
          : "investigative";
        add(
          p.id as string,
          m.id as string,
          p.name as string,
          m.name as string,
          reason,
          "core",
          nature
        );
      }
    }

    // Tier 2: marital / spouse pairs detected in bios. Always core when one
    // partner is the protagonist; otherwise secondary.
    for (const [a, b] of maritalHints) {
      const aChar = eligible.find((c) => c.id === a);
      const bChar = eligible.find((c) => c.id === b);
      if (!aChar || !bChar) continue;
      const involvesProtag =
        protags.some((p) => p.id === a) || protags.some((p) => p.id === b);
      add(
        a,
        b,
        aChar.name as string,
        bChar.name as string,
        "spouse / marital pair",
        involvesProtag ? "core" : "secondary",
        "marriage"
      );
    }

    const MAX_NEW = 10;
    const trimmed = candidates.slice(0, MAX_NEW);
    if (trimmed.length === 0) {
      const skipped = cast.length - eligible.length;
      return {
        inserted: 0,
        total: have.size,
        skippedNonIndividuals: skipped,
        message:
          eligible.length === 0
            ? "No eligible individual characters yet — set entity type on the cast first."
            : "No new strategic pairings to suggest. Add relationships manually if needed.",
      };
    }
    // Strip the preview echo before insert — it's only for the suggest-
    // preview route's payload, not for storage.
    const insertRows = trimmed.map((t) => ({
      a_id: t.a_id,
      b_id: t.b_id,
      project_id: t.project_id,
      metadata: t.metadata,
    }));
    const { data: ins, error } = await supabase
      .from("relationships")
      .insert(insertRows)
      .select("*");
    if (error) throw error;
    return {
      inserted: ins?.length ?? 0,
      total: have.size + (ins?.length ?? 0),
      skippedNonIndividuals: cast.length - eligible.length,
    };
  });

  // Cleanup auto-suggested noise. Deletes relationships that:
  //   • have approvalStatus !== 'approved'
  //   • have no descriptive content (no buyerSummary / coreTension / wants /
  //     withholds / powerDynamic / dramaticFunction / emotionalCost set)
  // This is the safety net for the over-eager old auto-suggest that
  // generated 28 records. Approved or edited relationships are NEVER
  // touched.
  app.post("/projects/:projectId/relationships/cleanup-auto", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data: rels } = await supabase
      .from("relationships")
      .select("id, metadata, tension, nature")
      .eq("project_id", projectId);
    const toDelete: string[] = [];
    for (const r of rels ?? []) {
      const f =
        (((r.metadata as Record<string, unknown>)?.fields as Record<string, unknown>) ??
          {}) as Record<string, unknown>;
      const status = (f.approvalStatus as string) ?? "draft";
      if (status === "approved") continue;
      const hasContent =
        Boolean((f.buyerSummary as string) && (f.buyerSummary as string).trim()) ||
        Boolean((f.coreTension as string) && (f.coreTension as string).trim()) ||
        Boolean((f.aWants as string) && (f.aWants as string).trim()) ||
        Boolean((f.bWants as string) && (f.bWants as string).trim()) ||
        Boolean((f.aWithholds as string) && (f.aWithholds as string).trim()) ||
        Boolean((f.bWithholds as string) && (f.bWithholds as string).trim()) ||
        Boolean((f.powerDynamic as string) && (f.powerDynamic as string).trim()) ||
        Boolean((f.emotionalCost as string) && (f.emotionalCost as string).trim()) ||
        Boolean(
          (f.dramaticFunction as string) && (f.dramaticFunction as string).trim()
        ) ||
        Boolean((r.tension as string) && (r.tension as string).trim());
      if (!hasContent) toDelete.push(r.id as string);
    }
    if (toDelete.length === 0) return { deleted: 0 };
    const { error } = await supabase
      .from("relationships")
      .delete()
      .in("id", toDelete);
    if (error) throw error;
    return { deleted: toDelete.length };
  });

  // Suggest preview — story-spine driven. Returns candidate pairings WITHOUT
  // persisting, with importance assigned by the source spine — not by role
  // labels alone.
  //
  // Rules:
  //   • CORE: primary-protagonist × any other major; OR marital pair
  //     involving primary protagonist; OR marriage engine confirmed by both
  //     bios; OR pair explicitly co-mentioned in treatment / season arc /
  //     episode loglines / showrunner notes WITH a strong-engine cue.
  //   • SECONDARY: marital pair NOT involving protagonist; OR non-protagonist
  //     pair explicitly co-mentioned in source.
  //   • OPTIONAL: every other dyadic pair (ensemble overlap only).
  //   • BACKGROUND: returned for completeness but UI hides by default.
  //
  // "Primary protagonist" is a SINGLE character — the first character whose
  // role is exactly "protagonist", else the first eligible character. We do
  // NOT pair every protagonist-tagged character with every major (that's
  // what produced the bad Claire × Solano / Paul × Dean cores).
  app.post("/projects/:projectId/relationships/suggest-preview", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const includeDeleted =
      String((req.query as Record<string, string>)?.includeDeleted ?? "") === "true" ||
      ((req.body as Record<string, unknown> | null) ?? {})?.includeDeleted === true;
    return suggestSpineCandidates(projectId, { includeDeleted });
  });

  // Create selected — writer confirms which suggested pairings to persist.
  app.post("/projects/:projectId/relationships/create-selected", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        pairings: z.array(
          z.object({
            aId: z.string().uuid(),
            bId: z.string().uuid(),
            pairingName: z.string().optional(),
            importance: z.enum(["core", "secondary", "optional", "background"]).optional(),
            nature: z.string().optional(),
            reason: z.string().optional(),
          })
        ),
        /** When true, runs the relationship generator on each new record. */
        generate: z.boolean().optional(),
        /** Optional steering text fed to the generator. */
        notes: z.string().optional(),
      })
      .parse(req.body ?? {});
    if (body.pairings.length === 0) return { inserted: 0, generated: 0 };
    const rows = body.pairings.map((p) => ({
      project_id: projectId,
      a_id: p.aId,
      b_id: p.bId,
      nature: p.nature ?? null,
      metadata: {
        fields: {
          pairingName: p.pairingName,
          approvalStatus: "draft",
          autoGenerated: true,
          suggestionReason: p.reason,
          importance: p.importance ?? "secondary",
          nature: p.nature,
        },
      },
    }));
    const { data, error } = await supabase
      .from("relationships")
      .insert(rows)
      .select("*");
    if (error) {
      // Ignore duplicates silently (writer may have already added one
      // earlier); fail loudly on other errors.
      if (!/duplicate key/i.test(error.message ?? "")) throw error;
    }
    const inserted = data ?? [];
    let generated = 0;
    const errors: string[] = [];
    if (body.generate) {
      for (const r of inserted) {
        try {
          await generateAndStore({
            relationshipId: r.id as string,
            notes: body.notes?.trim() || undefined,
          });
          generated++;
        } catch (e) {
          errors.push(`${r.id}: ${(e as Error).message}`);
        }
      }
    }
    return {
      inserted: inserted.length,
      generated,
      errors: errors.slice(0, 5),
    };
  });

  // ONE-CLICK: generate the entire relationship map from approved sources.
  // Pipeline:
  //   1. Run the story-spine heuristic to get ranked candidates.
  //   2. Filter to core + secondary by default (writer can override).
  //   3. Insert each as a relationship row.
  //   4. Immediately run the AI generator so each record lands with FULL
  //      buyer-grade dynamics — no empty drafts.
  //   5. Return the full set so the UI can show a review screen.
  app.post("/projects/:projectId/relationships/generate-map", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const body = z
      .object({
        notes: z.string().optional(),
        importance: z
          .array(z.enum(["core", "secondary", "optional", "background"]))
          .optional(),
        includeDeleted: z.boolean().optional(),
        /** When true, just suggests; doesn't persist or generate. */
        dryRun: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const filter = new Set(body.importance ?? ["core", "secondary"]);
    const { candidates, skippedNonIndividuals } = await suggestSpineCandidates(
      projectId,
      { includeDeleted: body.includeDeleted === true }
    );
    const picked = candidates.filter((c) => filter.has(c.importance));
    if (body.dryRun) {
      return { dryRun: true, candidates: picked, skippedNonIndividuals };
    }
    if (picked.length === 0) {
      return {
        inserted: 0,
        generated: 0,
        candidates: [],
        skippedNonIndividuals,
        message:
          "No core or secondary pairings to generate. Try toggling 'Show optional/background' or set characters' roles + bios first.",
      };
    }
    // 1. Persist as drafts.
    const rows = picked.map((p) => ({
      project_id: projectId,
      a_id: p.aId,
      b_id: p.bId,
      nature: p.nature ?? null,
      metadata: {
        fields: {
          pairingName: p.pairingName,
          approvalStatus: "draft",
          autoGenerated: true,
          suggestionReason: p.reason,
          importance: p.importance,
          nature: p.nature,
        },
      },
    }));
    const { data: inserted, error } = await supabase
      .from("relationships")
      .insert(rows)
      .select("*");
    if (error && !/duplicate key/i.test(error.message ?? "")) throw error;
    // 2. Generate content for each new row sequentially.
    const generatedRecords: Record<string, unknown>[] = [];
    const errors: string[] = [];
    for (const r of inserted ?? []) {
      try {
        const updated = await generateAndStore({
          relationshipId: r.id as string,
          notes: body.notes?.trim() || undefined,
        });
        generatedRecords.push(updated as unknown as Record<string, unknown>);
      } catch (e) {
        errors.push(`${r.id}: ${(e as Error).message}`);
      }
    }
    return {
      inserted: (inserted ?? []).length,
      generated: generatedRecords.length,
      records: generatedRecords,
      errors: errors.slice(0, 5),
      skippedNonIndividuals,
    };
  });

  // Quality check on a stored relationship — scores 8 axes + recommends.
  app.post("/relationships/:id/quality-check", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: cur } = await supabase
      .from("relationships")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!cur) throw new Error("relationship not found");
    await assertProjectMember(user.id, cur.project_id);
    return qualityCheckRelationship(id);
  });

  // Generate / regenerate the AI fields on one relationship.
  const FIELD_KEYS = ALL_GEN_FIELDS as readonly string[];
  app.post("/relationships/:id/generate", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: cur } = await supabase
      .from("relationships")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!cur) throw new Error("relationship not found");
    await assertProjectMember(user.id, cur.project_id);
    const body = z
      .object({
        fields: z.array(z.string()).optional(),
        notes: z.string().optional(),
        force: z.boolean().optional(),
        sourceStrict: z.boolean().optional(),
      })
      .parse(req.body ?? {});
    const fields = body.fields?.filter((f) => FIELD_KEYS.includes(f)) ?? undefined;
    return generateAndStore({
      relationshipId: id,
      fields: fields as (typeof FIELD_KEYS)[number][] | undefined,
      notes: body.notes?.trim() || undefined,
      force: body.force,
      sourceStrict: body.sourceStrict,
    });
  });

  // Approve / un-approve.
  app.post("/relationships/:id/approve", async (req) => {
    const user = await requireUser(req);
    const { id } = req.params as { id: string };
    const { data: cur } = await supabase
      .from("relationships")
      .select("project_id")
      .eq("id", id)
      .single();
    if (!cur) throw new Error("relationship not found");
    await assertProjectMember(user.id, cur.project_id);
    const { approved } = z.object({ approved: z.boolean() }).parse(req.body ?? {});
    return approveRelationship(id, approved);
  });

  // Bulk generation. Scope chooses which records to feed the agent:
  //   • empty_core      — core records with no descriptive content
  //   • empty_secondary — secondary records with no descriptive content
  //   • all_drafts      — every non-approved record (regen)
  app.post("/projects/:projectId/relationships/generate-bulk", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { scope, notes } = z
      .object({
        scope: z.enum(["empty_core", "empty_secondary", "all_drafts"]),
        notes: z.string().optional(),
      })
      .parse(req.body ?? {});
    const { data: rels } = await supabase
      .from("relationships")
      .select("id, metadata")
      .eq("project_id", projectId);
    const matches = (rels ?? []).filter((r) => {
      const f =
        (((r.metadata as Record<string, unknown>)?.fields as Record<string, unknown>) ??
          {}) as Record<string, unknown>;
      const importance = (f.importance as string) ?? "secondary";
      const approved = (f.approvalStatus as string) === "approved";
      const empty =
        !((f.buyerSummary as string) && (f.buyerSummary as string).trim()) &&
        !((f.coreTension as string) && (f.coreTension as string).trim());
      if (scope === "empty_core") return importance === "core" && empty && !approved;
      if (scope === "empty_secondary") return importance === "secondary" && empty && !approved;
      // all_drafts
      return !approved;
    });
    let generated = 0;
    const errors: string[] = [];
    for (const r of matches) {
      try {
        await generateAndStore({
          relationshipId: r.id as string,
          notes: notes?.trim() || undefined,
        });
        generated++;
      } catch (e) {
        errors.push(`${r.id}: ${(e as Error).message}`);
      }
    }
    return {
      requested: matches.length,
      generated,
      errors: errors.slice(0, 5),
    };
  });

  // ---------- Continuity issues ----------
  app.get("/projects/:projectId/continuity", async (req) => {
    const user = await requireUser(req);
    const { projectId } = req.params as { projectId: string };
    await assertProjectMember(user.id, projectId);
    const { data, error } = await supabase
      .from("continuity_issues")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });
}
