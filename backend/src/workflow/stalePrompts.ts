// Stale-prompt detection (Stage 5 step C).
//
// A stored prompt is "stale" when the canon it depends on has changed
// since the prompt was generated. We detect two failure modes:
//
//   1. NEW canon references exist for fields visible in this shot but
//      are NOT attached to the stored prompt's referenceMetadata.
//   2. A TEXT OVERRIDE exists for a canon path visible in this shot but
//      the override's distinctive tokens are NOT present in the prompt
//      body (the LLM never saw the new prose).
//
// Returns a per-shot/per-model list with human-readable reasons.

import { supabase } from "../db/client.js";
import { loadResolvedCanon } from "../departments/canonResolver.js";
import { normalizeKey } from "../continuity/types.js";

export interface StalePromptInfo {
  sceneOrd: number;
  shotIndex: number;
  model: string;
  versionId: string;
  reasons: string[];
  /** Friendly label — "EP01 SC01 SH02 · Kling" — so users don't see
   *  raw ordinals like "#0.2.kling". Computed during detection from
   *  episode + scene_number + shotIndex + a model-display map. */
  label: string;
  /** Whether this prompt is safe to keep using AS-IS (false) or must be
   *  regenerated (true). For now: every stale prompt should be
   *  regenerated. */
  needsRegen: boolean;
}

const MODEL_DISPLAY: Record<string, string> = {
  kling: "Kling",
  veo: "Veo",
  veo3: "Veo 3",
  flow: "Flow",
  runway: "Runway",
  midjourney: "Midjourney",
};

function modelDisplay(key: string): string {
  return MODEL_DISPLAY[key.toLowerCase()] ?? key;
}

export interface StalePromptReport {
  scriptId: string;
  totalPrompts: number;
  stale: StalePromptInfo[];
}

export async function detectStalePrompts(scriptId: string): Promise<StalePromptReport> {
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, episode_id, metadata")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");

  const projectId = script.project_id as string;
  const meta = (script.metadata ?? {}) as Record<string, unknown>;
  const aiPrompts = (meta.aiPrompts ?? {}) as Record<string, unknown>;
  const briefs = (aiPrompts.briefs as Record<string, Record<string, BriefLike>> | undefined) ?? {};
  const promptsByScene =
    (aiPrompts.prompts as Record<string, Record<string, Record<string, PromptSlot>>> | undefined) ?? {};

  const canon = await loadResolvedCanon(projectId);

  // Look up the episode number so labels can read "EP01 SC02 SH01" etc.
  let episodeNumber: number | null = null;
  if (script.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number")
      .eq("id", script.episode_id)
      .maybeSingle();
    episodeNumber = (ep?.number as number | undefined) ?? null;
  }

  // Pre-compute scene sluglines for friendly labels.
  const { data: scenes } = await supabase
    .from("script_scenes")
    .select("ord, slugline")
    .eq("script_id", scriptId);
  const sluglineByOrd: Record<number, string> = {};
  for (const s of scenes ?? []) {
    sluglineByOrd[s.ord as number] = (s.slugline as string) ?? "";
  }

  const stale: StalePromptInfo[] = [];
  let total = 0;
  for (const [sceneOrdStr, byShot] of Object.entries(promptsByScene)) {
    const sceneOrd = parseInt(sceneOrdStr, 10);
    const slug = sluglineByOrd[sceneOrd] ?? "";
    const locKey = slug ? normalizeKey(slug) : "";
    for (const [shotIdxStr, byModel] of Object.entries(byShot ?? {})) {
      const shotIndex = parseInt(shotIdxStr, 10);
      const brief = briefs[sceneOrdStr]?.[shotIdxStr];
      for (const [model, slot] of Object.entries(byModel ?? {})) {
        total++;
        const current = slot.current;
        if (!current) continue;
        const reasons = computeReasonsForShot({
          brief,
          locKey,
          stored: current,
          canon,
        });
        if (reasons.length > 0) {
          const ep = episodeNumber != null
            ? `EP${String(episodeNumber).padStart(2, "0")}`
            : "";
          const sc = `SC${String(sceneOrd + 1).padStart(2, "0")}`;
          const sh = `SH${String(shotIndex).padStart(2, "0")}`;
          const label = [ep, sc, sh].filter(Boolean).join(" ") + ` · ${modelDisplay(model)}`;
          stale.push({
            sceneOrd,
            shotIndex,
            model,
            versionId: current.versionId ?? "?",
            reasons,
            label,
            needsRegen: true,
          });
        }
      }
    }
  }
  return { scriptId, totalPrompts: total, stale };
}

