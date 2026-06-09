// Sound Bible generator — per-section LLM calls.
//
// The generator is split section-by-section to keep tokens low and to
// make per-section regen-with-notes cheap. The full-bible generator
// orchestrates these in sequence.
//
// Project-generic: the LLM is instructed to DERIVE motifs, signatures,
// and beats from the source script + project canon. No hardcoded
// SELVAJE vocabulary leaks here.

import { callLLM, extractJSON } from "../llm/provider.js";
import { supabase } from "../db/client.js";
import { normalizeKey } from "../continuity/types.js";
import {
  emptySoundBible,
  type CharacterSoundSignature,
  type EpisodeSoundIdentity,
  type LocationSoundSignature,
  type MusicGuidance,
  type SoundBible,
  type SoundMotif,
  type SoundSceneBreakdown,
} from "./types.js";

// ---------------------------------------------------------------------------
// Source assembly (read-only). No writes anywhere.
// ---------------------------------------------------------------------------

export interface GeneratorContext {
  projectId: string;
  episodeId: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  /** The CURRENT script for this episode — read-only. May be a locked
   *  draft; the generator only reads. */
  scriptId: string | null;
  scriptIsLocked: boolean;
  scriptDraftNumber: number | null;
  scriptFountain: string;
  scenes: Array<{
    ord: number;
    slugline: string;
    intExt: string | null;
    timeOfDay: string | null;
    locationKey: string | null;
    fountain: string;
    summary: string | null;
    characters: string[];
  }>;
  /** Project-scoped canon for grounding. */
  characters: Array<{ id: string; name: string; biography?: string | null }>;
  locationBibles: Array<{
    key: string;
    name: string;
    layout: string;
    continuityPrompt: string | null;
  }>;
  propBibles: Array<{ name: string; visualDetails: string }>;
  /** Templates the validator uses for SELVAJE-only filtering — read-only. */
  redevTemplateId: string | null;
}

export async function buildGeneratorContext(
  projectId: string,
  episodeId: string
): Promise<GeneratorContext> {
  const [{ data: project }, { data: episode }, { data: characters }] = await Promise.all([
    supabase
      .from("projects")
      .select("metadata")
      .eq("id", projectId)
      .single(),
    supabase
      .from("episodes")
      .select("number, title")
      .eq("id", episodeId)
      .maybeSingle(),
    supabase
      .from("characters")
      .select("id, name, biography")
      .eq("project_id", projectId),
  ]);

  // Resolve the current script for this episode (or for the project if
  // there is no episodes row, e.g. legacy single-episode projects).
  let scriptQ = supabase
    .from("scripts")
    .select("id, fountain, metadata, draft_number")
    .eq("project_id", projectId)
    .eq("current", true);
  scriptQ = episode ? scriptQ.eq("episode_id", episodeId) : scriptQ.is("episode_id", null);
  const { data: scriptRows } = await scriptQ.order("draft_number", { ascending: false }).limit(1);
  const script = scriptRows?.[0];

  const sceneRows = script
    ? (
        await supabase
          .from("script_scenes")
          .select("ord, slugline, int_ext, time_of_day, fountain, summary, characters")
          .eq("script_id", script.id)
          .order("ord", { ascending: true })
      ).data ?? []
    : [];

  const meta = (project?.metadata as Record<string, unknown> | null) ?? {};
  const locationBibles = Object.entries(
    (meta.locationBibles as Record<string, Record<string, unknown>>) ?? {}
  ).map(([key, b]) => ({
    key,
    name: (b.name as string) ?? key,
    layout: (b.layout as string) ?? "",
    continuityPrompt: (b.continuityPrompt as string) ?? null,
  }));
  const propBibles = Object.values(
    (meta.propBibles as Record<string, Record<string, unknown>>) ?? {}
  ).map((b) => ({
    name: (b.name as string) ?? "",
    visualDetails: (b.visualDetails as string) ?? "",
  }));

  // Latest redev pass for SELVAJE-vs-blank template lookup.
  const passes = Array.isArray(meta.redevelopmentPasses)
    ? (meta.redevelopmentPasses as Array<Record<string, unknown>>)
    : [];
  const latestPass = passes[passes.length - 1];
  const redevTemplateId = (latestPass?.redevTemplateId as string | null | undefined) ?? null;

  const scriptMeta = (script?.metadata as Record<string, unknown> | null) ?? {};
  const scriptIsLocked = scriptMeta.lockedWritingDraft === true;

  return {
    projectId,
    episodeId,
    episodeNumber: (episode?.number as number | null) ?? null,
    episodeTitle: (episode?.title as string | null) ?? null,
    scriptId: (script?.id as string | null) ?? null,
    scriptIsLocked,
    scriptDraftNumber: (script?.draft_number as number | null) ?? null,
    scriptFountain: (script?.fountain as string | null) ?? "",
    scenes: sceneRows.map((s) => ({
      ord: s.ord as number,
      slugline: (s.slugline as string) ?? "",
      intExt: (s.int_ext as string | null) ?? null,
      timeOfDay: (s.time_of_day as string | null) ?? null,
      locationKey: s.slugline ? normalizeKey(s.slugline as string) : null,
      fountain: (s.fountain as string) ?? "",
      summary: (s.summary as string) ?? null,
      characters: ((s.characters as string[] | null) ?? []).filter(Boolean),
    })),
    characters: (characters ?? []).map((c) => ({
      id: c.id as string,
      name: c.name as string,
      biography: (c.biography as string | null) ?? null,
    })),
    locationBibles,
    propBibles,
    redevTemplateId,
  };
}

