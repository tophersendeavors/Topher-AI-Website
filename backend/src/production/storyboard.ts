import type { ParsedScene } from "@toburt/shared";
import { buildShotlist, type Shot } from "./shotlist.js";

export interface StoryboardPrompt {
  shotId: string;
  shotNumber: string;
  prompt: string;
  negativePrompt?: string;
  aspect: "2.39:1" | "16:9" | "1.85:1";
  style: string;
}

export function buildStoryboardPrompts(scene: ParsedScene, opts: { style?: string; aspect?: "2.39:1" | "16:9" | "1.85:1" } = {}): StoryboardPrompt[] {
  const style = opts.style ?? "moody cinematic, naturalistic light, 35mm, shallow depth of field";
  const aspect = opts.aspect ?? "2.39:1";
  const list = buildShotlist(scene);
  return list.shots.map((shot) => ({
    shotId: shot.id,
    shotNumber: shot.shotNumber,
    aspect,
    style,
    prompt: composePrompt(scene, shot, style),
    negativePrompt: "low quality, distorted faces, text artifacts, watermark",
  }));
}

function composePrompt(scene: ParsedScene, shot: Shot, style: string): string {
  const where = `${scene.intExt ?? ""} ${scene.location}`.trim();
  const time = scene.timeOfDay || "ambient";
  return [
    `${shot.type} (${shot.description})`,
    `Location: ${where}, ${time}`,
    `Characters: ${scene.characters.join(", ") || "n/a"}`,
    `Style: ${style}`,
  ].join(". ");
}
