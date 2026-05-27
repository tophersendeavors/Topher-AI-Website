import type { ParsedScene } from "@toburt/shared";

export interface FlowPrompt {
  sceneOrder: number;
  slugline: string;
  durationSec: number;
  aspectRatio: "2.39:1" | "16:9" | "1.85:1";
  camera: {
    lens: string;
    movement: string;
    framing: string;
  };
  lighting: string;
  palette: string[];
  motion: string;
  prompt: string;
}

/**
 * Build a cinematic video-generation prompt for a scene. Provider-agnostic —
 * the resulting object can be passed to Flow / Sora / Runway adapters in
 * future without changing the upstream pipeline.
 */
export function buildFlowPrompt(
  scene: ParsedScene,
  opts: { durationSec?: number; aspect?: "2.39:1" | "16:9" | "1.85:1" } = {}
): FlowPrompt {
  const lens = scene.intExt === "EXT" ? "35mm" : "50mm";
  const movement = scene.characters.length > 1 ? "slow dolly-in" : "static, controlled handheld";
  const framing = scene.characters.length > 0 ? "medium two-shot" : "wide establishing";
  const lighting =
    scene.timeOfDay.toLowerCase().includes("night")
      ? "low-key, single key source, deep shadow"
      : scene.intExt === "EXT"
        ? "natural daylight, soft overhead"
        : "warm practicals, motivated key";
  const palette =
    scene.timeOfDay.toLowerCase().includes("night")
      ? ["#0c0d10", "#1c2230", "#caa572"]
      : ["#e9e3d6", "#5d6b82", "#252a30"];

  const prompt = [
    `${scene.intExt ?? ""} ${scene.location}, ${scene.timeOfDay}`.trim(),
    `${framing}, ${movement}`,
    `lens: ${lens}`,
    `lighting: ${lighting}`,
    scene.characters.length ? `characters: ${scene.characters.join(", ")}` : "",
    "look: photographic, filmic grain, naturalistic skin tones, restrained color",
  ]
    .filter(Boolean)
    .join(". ");

  return {
    sceneOrder: scene.order,
    slugline: scene.slugline,
    durationSec: opts.durationSec ?? 6,
    aspectRatio: opts.aspect ?? "2.39:1",
    camera: { lens, movement, framing },
    lighting,
    palette,
    motion: movement,
    prompt,
  };
}