// ---------------------------------------------------------------------------
// Shared system-prompt fragments
// ---------------------------------------------------------------------------

const STYLE_RULES = [
  "DESCRIPTIVE STYLE LANGUAGE ONLY.",
  "Do NOT reference real composers, real film score titles, real song titles,",
  "or 'in the style of [artist]' phrasing. Forbidden: composer names, score",
  "titles, copyright marks, 'reminiscent of', 'à la', 'sounds like X'.",
  "",
  "Good: 'sparse strings, low sub-bass pulse, dry room tone, distant insects,",
  "no melodic line'.",
  "",
  "Bad: 'Reznor/Ross-style synth bed' / 'in the style of Mica Levi' /",
  "'sounds like the Annihilation score'.",
].join("\n");

const SCREENPLAY_RULES = [
  "Derive motifs, ambiences, and sound rules from the screenplay and the",
  "provided canon. Do NOT invent characters, locations, or props that are",
  "not in the script or the bibles. Do NOT contradict approved canon.",
].join("\n");

// ---------------------------------------------------------------------------
// §1 — Episode Sound Identity
// ---------------------------------------------------------------------------

export async function generateEpisodeSoundIdentity(
  ctx: GeneratorContext,
  notes?: string
): Promise<EpisodeSoundIdentity> {
  const system = [
    "You are the Sound Department for a prestige television production.",
    "Define the SONIC IDENTITY of one episode. Output JSON only.",
    "",
    STYLE_RULES,
    "",
    SCREENPLAY_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{",
    '  "sonicPhilosophy": string,         // one paragraph',
    '  "silenceRules": string[],',
    '  "musicRestraintRules": string[],',
    '  "atmospherePalette": string[],',
    '  "emotionalUseOfSound": string,',
    '  "forbiddenSoundCliches": string[]',
    "}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");

  const user = buildSourcePayload(ctx, { includeAllScenes: false });

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 2048,
  });
  const parsed = extractJSON<Record<string, unknown>>(res.text);
  return {
    sonicPhilosophy: stringOf(parsed.sonicPhilosophy),
    silenceRules: stringListOf(parsed.silenceRules),
    musicRestraintRules: stringListOf(parsed.musicRestraintRules),
    atmospherePalette: stringListOf(parsed.atmospherePalette),
    // recurringMotifIds resolved AFTER motifs are generated; leave empty.
    recurringMotifIds: [],
    emotionalUseOfSound: stringOf(parsed.emotionalUseOfSound),
    forbiddenSoundCliches: stringListOf(parsed.forbiddenSoundCliches),
    sectionApprovedAt: null,
    sectionApprovedBy: null,
  };
}

