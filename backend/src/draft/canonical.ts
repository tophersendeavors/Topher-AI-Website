import { supabase } from "../db/client.js";
import { getCanonicalCast, castInstruction, type CastMember } from "./cast.js";
import { buildPriorEpisodeContext } from "../orchestrator/episodes.js";

export type CanonicalScene = {
  ord: number;
  slugline: string;
  timeOfDay: string | null;
  timelinePosition: number | null;
  protocolStage: string | null;
  canonicalSummary: string | null;
  continuityOut: unknown[];
};

export type CanonicalContext = {
  cast: CastMember[];
  priorScenes: CanonicalScene[];
  /** Rendered text block handed to the Scene agent as `canonicalContext`. */
  text: string;
};

/**
 * Assemble the SOURCE OF TRUTH for drafting scene `beforeOrd`: the locked cast
 * bible + every prior CANONICAL scene's summary + the continuity facts those
 * scenes established. Drafting reads ONLY this — never memory, never old
 * drafts, never abandoned versions.
 */
export async function getCanonicalContext(
  scriptId: string,
  beforeOrd: number
): Promise<CanonicalContext> {
  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, episode_id")
    .eq("id", scriptId)
    .single();
  const cast = await getCanonicalCast(script!.project_id);

  // Cross-episode continuity: if this script belongs to an episode, summarize
  // earlier episodes so drafted scenes stay consistent with what already aired.
  let priorEpisodesText = "";
  if (script!.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number")
      .eq("id", script!.episode_id)
      .maybeSingle();
    const epNum = ep?.number as number | undefined;
    if (epNum && epNum > 1) {
      const prior = await buildPriorEpisodeContext(script!.project_id, epNum);
      if (prior.length) {
        priorEpisodesText = [
          "PREVIOUSLY THIS SEASON (earlier episodes — honor this continuity):",
          ...prior.map(
            (e) =>
              `- Episode ${e.number} "${e.title}": ${e.logline}${
                e.recap ? ` — ${e.recap}` : ""
              }`
          ),
          "",
        ].join("\n");
      }
    }
  }

  const { data: prior } = await supabase
    .from("script_scenes")
    .select(
      "ord, slugline, time_of_day, timeline_position, protocol_stage, canonical_summary, continuity_out, canonical"
    )
    .eq("script_id", scriptId)
    .eq("canonical", true)
    .lt("ord", beforeOrd)
    .order("ord", { ascending: true });

  const priorScenes: CanonicalScene[] = (prior ?? []).map((s) => ({
    ord: s.ord as number,
    slugline: s.slugline as string,
    timeOfDay: (s.time_of_day as string) ?? null,
    timelinePosition: (s.timeline_position as number) ?? null,
    protocolStage: (s.protocol_stage as string) ?? null,
    canonicalSummary: (s.canonical_summary as string) ?? null,
    continuityOut: Array.isArray(s.continuity_out) ? (s.continuity_out as unknown[]) : [],
  }));

  // Merge all established continuity facts into one running ledger.
  const facts: string[] = [];
  for (const s of priorScenes) {
    for (const f of s.continuityOut) {
      if (typeof f === "string") facts.push(`(#${s.ord}) ${f}`);
      else if (f && typeof f === "object") {
        try {
          facts.push(`(#${s.ord}) ${JSON.stringify(f)}`);
        } catch {
          /* skip */
        }
      }
    }
  }

  const text = [
    priorEpisodesText,
    castInstruction(cast),
    "",
    priorScenes.length > 0
      ? "PRIOR CANONICAL SCENES (already approved — be consistent, do not re-establish or contradict):"
      : "No prior scenes are canonical yet — this is the opening of the script.",
    ...priorScenes.map(
      (s) =>
        `- Scene ${s.ord} [${s.slugline}]${
          s.protocolStage ? ` · protocol: ${s.protocolStage}` : ""
        }${s.timelinePosition != null ? ` · timeline pos ${s.timelinePosition}` : ""}: ${
          s.canonicalSummary ?? "(no summary)"
        }`
    ),
    facts.length > 0 ? "\nESTABLISHED CONTINUITY FACTS (binding):" : "",
    ...facts.map((f) => `- ${f}`),
  ]
    .filter((l) => l !== "")
    .join("\n");

  return { cast, priorScenes, text };
}

/**
 * Commit a scene as canonical: store its summary and the continuity facts it
 * establishes so later scenes can reference them. Called after a scene passes
 * its per-scene continuity check.
 */
export async function commitSceneCanonical(
  sceneId: string,
  canonicalSummary: string,
  continuityOut: unknown[]
): Promise<void> {
  const { error } = await supabase
    .from("script_scenes")
    .update({
      canonical: true,
      canonical_summary: canonicalSummary,
      continuity_out: continuityOut,
    })
    .eq("id", sceneId);
  if (error) throw error;
}
