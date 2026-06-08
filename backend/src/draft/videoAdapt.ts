import { callLLM, extractJSON } from "../llm/provider.js";
import { config } from "../config.js";
import { supabase } from "../db/client.js";

export interface VeoShot {
  index: number;
  durationSec: number;
  shotSize: string;
  cameraMove: string;
  /** Full Veo-ready generation prompt for this clip. */
  prompt: string;
  /** Spoken line(s) for this clip, where dialogue fits an ~8s take. */
  dialogue?: string;
  characters: string[];
  /** e.g. "use VO if lip-sync drifts". */
  notes?: string;
}

export interface SceneAdaptation {
  ord: number;
  slugline: string;
  shots: VeoShot[];
  generatedAt: string;
}

/**
 * Build a Google Flow / Veo shot list from ONE scene of the (untouched) draft.
 * The screenplay is canonical; this is a derived adaptation. Reshapes the scene
 * into ~8s clips with cinematic prompt grammar, re-stated character/setting
 * descriptors (the model has no memory across clips), and synced dialogue
 * in-shot where a line fits a take. Persisted to scripts.metadata — never the
 * fountain, so the draft is never altered.
 */
export async function adaptSceneForVeo(args: {
  scriptId: string;
  ord: number;
  notes?: string;
}): Promise<SceneAdaptation> {
  const { scriptId, ord, notes } = args;

  const { data: script } = await supabase
    .from("scripts")
    .select("project_id, metadata")
    .eq("id", scriptId)
    .single();
  if (!script) throw new Error("script not found");
  const projectId = script.project_id as string;

  const { data: scene } = await supabase
    .from("script_scenes")
    .select("ord, slugline, fountain")
    .eq("script_id", scriptId)
    .eq("ord", ord)
    .single();
  if (!scene?.fountain) throw new Error(`Scene ${ord} has no content to adapt.`);

  // Consistent character descriptors — re-stated in every clip prompt.
  const { data: chars } = await supabase
    .from("characters")
    .select("name, age, occupation, biography")
    .eq("project_id", projectId);
  const castBlock = (chars ?? [])
    .map((c) => {
      const bits = [c.age ? `${c.age}` : "", c.occupation as string]
        .filter(Boolean)
        .join(", ");
      const bio = (c.biography as string) ? ` — ${(c.biography as string).slice(0, 160)}` : "";
      return `${c.name}${bits ? ` (${bits})` : ""}${bio}`;
    })
    .join("\n");

  const { data: proj } = await supabase
    .from("projects")
    .select("tone, showrunner_notes")
    .eq("id", projectId)
    .maybeSingle();
  const styleBlock = [
    (proj?.tone as string[] | null)?.length ? `Tone: ${(proj!.tone as string[]).join(", ")}` : "",
    proj?.showrunner_notes ? `Visual vision: ${(proj.showrunner_notes as string).slice(0, 400)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const system = [
    "You are a Google Flow / Veo shot designer. Convert ONE screenplay scene",
    "into an ordered list of generation-ready video CLIPS. You are NOT rewriting",
    "the screenplay — you are translating it into prompts a text-to-video model",
    "can actually build.",
    "",
    "VEO RULES (follow exactly):",
    "- Each clip is ONE continuous ~8-second take of ONE action. Split the scene",
    "  into as many clips as it needs; do not cram multiple beats into one clip.",
    "- Each `prompt` is a single cinematic sentence-block: [shot size] of",
    "  [character WITH a re-stated physical descriptor] [doing one action] in",
    "  [the setting, re-described], [lighting], [camera move], [lens/feel],",
    "  [mood + visual style], 16:9. RE-STATE character look + setting EVERY clip —",
    "  the model has no memory between clips, so consistency must be in the words.",
    "- Veo can do native audio + dialogue. When a line fits an ~8s take, put it",
    "  in `dialogue` AND fold it naturally into the prompt as spoken; otherwise",
    "  set `dialogue` empty and carry the meaning visually.",
    "- Avoid on-screen text, avoid morphing, avoid impossible camera teleports.",
    "- Preserve the scene's story, blocking, and emotional outcome.",
    "",
    notes ? `WRITER PRIORITY NOTES (weight above all): """${notes}"""` : "",
    castBlock ? `CONSISTENT CAST (re-use these descriptors verbatim):\n${castBlock}` : "",
    styleBlock,
    "",
    "Return ONLY JSON:",
    "{",
    '  "shots": [',
    "    {",
    '      "index": 1, "durationSec": 8,',
    '      "shotSize": "WIDE | MEDIUM | CLOSE-UP | ...",',
    '      "cameraMove": "static | slow dolly in | pan left | handheld | ...",',
    '      "prompt": "<full Veo-ready clip prompt>",',
    '      "dialogue": "<spoken line for this clip, or empty>",',
    '      "characters": ["..."],',
    '      "notes": "<optional production note>"',
    "    }",
    "  ]",
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: system },
      { role: "user", content: `SCENE ${ord} — ${scene.slugline}\n\n${scene.fountain}` },
    ],
    temperature: 0.5,
    maxTokens: 4000,
  });

  let parsed: Record<string, unknown> = {};
  try {
    parsed = extractJSON(res.text) as Record<string, unknown>;
  } catch {
    throw new Error("Veo adapter did not return usable JSON. Try again.");
  }

  const rawShots = Array.isArray(parsed.shots) ? parsed.shots : [];
  const shots: VeoShot[] = rawShots
    .map((s, i): VeoShot | null => {
      const o = (s ?? {}) as Record<string, unknown>;
      const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
      if (!prompt) return null;
      const dlg = typeof o.dialogue === "string" ? o.dialogue.trim() : "";
      return {
        index: typeof o.index === "number" ? o.index : i + 1,
        durationSec: typeof o.durationSec === "number" ? o.durationSec : 8,
        shotSize: (typeof o.shotSize === "string" && o.shotSize.trim()) || "MEDIUM",
        cameraMove: (typeof o.cameraMove === "string" && o.cameraMove.trim()) || "static",
        prompt,
        dialogue: dlg || undefined,
        characters: Array.isArray(o.characters)
          ? (o.characters as unknown[]).filter((x): x is string => typeof x === "string")
          : [],
        notes: typeof o.notes === "string" && o.notes.trim() ? o.notes.trim() : undefined,
      };
    })
    .filter((x): x is VeoShot => x !== null)
    .map((s, i) => ({ ...s, index: i + 1 }));

  const adaptation: SceneAdaptation = {
    ord,
    slugline: scene.slugline as string,
    shots,
    generatedAt: new Date().toISOString(),
  };

  // Persist scene-safely under metadata.videoAdaptation[ord] — never the fountain.
  const meta = { ...((script.metadata as Record<string, unknown>) ?? {}) };
  const va = { ...((meta.videoAdaptation as Record<string, unknown>) ?? {}) };
  va[String(ord)] = adaptation;
  meta.videoAdaptation = va;
  await supabase.from("scripts").update({ metadata: meta }).eq("id", scriptId);

  return adaptation;
}

/** Read all stored Veo adaptations for a script, joined to current sluglines. */
export async function getVideoAdaptation(scriptId: string): Promise<SceneAdaptation[]> {
  const { data: script } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .single();
  const va = ((script?.metadata as Record<string, unknown>)?.videoAdaptation ?? {}) as Record<
    string,
    SceneAdaptation
  >;
  return Object.values(va).sort((a, b) => a.ord - b.ord);
}
