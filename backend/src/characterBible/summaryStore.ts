// Storage for the Character Bible executive summary. Writes target the
// projects.metadata.characterBibleSummary jsonb key ONLY — every other
// project metadata key is preserved (same read→spread→merge→write pattern
// as the Sound Bible store).

import { supabase } from "../db/client.js";
import type { CharacterBibleSummary } from "@toburt/shared";

async function loadProjectMetadata(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("projects")
    .select("metadata")
    .eq("id", projectId)
    .single();
  if (error) throw error;
  return (data?.metadata as Record<string, unknown> | null) ?? {};
}

export async function getCharacterBibleSummary(
  projectId: string
): Promise<CharacterBibleSummary | null> {
  const meta = await loadProjectMetadata(projectId);
  return (meta.characterBibleSummary as CharacterBibleSummary | undefined) ?? null;
}

/** Write the summary back, preserving every other project metadata key. */
export async function putCharacterBibleSummary(
  projectId: string,
  summary: CharacterBibleSummary
): Promise<CharacterBibleSummary> {
  const meta = await loadProjectMetadata(projectId);
  const next = { ...meta, characterBibleSummary: summary };
  const { error } = await supabase
    .from("projects")
    .update({ metadata: next })
    .eq("id", projectId);
  if (error) throw error;
  return summary;
}

/** Save edited/generated text. Any content change drops the approval —
 *  the showrunner must re-approve after edits. `fromGenerate` stamps
 *  generatedAt; a manual save leaves the prior generatedAt intact. */
export async function saveCharacterBibleSummaryText(
  projectId: string,
  text: string,
  opts: { fromGenerate: boolean }
): Promise<CharacterBibleSummary> {
  const prior = await getCharacterBibleSummary(projectId);
  const now = new Date().toISOString();
  const next: CharacterBibleSummary = {
    text,
    generatedAt: opts.fromGenerate ? now : prior?.generatedAt ?? null,
    updatedAt: now,
    // Content changed → unapprove. (If the text is byte-identical to an
    // approved summary, keep the approval.)
    approvedAt: prior && prior.approvedAt && prior.text === text ? prior.approvedAt : null,
    approvedBy: prior && prior.approvedAt && prior.text === text ? prior.approvedBy : null,
  };
  return putCharacterBibleSummary(projectId, next);
}

export async function approveCharacterBibleSummary(
  projectId: string,
  userId: string
): Promise<CharacterBibleSummary> {
  const prior = await getCharacterBibleSummary(projectId);
  if (!prior || !prior.text.trim()) {
    throw new Error("No Character Bible summary to approve — generate or write one first.");
  }
  const next: CharacterBibleSummary = {
    ...prior,
    approvedAt: new Date().toISOString(),
    approvedBy: userId,
  };
  return putCharacterBibleSummary(projectId, next);
}