function computeReasonsForShot(args: {
  brief: BriefLike | undefined;
  locKey: string;
  stored: NonNullable<PromptSlot["current"]>;
  canon: Awaited<ReturnType<typeof loadResolvedCanon>>;
}): string[] {
  const { brief, locKey, stored, canon } = args;
  const reasons: string[] = [];

  // 1. NEW canon references for fields visible in this shot that aren't
  //    attached to the stored prompt.
  const visible = (brief?.visibleSetElements ?? []).join(" ").toLowerCase();
  const charNames = (brief?.characters ?? []).map((c) => c.name.toLowerCase());
  const refKeyset = new Set<string>();
  for (const r of stored.referenceMetadata?.canonReferences ?? []) refKeyset.add(r.contributionId);

  for (const ref of canon.references) {
    // Is this reference's field path relevant to this shot?
    if (!relevantToShot(ref.fieldPath, locKey, visible, charNames)) continue;
    if (!refKeyset.has(ref.contributionId)) {
      reasons.push(
        `New approved reference for ${friendlyPath(ref.fieldPath)} ("${ref.title || ref.url || ref.kind}") not attached`
      );
    }
  }

  // 2. TEXT OVERRIDES for paths visible in this shot whose distinctive
  //    tokens are absent from the prompt body.
  const body = (stored.mainPrompt ?? "").toLowerCase();
  const STOP = new Set("the and with from into onto over under near a an of in on at to is are was".split(/\s+/));
  for (const [fieldPath, ov] of canon.textOverrides) {
    if (!relevantToShot(fieldPath, locKey, visible, charNames)) continue;
    const tokens = (ov.value ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9 -]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 5 && !STOP.has(w));
    if (tokens.length === 0) continue;
    const matched = tokens.filter((t) => body.includes(t)).length;
    if (matched < Math.min(2, tokens.length)) {
      reasons.push(
        `Text override on ${friendlyPath(fieldPath)} not surfaced in prompt (matched ${matched} of ${tokens.length} distinctive tokens)`
      );
    }
  }

  return reasons;
}

function relevantToShot(
  fieldPath: string,
  locKey: string,
  visible: string,
  charNames: string[]
): boolean {
  if (fieldPath.startsWith(`locationBibles.${locKey}.`)) return true;
  if (fieldPath.startsWith("propBibles.")) {
    const propKey = fieldPath.split(".")[1] ?? "";
    const propWords = propKey.split("_").filter((w) => w.length >= 4).map((w) => w.toLowerCase());
    return propWords.some((w) => visible.includes(w));
  }
  if (fieldPath.startsWith("characters.")) {
    const lower = fieldPath.toLowerCase();
    return charNames.some((n) => lower.includes(n));
  }
  return false;
}

function friendlyPath(fieldPath: string): string {
  return fieldPath
    .replace(/^locationBibles\.[^.]+\./, "")
    .replace(/^propBibles\.[^.]+\./, "")
    .replace(/^characters\.[^.]+\.visualBible\./, "")
    .replace(/\./g, " › ");
}

// ----- minimal shapes -----

interface BriefLike {
  visibleSetElements?: string[];
  characters?: Array<{ name: string }>;
}

interface PromptSlot {
  current?: {
    versionId?: string;
    mainPrompt?: string;
    referenceMetadata?: {
      canonReferences?: Array<{
        contributionId: string;
        fieldPath: string;
        title?: string;
        url?: string | null;
        kind?: string;
      }>;
    };
  };
}
