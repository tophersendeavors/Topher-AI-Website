import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";
import { supabase } from "../db/client.js";

export interface RoutedNote {
  ord: number;
  slugline: string;
  instruction: string;
}

/**
 * Split a writer's freeform rewrite notes and assign each actionable
 * instruction to the scene(s) it targets. Does NOT rewrite anything — it only
 * routes. A note may apply to several scenes; a scene may collect several
 * notes (combined into one instruction). Anything global/unclear is returned
 * under `unrouted` for the writer to place manually.
 */
export async function routeNotesToScenes(args: {
  scriptId: string;
  notes: string;
}): Promise<{ routed: RoutedNote[]; unrouted: string[] }> {
  const { scriptId, notes } = args;
  const { data: scenesRaw } = await supabase
    .from("script_scenes")
    .select("ord, slugline, summary")
    .eq("script_id", scriptId)
    .order("ord", { ascending: true });
  const rows = (scenesRaw ?? []) as Array<{ ord: number; slugline: string; summary: string | null }>;
  if (!rows.length) throw new Error("No scenes to route notes to.");

  const sceneList = rows
    .map((r) => `#${r.ord} ${r.slugline}${r.summary ? ` — ${r.summary}` : ""}`)
    .join("\n");

  const system = [
    "You route a writer's freeform rewrite notes to the specific scenes they",
    "apply to. You DO NOT rewrite anything — you only split and assign.",
    "",
    "For each scene a note targets, write ONE concrete instruction the line",
    "editor can act on (combine multiple notes for the same scene). A note may",
    "apply to several scenes. If a note is global, structural across the whole",
    "script, or you can't confidently place it, put its text under `unrouted`.",
    "",
    "Use the scene `ord` numbers from the list. Return ONLY JSON:",
    "{",
    '  "routed": [ { "ord": <int>, "instruction": "<what to change in this scene>" } ],',
    '  "unrouted": [ "<note text that needs manual placement>" ]',
    "}",
  ].join("\n");

  const user = `SCENES:\n${sceneList}\n\nWRITER'S REWRITE NOTES:\n${notes}`;

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0.3,
    maxTokens: 2000,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    /* leave empty */
  }

  const ordToSlug = new Map(rows.map((r) => [r.ord, r.slugline]));
  const rawRouted = Array.isArray(parsed.routed) ? parsed.routed : [];
  const routed: RoutedNote[] = rawRouted
    .map((x): RoutedNote | null => {
      const o = (x ?? {}) as Record<string, unknown>;
      const ord = Number(o.ord);
      const instruction = typeof o.instruction === "string" ? o.instruction.trim() : "";
      if (!ordToSlug.has(ord) || !instruction) return null;
      return { ord, slugline: ordToSlug.get(ord)!, instruction };
    })
    .filter((x): x is RoutedNote => x !== null);

  const unrouted = (Array.isArray(parsed.unrouted) ? parsed.unrouted : [])
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());

  return { routed, unrouted };
}