// ---------------------------------------------------------------------------
// §6 — Music Guidance
// ---------------------------------------------------------------------------

export async function generateMusicGuidance(
  ctx: GeneratorContext,
  notes?: string
): Promise<MusicGuidance> {
  const system = [
    "You are the Music Supervisor. Define score philosophy for this",
    "episode. Output JSON only.",
    "",
    STYLE_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{",
    '  "scorePhilosophy": string,',
    '  "forbiddenMusicMoments": string[],',
    '  "permittedTonalUnderscoreMoments": string[],',
    '  "trailerMusicDirection": string,',
    '  "referenceStyleLanguage": string,',
    '  "emotionalRestraintRules": string[]',
    "}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");
  const user = buildSourcePayload(ctx, { includeAllScenes: false });
  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 1500,
  });
  const parsed = extractJSON<Record<string, unknown>>(res.text);
  return {
    scorePhilosophy: stringOf(parsed.scorePhilosophy),
    forbiddenMusicMoments: stringListOf(parsed.forbiddenMusicMoments),
    permittedTonalUnderscoreMoments: stringListOf(parsed.permittedTonalUnderscoreMoments),
    trailerMusicDirection: stringOf(parsed.trailerMusicDirection),
    referenceStyleLanguage: stringOf(parsed.referenceStyleLanguage),
    emotionalRestraintRules: stringListOf(parsed.emotionalRestraintRules),
    sectionApprovedAt: null,
    sectionApprovedBy: null,
  };
}

// ---------------------------------------------------------------------------
// §3 — Motifs
// ---------------------------------------------------------------------------

export async function generateMotifs(
  ctx: GeneratorContext,
  notes?: string
): Promise<SoundMotif[]> {
  const system = [
    "You are the Sound Designer. Identify the recurring SOUND MOTIFS of",
    "this episode. A motif is a specific recurring sound that the show",
    "uses to carry meaning. Derive motifs from the screenplay text — do",
    "NOT invent motifs unsupported by the script.",
    "",
    STYLE_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{ \"motifs\": [",
    "  {",
    '    "id": string,                       // slug, lowercase_underscores',
    '    "label": string,',
    '    "description": string,',
    '    "introducedAtSceneOrd": number | null,',
    '    "recurringAtSceneOrds": number[],',
    '    "emotionalFunction": string,',
    '    "rules": string[]',
    "  }",
    "]}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");
  const user = buildSourcePayload(ctx, { includeAllScenes: true });
  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 2500,
  });
  const parsed = extractJSON<{ motifs?: unknown[] }>(res.text);
  return (parsed.motifs ?? []).map((raw): SoundMotif => {
    const m = (raw as Record<string, unknown>) ?? {};
    return {
      id: slugifyId(stringOf(m.id) || stringOf(m.label)),
      label: stringOf(m.label),
      description: stringOf(m.description),
      introducedAtSceneOrd: numericOrNull(m.introducedAtSceneOrd),
      recurringAtSceneOrds: numericListOf(m.recurringAtSceneOrds),
      emotionalFunction: stringOf(m.emotionalFunction),
      rules: stringListOf(m.rules),
    };
  });
}

// ---------------------------------------------------------------------------
// §4 — Character Signatures
// ---------------------------------------------------------------------------

