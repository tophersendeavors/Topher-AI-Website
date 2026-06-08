// Prompt Impact Preview — given a canon field path that's about to
// change (or that just changed), determine which scenes/shots in a
// given script the change will affect, in human-friendly labels.
//
// The matching rules mirror what aiPrompts/engine.ts uses to filter
// canon references onto shots:
//   • locationBibles.{key}.*   → scenes whose slugline matches that key
//   • propBibles.{key}.*       → shots whose visibleSetElements mention
//                                 any word from the prop key
//   • characters.{id}.*        → shots that include that character
//
// This lives separately from engine.ts so the route layer can call it
// without dragging the whole prompt-generation pipeline along.

import { supabase } from "../db/client.js";
import { normalizeKey } from "../continuity/types.js";

export interface AffectedShot {
  /** Episode-aware human label: "EP01 SC01 SH02" */
  label: string;
  /** Raw refs the regen endpoint expects. */
  sceneOrd: number;
  shotIndex: number;
  /** Whether prompts currently exist on this shot — so the UI can show
   *  "(no prompts yet)" vs "(3 prompts will go stale)". */
  promptCountByModel: Record<string, number>;
  /** Why this shot matched. */
  matchReason: string;
}

export interface AffectedScene {
  label: string;
  sceneOrd: number;
  sceneNumber: string | null;
  slugline: string | null;
  shots: AffectedShot[];
}

export interface PromptImpactReport {
  fieldPath: string;
  /** Friendly summary of what category the field belongs to. */
  category: "location" | "prop" | "character" | "other";
  scenes: AffectedScene[];
  totalShots: number;
  /** "promptText" — the prompt's text will change.
   *  "reference" — the reference-metadata block will change (no text edit).
   *  "both" — either may change. We default to "both" because we can't
   *  perfectly predict — the user gets a clear hint either way. */
  affects: "promptText" | "reference" | "both";
  /** Quick suggestion line to show below the list. */
  suggestion: string;
}

export async function computePromptImpact(args: {
  projectId: string;
  scriptId: string;
  fieldPath: string;
}): Promise<PromptImpactReport> {
  const { fieldPath } = args;
  const category = categorize(fieldPath);

  const { data: script } = await supabase
    .from("scripts")
    .select("episode_id, metadata")
    .eq("id", args.scriptId)
    .single();
  const scriptMeta = (script?.metadata ?? {}) as Record<string, unknown>;
  const briefs = ((scriptMeta.aiPrompts as Record<string, unknown> | undefined)
    ?.briefs as Record<string, Record<string, Record<string, unknown>>> | undefined) ?? {};
  const prompts = ((scriptMeta.aiPrompts as Record<string, unknown> | undefined)
    ?.prompts as
    | Record<string, Record<string, Record<string, unknown>>>
    | undefined) ?? {};

  let episodeNumber: number | null = null;
  if (script?.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number")
      .eq("id", script.episode_id)
      .maybeSingle();
    episodeNumber = (ep?.number as number | undefined) ?? null;
  }

  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline")
    .eq("script_id", args.scriptId)
    .order("ord", { ascending: true });

  const scenesById = new Map<number, { ord: number; slugline: string | null }>();
  for (const s of scenes ?? []) {
    scenesById.set(s.ord as number, { ord: s.ord as number, slugline: (s.slugline as string | null) ?? null });
  }

  const out: AffectedScene[] = [];
  let totalShots = 0;

  for (const [sceneOrdStr, byShot] of Object.entries(briefs)) {
    const sceneOrd = Number(sceneOrdStr);
    const scene = scenesById.get(sceneOrd);
    const slug = scene?.slugline ?? "";
    const slugKey = slug ? normalizeKey(slug) : "";

    const affectedShots: AffectedShot[] = [];
    for (const [shotKey, brief] of Object.entries(byShot ?? {})) {
      const shotIndex = parseShotIndex(shotKey);
      const matched = matchFieldToShot({
        fieldPath,
        category,
        brief: brief as Record<string, unknown>,
        slugKey,
      });
      if (!matched.matched) continue;
      // Count prompts on this shot.
      const promptByModel = (prompts[sceneOrdStr]?.[shotKey] ?? {}) as Record<
        string,
        Record<string, unknown>
      >;
      const promptCountByModel: Record<string, number> = {};
      for (const m of Object.keys(promptByModel)) {
        promptCountByModel[m] = promptByModel[m]?.current ? 1 : 0;
      }
      affectedShots.push({
        label: buildShotLabel({
          episodeNumber,
          sceneOrd,
          shotIndex,
        }),
        sceneOrd,
        shotIndex,
        promptCountByModel,
        matchReason: matched.reason,
      });
      totalShots++;
    }
    if (affectedShots.length === 0) continue;
    out.push({
      label: buildSceneLabel({
        episodeNumber,
        sceneOrd,
        slugline: scene?.slugline ?? null,
      }),
      sceneOrd,
      sceneNumber: null,
      slugline: scene?.slugline ?? null,
      shots: affectedShots.sort((a, b) => a.shotIndex - b.shotIndex),
    });
  }

  out.sort((a, b) => a.sceneOrd - b.sceneOrd);

  const affects: PromptImpactReport["affects"] =
    category === "location" || category === "prop"
      ? "both"
      : category === "character"
        ? "both"
        : "promptText";

  const suggestion = totalShots
    ? `Approving this change will mark ${totalShots} prompt${
        totalShots === 1 ? "" : "s"
      } as stale. Regenerate to bake the new canon into the text and reference metadata.`
    : "No existing shots use this canon yet — no prompts will go stale.";

  return {
    fieldPath,
    category,
    scenes: out,
    totalShots,
    affects,
    suggestion,
  };
}

