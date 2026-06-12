// Room Notes store. Studio-wide production notes keyed by project + room.
// Visibility is enforced here (the service-role client bypasses RLS).

import { supabase } from "../db/client.js";
import type {
  NoteStatus,
  NoteTargetType,
  NoteVisibility,
  RoomNote,
  RoomNoteInput,
} from "@toburt/shared";

type Row = {
  id: string;
  project_id: string;
  room: string;
  author_id: string | null;
  assignee_id: string | null;
  body: string;
  target_type: string;
  target_ref: string | null;
  target_label: string | null;
  visibility: string;
  selected_user_ids: string[] | null;
  status: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
};

async function nameMap(ids: Array<string | null>): Promise<Record<string, string>> {
  const want = [...new Set(ids.filter(Boolean) as string[])];
  if (!want.length) return {};
  const { data } = await supabase.from("profiles").select("id, display_name").in("id", want);
  const m: Record<string, string> = {};
  for (const p of (data ?? []) as Array<{ id: string; display_name: string | null }>) {
    m[p.id] = p.display_name ?? "Someone";
  }
  return m;
}

function toNote(r: Row, names: Record<string, string>): RoomNote {
  return {
    id: r.id,
    projectId: r.project_id,
    room: r.room,
    authorId: r.author_id,
    authorName: r.author_id ? names[r.author_id] ?? null : null,
    assigneeId: r.assignee_id,
    assigneeName: r.assignee_id ? names[r.assignee_id] ?? null : null,
    body: r.body,
    targetType: r.target_type as NoteTargetType,
    targetRef: r.target_ref,
    targetLabel: r.target_label,
    visibility: r.visibility as NoteVisibility,
    selectedUserIds: r.selected_user_ids ?? [],
    status: r.status as NoteStatus,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    resolvedAt: r.resolved_at,
  };
}

function canSee(r: Row, userId: string): boolean {
  if (r.visibility === "room" || r.visibility === "project") return true;
  if (r.author_id === userId || r.assignee_id === userId) return true;
  return (r.selected_user_ids ?? []).includes(userId);
}

export interface NoteFilter {
  room?: string;
  targetType?: NoteTargetType;
  targetRef?: string;
  status?: NoteStatus;
}

export async function listNotes(
  projectId: string,
  userId: string,
  filter: NoteFilter = {}
): Promise<RoomNote[]> {
  let q = supabase.from("room_notes").select("*").eq("project_id", projectId);
  if (filter.room) q = q.eq("room", filter.room);
  if (filter.targetType) q = q.eq("target_type", filter.targetType);
  if (filter.targetRef) q = q.eq("target_ref", filter.targetRef);
  if (filter.status) q = q.eq("status", filter.status);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw error;
  const rows = (data as Row[]).filter((r) => canSee(r, userId));
  const names = await nameMap(rows.flatMap((r) => [r.author_id, r.assignee_id]));
  return rows.map((r) => toNote(r, names));
}

async function single(id: string): Promise<RoomNote> {
  const { data, error } = await supabase.from("room_notes").select("*").eq("id", id).single();
  if (error) throw error;
  const r = data as Row;
  const names = await nameMap([r.author_id, r.assignee_id]);
  return toNote(r, names);
}

export async function createNote(
  projectId: string,
  userId: string,
  input: RoomNoteInput
): Promise<RoomNote> {
  const { data, error } = await supabase
    .from("room_notes")
    .insert({
      project_id: projectId,
      room: input.room ?? "writers",
      author_id: userId,
      assignee_id: input.assigneeId ?? null,
      body: input.body.trim(),
      target_type: input.targetType ?? "room",
      target_ref: input.targetRef ?? null,
      target_label: input.targetLabel ?? null,
      visibility: input.visibility ?? "room",
      selected_user_ids: input.selectedUserIds ?? [],
      status: input.status ?? "open",
    })
    .select("id")
    .single();
  if (error) throw error;
  return single((data as { id: string }).id);
}

export async function updateNote(
  projectId: string,
  noteId: string,
  patch: RoomNoteInput
): Promise<RoomNote> {
  const row: Record<string, unknown> = {};
  if (patch.body !== undefined) row.body = patch.body.trim();
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.assigneeId !== undefined) row.assignee_id = patch.assigneeId;
  if (patch.visibility !== undefined) row.visibility = patch.visibility;
  if (patch.selectedUserIds !== undefined) row.selected_user_ids = patch.selectedUserIds;
  if (patch.targetType !== undefined) row.target_type = patch.targetType;
  if (patch.targetRef !== undefined) row.target_ref = patch.targetRef;
  if (patch.targetLabel !== undefined) row.target_label = patch.targetLabel;
  const { error } = await supabase
    .from("room_notes")
    .update(row)
    .eq("id", noteId)
    .eq("project_id", projectId);
  if (error) throw error;
  return single(noteId);
}

export async function deleteNote(projectId: string, noteId: string): Promise<void> {
  const { error } = await supabase
    .from("room_notes")
    .delete()
    .eq("id", noteId)
    .eq("project_id", projectId);
  if (error) throw error;
}

/** Count of still-open notes for a room (used by the Final Draft Lock gate). */
export async function openNoteCount(projectId: string, room = "writers"): Promise<number> {
  const { count, error } = await supabase
    .from("room_notes")
    .select("id", { count: "exact", head: true })
    .eq("project_id", projectId)
    .eq("room", room)
    .in("status", ["open", "in_review", "accepted"]);
  if (error) throw error;
  return count ?? 0;
}
