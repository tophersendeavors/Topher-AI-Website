// Sound / Music / Atmosphere Bible — HTTP routes.
//
// All endpoints read scripts.fountain + script_scenes as SOURCE
// (read-only) and write only to projects.metadata.soundBibles. No route
// in this file touches scripts.fountain or script_scenes. The lock
// guards on scripts/script_scenes therefore can never refuse a sound
// route — by design, this whole module is on the safe side of the
// lock.

import type { FastifyInstance } from "fastify";
import { requireUser } from "../auth/verifyJwt.js";
import { assertProjectMember } from "../db/queries.js";
import { supabase } from "../db/client.js";
import {
  approveSoundBible,
  approveSoundScene,
  approveSoundSection,
  getSoundBible,
  patchCharacterSoundSignature,
  patchLocationSoundSignature,
  patchSoundBibleSection,
  patchSoundSceneRow,
  putSoundBible,
} from "../sound/store.js";
import {
  buildGeneratorContext,
  generateCharacterSignatures,
  generateEpisodeSoundIdentity,
  generateFullSoundBible,
  generateLocationSignatures,
  generateMotifs,
  generateMusicGuidance,
  generateScenes,
} from "../sound/generator.js";
import { auditSoundBible } from "../sound/validator.js";
import {
  exportSoundBibleJSON,
  exportSoundBibleMarkdown,
} from "../sound/exporter.js";
import { SOUND_SECTIONS, type SoundBible, type SoundSection } from "../sound/types.js";

function assertSection(s: string): SoundSection {
  if ((SOUND_SECTIONS as readonly string[]).includes(s)) return s as SoundSection;
  throw new Error(`unknown sound section: ${s}`);
}

