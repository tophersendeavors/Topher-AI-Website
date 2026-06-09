// Trailer plan generator — per-variant LLM agent.
//
// Reads APPROVED shot list briefs, approved SoundBible MusicPromptPack
// (trailer entries), episode chain (when present, micro-drama), and
// optional pitch one-sheet text. Outputs structured TrailerPlan.
//
// Project-type aware via projectTypeConfig.shotPolicy:
//   • micro_drama   → vertical/social hook-first
//   • prestige_*    → cinematic restraint
//   • feature       → theatrical trailer structure
//   • anthology     → self-contained episode trailer
//
// No copyrighted music references — generator system prompt instructs
// descriptive style language only.

import { callLLM, extractJSON } from "../llm/provider.js";
import { supabase } from "../db/client.js";
import { resolveProjectTypeConfig } from "@toburt/shared";
import { getSoundBible } from "../sound/store.js";
import { containsCopyrightedReference } from "../sound/validator.js";
import {
  TRAILER_VARIANT_DURATIONS,
  type TitleCardBeat,
  type TrailerBeat,
  type TrailerPack,
  type TrailerPlan,
  type TrailerVariantKey,
} from "./types.js";

// ---------------------------------------------------------------------------
// Generator context — read once, threaded into the LLM calls
// ---------------------------------------------------------------------------

export interface GeneratorContext {
  projectId: string;
  episodeId: string;
  projectTitle: string;
  projectType: string;
  projectTypeLabel: string;
  episodeNumber: number | null;
  episodeTitle: string | null;
  scriptId: string | null;
  scriptIsLocked: boolean;
  scriptDraftNumber: number | null;
  /** Approved shot briefs grouped by scene. Empty array when none
   *  approved — generator falls back to all briefs but flags them. */
  approvedShots: SourceShot[];
  /** All briefs — generator may select unapproved ones if the
   *  approved set is empty, surfacing a warning. */
  allShots: SourceShot[];
  /** Approved music guidance — the only one safe to inject without a
   *  copyright concern. */
  approvedTrailerMusic: string | null;
  /** Approved episode sonic philosophy, when present. */
  approvedSonicPhilosophy: string | null;
  /** Episode chain (micro-drama hook/setup/twist/cliff/withheld) — null
   *  for non-micro projects. */
  episodeChain: EpisodeChain | null;
  /** Locations (top-5 by name) for the LLM's sense of world. */
  locations: string[];
  /** Project's overall withhold list (composed). */
  whatNotToReveal: string[];
}

export interface SourceShot {
  sceneOrd: number;
  shotIndex: number;
  primaryImage: string;
  cameraFraming: string;
  action: string;
  emotionalBeat: string;
  location: string;
  characters: string[];
  approvedAt: string | null;
}

export interface EpisodeChain {
  hook: string;
  setup: string;
  twist: string;
  cliffhanger: string;
  withheldFromAudience: string;
}

