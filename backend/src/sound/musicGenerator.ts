// Music prompt pack generator. Reads ONLY APPROVED Sound Bible canon
// and produces a tool-agnostic MusicPromptPack. No copyrighted refs —
// the LLM is instructed to use descriptive style language only.

import { callLLM, extractJSON } from "../llm/provider.js";
import { containsCopyrightedReference } from "./validator.js";
import { emptyMusicPromptPack, type MusicMotifFragment, type MusicPrompt, type MusicPromptPack, type TrailerMusicPrompts } from "./musicTypes.js";
import type { LocationMusicException, SoundBible } from "./types.js";

/** Resolve any approved location-level music exception that covers this
 *  scene ord. Matched by `sceneOrds` (not location key) so it survives
 *  slugline/time-of-day key variants. Returns null when no exception
 *  applies — the scene then follows its own row + location prohibition. */
export function resolveSceneMusicException(
  bible: SoundBible,
  ord: number
): LocationMusicException | null {
  for (const sig of Object.values(bible.locationSignatures)) {
    for (const ex of sig.musicExceptions ?? []) {
      if (ex.sceneOrds.includes(ord)) return ex;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared rules — both episode and scene generators receive these
// ---------------------------------------------------------------------------

const STYLE_RULES = [
  "DESCRIPTIVE STYLE LANGUAGE ONLY.",
  "FORBIDDEN: composer names, score titles, song titles, copyright marks,",
  "'in the style of [X]', 'reminiscent of', 'sounds like X', 'à la'.",
  "If you cannot describe the cue without naming a copyrighted work or",
  "person, omit that field entirely.",
  "",
  "Good: 'sparse strings, low sub-bass pulse, dry room tone, slow swells,",
  "no melodic line'.",
  "Bad: 'Reznor/Ross-style synth bed' / 'in the style of Mica Levi'.",
].join("\n");

const INSTRUMENTAL_RULES = [
  "INSTRUMENTAL BY DEFAULT. Do not request vocals unless the bible's",
  "music guidance explicitly says vocals are permitted in this episode.",
  "Set 'isInstrumental: true' and 'includesVocals: false' for every cue",
  "unless the canon says otherwise.",
].join("\n");

// ---------------------------------------------------------------------------
// §1 — Episode soundtrack prompt
// ---------------------------------------------------------------------------

export async function generateEpisodeSoundtrack(
  bible: SoundBible,
  notes?: string
): Promise<MusicPrompt | null> {
  // Approval gate: bail if the canon driving this prompt isn't approved.
  if (!bible.episodeSoundIdentity.sectionApprovedAt) return null;

  const sys = [
    "You are a music supervisor producing ONE tool-agnostic prompt for",
    "the full-episode soundtrack identity. Output JSON only.",
    "",
    STYLE_RULES,
    "",
    INSTRUMENTAL_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{",
    '  "intent": string,                       // one sentence',
    '  "mood": string[],',
    '  "tempoRange": string | null,            // e.g. "60-70 BPM"',
    '  "instrumentation": string[],',
    '  "texture": string[],',
    '  "intensity": string,                    // descriptive or 0-10',
    '  "durationTargetSec": number | null,',
    '  "loopability": "loopable" | "one-shot" | null,',
    '  "isInstrumental": true,',
    '  "includesVocals": false,',
    '  "description": string                   // full Suno-ready blurb',
    "}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");

  const user = [
    "EPISODE SOUND IDENTITY (approved canon):",
    `- Sonic philosophy: ${bible.episodeSoundIdentity.sonicPhilosophy}`,
    `- Atmosphere palette: ${bible.episodeSoundIdentity.atmospherePalette.join("; ")}`,
    `- Silence rules: ${bible.episodeSoundIdentity.silenceRules.join("; ")}`,
    `- Music restraint rules: ${bible.episodeSoundIdentity.musicRestraintRules.join("; ")}`,
    `- Emotional use of sound: ${bible.episodeSoundIdentity.emotionalUseOfSound}`,
    `- Forbidden cliches: ${bible.episodeSoundIdentity.forbiddenSoundCliches.join("; ")}`,
    "",
    "MUSIC GUIDANCE (approved canon, if present):",
    bible.musicGuidance.sectionApprovedAt
      ? [
          `- Score philosophy: ${bible.musicGuidance.scorePhilosophy}`,
          `- Reference style language: ${bible.musicGuidance.referenceStyleLanguage}`,
          `- Emotional restraint rules: ${bible.musicGuidance.emotionalRestraintRules.join("; ")}`,
        ].join("\n")
      : "(music guidance not yet approved — derive conservatively)",
  ].join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: 1500,
  });
  return parseMusicPrompt(res.text, { kind: "episode_identity" });
}

// ---------------------------------------------------------------------------
// §2 — Per-scene music prompts (batched by 5)
// ---------------------------------------------------------------------------

export async function generateScenePrompts(
  bible: SoundBible,
  notes?: string
): Promise<Record<string, MusicPrompt>> {
  // Only approved scene rows are candidates. Composer reads only
  // approved rows; music prompts should mirror.
  const approvedScenes = Object.values(bible.scenes).filter((s) => s.approvedAt != null);
  if (approvedScenes.length === 0) return {};

  const out: Record<string, MusicPrompt> = {};
  const BATCH = 5;
  for (let i = 0; i < approvedScenes.length; i += BATCH) {
    const batch = approvedScenes.slice(i, i + BATCH);
    const sys = [
      "You are a music supervisor. For EACH scene provided, produce a",
      "tool-agnostic music prompt. If the scene's canon says music is",
      "forbidden in this scene, output noMusic=true and leave other",
      "fields minimal — the writer needs the explicit 'no music' record.",
      "",
      STYLE_RULES,
      "",
      INSTRUMENTAL_RULES,
      "",
      "Return JSON shaped EXACTLY as:",
      "{ \"scenes\": [",
      "  {",
      '    "ord": number,',
      '    "intent": string,',
      '    "mood": string[],',
      '    "tempoRange": string | null,',
      '    "instrumentation": string[],',
      '    "texture": string[],',
      '    "intensity": string,',
      '    "durationTargetSec": number | null,',
      '    "loopability": "loopable" | "one-shot" | null,',
      '    "noMusic": boolean,',
      '    "isInstrumental": true,',
      '    "includesVocals": false,',
      '    "description": string',
      "  }",
      "]}",
      notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
    ].join("\n");
    const user = [
      "APPROVED SCENE CANON:",
      batch
        .map((s) => {
          const ex = resolveSceneMusicException(bible, s.ord);
          const exceptionBlock = ex
            ? [
                "MUSIC EXCEPTION (approved — overrides any 'no score' note on this row):",
                `  This scene IS permitted a constrained near-musical cue. Set noMusic=false.`,
                `  Condition: ${ex.condition}`,
                `  Permitted texture (render ONLY this, descriptive style language): ${ex.permittedTexture}`,
                ex.rules.length ? `  Hard rules: ${ex.rules.join("; ")}` : "",
              ]
                .filter(Boolean)
                .join("\n")
            : "";
          return [
            `--- ord ${s.ord} ---`,
            `heading: ${s.sceneHeading}`,
            `ambient bed: ${s.ambientBed}`,
            `non-diegetic music: ${s.nonDiegeticMusic}`,
            s.silenceNotes ? `silence: ${s.silenceNotes}` : "",
            s.motifIds.length ? `motifs: ${s.motifIds.join(", ")}` : "",
            s.transitionSound ? `transition: ${s.transitionSound}` : "",
            exceptionBlock,
          ]
            .filter(Boolean)
            .join("\n");
        })
        .join("\n\n"),
    ].join("\n");
    const res = await callLLM({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      maxTokens: 3500,
    });
    const parsed = extractJSON<{ scenes?: unknown[] }>(res.text);
    for (const raw of parsed.scenes ?? []) {
      const m = (raw as Record<string, unknown>) ?? {};
      const ord = Number(m.ord);
      if (!Number.isFinite(ord)) continue;
      const prompt = parseMusicPrompt(JSON.stringify(m), { kind: "scene_row", ref: ord });
      if (prompt) out[String(ord)] = prompt;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// §3 — Trailer music (15 / 30 / 60s) with build structure
// ---------------------------------------------------------------------------

export async function generateTrailerMusic(
  bible: SoundBible,
  notes?: string
): Promise<TrailerMusicPrompts | null> {
  if (!bible.musicGuidance.sectionApprovedAt) return null;

  const sys = [
    "You are a trailer music supervisor. Produce THREE prompts (15s, 30s,",
    "60s) and a four-beat build structure (start / rise / break / final",
    "hit). Output JSON only.",
    "",
    STYLE_RULES,
    "",
    INSTRUMENTAL_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{",
    '  "variant15": {<MusicPrompt fields>},',
    '  "variant30": {<MusicPrompt fields>},',
    '  "variant60": {<MusicPrompt fields>},',
    '  "buildStructure": {',
    '    "start": string,',
    '    "rise": string,',
    '    "break": string,',
    '    "finalHit": string',
    "  }",
    "}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");
  const user = [
    "APPROVED MUSIC GUIDANCE:",
    `- Score philosophy: ${bible.musicGuidance.scorePhilosophy}`,
    `- Trailer music direction: ${bible.musicGuidance.trailerMusicDirection}`,
    `- Reference style language: ${bible.musicGuidance.referenceStyleLanguage}`,
    `- Emotional restraint: ${bible.musicGuidance.emotionalRestraintRules.join("; ")}`,
    "",
    "EPISODE IDENTITY (for tonal alignment):",
    bible.episodeSoundIdentity.sectionApprovedAt
      ? `- ${bible.episodeSoundIdentity.sonicPhilosophy}`
      : "(identity not yet approved)",
  ].join("\n");
  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: 2500,
  });
  const parsed = extractJSON<Record<string, unknown>>(res.text);
  const v15 = parseMusicPromptFromObj(parsed.variant15, { kind: "music_guidance", ref: "trailer_15" });
  const v30 = parseMusicPromptFromObj(parsed.variant30, { kind: "music_guidance", ref: "trailer_30" });
  const v60 = parseMusicPromptFromObj(parsed.variant60, { kind: "music_guidance", ref: "trailer_60" });
  if (!v15 || !v30 || !v60) return null;
  const bs = (parsed.buildStructure ?? {}) as Record<string, unknown>;
  return {
    variant15: { ...v15, durationTargetSec: 15 },
    variant30: { ...v30, durationTargetSec: 30 },
    variant60: { ...v60, durationTargetSec: 60 },
    buildStructure: {
      start: stringOf(bs.start),
      rise: stringOf(bs.rise),
      break: stringOf(bs.break),
      finalHit: stringOf(bs.finalHit),
    },
  };
}

// ---------------------------------------------------------------------------
// §4 — Motif fragments
// ---------------------------------------------------------------------------

export async function generateMotifFragments(
  bible: SoundBible,
  notes?: string
): Promise<MusicMotifFragment[]> {
  if (bible.motifs.length === 0) return [];

  const sys = [
    "You are a music supervisor. For each MOTIF below, produce a SHORT",
    "tool-agnostic prompt fragment that captures the motif as a music cue.",
    "Output JSON only.",
    "",
    STYLE_RULES,
    "",
    INSTRUMENTAL_RULES,
    "",
    "Return JSON shaped EXACTLY as:",
    "{ \"fragments\": [",
    "  {",
    '    "motifId": string,',
    '    "prompt": string,                  // single sentence, Suno-ready',
    '    "mood": string[],',
    '    "instrumentation": string[],',
    '    "texture": string[]',
    "  }",
    "]}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");
  const user = [
    "MOTIFS:",
    bible.motifs
      .map((m) =>
        [
          `--- ${m.id} (${m.label}) ---`,
          m.description,
          `Emotional function: ${m.emotionalFunction}`,
          m.rules.length > 0 ? `Rules: ${m.rules.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      )
      .join("\n\n"),
  ].join("\n");
  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: 2500,
  });
  const parsed = extractJSON<{ fragments?: unknown[] }>(res.text);
  const out: MusicMotifFragment[] = [];
  for (const raw of parsed.fragments ?? []) {
    const m = (raw as Record<string, unknown>) ?? {};
    const motifId = stringOf(m.motifId);
    const motif = bible.motifs.find((x) => x.id === motifId);
    if (!motif) continue;
    const prompt = stringOf(m.prompt);
    if (containsCopyrightedReference(prompt)) continue; // safety
    out.push({
      motifId,
      motifLabel: motif.label,
      prompt,
      mood: stringListOf(m.mood),
      instrumentation: stringListOf(m.instrumentation),
      texture: stringListOf(m.texture),
      approvedAt: null,
      approvedBy: null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Full pack orchestrator
// ---------------------------------------------------------------------------

export async function generateMusicPromptPack(
  bible: SoundBible,
  prior?: MusicPromptPack
): Promise<MusicPromptPack> {
  const base = prior ?? emptyMusicPromptPack();
  const [episodeSoundtrack, scenePrompts, trailer, motifFragments] = await Promise.all([
    generateEpisodeSoundtrack(bible),
    generateScenePrompts(bible),
    generateTrailerMusic(bible),
    generateMotifFragments(bible),
  ]);
  const allApproved =
    bible.episodeSoundIdentity.sectionApprovedAt != null &&
    bible.musicGuidance.sectionApprovedAt != null &&
    Object.values(bible.scenes).every((s) => s.approvedAt != null);
  return {
    ...base,
    derivedFromApprovedCanon: allApproved,
    updatedAt: new Date().toISOString(),
    episodeSoundtrack,
    scenePrompts,
    trailer,
    motifFragments,
  };
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseMusicPrompt(
  rawText: string,
  derivedFrom: MusicPrompt["derivedFrom"]
): MusicPrompt | null {
  try {
    const parsed = extractJSON<Record<string, unknown>>(rawText);
    return parseMusicPromptFromObj(parsed, derivedFrom);
  } catch {
    return null;
  }
}

function parseMusicPromptFromObj(
  obj: unknown,
  derivedFrom: MusicPrompt["derivedFrom"]
): MusicPrompt | null {
  if (!obj || typeof obj !== "object") return null;
  const m = obj as Record<string, unknown>;
  const description = stringOf(m.description);
  if (containsCopyrightedReference(description)) {
    // Strip the prompt rather than persist a forbidden ref.
    return null;
  }
  const intent = stringOf(m.intent);
  const noMusic = m.noMusic === true;
  return {
    intent,
    mood: stringListOf(m.mood),
    tempoRange: nullableStringOf(m.tempoRange),
    instrumentation: stringListOf(m.instrumentation),
    texture: stringListOf(m.texture),
    intensity: stringOf(m.intensity),
    durationTargetSec: numericOrNull(m.durationTargetSec),
    loopability:
      m.loopability === "loopable" || m.loopability === "one-shot"
        ? (m.loopability as "loopable" | "one-shot")
        : null,
    noMusic,
    isInstrumental: m.isInstrumental !== false,
    includesVocals: m.includesVocals === true,
    description,
    derivedFrom,
    approvedAt: null,
    approvedBy: null,
  };
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
function numericOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
