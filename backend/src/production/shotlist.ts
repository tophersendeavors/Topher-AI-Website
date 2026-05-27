import type { ParsedScene } from "@toburt/shared";

export interface Shot {
  id: string;
  shotNumber: string;
  type: "WS" | "MS" | "CU" | "ECU" | "OTS" | "POV" | "INSERT" | "CRANE" | "DRONE" | "TRACK";
  description: string;
  lens?: string;
  motion?: "static" | "pan" | "tilt" | "dolly" | "handheld";
  notes?: string;
}

export interface Shotlist {
  sceneOrder: number;
  slugline: string;
  shots: Shot[];
}

/**
 * Build a heuristic shotlist for a parsed scene. The real cinematic intent
 * comes from the Producer/Scene agents calling this through the production
 * route, but this baseline catches the obvious coverage.
 */
export function buildShotlist(scene: ParsedScene): Shotlist {
  const shots: Shot[] = [];
  let n = 1;
  const tag = scene.order.toString().padStart(2, "0");

  // 1. Establishing.
  shots.push({
    id: `S${tag}-${n}`,
    shotNumber: `${scene.order}.${n++}`,
    type: scene.intExt === "EXT" ? "WS" : "MS",
    description: `Establishing — ${scene.location}`,
    motion: "static",
  });

  // 2. Per character entrance / key beat — a master + an OTS or CU.
  for (const ch of scene.characters) {
    shots.push({
      id: `S${tag}-${n}`,
      shotNumber: `${scene.order}.${n++}`,
      type: "MS",
      description: `Master on ${ch}`,
      motion: "static",
    });
    shots.push({
      id: `S${tag}-${n}`,
      shotNumber: `${scene.order}.${n++}`,
      type: "CU",
      description: `Close on ${ch} for the turn`,
      lens: "50mm",
      motion: "static",
    });
  }

  // 3. Turn beat insert.
  shots.push({
    id: `S${tag}-${n}`,
    shotNumber: `${scene.order}.${n++}`,
    type: "INSERT",
    description: "Insert — key prop / detail driving the turn",
  });

  return { sceneOrder: scene.order, slugline: scene.slugline, shots };
}