export async function generateCharacterSignatures(
  ctx: GeneratorContext,
  motifs: SoundMotif[],
  notes?: string
): Promise<Record<string, CharacterSoundSignature>> {
  const principalChars = ctx.characters.slice(0, 12);
  if (principalChars.length === 0) return {};
  const system = [
    "You are the Sound Designer. For each PRINCIPAL CHARACTER, define how",
    "sound represents them — their associated sounds, silence pattern,",
    "object sounds, when their sound disappears, and how sound reveals",
    "avoidance behaviour. Output JSON only.",
    "",
    STYLE_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{ \"signatures\": [",
    "  {",
    '    "characterName": string,',
    '    "associatedSounds": string[],',
    '    "silencePattern": string,',
    '    "objectSounds": string[],',
    '    "soundDisappearance": string,',
    '    "avoidanceSignals": string[]',
    "  }",
    "]}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");
  const user = [
    buildSourcePayload(ctx, { includeAllScenes: false }),
    "\nPRINCIPAL CHARACTERS:",
    principalChars.map((c) => `- ${c.name}${c.biography ? `: ${c.biography.slice(0, 200)}` : ""}`).join("\n"),
    "\nMOTIFS ALREADY REGISTERED (you may reference them):",
    motifs.map((m) => `- ${m.id} (${m.label})`).join("\n") || "(none)",
  ].join("\n");
  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 3000,
  });
  const parsed = extractJSON<{ signatures?: unknown[] }>(res.text);
  const out: Record<string, CharacterSoundSignature> = {};
  for (const raw of parsed.signatures ?? []) {
    const m = (raw as Record<string, unknown>) ?? {};
    const name = stringOf(m.characterName);
    if (!name) continue;
    const charRow = principalChars.find((c) => c.name.toUpperCase() === name.toUpperCase());
    out[name] = {
      characterName: name,
      characterId: charRow?.id ?? null,
      associatedSounds: stringListOf(m.associatedSounds),
      silencePattern: stringOf(m.silencePattern),
      objectSounds: stringListOf(m.objectSounds),
      soundDisappearance: stringOf(m.soundDisappearance),
      avoidanceSignals: stringListOf(m.avoidanceSignals),
      sectionApprovedAt: null,
      sectionApprovedBy: null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// §5 — Location Signatures
// ---------------------------------------------------------------------------

export async function generateLocationSignatures(
  ctx: GeneratorContext,
  motifs: SoundMotif[],
  notes?: string
): Promise<Record<string, LocationSoundSignature>> {
  if (ctx.locationBibles.length === 0) {
    // Fall back to deriving from sluglines.
    const seen = new Set<string>();
    const derived: Array<{ key: string; name: string }> = [];
    for (const s of ctx.scenes) {
      if (s.locationKey && !seen.has(s.locationKey)) {
        seen.add(s.locationKey);
        derived.push({ key: s.locationKey, name: s.slugline });
      }
    }
    if (derived.length === 0) return {};
  }
  const locations =
    ctx.locationBibles.length > 0
      ? ctx.locationBibles.map((b) => ({ key: b.key, name: b.name, layout: b.layout }))
      : Array.from(
          new Map(
            ctx.scenes
              .filter((s) => s.locationKey)
              .map((s) => [s.locationKey as string, { key: s.locationKey as string, name: s.slugline, layout: "" }])
          ).values()
        );

  const system = [
    "You are the Sound Designer. For each LOCATION used in this episode,",
    "define its sound signature — ambient bed, key diegetic sounds,",
    "whether score is prohibited in that location, anchored motifs, and",
    "writer notes. Output JSON only.",
    "",
    STYLE_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{ \"signatures\": [",
    "  {",
    '    "locationName": string,',
    '    "locationKey": string,',
    '    "ambientBed": string,',
    '    "keyDiegeticPresent": string[],',
    '    "musicProhibited": boolean,',
    '    "anchoredMotifIds": string[],',
    '    "notes": string',
    "  }",
    "]}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");
  const user = [
    buildSourcePayload(ctx, { includeAllScenes: false }),
    "\nLOCATIONS:",
    locations.map((l) => `- key=${l.key} name=${l.name} layout=${l.layout.slice(0, 200)}`).join("\n"),
    "\nMOTIFS ALREADY REGISTERED:",
    motifs.map((m) => `- ${m.id} (${m.label})`).join("\n") || "(none)",
  ].join("\n");
  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    maxTokens: 3000,
  });
  const parsed = extractJSON<{ signatures?: unknown[] }>(res.text);
  const out: Record<string, LocationSoundSignature> = {};
  for (const raw of parsed.signatures ?? []) {
    const m = (raw as Record<string, unknown>) ?? {};
    const key = stringOf(m.locationKey) || normalizeKey(stringOf(m.locationName));
    if (!key) continue;
    out[key] = {
      locationName: stringOf(m.locationName) || key,
      locationKey: key,
      ambientBed: stringOf(m.ambientBed),
      keyDiegeticPresent: stringListOf(m.keyDiegeticPresent),
      musicProhibited: boolOf(m.musicProhibited),
      anchoredMotifIds: stringListOf(m.anchoredMotifIds),
      notes: stringOf(m.notes),
      sectionApprovedAt: null,
      sectionApprovedBy: null,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// §2 — Per-Scene Breakdown (batched in groups of 5)
// ---------------------------------------------------------------------------

export async function generateScenes(
  ctx: GeneratorContext,
  motifs: SoundMotif[],
  characterSignatures: Record<string, CharacterSoundSignature>,
  notes?: string
): Promise<Record<string, SoundSceneBreakdown>> {
  if (ctx.scenes.length === 0) return {};

  const out: Record<string, SoundSceneBreakdown> = {};
  const BATCH = 5;
  for (let i = 0; i < ctx.scenes.length; i += BATCH) {
    const batch = ctx.scenes.slice(i, i + BATCH);
    const system = [
      "You are the Sound Designer. For EACH SCENE provided, define its",
      "sound breakdown. Be observational and concrete; describe sound as",
      "the audience HEARS it, not as a vibe. Output JSON only.",
      "",
      STYLE_RULES,
      "",
      SCREENPLAY_RULES,
      "",
      "Return JSON shaped EXACTLY as:",
      "{ \"scenes\": [",
      "  {",
      '    "ord": number,',
      '    "ambientBed": string,',
      '    "keyDiegetic": string[],',
      '    "nonDiegeticMusic": string,        // "no score" is a valid value',
      '    "silenceNotes": string | null,',
      '    "motifIds": string[],',
      '    "characterSounds": { [name]: string },',
      '    "transitionSound": string | null,',
      '    "aiVideoPromptAudioNotes": string | null',
      "  }",
      "]}",
      notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
    ].join("\n");
    const user = [
      `EPISODE: ${ctx.episodeNumber ?? "?"} — ${ctx.episodeTitle ?? "Untitled"}`,
      "",
      "REGISTERED MOTIFS (use these IDs):",
      motifs.map((m) => `- ${m.id} (${m.label}) — ${m.description}`).join("\n") || "(none)",
      "",
      "PRINCIPAL CHARACTER SIGNATURES (reference when relevant):",
      Object.values(characterSignatures)
        .map((s) => `- ${s.characterName}: silence=${s.silencePattern || "?"}`)
        .join("\n") || "(none)",
      "",
      "SCENES TO BREAK DOWN:",
      batch
        .map((s) => {
          return [
            `--- ord ${s.ord} ---`,
            `slugline: ${s.slugline}`,
            `time of day: ${s.timeOfDay ?? "?"}`,
            `characters: ${s.characters.join(", ") || "(none)"}`,
            `prose: ${s.fountain.slice(0, 1200)}`,
          ].join("\n");
        })
        .join("\n\n"),
    ].join("\n");
    const res = await callLLM({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      maxTokens: 4000,
    });
    const parsed = extractJSON<{ scenes?: unknown[] }>(res.text);
    for (const raw of parsed.scenes ?? []) {
      const m = (raw as Record<string, unknown>) ?? {};
      const ord = numericOrNull(m.ord);
      if (ord == null) continue;
      const sceneSrc = batch.find((s) => s.ord === ord);
      out[String(ord)] = {
        ord,
        sceneHeading: sceneSrc?.slugline ?? `Scene ${ord}`,
        locationKey: sceneSrc?.locationKey ?? null,
        timeOfDay: sceneSrc?.timeOfDay ?? null,
        ambientBed: stringOf(m.ambientBed),
        keyDiegetic: stringListOf(m.keyDiegetic),
        nonDiegeticMusic: stringOf(m.nonDiegeticMusic),
        silenceNotes: nullableStringOf(m.silenceNotes),
        motifIds: stringListOf(m.motifIds),
        characterSounds: stringMapOf(m.characterSounds),
        transitionSound: nullableStringOf(m.transitionSound),
        aiVideoPromptAudioNotes: nullableStringOf(m.aiVideoPromptAudioNotes),
        approvedAt: null,
        approvedBy: null,
      };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Full-bible orchestrator
// ---------------------------------------------------------------------------

export async function generateFullSoundBible(
  ctx: GeneratorContext,
  prior?: SoundBible
): Promise<SoundBible> {
  const base = prior ?? emptySoundBible(ctx.episodeId);
  const identity = await generateEpisodeSoundIdentity(ctx);
  const musicGuidance = await generateMusicGuidance(ctx);
  const motifs = await generateMotifs(ctx);
  const characterSignatures = await generateCharacterSignatures(ctx, motifs);
  const locationSignatures = await generateLocationSignatures(ctx, motifs);
  const scenes = await generateScenes(ctx, motifs, characterSignatures);
  // Backfill identity.recurringMotifIds from motifs the LLM cited in scenes.
  const motifTallies = new Map<string, number>();
  for (const s of Object.values(scenes)) {
    for (const mid of s.motifIds) {
      motifTallies.set(mid, (motifTallies.get(mid) ?? 0) + 1);
    }
  }
  const recurringMotifIds = Array.from(motifTallies.entries())
    .filter(([, n]) => n >= 2)
    .map(([id]) => id);

  // Stamp provenance: fountain + scene-index hashes so the verifier and
  // the UI coverage gate can detect when the bible is stale relative to
  // the source draft.
  const sceneRowsForHash = ctx.scenes.map((s) => ({
    ord: s.ord,
    slugline: s.slugline,
    fountainLen: s.fountain.length,
  }));
  return {
    ...base,
    sourceScriptId: ctx.scriptId,
    sourceDraftNumber: ctx.scriptDraftNumber,
    sourceWasLocked: ctx.scriptIsLocked,
    sourceDraftLabel:
      ctx.scriptDraftNumber != null ? `Draft ${ctx.scriptDraftNumber}` : null,
    sourceFountainHash: djb2Hex(ctx.scriptFountain ?? ""),
    sourceScenesHash: djb2Hex(JSON.stringify(sceneRowsForHash)),
    sourceSceneCount: ctx.scenes.length,
    episodeSoundIdentity: { ...identity, recurringMotifIds },
    musicGuidance,
    motifs,
    characterSignatures,
    locationSignatures,
    scenes,
  };
}

function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildSourcePayload(
  ctx: GeneratorContext,
  opts: { includeAllScenes: boolean }
): string {
  const sceneDigest = ctx.scenes
    .slice(0, opts.includeAllScenes ? ctx.scenes.length : 10)
    .map((s) => `- ord ${s.ord}: ${s.slugline} :: ${s.summary ?? s.fountain.slice(0, 200)}`)
    .join("\n");
  const charactersLine = ctx.characters.map((c) => c.name).join(", ");
  const locationLine = ctx.locationBibles.map((l) => l.name).join(", ");
  return [
    `PROJECT: ${ctx.projectId}`,
    `EPISODE: ${ctx.episodeNumber ?? "?"} — ${ctx.episodeTitle ?? "Untitled"}`,
    `CHARACTERS: ${charactersLine || "(none yet)"}`,
    `LOCATIONS: ${locationLine || "(none yet)"}`,
    "",
    "SCENES:",
    sceneDigest || "(no scenes)",
  ].join("\n");
}

function stringOf(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function nullableStringOf(v: unknown): string | null {
  const s = stringOf(v);
  return s ? s : null;
}
function stringListOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => stringOf(x)).filter(Boolean);
}
function numericListOf(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}
function numericOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function boolOf(v: unknown): boolean {
  return v === true;
}
function stringMapOf(v: unknown): Record<string, string> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const s = stringOf(val);
    if (s) out[k] = s;
  }
  return out;
}
function slugifyId(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
