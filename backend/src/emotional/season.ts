import { supabase } from "../db/client.js";
import { scoreScriptRange, type SceneScoreReport } from "./score.js";

export interface SeasonSceneReport extends SceneScoreReport {
  /** Episode this scene belongs to (for season-level grouping/heatmap). */
  episodeNumber: number;
  episodeTitle: string;
}

export interface SeasonScoreReport {
  projectId: string;
  overall: number;
  weakSceneCount: number;
  episodes: Array<{ number: number; title: string; sceneCount: number; overall: number }>;
  scenes: SeasonSceneReport[];
  debug: {
    episodesScored: number;
    scenesScored: number;
    cost: number;
  };
}

/**
 * Score an ENTIRE season by aggregating every episode's current script. Uses
 * the FREE heuristic pass (useLLM=false) by default so a whole-season read
 * costs nothing. Returns one flat, episode-tagged scene list that the existing
 * scope-agnostic analysis (buildInsights / buildCharacterHealth / pacing /
 * heatmap) can consume unchanged.
 */
export async function scoreSeason(args: {
  projectId: string;
  useLLM?: boolean;
}): Promise<SeasonScoreReport> {
  const { projectId } = args;
  const useLLM = args.useLLM === true;

  const { data: episodes } = await supabase
    .from("episodes")
    .select("id, number, title")
    .eq("project_id", projectId)
    .order("number", { ascending: true });

  const scenes: SeasonSceneReport[] = [];
  const episodeSummaries: SeasonScoreReport["episodes"] = [];
  let cost = 0;
  let episodesScored = 0;

  for (const ep of episodes ?? []) {
    // Current drafted script for this episode.
    const { data: script } = await supabase
      .from("scripts")
      .select("id, fountain")
      .eq("project_id", projectId)
      .eq("episode_id", ep.id)
      .eq("current", true)
      .maybeSingle();
    const fountain = (script?.fountain as string) ?? "";
    if (!script?.id || !fountain.trim()) continue;

    const res = await scoreScriptRange({
      projectId,
      scriptId: script.id as string,
      fountain,
      fromIndex: 0,
      toIndex: 100000,
      useLLM,
    });
    cost += res.cost;
    episodesScored += 1;
    const epScenes = res.scenes.map((s) => ({
      ...s,
      episodeNumber: ep.number as number,
      episodeTitle: (ep.title as string) ?? `Episode ${ep.number}`,
    }));
    scenes.push(...epScenes);
    const epOverall = epScenes.length
      ? epScenes.reduce((a, s) => a + s.overall, 0) / epScenes.length
      : 0;
    episodeSummaries.push({
      number: ep.number as number,
      title: (ep.title as string) ?? `Episode ${ep.number}`,
      sceneCount: epScenes.length,
      overall: epOverall,
    });
  }

  const overall = scenes.length
    ? scenes.reduce((a, s) => a + s.overall, 0) / scenes.length
    : 0;

  return {
    projectId,
    overall,
    weakSceneCount: scenes.filter((s) => s.weak).length,
    episodes: episodeSummaries,
    scenes,
    debug: { episodesScored, scenesScored: scenes.length, cost },
  };
}
