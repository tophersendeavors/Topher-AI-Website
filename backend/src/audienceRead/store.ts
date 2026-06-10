// Audience Read storage + draft loader. The report is stored at
// projects.metadata.audienceReads[episodeId] (NEVER on the locked scripts
// row), preserving every other project metadata key. Read-only w.r.t. the
// draft itself.

import { supabase } from "../db/client.js";
import type { AudienceReadReport } from "@toburt/shared";

export function djb2Hex(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return (h >>> 0).toString(16);
}

async function loadProjectMetadata(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return (data?.metadata as Record<string, unknown> | null) ?? {};
}

export interface CurrentDraft {
  scriptId: string | null;
  draftLabel: string | null;
  isLocked: boolean;
  fountain: string;
  fountainHash: string;
  scenes: Array<{ ord: number; heading: string }>;
}

/** Load the current (latest) script for an episode + its scene headings. */
export async function loadCurrentDraft(
  projectId: string,
  episodeId: string
): Promise<CurrentDraft> {
  const { data: scripts } = await supabase
    .from("scripts")
    .select("id, fountain, draft_number, metadata, current")
    .eq("project_id", projectId)
    .eq("episode_id", episodeId)
    .eq("current", true);
  const script = (scripts ?? [])[0];
  if (!script) {
    return { scriptId: null, draftLabel: null, isLocked: false, fountain: "", fountainHash: "", scenes: [] };
  }
  const { data: sceneRows } = await supabase
    .from("script_scenes")
    .select("ord, slugline")
    .eq("script_id", script.id as string)
    .order("ord", { ascending: true });
  const meta = (script.metadata as Record<string, unknown> | null) ?? {};
  const fountain = (script.fountain as string) ?? "";
  return {
    scriptId: script.id as string,
    draftLabel: `Draft ${script.draft_number as number}`,
    isLocked: meta.lockedWritingDraft === true,
    fountain,
    fountainHash: djb2Hex(fountain),
    scenes: (sceneRows ?? []).map((r) => ({
      ord: Number(r.ord),
      heading: (r.slugline as string) ?? `Scene ${r.ord}`,
    })),
  };
}

export async function getAudienceRead(
  projectId: string,
  episodeId: string
): Promise<AudienceReadReport | null> {
  const meta = await loadProjectMetadata(projectId);
  const all = (meta.audienceReads as Record<string, AudienceReadReport> | undefined) ?? {};
  return all[episodeId] ?? null;
}

export async function putAudienceRead(
  projectId: string,
  episodeId: string,
  report: AudienceReadReport
): Promise<AudienceReadReport> {
  const meta = await loadProjectMetadata(projectId);
  const all = (meta.audienceReads as Record<string, AudienceReadReport> | undefined) ?? {};
  const nextAll = { ...all, [episodeId]: report };
  const { error } = await supabase
    .from("projects")
    .update({ metadata: { ...meta, audienceReads: nextAll } })
    .eq("id", projectId);
  if (error) throw error;
  return report;
}

export async function approveAudienceRead(
  projectId: string,
  episodeId: string,
  userId: string
): Promise<AudienceReadReport> {
  const prior = await getAudienceRead(projectId, episodeId);
  if (!prior) throw new Error("No Audience Read to approve — generate one first.");
  return putAudienceRead(projectId, episodeId, {
    ...prior,
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  });
}
