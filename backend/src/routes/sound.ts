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
  approveMusicPromptPack,
  approveSoundBible,
  approveSoundScene,
  approveSoundSection,
  getMusicPromptPack,
  getSoundBible,
  patchCharacterSoundSignature,
  patchLocationSoundSignature,
  patchSoundBibleSection,
  patchSoundSceneRow,
  putMusicPromptPack,
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
import {
  generateEpisodeSoundtrack,
  generateMotifFragments,
  generateMusicPromptPack,
  generateScenePrompts,
  generateTrailerMusic,
} from "../sound/musicGenerator.js";
import {
  renderComposerBrief,
  renderSunoMotif,
  renderSunoPrompt,
  renderTrailerComposerBrief,
  renderTrailerSuno,
  renderUdioPrompt,
} from "../sound/musicAdapters.js";
import { auditSoundBible } from "../sound/validator.js";
import {
  exportSoundBibleJSON,
  exportSoundBibleMarkdown,
} from "../sound/exporter.js";
import { SOUND_SECTIONS, type SoundBible, type SoundSection } from "../sound/types.js";
import { MUSIC_ADAPTERS, type MusicAdapter, type MusicPromptPack } from "../sound/musicTypes.js";

function assertSection(s: string): SoundSection {
  if ((SOUND_SECTIONS as readonly string[]).includes(s)) return s as SoundSection;
  throw new Error(`unknown sound section: ${s}`);
}