export async function buildTrailerContext(
  projectId: string,
  episodeId: string
): Promise<GeneratorContext> {
  const [{ data: project }, { data: episode }] = await Promise.all([
    supabase.from("projects").select("title, metadata").eq("id", projectId).single(),
    supabase
      .from("episodes")
      .select("number, title, metadata")
      .eq("id", episodeId)
      .maybeSingle(),
  ]);
  const projMeta = (project?.metadata as Record<string, unknown> | null) ?? {};
  const projectType = (projMeta.projectType as string | undefined) ?? "prestige_series";
  const cfg = resolveProjectTypeConfig(projectType);

  // Current script for this episode.
  let scriptQ = supabase
    .from("scripts")
    .select("id, fountain, metadata, draft_number")
    .eq("project_id", projectId)
    .eq("current", true);
  scriptQ = episode ? scriptQ.eq("episode_id", episodeId) : scriptQ.is("episode_id", null);
  const { data: scriptRows } = await scriptQ
    .order("draft_number", { ascending: false })
    .limit(1);
  const script = scriptRows?.[0];

  const briefs =
    (((script?.metadata as Record<string, unknown> | null) ?? {})
      .aiPrompts as { briefs?: Record<string, Record<string, unknown>> } | undefined)
      ?.briefs ?? {};
  const shotListApproval = ((script?.metadata as Record<string, unknown> | null) ?? {})
    .shotListApproval as
    | {
        shots?: Record<string, { approvedAt: string }>;
        scenes?: Record<string, { approvedAt: string }>;
        episode?: { approvedAt: string } | null;
      }
    | undefined;

  const allShots: SourceShot[] = [];
  for (const [ordStr, sceneBriefs] of Object.entries(briefs)) {
    const ord = parseInt(ordStr, 10);
    if (!Number.isFinite(ord)) continue;
    for (const [idxStr, briefRaw] of Object.entries(
      sceneBriefs as Record<string, Record<string, unknown>>
    )) {
      const shotIndex = parseInt(idxStr, 10);
      if (!Number.isFinite(shotIndex)) continue;
      const brief = briefRaw ?? {};
      const characters = Array.isArray(brief.characters)
        ? (brief.characters as Array<{ name?: string }>).map((c) => c?.name ?? "").filter(Boolean)
        : [];
      const k = `${ord}-${shotIndex}`;
      const approvedAt =
        shotListApproval?.shots?.[k]?.approvedAt ??
        shotListApproval?.scenes?.[String(ord)]?.approvedAt ??
        shotListApproval?.episode?.approvedAt ??
        null;
      allShots.push({
        sceneOrd: ord,
        shotIndex,
        primaryImage: (brief.primaryImage as string) ?? "",
        cameraFraming: (brief.cameraFraming as string) ?? "",
        action: (brief.action as string) ?? "",
        emotionalBeat: (brief.emotionalBeat as string) ?? "",
        location: (brief.location as string) ?? "",
        characters,
        approvedAt,
      });
    }
  }
  const approvedShots = allShots.filter((s) => s.approvedAt != null);

  // Sound bible — approved music guidance + sonic philosophy.
  const bible = await getSoundBible(projectId, episodeId);
  const approvedTrailerMusic =
    bible.musicGuidance.sectionApprovedAt != null
      ? bible.musicGuidance.trailerMusicDirection
      : null;
  const approvedSonicPhilosophy =
    bible.episodeSoundIdentity.sectionApprovedAt != null
      ? bible.episodeSoundIdentity.sonicPhilosophy
      : null;

  // Episode chain (micro-drama only).
  const epMeta = (episode?.metadata as Record<string, unknown> | null) ?? {};
  const microMeta = epMeta.microDrama as
    | { hook?: string; setup?: string; twist?: string; cliffhanger?: string; withheldFromAudience?: string }
    | undefined;
  const episodeChain: EpisodeChain | null = microMeta?.hook
    ? {
        hook: microMeta.hook ?? "",
        setup: microMeta.setup ?? "",
        twist: microMeta.twist ?? "",
        cliffhanger: microMeta.cliffhanger ?? "",
        withheldFromAudience: microMeta.withheldFromAudience ?? "",
      }
    : null;

  // Top locations.
  const locationBibles = (projMeta.locationBibles as Record<string, { name?: string }> | undefined) ?? {};
  const locations = Object.values(locationBibles)
    .map((l) => l?.name ?? "")
    .filter(Boolean)
    .slice(0, 5);

  // Withhold composite — chain.withhold + redev protectedReveals if any.
  const whatNotToReveal: string[] = [];
  if (episodeChain?.withheldFromAudience) whatNotToReveal.push(episodeChain.withheldFromAudience);
  const passes = (projMeta.redevelopmentPasses as Array<Record<string, unknown>> | undefined) ?? [];
  for (const p of passes) {
    const guards = p?.r6Guardrails as { characterContracts?: Array<{ doNotReveal?: string[] }> } | undefined;
    for (const c of guards?.characterContracts ?? []) {
      for (const r of c.doNotReveal ?? []) {
        if (r) whatNotToReveal.push(r);
      }
    }
  }

  return {
    projectId,
    episodeId,
    projectTitle: (project?.title as string) ?? "Untitled",
    projectType,
    projectTypeLabel: cfg.label,
    episodeNumber: (episode?.number as number | null) ?? null,
    episodeTitle: (episode?.title as string | null) ?? null,
    scriptId: (script?.id as string | null) ?? null,
    scriptIsLocked:
      ((script?.metadata as Record<string, unknown> | null)?.lockedWritingDraft as boolean | undefined) ===
      true,
    scriptDraftNumber: (script?.draft_number as number | null) ?? null,
    approvedShots,
    allShots,
    approvedTrailerMusic,
    approvedSonicPhilosophy,
    episodeChain,
    locations,
    whatNotToReveal: Array.from(new Set(whatNotToReveal)),
  };
}

