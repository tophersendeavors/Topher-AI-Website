// Active writing collaboration at the desk. The seated AI Writer / AI Creative
// drafts the next scene, continues a scene, rewrites a selection, strengthens
// subtext, proposes an alternate beat, or answers a question — all through that
// collaborator's lens. Returns generated text; the editor decides how to apply
// it (append vs replace selection vs show). Nothing is auto-applied.

import { config } from "../config.js";
import { supabase } from "../db/client.js";
import { callLLM } from "../llm/provider.js";
import type { CollabAction, WriteFlowCollaborator } from "@toburt/shared";
import { getWritersRoomState, saveWriteFlow } from "./store.js";
import { resolveCollaborator, collaboratorSystem } from "./writeFlow.js";

async function loadDraftText(projectId: string, preferredId?: string | null): Promise<string> {
  const { data } = await supabase
    .from("scripts")
    .select("id, fountain, current, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  const rows = (data ?? []) as Array<{ id: string; fountain: string | null; current: boolean | null }>;
  const s = (preferredId ? rows.find((r) => r.id === preferredId) : null) ?? rows.find((r) => r.current) ?? rows[0];
  return (s?.fountain ?? "").slice(-12_000); // recent tail is enough for context
}

interface CollabResult {
  text: string;
  mode: "append" | "replace" | "message"; // how the editor should apply it
  collaborator: string | null;
}

const ACTION_BRIEF: Record<CollabAction, { instruction: string; mode: CollabResult["mode"]; needsSelection: boolean }> = {
  next_scene: { instruction: "Write the NEXT scene that should follow, in Fountain format (scene heading in CAPS). Continue the story naturally. Return only the new scene.", mode: "append", needsSelection: false },
  continue: { instruction: "Continue the current scene from where it stops — more of the same scene, in Fountain. Return only the continuation.", mode: "append", needsSelection: false },
  complete: { instruction: "Continue the screenplay from EXACTLY where it stops and carry it through to a satisfying ending. If it ends on a scene heading or transition with nothing under it, write the scene that follows. If it ends mid-scene, mid-action, or mid-dialogue, finish that line/beat first and continue. Do NOT repeat any existing text. Return ONLY the new material, in Fountain.", mode: "append", needsSelection: false },
  rewrite: { instruction: "Rewrite the SELECTED passage, keeping its purpose but improving it through your lens. Return only the rewritten passage (Fountain).", mode: "replace", needsSelection: true },
  subtext: { instruction: "Rewrite the SELECTED passage to carry the meaning in subtext — replace on-the-nose lines with indirection and behavior. Return only the rewritten passage (Fountain).", mode: "replace", needsSelection: true },
  alt_beat: { instruction: "Propose an ALTERNATE version of the selected moment (or the latest scene) — a different but valid beat. Return the alternate as Fountain, with a one-line note above it prefixed with '//'.", mode: "message", needsSelection: false },
  ask: { instruction: "Answer the creator's question about this draft as their writing collaborator. Be specific and concrete. Plain prose.", mode: "message", needsSelection: false },
};

export async function collaborate(
  projectId: string,
  action: CollabAction,
  opts: { selection?: string; instruction?: string; context?: string } = {}
): Promise<CollabResult> {
  const state = await getWritersRoomState(projectId);
  const resolved = resolveCollaborator(state);
  if (!resolved) throw new Error("Seat an AI Writer or AI Creative in the Writers Room first.");
  const brief = ACTION_BRIEF[action];
  // Prefer the editor's live text (reflects unsaved edits + cursor) when given.
  const draft = opts.context?.trim() ? opts.context.slice(-12_000) : await loadDraftText(projectId, state.writeFlow.draftScriptId);

  const parts: string[] = [`Draft so far (continue from the very end of this):\n${draft || "(empty — start the script)"}`];
  if (brief.needsSelection) parts.push(`Selected passage:\n${opts.selection?.trim() || "(none selected — use the latest scene)"}`);
  if (action === "ask" && opts.instruction) parts.push(`Question: ${opts.instruction.trim()}`);
  else if (opts.instruction) parts.push(`Steering notes — follow closely: ${opts.instruction.trim()}`);

  const res = await callLLM({
    model: config.SCENE_MODEL,
    messages: [
      { role: "system", content: `${collaboratorSystem(resolved.ref, resolved.creativeIdx)}\n\n${brief.instruction}` },
      { role: "user", content: parts.join("\n\n") },
    ],
    temperature: 0.8,
    maxTokens: 1600,
  });
  return { text: res.text.trim(), mode: brief.mode, collaborator: collaboratorName(resolved.ref) };
}

function collaboratorName(ref: WriteFlowCollaborator): string {
  return ref.name;
}

export async function setDraftApproved(projectId: string, approved: boolean, scriptId?: string) {
  const state = await getWritersRoomState(projectId);
  // Approving pins THIS script as the working draft (so the Review Bench, lock,
  // and collaborate all read it) and marks it current.
  if (approved && scriptId) {
    await supabase.from("scripts").update({ current: false }).eq("project_id", projectId);
    await supabase.from("scripts").update({ current: true }).eq("id", scriptId);
  }
  return saveWriteFlow(projectId, {
    ...state.writeFlow,
    draftApproved: approved,
    draftApprovedAt: approved ? new Date().toISOString() : null,
    draftScriptId: scriptId ?? state.writeFlow.draftScriptId,
  });
}
