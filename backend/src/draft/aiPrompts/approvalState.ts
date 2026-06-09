// Curated Shot List approval-state probe for the composer.
//
// Returns whether THIS shot brief is approved under the curated shot
// list, considering per-shot, per-scene, and episode-level approvals.
// Pure read against scripts.metadata.shotListApproval — never blocks,
// never writes. The composer uses the result to surface a warning
// banner when the shot isn't approved.

import { supabase } from "../../db/client.js";

export interface ShotListApprovalState {
  status: "approved" | "unapproved" | "no_shot_list";
  reason: "shot" | "scene" | "episode" | "none";
  totalShots: number;
  approvedShots: number;
}

export async function getShotListApprovalState(
  scriptId: string,
  sceneOrd: number,
  shotIndex: number
): Promise<ShotListApprovalState> {
  const { data } = await supabase
    .from("scripts")
    .select("metadata")
    .eq("id", scriptId)
    .maybeSingle();
  const meta = (data?.metadata as Record<string, unknown> | null) ?? {};
  const approval = (meta.shotListApproval as
    | {
        shots?: Record<string, { approvedAt: string }>;
        scenes?: Record<string, { approvedAt: string }>;
        episode?: { approvedAt: string } | null;
      }
    | undefined) ?? null;
  const aiPrompts = (meta.aiPrompts as { briefs?: Record<string, Record<string, unknown>> } | undefined) ?? {};
  const briefs = aiPrompts.briefs ?? {};
  let totalShots = 0;
  let approvedShots = 0;
  for (const [ordStr, sceneBriefs] of Object.entries(briefs)) {
    for (const idxStr of Object.keys(sceneBriefs as Record<string, unknown>)) {
      totalShots += 1;
      const k = `${ordStr}-${idxStr}`;
      if (
        approval?.shots?.[k] ||
        approval?.scenes?.[ordStr] ||
        approval?.episode
      ) {
        approvedShots += 1;
      }
    }
  }
  if (!approval || (Object.keys(approval.shots ?? {}).length === 0 && Object.keys(approval.scenes ?? {}).length === 0 && !approval.episode)) {
    return { status: "no_shot_list", reason: "none", totalShots, approvedShots };
  }
  const k = `${sceneOrd}-${shotIndex}`;
  if (approval.shots?.[k]) {
    return { status: "approved", reason: "shot", totalShots, approvedShots };
  }
  if (approval.scenes?.[String(sceneOrd)]) {
    return { status: "approved", reason: "scene", totalShots, approvedShots };
  }
  if (approval.episode) {
    return { status: "approved", reason: "episode", totalShots, approvedShots };
  }
  return { status: "unapproved", reason: "none", totalShots, approvedShots };
}
