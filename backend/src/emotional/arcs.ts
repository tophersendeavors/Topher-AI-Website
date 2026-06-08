import { supabase } from "../db/client.js";
import { config } from "../config.js";
import { runAgent } from "../agents/runner.js";
import { characterArcAgent } from "../agents/characterArc.js";
import { hydrateContext } from "../orchestrator/hydrate.js";
import { buildNameResolver } from "./metadata.js";
import { estimateCost } from "../llm/pricing.js";

export interface CharacterArcRecord {
  characterId: string;
  name: string;
  startingState: string;
  currentState: string;
  evidence: string[];
}

/** Combined/junk cast rows ("Claire and Paul") aren't real characters. */
function isMainName(name: string): boolean {
  return !!name && !/\band\b/i.test(name);
}

/**
 * Read the current (latest) character arcs for a script. Read-only.
 */
export async function getCharacterArcs(
  projectId: string,
  scriptId: string
): Promise<CharacterArcRecord[]> {
  const { data: rows } = await supabase
    .from("character_arcs")
    .select("character_id, starting_state, current_state, evidence")
    .eq("project_id", projectId)
    .eq("script_id", scriptId)
    .eq("current", true);
  if (!rows?.length) return [];

  const { data: chars } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);
  const idToName = new Map((chars ?? []).map((c) => [c.id as string, c.name as string]));

  return rows.map((r) => ({
    characterId: r.character_id as string,
    name: idToName.get(r.character_id as string) ?? "Unknown",
    startingState: (r.starting_state as string) ?? "",
    currentState: (r.current_state as string) ?? "",
    evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : [],
  }));
}

/**
 * Run the (single, cheap) Character Arc LLM pass for a script and persist one
 * `current` arc per main character. Supersedes any prior current row. This is
 * the ONLY state-changing arc operation and is always triggered explicitly by
 * the writer — it never rewrites the screenplay, only labels canon.
 */
export async function mapCharacterArcs(args: {
  projectId: string;
  scriptId: string;
  userId?: string;
}): Promise<{ arcs: CharacterArcRecord[]; cost: number }> {
  const { projectId, scriptId, userId } = args;

  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, fountain, episode_id")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const fountain = (script.fountain as string) ?? "";

  // Resolve which episode this script is, so arcs accumulate across the season.
  let episodeNumber: number | undefined;
  if (script.episode_id) {
    const { data: ep } = await supabase
      .from("episodes")
      .select("number")
      .eq("id", script.episode_id)
      .maybeSingle();
    episodeNumber = (ep?.number as number) ?? undefined;
  }

  const { data: charsRaw } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);
  const chars = (charsRaw ?? []).filter((c) => isMainName(c.name as string));
  if (!chars.length) return { arcs: [], cost: 0 };

  const resolve = buildNameResolver(
    chars.map((c) => ({ id: c.id as string, name: c.name as string }))
  );
  const idToName = new Map(chars.map((c) => [c.id as string, c.name as string]));

  // Carry-over: each character's ending state from the latest earlier episode.
  let priorStates: Array<{ name: string; endingState: string }> | undefined;
  if (episodeNumber && episodeNumber > 1) {
    const prior = await loadPriorEndingStates(projectId, episodeNumber);
    priorStates = prior
      .map((p) => ({ name: idToName.get(p.characterId) ?? "", endingState: p.endingState }))
      .filter((p) => p.name);
  }

  const ctx = await hydrateContext({
    projectId,
    collaborators: ["emotional_truth"],
    query: "character arcs",
    user: userId ? { id: userId } : undefined,
    episodeNumber,
  });

  const run = await runAgent(
    characterArcAgent,
    {
      fountain: fountain.slice(0, 12000),
      cast: chars.map((c) => c.name as string),
      ...(priorStates && priorStates.length ? { priorStates } : {}),
    },
    ctx,
    { maxToolRounds: 1, maxTokens: 2048 }
  );
  const cost = estimateCost(
    config.CHARACTER_MODEL,
    run.usage?.input,
    run.usage?.output
  );

  const entries = Array.isArray(run.output?.arcs) ? run.output.arcs : [];

  // Prior current rows, keyed by character, so we can supersede them.
  const { data: prior } = await supabase
    .from("character_arcs")
    .select("id, character_id, version")
    .eq("project_id", projectId)
    .eq("script_id", scriptId)
    .eq("current", true);
  const priorByChar = new Map(
    (prior ?? []).map((r) => [r.character_id as string, { id: r.id as string, version: r.version as number }])
  );

  const saved: CharacterArcRecord[] = [];
  for (const e of entries) {
    if (!e?.name || !e.startingState || !e.currentState) continue;
    const characterId = resolve(e.name);
    if (!characterId) continue;

    const prev = priorByChar.get(characterId);
    if (prev) {
      await supabase
        .from("character_arcs")
        .update({ current: false })
        .eq("id", prev.id);
    }
    const { error } = await supabase.from("character_arcs").insert({
      project_id: projectId,
      character_id: characterId,
      script_id: scriptId,
      starting_state: e.startingState,
      current_state: e.currentState,
      evidence: Array.isArray(e.evidence) ? e.evidence : [],
      version: (prev?.version ?? 0) + 1,
      supersedes_id: prev?.id ?? null,
      authored_by: userId ?? null,
      authored_role: "emotional_truth",
      current: true,
    });
    if (error) {
      // Roll back demotion so the prior row remains queryable.
      if (prev)
        await supabase
          .from("character_arcs")
          .update({ current: true })
          .eq("id", prev.id);
      throw error;
    }
    saved.push({
      characterId,
      name: idToName.get(characterId) ?? e.name,
      startingState: e.startingState,
      currentState: e.currentState,
      evidence: Array.isArray(e.evidence) ? e.evidence : [],
    });
  }

  // Refresh the season-level rollup (script_id = null) from all episode arcs.
  try {
    await rollupSeasonArcs(projectId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[arcs] season rollup failed", err);
  }

  return { arcs: saved, cost };
}

