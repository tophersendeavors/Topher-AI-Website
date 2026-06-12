// Final Draft Lock. Before the Writers Room can hand off to the Creative Room,
// a checklist must pass and the creator must lock the draft. Locking assigns a
// version and marks the script's draft locked (scripts.metadata.lockedWritingDraft),
// which the existing lockGuard already honours.

import { supabase } from "../db/client.js";
import type { FinalLock, LockRequirement, LockStatus, WritersRoomState } from "@toburt/shared";
import { QUALITY_STAFF } from "./profiles.js";
import { getWritersRoomState, saveFinalLock } from "./store.js";
import { openNoteCount } from "../roomNotes/store.js";

interface DraftRef {
  scriptId: string | null;
  draftNumber: number | null;
  label: string | null;
  hasText: boolean;
  metadata: Record<string, unknown>;
}

async function loadDraftRef(projectId: string): Promise<DraftRef> {
  const { data } = await supabase
    .from("scripts")
    .select("id, fountain, draft_number, current, metadata, updated_at")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false });
  const rows = (data ?? []) as Array<{ id: string; fountain: string | null; draft_number: number | null; current: boolean | null; metadata: Record<string, unknown> | null }>;
  const s = rows.find((r) => r.current) ?? rows[0];
  if (!s) return { scriptId: null, draftNumber: null, label: null, hasText: false, metadata: {} };
  return {
    scriptId: s.id,
    draftNumber: s.draft_number ?? 1,
    label: `Draft ${s.draft_number ?? 1}`,
    hasText: !!(s.fountain ?? "").trim(),
    metadata: s.metadata ?? {},
  };
}

function buildRequirements(
  draft: DraftRef,
  lock: FinalLock,
  passesDone: number,
  passesTotal: number,
  openNotes: number
): LockRequirement[] {
  return [
    {
      key: "final_draft",
      label: "Final draft exists",
      met: draft.hasText,
      detail: draft.hasText ? `${draft.label} is in place` : "No draft yet — write or upload one",
      waivable: false,
    },
    {
      key: "quality_passes",
      label: "Major quality passes complete or skipped",
      met: passesTotal > 0 && passesDone >= passesTotal,
      detail: `${passesDone} of ${passesTotal} passes done or intentionally skipped`,
      waivable: true,
    },
    {
      key: "human_read",
      label: "Human read complete or skipped",
      met: lock.humanReadStatus === "complete" || lock.humanReadStatus === "skipped",
      detail:
        lock.humanReadStatus === "complete" ? "Marked complete"
        : lock.humanReadStatus === "skipped" ? "Intentionally skipped"
        : "Not yet done",
      waivable: true,
    },
    {
      key: "blocking_notes",
      label: "Blocking notes resolved or waived",
      met: openNotes === 0 || lock.notesWaived,
      detail: lock.notesWaived ? "Remaining notes waived" : `${openNotes} open note${openNotes === 1 ? "" : "s"}`,
      waivable: true,
    },
    {
      key: "creator_approval",
      label: "Creator approval given",
      met: lock.creatorApproved,
      detail: lock.creatorApproved ? "Approved by you" : "Awaiting your approval",
      waivable: false,
    },
  ];
}

export async function getLockStatus(projectId: string): Promise<LockStatus> {
  const [state, draft, openNotes] = await Promise.all([
    getWritersRoomState(projectId),
    loadDraftRef(projectId),
    openNoteCount(projectId, "writers"),
  ]);
  const lock = state.finalLock;
  const passesTotal = QUALITY_STAFF.length;
  const passesDone = state.reviewBench.filter((r) => r.status === "done" || r.status === "skipped").length;
  const requirements = buildRequirements(draft, lock, passesDone, passesTotal, openNotes);
  const canLock = requirements.every((r) => r.met);
  return { requirements, canLock, lock, draftLabel: draft.label };
}

export async function updateLockSettings(
  projectId: string,
  patch: Partial<Pick<FinalLock, "humanReadStatus" | "notesWaived" | "creatorApproved">>
): Promise<LockStatus> {
  const state = await getWritersRoomState(projectId);
  await saveFinalLock(projectId, { ...state.finalLock, ...patch });
  return getLockStatus(projectId);
}

export async function lockFinalDraft(projectId: string, userId: string): Promise<LockStatus> {
  const status = await getLockStatus(projectId);
  if (!status.canLock) throw new Error("The Final Draft checklist isn't complete yet.");
  const draft = await loadDraftRef(projectId);
  if (!draft.scriptId) throw new Error("There's no draft to lock.");

  // Mark the script's draft locked so the existing lockGuard honours it.
  await supabase
    .from("scripts")
    .update({ metadata: { ...draft.metadata, lockedWritingDraft: true } })
    .eq("id", draft.scriptId);

  const finalLock: FinalLock = {
    ...status.lock,
    locked: true,
    version: draft.draftNumber ?? 1,
    scriptId: draft.scriptId,
    lockedAt: new Date().toISOString(),
    lockedBy: userId,
  };
  await saveFinalLock(projectId, finalLock);
  return getLockStatus(projectId);
}

export async function unlockFinalDraft(projectId: string): Promise<LockStatus> {
  const state = await getWritersRoomState(projectId);
  const lock = state.finalLock;
  if (lock.scriptId) {
    const { data } = await supabase.from("scripts").select("metadata").eq("id", lock.scriptId).maybeSingle();
    const meta = ((data?.metadata as Record<string, unknown> | null) ?? {});
    await supabase.from("scripts").update({ metadata: { ...meta, lockedWritingDraft: false } }).eq("id", lock.scriptId);
  }
  await saveFinalLock(projectId, { ...lock, locked: false, lockedAt: null, version: null });
  return getLockStatus(projectId);
}

/** Used by the handoff (Phase E) to refuse a casual handoff without a lock. */
export async function isFinalLocked(projectId: string): Promise<boolean> {
  const state = await getWritersRoomState(projectId);
  return state.finalLock.locked;
}