// ---------------------------------------------------------------------------
// Per-variant generator
// ---------------------------------------------------------------------------

const NO_COPYRIGHT_RULE = [
  "NO COPYRIGHTED MUSIC REFERENCES.",
  "Forbidden: composer names, score titles, song titles, copyright marks,",
  "'in the style of [X]', 'reminiscent of', 'sounds like X'.",
  "Use descriptive style language only — e.g. 'sparse strings, sub-bass",
  "pulse, dry room tone, instrumental only'.",
].join("\n");

const NO_REVEAL_RULE = [
  "REVEAL DISCIPLINE.",
  "If the input lists `whatNotToReveal` items, the trailer must TEASE",
  "them without confirming. Each beat MUST set isWithheldSafe=false if",
  "it confirms a withheld item, and isWithheldSafe=true otherwise. The",
  "final hook should leave the audience needing the episode to find",
  "out — never show the answer.",
].join("\n");

function projectTypeDirective(projectType: string): string {
  switch (projectType) {
    case "micro_drama":
      return [
        "MICRO-DRAMA / SOCIAL teaser:",
        "• Vertical 9:16, hook in the first 0.5s, mostly faces / hands /",
        "  phones / objects. No wide establishing shots.",
        "• Title cards short, kinetic. Text overlays welcome.",
        "• Final hook = a cliffhanger frame the viewer cannot ignore.",
      ].join("\n");
    case "prestige_series":
    case "mini_series":
      return [
        "PRESTIGE / MINI-SERIES trailer:",
        "• Cinematic widescreen. Restrained coverage; let frames breathe.",
        "• Title cards minimal, typographic; restraint over flash.",
        "• Music carries emotional weight. No viral / TikTok / Reels language.",
      ].join("\n");
    case "feature":
      return [
        "FEATURE FILM theatrical trailer:",
        "• Widescreen. Three-act build (setup / escalation / climax button).",
        "• Title cards traditional theatrical pacing.",
        "• Closing logo / date / button at the end.",
      ].join("\n");
    case "anthology":
      return [
        "ANTHOLOGY episode trailer:",
        "• Self-contained — assume the viewer hasn't seen prior episodes.",
        "• Frame the episode's central question; tease the world only as",
        "  much as needed.",
      ].join("\n");
    default:
      return "";
  }
}