function categorize(fieldPath: string): PromptImpactReport["category"] {
  if (fieldPath.startsWith("locationBibles.")) return "location";
  if (fieldPath.startsWith("propBibles.")) return "prop";
  if (fieldPath.startsWith("characters.")) return "character";
  return "other";
}

interface MatchResult {
  matched: boolean;
  reason: string;
}

function matchFieldToShot(args: {
  fieldPath: string;
  category: PromptImpactReport["category"];
  brief: Record<string, unknown>;
  slugKey: string;
}): MatchResult {
  if (args.category === "location") {
    const bibleKey = args.fieldPath.split(".")[1] ?? "";
    if (!bibleKey || !args.slugKey) return { matched: false, reason: "" };
    const sameLoc =
      args.slugKey === bibleKey ||
      args.slugKey.includes(bibleKey) ||
      bibleKey.includes(args.slugKey);
    if (sameLoc) {
      return { matched: true, reason: "scene takes place in this location" };
    }
    return { matched: false, reason: "" };
  }
  if (args.category === "prop") {
    const propKey = args.fieldPath.split(".")[1] ?? "";
    const visibleRaw = ((args.brief.visibleSetElements as string[] | undefined) ?? [])
      .join(" ")
      .toLowerCase();
    const propWords = propKey
      .split("_")
      .filter((w) => w.length >= 4)
      .map((w) => w.toLowerCase());
    if (propWords.some((w) => visibleRaw.includes(w))) {
      return {
        matched: true,
        reason: `prop "${propKey.replace(/_/g, " ")}" is visible in this shot`,
      };
    }
    return { matched: false, reason: "" };
  }
  if (args.category === "character") {
    const charsInBrief = ((args.brief.characters as Array<{ name?: string }> | undefined) ?? [])
      .map((c) => (c.name ?? "").toLowerCase());
    const fieldLower = args.fieldPath.toLowerCase();
    const hit = charsInBrief.some((n) => n && fieldLower.includes(n.split(" ")[0]));
    if (hit) {
      return { matched: true, reason: "character appears in this shot" };
    }
    return { matched: false, reason: "" };
  }
  return { matched: false, reason: "" };
}

function parseShotIndex(key: string): number {
  const m = key.match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}

function buildSceneLabel(args: {
  episodeNumber: number | null;
  sceneOrd: number;
  slugline: string | null;
}): string {
  const ep = args.episodeNumber != null
    ? `EP${String(args.episodeNumber).padStart(2, "0")}`
    : "";
  const sc = `SC${String(args.sceneOrd + 1).padStart(2, "0")}`;
  const slug = args.slugline ? ` — ${args.slugline}` : "";
  return [ep, sc].filter(Boolean).join(" ") + slug;
}

function buildShotLabel(args: {
  episodeNumber: number | null;
  sceneOrd: number;
  shotIndex: number;
}): string {
  const ep = args.episodeNumber != null
    ? `EP${String(args.episodeNumber).padStart(2, "0")}`
    : "";
  const sc = `SC${String(args.sceneOrd + 1).padStart(2, "0")}`;
  const sh = `SH${String(args.shotIndex).padStart(2, "0")}`;
  return [ep, sc, sh].filter(Boolean).join(" ");
}