export default async function soundRoutes(app: FastifyInstance) {
  // GET full SoundBible (empty shell if none yet).
  app.get(
    "/projects/:projectId/episodes/:episodeId/sound-bible",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const bible = await getSoundBible(projectId, episodeId);
      // Surface source-draft identity so the UI banner can read it
      // without an extra query.
      const ctx = await buildGeneratorContext(projectId, episodeId);
      return {
        bible,
        source: {
          scriptId: ctx.scriptId,
          scriptDraftNumber: ctx.scriptDraftNumber,
          scriptIsLocked: ctx.scriptIsLocked,
          episodeNumber: ctx.episodeNumber,
          episodeTitle: ctx.episodeTitle,
          sceneCount: ctx.scenes.length,
        },
      };
    }
  );

  // POST full generate — orchestrates per-section generation. Returns the
  // saved bible.
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/generate",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const ctx = await buildGeneratorContext(projectId, episodeId);
      const prior = await getSoundBible(projectId, episodeId);
      const next = await generateFullSoundBible(ctx, prior);
      const saved = await putSoundBible(projectId, next);
      return { bible: saved };
    }
  );

  // POST per-section generate. Body: { notes?: string }
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/section/:section/generate",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, section } = req.params as {
        projectId: string;
        episodeId: string;
        section: string;
      };
      await assertProjectMember(user.id, projectId);
      const sec = assertSection(section);
      const notes = (req.body as { notes?: string } | null)?.notes;
      const ctx = await buildGeneratorContext(projectId, episodeId);
      const prior = await getSoundBible(projectId, episodeId);

      let next: SoundBible = prior;
      if (sec === "episodeSoundIdentity") {
        next = { ...prior, episodeSoundIdentity: await generateEpisodeSoundIdentity(ctx, notes) };
      } else if (sec === "musicGuidance") {
        next = { ...prior, musicGuidance: await generateMusicGuidance(ctx, notes) };
      } else if (sec === "motifs") {
        next = { ...prior, motifs: await generateMotifs(ctx, notes) };
      } else if (sec === "characterSignatures") {
        next = {
          ...prior,
          characterSignatures: await generateCharacterSignatures(ctx, prior.motifs, notes),
        };
      } else if (sec === "locationSignatures") {
        next = {
          ...prior,
          locationSignatures: await generateLocationSignatures(ctx, prior.motifs, notes),
        };
      } else if (sec === "scenes") {
        next = {
          ...prior,
          scenes: await generateScenes(ctx, prior.motifs, prior.characterSignatures, notes),
        };
      }
      const saved = await putSoundBible(projectId, next);
      return { bible: saved };
    }
  );

  // PUT full save — partial deep-merge by section. Body: Partial<SoundBible>.
  app.put(
    "/projects/:projectId/episodes/:episodeId/sound-bible",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const patch = (req.body ?? {}) as Partial<SoundBible>;
      const prior = await getSoundBible(projectId, episodeId);
      const next: SoundBible = {
        ...prior,
        episodeSoundIdentity: patch.episodeSoundIdentity ?? prior.episodeSoundIdentity,
        musicGuidance: patch.musicGuidance ?? prior.musicGuidance,
        motifs: patch.motifs ?? prior.motifs,
        scenes: patch.scenes ?? prior.scenes,
        characterSignatures: patch.characterSignatures ?? prior.characterSignatures,
        locationSignatures: patch.locationSignatures ?? prior.locationSignatures,
      };
      const saved = await putSoundBible(projectId, next);
      return { bible: saved };
    }
  );

  // PUT per-scene row.
  app.put(
    "/projects/:projectId/episodes/:episodeId/sound-bible/scenes/:ord",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, ord } = req.params as {
        projectId: string;
        episodeId: string;
        ord: string;
      };
      await assertProjectMember(user.id, projectId);
      const ordNum = parseInt(ord, 10);
      if (!Number.isFinite(ordNum)) throw new Error("ord must be a number");
      const body = (req.body ?? {}) as Partial<SoundBible["scenes"][string]>;
      const prior = await getSoundBible(projectId, episodeId);
      const priorRow = prior.scenes[String(ordNum)];
      if (!priorRow) throw new Error(`no scene row at ord ${ordNum}`);
      const next = { ...priorRow, ...body, ord: ordNum };
      const saved = await patchSoundSceneRow(projectId, episodeId, ordNum, next);
      return { bible: saved };
    }
  );

  // POST per-scene approve.
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/scenes/:ord/approve",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, ord } = req.params as {
        projectId: string;
        episodeId: string;
        ord: string;
      };
      await assertProjectMember(user.id, projectId);
      const ordNum = parseInt(ord, 10);
      const saved = await approveSoundScene(projectId, episodeId, ordNum, user.id);
      return { bible: saved };
    }
  );

  // POST per-section approve.
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/section/:section/approve",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, section } = req.params as {
        projectId: string;
        episodeId: string;
        section: string;
      };
      await assertProjectMember(user.id, projectId);
      const sec = assertSection(section);
      const saved = await approveSoundSection(projectId, episodeId, sec, user.id);
      return { bible: saved };
    }
  );

  // POST whole-bible approve.
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/approve",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const saved = await approveSoundBible(projectId, episodeId, user.id);
      return { bible: saved };
    }
  );

  // POST audit (read-only — uses current persisted bible).
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/audit",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const bible = await getSoundBible(projectId, episodeId);
      const ctx = await buildGeneratorContext(projectId, episodeId);
      const result = auditSoundBible({
        bible,
        expectedSceneOrds: ctx.scenes.map((s) => s.ord),
      });
      return { audit: result };
    }
  );

  // GET export — format=markdown|json
  app.get(
    "/projects/:projectId/episodes/:episodeId/sound-bible/export",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const format = ((req.query as { format?: string }).format ?? "markdown").toLowerCase();
      const bible = await getSoundBible(projectId, episodeId);
      const { data: ep } = await supabase
        .from("episodes")
        .select("number, title")
        .eq("id", episodeId)
        .maybeSingle();
      const label = ep
        ? `Episode ${ep.number}${ep.title ? `: ${ep.title}` : ""}`
        : "Untitled episode";
      if (format === "json") {
        reply.header("content-type", "application/json");
        return exportSoundBibleJSON(bible);
      }
      reply.header("content-type", "text/markdown; charset=utf-8");
      return exportSoundBibleMarkdown(bible, label);
    }
  );

  // POST patch a character signature row.
  app.put(
    "/projects/:projectId/episodes/:episodeId/sound-bible/character-signatures/:name",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, name } = req.params as {
        projectId: string;
        episodeId: string;
        name: string;
      };
      await assertProjectMember(user.id, projectId);
      const body = (req.body ?? {}) as Partial<SoundBible["characterSignatures"][string]>;
      const prior = await getSoundBible(projectId, episodeId);
      const priorRow = prior.characterSignatures[name];
      if (!priorRow) throw new Error(`no character signature for ${name}`);
      const next = { ...priorRow, ...body, characterName: name };
      const saved = await patchCharacterSoundSignature(projectId, episodeId, name, next);
      return { bible: saved };
    }
  );

  // POST patch a location signature row.
  app.put(
    "/projects/:projectId/episodes/:episodeId/sound-bible/location-signatures/:key",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, key } = req.params as {
        projectId: string;
        episodeId: string;
        key: string;
      };
      await assertProjectMember(user.id, projectId);
      const body = (req.body ?? {}) as Partial<SoundBible["locationSignatures"][string]>;
      const prior = await getSoundBible(projectId, episodeId);
      const priorRow = prior.locationSignatures[key];
      if (!priorRow) throw new Error(`no location signature for ${key}`);
      const next = { ...priorRow, ...body, locationKey: key };
      const saved = await patchLocationSoundSignature(projectId, episodeId, key, next);
      return { bible: saved };
    }
  );

  // PUT per-section direct save (for inline edits).
  app.put(
    "/projects/:projectId/episodes/:episodeId/sound-bible/section/:section",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, section } = req.params as {
        projectId: string;
        episodeId: string;
        section: string;
      };
      await assertProjectMember(user.id, projectId);
      const sec = assertSection(section);
      const body = (req.body ?? {}) as { value?: unknown };
      if (body.value === undefined) throw new Error("body.value is required");
      if (sec === "episodeSoundIdentity") {
        const saved = await patchSoundBibleSection(
          projectId,
          episodeId,
          "episodeSoundIdentity",
          body.value as SoundBible["episodeSoundIdentity"]
        );
        return { bible: saved };
      }
      if (sec === "musicGuidance") {
        const saved = await patchSoundBibleSection(
          projectId,
          episodeId,
          "musicGuidance",
          body.value as SoundBible["musicGuidance"]
        );
        return { bible: saved };
      }
      if (sec === "motifs") {
        const saved = await patchSoundBibleSection(
          projectId,
          episodeId,
          "motifs",
          body.value as SoundBible["motifs"]
        );
        return { bible: saved };
      }
      throw new Error(`section ${sec} does not support direct PUT — use the per-row endpoints`);
    }
  );
}