function assertMusicAdapter(s: string): MusicAdapter {
  if ((MUSIC_ADAPTERS as readonly string[]).includes(s)) return s as MusicAdapter;
  throw new Error(`unknown music adapter: ${s}`);
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

  // ===================================================================
  // Music prompt pack — derived view of the Sound Bible canon. Tool-
  // agnostic. Suno is the first adapter; Udio + Composer Brief ship in
  // the same release.
  // ===================================================================

  // GET music pack (or null when none generated yet).
  app.get(
    "/projects/:projectId/episodes/:episodeId/sound-bible/music",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const pack = await getMusicPromptPack(projectId, episodeId);
      const bible = await getSoundBible(projectId, episodeId);
      return {
        pack,
        // Surface the approval state of the underlying canon so the UI
        // can disable Generate buttons that would otherwise be no-ops.
        canonReadiness: {
          episodeIdentityApproved: bible.episodeSoundIdentity.sectionApprovedAt != null,
          musicGuidanceApproved: bible.musicGuidance.sectionApprovedAt != null,
          approvedSceneCount: Object.values(bible.scenes).filter((s) => s.approvedAt != null).length,
          totalSceneCount: Object.keys(bible.scenes).length,
          motifCount: bible.motifs.length,
        },
      };
    }
  );

  // POST full pack generate (orchestrates per-section). Returns the saved pack.
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/music/generate",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const bible = await getSoundBible(projectId, episodeId);
      const prior = (await getMusicPromptPack(projectId, episodeId)) ?? undefined;
      const next = await generateMusicPromptPack(bible, prior);
      const saved = await putMusicPromptPack(projectId, episodeId, next);
      return { pack: saved };
    }
  );

  // POST per-slot regenerate. Slots: episode | scenes | trailer | motifs.
  // Body: { notes?: string }
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/music/slot/:slot/generate",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId, slot } = req.params as {
        projectId: string;
        episodeId: string;
        slot: string;
      };
      await assertProjectMember(user.id, projectId);
      const notes = (req.body as { notes?: string } | null)?.notes;
      const bible = await getSoundBible(projectId, episodeId);
      const prior = (await getMusicPromptPack(projectId, episodeId)) ?? {
        version: 0,
        approvedAt: null,
        approvedBy: null,
        derivedFromApprovedCanon: false,
        updatedAt: new Date().toISOString(),
        episodeSoundtrack: null,
        scenePrompts: {},
        trailer: null,
        motifFragments: [],
      };
      let next: MusicPromptPack = prior;
      if (slot === "episode") {
        next = { ...prior, episodeSoundtrack: await generateEpisodeSoundtrack(bible, notes) };
      } else if (slot === "scenes") {
        next = { ...prior, scenePrompts: await generateScenePrompts(bible, notes) };
      } else if (slot === "trailer") {
        next = { ...prior, trailer: await generateTrailerMusic(bible, notes) };
      } else if (slot === "motifs") {
        next = { ...prior, motifFragments: await generateMotifFragments(bible, notes) };
      } else {
        throw new Error(`unknown music slot: ${slot}`);
      }
      const saved = await putMusicPromptPack(projectId, episodeId, next);
      return { pack: saved };
    }
  );

  // POST approve full pack.
  app.post(
    "/projects/:projectId/episodes/:episodeId/sound-bible/music/approve",
    async (req) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const saved = await approveMusicPromptPack(projectId, episodeId, user.id);
      return { pack: saved };
    }
  );

  // GET export — returns a plain-text body the UI can route into the
  // clipboard or download as a file. Query:
  //   adapter=suno|udio|composer_brief
  //   scope=episode | scene:N | trailer:15|30|60|all | motif:ID | all
  app.get(
    "/projects/:projectId/episodes/:episodeId/sound-bible/music/export",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const q = req.query as { adapter?: string; scope?: string };
      const adapter = assertMusicAdapter(q.adapter ?? "suno");
      const scope = (q.scope ?? "all").trim();
      const pack = await getMusicPromptPack(projectId, episodeId);
      if (!pack) {
        reply.code(404);
        return { error: "No music pack generated yet." };
      }
      const text = renderScope(pack, adapter, scope);
      reply.header("content-type", "text/plain; charset=utf-8");
      return text;
    }
  );

  // GET JSON export of the full music pack.
  app.get(
    "/projects/:projectId/episodes/:episodeId/sound-bible/music/export.json",
    async (req, reply) => {
      const user = await requireUser(req);
      const { projectId, episodeId } = req.params as { projectId: string; episodeId: string };
      await assertProjectMember(user.id, projectId);
      const pack = await getMusicPromptPack(projectId, episodeId);
      reply.header("content-type", "application/json");
      return pack ?? { error: "No music pack generated yet." };
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

/** Render a slice of the music pack for a chosen adapter + scope. Pure
 *  function — no DB, no LLM. */
function renderScope(pack: MusicPromptPack, adapter: MusicAdapter, scope: string): string {
  const r = adapter === "suno"
    ? renderSunoPrompt
    : adapter === "udio"
    ? renderUdioPrompt
    : renderComposerBrief;
  if (scope === "episode") {
    return pack.episodeSoundtrack
      ? r(pack.episodeSoundtrack)
      : "(no episode soundtrack prompt yet)";
  }
  if (scope.startsWith("scene:")) {
    const ord = scope.slice("scene:".length);
    const p = pack.scenePrompts[ord];
    return p ? r(p) : `(no music prompt for scene ${ord})`;
  }
  if (scope.startsWith("trailer:")) {
    const variant = scope.slice("trailer:".length);
    if (!pack.trailer) return "(no trailer pack yet)";
    if (variant === "15" || variant === "30" || variant === "60") {
      if (adapter === "composer_brief") return renderTrailerComposerBrief(pack.trailer);
      return renderTrailerSuno(pack.trailer, variant);
    }
    if (variant === "all") {
      if (adapter === "composer_brief") return renderTrailerComposerBrief(pack.trailer);
      return [
        "## 15s\n" + renderTrailerSuno(pack.trailer, "15"),
        "## 30s\n" + renderTrailerSuno(pack.trailer, "30"),
        "## 60s\n" + renderTrailerSuno(pack.trailer, "60"),
      ].join("\n\n");
    }
    return "(unknown trailer variant)";
  }
  if (scope.startsWith("motif:")) {
    const id = scope.slice("motif:".length);
    const f = pack.motifFragments.find((m) => m.motifId === id);
    if (!f) return `(no motif fragment for "${id}")`;
    if (adapter === "suno") return renderSunoMotif(f);
    if (adapter === "udio") return renderSunoMotif(f); // Suno-shaped works fine for Udio at fragment scale
    return `**${f.motifLabel}** (\`${f.motifId}\`)\n${f.prompt}`;
  }
  // scope === "all" — full dump
  const lines: string[] = [];
  lines.push("# Music Prompt Pack");
  if (pack.episodeSoundtrack) {
    lines.push("\n## Episode soundtrack\n" + r(pack.episodeSoundtrack));
  }
  if (pack.trailer) {
    lines.push("\n## Trailer (15s)\n" + (adapter === "composer_brief" ? renderTrailerComposerBrief(pack.trailer) : renderTrailerSuno(pack.trailer, "15")));
    if (adapter !== "composer_brief") {
      lines.push("\n## Trailer (30s)\n" + renderTrailerSuno(pack.trailer, "30"));
      lines.push("\n## Trailer (60s)\n" + renderTrailerSuno(pack.trailer, "60"));
    }
  }
  for (const ord of Object.keys(pack.scenePrompts).sort((a, b) => Number(a) - Number(b))) {
    lines.push(`\n## Scene ${ord}\n` + r(pack.scenePrompts[ord]));
  }
  for (const f of pack.motifFragments) {
    lines.push(`\n## Motif: ${f.motifLabel}\n` + (adapter === "composer_brief" ? f.prompt : renderSunoMotif(f)));
  }
  return lines.join("\n");
}
