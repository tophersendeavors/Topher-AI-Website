import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";
import { supabase } from "../db/client.js";

export interface DevPackageProjectChanges {
  title?: string;
  logline?: string;
  genre?: string[];
  tone?: string[];
  inspirations?: string[];
}

export interface DevPackageSeasonArc {
  seasonNumber: number;
  title: string;
  premise: string;
  throughline: string;
  episodes: Array<{ number: number; title: string; logline: string; tentpole?: boolean }>;
}

export interface DevPackageSceneChange {
  ord: number;
  slugline: string;
  instruction: string;
}

export interface DevPackagePlan {
  /** Current project field values, for old→new diffing in the UI. */
  current: {
    title: string;
    logline: string | null;
    genre: string[] | null;
    tone: string[] | null;
    inspirations: string[] | null;
  };
  project: DevPackageProjectChanges;
  seasonArc: DevPackageSeasonArc | null;
  scenes: DevPackageSceneChange[];
  unrouted: string[];
}

/**
 * Classify a pasted development package into the three altitudes it actually
 * operates at — PROJECT (title/logline/comps/tone), SEASON (episode arc), and
 * SCENE (concrete rewrites) — and route each. One LLM pass. Read-only: returns
 * a plan the writer reviews and applies; nothing is changed here.
 */
export async function analyzeDevelopmentPackage(args: {
  projectId: string;
  scriptId: string;
  packageText: string;
}): Promise<DevPackagePlan> {
  const { projectId, scriptId, packageText } = args;

  const { data: project } = await supabase
    .from("projects")
    .select("title, logline, genre, tone, inspirations")
    .eq("id", projectId)
    .maybeSingle();
  const { data: scenesRaw } = await supabase
    .from("script_scenes")
    .select("ord, slugline, summary")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  const rows = (scenesRaw ?? []) as Array<{ ord: number; slugline: string; summary: string | null }>;
  const ordToSlug = new Map(rows.map((r) => [r.ord, r.slugline]));

  const sceneList = rows
    .map((r) => `#${r.ord} ${r.slugline}${r.summary ? ` — ${r.summary}` : ""}`)
    .join("\n");

  const system = [
    "You triage a screenwriter's development package and SORT it into three",
    "levels. You do NOT rewrite anything — you classify and route.",
    "",
    "1) PROJECT — changes to title, logline, genre, tone, or comps/inspirations.",
    "   Only include a field if the package proposes changing it.",
    "2) SEASON — an episode arc / season map. Parse it into structured episodes.",
    "   Only include if the package contains a multi-episode arc.",
    "3) SCENE — concrete, scene-actionable rewrite instructions. Route each to",
    "   the scene `ord` it targets, using the SCENES list. A long inserted/",
    "   replacement beat counts as a scene instruction for the scene it replaces.",
    "Anything you cannot confidently place (vague, global, or strategic notes)",
    "goes in `unrouted` as plain text.",
    "",
    "Return ONLY JSON of this exact shape (omit keys that don't apply):",
    "{",
    '  "project": { "title": "...", "logline": "...", "genre": ["..."], "tone": ["..."], "inspirations": ["..."] },',
    '  "seasonArc": { "seasonNumber": 1, "title": "...", "premise": "...", "throughline": "...",',
    '    "episodes": [ { "number": 1, "title": "...", "logline": "...", "tentpole": false } ] },',
    '  "scenes": [ { "ord": <int from the SCENES list>, "instruction": "<what to change>" } ],',
    '  "unrouted": [ "<note text>" ]',
    "}",
  ].join("\n");

  const user = [
    "CURRENT PROJECT:",
    `  title: ${project?.title ?? ""}`,
    `  logline: ${project?.logline ?? ""}`,
    `  genre: ${(project?.genre ?? []).join(", ")}`,
    `  tone: ${(project?.tone ?? []).join(", ")}`,
    `  comps/inspirations: ${(project?.inspirations ?? []).join(", ")}`,
    "",
    "SCENES:",
    sceneList || "(none drafted yet)",
    "",
    "DEVELOPMENT PACKAGE:",
    packageText.slice(0, 16000),
  ].join("\n");

  const res = await callLLM({
    model: config.SCRIPT_DOCTOR_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.2,
    maxTokens: 4000,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    /* leave empty */
  }

  const strArr = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : undefined;
  const str = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;

  // PROJECT — only fields that differ from current.
  const p = (parsed.project ?? {}) as Record<string, unknown>;
  const projectChanges: DevPackageProjectChanges = {};
  const titleP = str(p.title);
  if (titleP && titleP !== project?.title) projectChanges.title = titleP;
  const loglineP = str(p.logline);
  if (loglineP && loglineP !== (project?.logline ?? "")) projectChanges.logline = loglineP;
  const genreP = strArr(p.genre);
  if (genreP && genreP.join("|") !== (project?.genre ?? []).join("|")) projectChanges.genre = genreP;
  const toneP = strArr(p.tone);
  if (toneP && toneP.join("|") !== (project?.tone ?? []).join("|")) projectChanges.tone = toneP;
  const inspP = strArr(p.inspirations);
  if (inspP && inspP.join("|") !== (project?.inspirations ?? []).join("|")) projectChanges.inspirations = inspP;

  // SEASON arc.
  let seasonArc: DevPackageSeasonArc | null = null;
  const sa = parsed.seasonArc as Record<string, unknown> | undefined;
  if (sa && Array.isArray(sa.episodes) && sa.episodes.length) {
    const episodes = (sa.episodes as unknown[])
      .map((e, i): DevPackageSeasonArc["episodes"][number] | null => {
        const o = (e ?? {}) as Record<string, unknown>;
        const title = str(o.title);
        const logline = str(o.logline) ?? "";
        if (!title) return null;
        return {
          number: typeof o.number === "number" ? o.number : i + 1,
          title,
          logline,
          tentpole: o.tentpole === true,
        };
      })
      .filter((x): x is DevPackageSeasonArc["episodes"][number] => x !== null);
    if (episodes.length) {
      seasonArc = {
        seasonNumber: typeof sa.seasonNumber === "number" ? sa.seasonNumber : 1,
        title: str(sa.title) ?? "Season 1",
        premise: str(sa.premise) ?? "",
        throughline: str(sa.throughline) ?? "",
        episodes,
      };
    }
  }

  // SCENE changes — keep only ords that exist.
  const scenes: DevPackageSceneChange[] = (Array.isArray(parsed.scenes) ? parsed.scenes : [])
    .map((x): DevPackageSceneChange | null => {
      const o = (x ?? {}) as Record<string, unknown>;
      const ord = Number(o.ord);
      const instruction = str(o.instruction);
      if (!ordToSlug.has(ord) || !instruction) return null;
      return { ord, slugline: ordToSlug.get(ord)!, instruction };
    })
    .filter((x): x is DevPackageSceneChange => x !== null);

  const unrouted = (Array.isArray(parsed.unrouted) ? parsed.unrouted : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());

  return {
    current: {
      title: project?.title ?? "",
      logline: project?.logline ?? null,
      genre: project?.genre ?? null,
      tone: project?.tone ?? null,
      inspirations: project?.inspirations ?? null,
    },
    project: projectChanges,
    seasonArc,
    scenes,
    unrouted,
  };
}