interface EpisodeArcRow {
  characterId: string;
  episodeNumber: number;
  startingState: string;
  currentState: string;
  evidence: string[];
}

/**
 * All CURRENT per-episode arcs for a project, tagged with their episode number
 * (resolved via script → episode). Arcs whose script has no episode are skipped.
 */
async function loadEpisodeArcs(projectId: string): Promise<EpisodeArcRow[]> {
  const { data: arcs } = await supabase
    .from("character_arcs")
    .select("character_id, script_id, starting_state, current_state, evidence")
    .eq("project_id", projectId)
    .eq("current", true)
    .not("script_id", "is", null);
  if (!arcs?.length) return [];

  const scriptIds = [...new Set(arcs.map((a) => a.script_id as string))];
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, episode_id")
    .in("id", scriptIds);
  const scriptToEp = new Map(
    (scripts ?? []).map((s) => [s.id as string, s.episode_id as string | null])
  );
  const epIds = [
    ...new Set(
      (scripts ?? [])
        .map((s) => s.episode_id as string | null)
        .filter((x): x is string => !!x)
    ),
  ];
  if (!epIds.length) return [];
  const { data: eps } = await supabase
    .from("episodes")
    .select("id, number")
    .in("id", epIds);
  const epToNum = new Map((eps ?? []).map((e) => [e.id as string, e.number as number]));

  const out: EpisodeArcRow[] = [];
  for (const a of arcs) {
    const epId = scriptToEp.get(a.script_id as string);
    const num = epId ? epToNum.get(epId) : undefined;
    if (num == null) continue;
    out.push({
      characterId: a.character_id as string,
      episodeNumber: num,
      startingState: (a.starting_state as string) ?? "",
      currentState: (a.current_state as string) ?? "",
      evidence: Array.isArray(a.evidence) ? (a.evidence as string[]) : [],
    });
  }
  return out;
}

/** Per character, the ending state from the latest episode before `episodeNumber`. */
async function loadPriorEndingStates(
  projectId: string,
  episodeNumber: number
): Promise<Array<{ characterId: string; endingState: string }>> {
  const arcs = await loadEpisodeArcs(projectId);
  const latest = new Map<string, EpisodeArcRow>();
  for (const a of arcs) {
    if (a.episodeNumber >= episodeNumber) continue;
    const cur = latest.get(a.characterId);
    if (!cur || a.episodeNumber > cur.episodeNumber) latest.set(a.characterId, a);
  }
  return [...latest.values()].map((a) => ({
    characterId: a.characterId,
    endingState: a.currentState,
  }));
}

/**
 * Compose the SEASON-level arc per character (character_arcs row with
 * script_id = null): starting = earliest episode's start, current = latest
 * episode's current. Append-only via supersedes_id, one `current` season row
 * per character.
 */
export async function rollupSeasonArcs(projectId: string): Promise<void> {
  const arcs = await loadEpisodeArcs(projectId);
  if (!arcs.length) return;

  const byChar = new Map<string, EpisodeArcRow[]>();
  for (const a of arcs) {
    const list = byChar.get(a.characterId) ?? [];
    list.push(a);
    byChar.set(a.characterId, list);
  }

  const { data: priorSeason } = await supabase
    .from("character_arcs")
    .select("id, character_id, version")
    .eq("project_id", projectId)
    .is("script_id", null)
    .eq("current", true);
  const priorByChar = new Map(
    (priorSeason ?? []).map((r) => [
      r.character_id as string,
      { id: r.id as string, version: r.version as number },
    ])
  );

  for (const [characterId, list] of byChar.entries()) {
    list.sort((a, b) => a.episodeNumber - b.episodeNumber);
    const first = list[0];
    const last = list[list.length - 1];
    const prev = priorByChar.get(characterId);
    if (prev) {
      await supabase.from("character_arcs").update({ current: false }).eq("id", prev.id);
    }
    await supabase.from("character_arcs").insert({
      project_id: projectId,
      character_id: characterId,
      script_id: null,
      starting_state: first.startingState,
      current_state: last.currentState,
      evidence: [
        `Across episodes ${first.episodeNumber}–${last.episodeNumber}`,
        ...last.evidence,
      ],
      version: (prev?.version ?? 0) + 1,
      supersedes_id: prev?.id ?? null,
      authored_role: "emotional_truth",
      current: true,
    });
  }
}

/** Read the season-level (script_id = null) character arcs for a project. */
export async function getSeasonCharacterArcs(
  projectId: string
): Promise<CharacterArcRecord[]> {
  const { data: rows } = await supabase
    .from("character_arcs")
    .select("character_id, starting_state, current_state, evidence")
    .eq("project_id", projectId)
    .is("script_id", null)
    .eq("current", true);
  if (!rows?.length) return [];
  const { data: chars } = await supabase
    .from("characters")
    .select("id, name")
    .eq("project_id", projectId);
  const idToName = new Map((chars ?? []).map((c) => [c.id as string, c.name as string]));
  return rows.map((r) => ({
    characterId: r.character_id as string,
    name: idToName.get(r.character_id as string) ?? "Unknown",
    startingState: (r.starting_state as string) ?? "",
    currentState: (r.current_state as string) ?? "",
    evidence: Array.isArray(r.evidence) ? (r.evidence as string[]) : [],
  }));
}