export async function generateTrailerVariant(
  ctx: GeneratorContext,
  variant: TrailerVariantKey,
  notes?: string
): Promise<TrailerPlan> {
  const durationSec = TRAILER_VARIANT_DURATIONS[variant];
  const shotPool = ctx.approvedShots.length > 0 ? ctx.approvedShots : ctx.allShots;
  const shotPoolDigest = shotPool
    .slice(0, 40)
    .map((s) => `  - scene ${s.sceneOrd} shot ${s.shotIndex}: ${s.primaryImage} (${s.cameraFraming}); chars: ${s.characters.join(", ") || "—"}; approved: ${s.approvedAt ? "yes" : "no"}`)
    .join("\n");

  const sys = [
    "You are a trailer / teaser editor. Produce ONE structured plan for",
    `the ${variant} variant of a ${durationSec}-second cut. Output JSON only.`,
    "",
    projectTypeDirective(ctx.projectType),
    "",
    NO_COPYRIGHT_RULE,
    "",
    NO_REVEAL_RULE,
    "",
    "STRUCTURE (always 4 named acts even when short):",
    "  openingImage    — first frame that buys the next three seconds.",
    "  escalation      — the build; what raises the stakes.",
    "  revealWithheld  — what you TEASE but DO NOT confirm.",
    "  finalHook       — the last frame that earns the question.",
    "",
    "Return JSON shaped EXACTLY as:",
    "{",
    '  "structure": { "openingImage": string, "escalation": string, "revealWithheld": string, "finalHook": string },',
    '  "beats": [',
    "    {",
    '      "durationSec": number,           // sum of beats MUST equal variant duration',
    '      "sourceSceneOrd": number | null,',
    '      "sourceShotIndex": number | null,',
    '      "videoPrompt": string,            // composer-ready, no copyright',
    '      "imagePrompt": string | null,',
    '      "textOverlay": string | null,',
    '      "musicFragment": string,          // descriptive style language only',
    '      "editingNote": string,',
    '      "isWithheldSafe": boolean',
    "    }",
    "  ],",
    '  "titleCardBeats": [',
    "    {",
    '      "durationSec": number,',
    '      "text": string,',
    '      "imagePrompt": string,',
    '      "position": "open" | "act_break" | "end"',
    "    }",
    "  ],",
    '  "voDirection": string | null,',
    '  "endingButton": string,',
    '  "endingImage": string,',
    '  "musicGuidance": string',
    "}",
    notes ? `\nWRITER NOTES (apply verbatim):\n${notes}` : "",
  ].join("\n");

  const user = [
    `PROJECT: ${ctx.projectTitle} (${ctx.projectTypeLabel})`,
    ctx.episodeNumber ? `EPISODE: ${ctx.episodeNumber}${ctx.episodeTitle ? `: ${ctx.episodeTitle}` : ""}` : "",
    "",
    "WHAT NOT TO REVEAL:",
    ctx.whatNotToReveal.length > 0 ? ctx.whatNotToReveal.map((r) => `  - ${r}`).join("\n") : "  (no explicit withholds — use editorial judgment)",
    "",
    ctx.episodeChain
      ? [
          "EPISODE CHAIN (micro-drama):",
          `  hook: ${ctx.episodeChain.hook}`,
          `  setup: ${ctx.episodeChain.setup}`,
          `  twist: ${ctx.episodeChain.twist}`,
          `  cliffhanger: ${ctx.episodeChain.cliffhanger}`,
        ].join("\n")
      : "",
    "",
    ctx.approvedTrailerMusic
      ? `APPROVED TRAILER MUSIC DIRECTION (from Sound Bible):\n  ${ctx.approvedTrailerMusic}`
      : "(no approved trailer music direction yet — derive conservatively)",
    "",
    ctx.approvedSonicPhilosophy
      ? `APPROVED SONIC PHILOSOPHY:\n  ${ctx.approvedSonicPhilosophy}`
      : "",
    "",
    "AVAILABLE LOCATIONS:",
    ctx.locations.length > 0 ? ctx.locations.map((l) => `  - ${l}`).join("\n") : "  (none registered)",
    "",
    `AVAILABLE SHOT BRIEFS (${ctx.approvedShots.length} approved, ${ctx.allShots.length} total):`,
    shotPoolDigest || "  (no briefs registered — generate beats standalone)",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const res = await callLLM({
    model: "claude-sonnet-4-6",
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: 3500,
  });
  const parsed = extractJSON<Record<string, unknown>>(res.text);

  const structureRaw = (parsed.structure as Record<string, unknown> | undefined) ?? {};
  const beatsRaw = Array.isArray(parsed.beats) ? (parsed.beats as Array<Record<string, unknown>>) : [];
  const titleCardsRaw = Array.isArray(parsed.titleCardBeats)
    ? (parsed.titleCardBeats as Array<Record<string, unknown>>)
    : [];

  const beats: TrailerBeat[] = beatsRaw.map((raw, i) => {
    const videoPrompt = stringOf(raw.videoPrompt);
    const musicFragment = stringOf(raw.musicFragment);
    // Strip copyrighted refs out of LLM responses defensively.
    const safeVideo = containsCopyrightedReference(videoPrompt) ? "" : videoPrompt;
    const safeMusic = containsCopyrightedReference(musicFragment) ? "instrumental, descriptive cue" : musicFragment;
    return {
      index: i + 1,
      durationSec: numericOrZero(raw.durationSec),
      sourceSceneOrd: numericOrNull(raw.sourceSceneOrd),
      sourceShotIndex: numericOrNull(raw.sourceShotIndex),
      sourceApprovedAt: null, // resolved below
      videoPrompt: safeVideo,
      imagePrompt: nullableStringOf(raw.imagePrompt),
      textOverlay: nullableStringOf(raw.textOverlay),
      musicFragment: safeMusic,
      editingNote: stringOf(raw.editingNote),
      isWithheldSafe: raw.isWithheldSafe !== false,
    };
  });

  // Hydrate sourceApprovedAt from the pool.
  for (const beat of beats) {
    if (beat.sourceSceneOrd != null && beat.sourceShotIndex != null) {
      const match = ctx.allShots.find(
        (s) => s.sceneOrd === beat.sourceSceneOrd && s.shotIndex === beat.sourceShotIndex
      );
      if (match) beat.sourceApprovedAt = match.approvedAt;
    }
  }

  const titleCardBeats: TitleCardBeat[] = titleCardsRaw.map((raw, i) => ({
    index: i + 1,
    durationSec: numericOrZero(raw.durationSec),
    text: stringOf(raw.text),
    imagePrompt: stringOf(raw.imagePrompt),
    position: ((): "open" | "act_break" | "end" => {
      const p = stringOf(raw.position);
      return p === "open" || p === "act_break" || p === "end" ? p : "open";
    })(),
  }));

  const musicGuidance = stringOf(parsed.musicGuidance);
  const safeMusicGuidance = containsCopyrightedReference(musicGuidance)
    ? "Instrumental — sparse texture, restrained dynamics, no melodic line."
    : musicGuidance;

  return {
    variantKey: variant,
    durationSec,
    approvedAt: null,
    approvedBy: null,
    structure: {
      openingImage: stringOf(structureRaw.openingImage),
      escalation: stringOf(structureRaw.escalation),
      revealWithheld: stringOf(structureRaw.revealWithheld),
      finalHook: stringOf(structureRaw.finalHook),
    },
    beats,
    titleCardBeats,
    voDirection: nullableStringOf(parsed.voDirection),
    endingButton: stringOf(parsed.endingButton),
    endingImage: stringOf(parsed.endingImage),
    whatNotToReveal: ctx.whatNotToReveal,
    musicGuidance: safeMusicGuidance,
  };
}

export async function generateFullTrailerPack(
  ctx: GeneratorContext,
  prior: TrailerPack,
  includeSocial: boolean
): Promise<TrailerPack> {
  const [teaser15, teaser30, trailer60] = await Promise.all([
    generateTrailerVariant(ctx, "teaser15"),
    generateTrailerVariant(ctx, "teaser30"),
    generateTrailerVariant(ctx, "trailer60"),
  ]);
  const social = includeSocial ? await generateTrailerVariant(ctx, "social") : null;
  const derivedFromApprovedShots = ctx.approvedShots.length > 0;
  return {
    ...prior,
    sourceScriptId: ctx.scriptId,
    derivedFromApprovedShots,
    derivedFromApprovedMusic: ctx.approvedTrailerMusic != null,
    variants: { teaser15, teaser30, trailer60, social },
  };
}

function stringOf(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function nullableStringOf(v: unknown): string | null {
  const s = stringOf(v);
  return s ? s : null;
}
function numericOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function numericOrZero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
