import { supabase } from "../db/client.js";
import type { SeasonArc } from "@toburt/shared";

/**
 * Create `episodes` rows from an approved Season Arc. Idempotent: keyed by
 * (project_id, number). Also ensures a `seasons` row exists for the arc's
 * season number and links episodes to it. Returns which episode numbers were
 * created vs already present.
 */
export async function materializeEpisodesFromArc(
  projectId: string,
  arc: SeasonArc
): Promise<{ created: number[]; existing: number[]; seasonId: string | null }> {
  const episodes = Array.isArray(arc?.episodes) ? arc.episodes : [];
  if (!episodes.length) return { created: [], existing: [], seasonId: null };

  // Ensure the season row (by number) and keep its arc snapshot fresh.
  const seasonNumber = arc.seasonNumber ?? 1;
  const { data: existingSeason } = await supabase
    .from("seasons")
    .select("id")
    .eq("project_id", projectId)
    .eq("number", seasonNumber)
    .maybeSingle();
  let seasonId: string | null = existingSeason?.id ?? null;
  if (seasonId) {
    await supabase
      .from("seasons")
      .update({ title: arc.title ?? null, premise: arc.premise ?? null, arc })
      .eq("id", seasonId);
  } else {
    const { data: ins } = await supabase
      .from("seasons")
      .insert({
        project_id: projectId,
        number: seasonNumber,
        title: arc.title ?? null,
        premise: arc.premise ?? null,
        arc,
      })
      .select("id")
      .maybeSingle();
    seasonId = ins?.id ?? null;
  }

  const { data: existingEps } = await supabase
    .from("episodes")
    .select("number")
    .eq("project_id", projectId);
  const have = new Set((existingEps ?? []).map((e) => e.number as number));

  const created: number[] = [];
  const existing: number[] = [];
  for (const ep of episodes) {
    if (have.has(ep.number)) {
      await supabase
        .from("episodes")
        .update({ title: ep.title, logline: ep.logline, season_id: seasonId })
        .eq("project_id", projectId)
        .eq("number", ep.number);
      existing.push(ep.number);
      continue;
    }
    await supabase.from("episodes").insert({
      project_id: projectId,
      season_id: seasonId,
      number: ep.number,
      title: ep.title,
      logline: ep.logline,
      status: "development",
    });
    created.push(ep.number);
  }

  return { created, existing, seasonId };
}

/**
 * Latest season-level foundation (treatment + season_arc) from a project's
 * Season workflow(s) — those with no episode_id. Lets episode-scoped workflows
 * and routes read the shared foundation they didn't themselves produce.
 */
export async function loadSeasonFoundationArtifacts(
  projectId: string
): Promise<Record<string, unknown>> {
  const { data: wfs } = await supabase
    .from("workflows")
    .select("id")
    .eq("project_id", projectId)
    .is("episode_id", null);
  const ids = (wfs ?? []).map((w) => w.id as string);
  if (!ids.length) return {};
  const { data } = await supabase
    .from("workflow_stage_artifacts")
    .select("stage_id, revision, body")
    .in("workflow_id", ids)
    .in("stage_id", ["treatment", "season_arc"])
    .order("revision", { ascending: false });
  const out: Record<string, unknown> = {};
  for (const row of data ?? []) {
    if (!(row.stage_id in out)) out[row.stage_id] = row.body;
  }
  return out;
}

export interface PriorEpisodeContext {
  number: number;
  title: string;
  logline: string;
  recap: string;
}

/**
 * Build a FREE (no-LLM) recap of episodes that come BEFORE `episodeNumber` and
 * have a current drafted script, so a later episode can reference earlier ones.
 * The recap is assembled from the episode outline + each scene's stored summary
 * — never the full draft text (keeps token cost flat as the season grows).
 */
export async function buildPriorEpisodeContext(
  projectId: string,
  episodeNumber: number
): Promise<PriorEpisodeContext[]> {
  const { data: eps } = await supabase
    .from("episodes")
    .select("id, number, title, logline, outline")
    .eq("project_id", projectId)
    .lt("number", episodeNumber)
    .order("number", { ascending: true });
  if (!eps?.length) return [];

  const out: PriorEpisodeContext[] = [];
  for (const ep of eps) {
    // Current script for this episode (if drafted).
    const { data: script } = await supabase
      .from("scripts")
      .select("id")
      .eq("project_id", projectId)
      .eq("episode_id", ep.id)
      .eq("current", true)
      .maybeSingle();

    let recap = "";
    if (script?.id) {
      const { data: scenes } = await supabase
        .from("script_scenes")
        .select("ord, summary")
        .eq("script_id", script.id)
        .order("ord", { ascending: true });
      const summaries = (scenes ?? [])
        .map((s) => (s.summary as string | null)?.trim())
        .filter((s): s is string => !!s);
      if (summaries.length) recap = summaries.join(" ");
    }
    if (!recap) {
      // Fall back to the outline prose if no scene summaries exist yet.
      const outline = ep.outline as { acts?: Array<{ summary?: string }> } | null;
      recap =
        (outline?.acts ?? [])
          .map((a) => a.summary?.trim())
          .filter((s): s is string => !!s)
          .join(" ") || (ep.logline as string) || "";
    }

    out.push({
      number: ep.number as number,
      title: (ep.title as string) ?? `Episode ${ep.number}`,
      logline: (ep.logline as string) ?? "",
      recap: recap.slice(0, 1200),
    });
  }
  return out;
}
