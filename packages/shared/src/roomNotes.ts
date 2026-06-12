// Room Notes & Annotations — a studio-wide PRODUCTION-NOTE system (not chat).
//
// A note is actionable and resolvable: it targets something (the room, a
// script, a scene, a line, a beat, a character, an episode), has an author and
// optional assignee, a visibility, and a status that moves through a review
// lifecycle. The `room` field makes this reusable across every room.

export const NOTE_TARGET_TYPES = [
  "room",
  "script",
  "scene",
  "line",
  "beat",
  "character",
  "episode",
] as const;
export type NoteTargetType = (typeof NOTE_TARGET_TYPES)[number];
export const NOTE_TARGET_LABELS: Record<NoteTargetType, string> = {
  room: "Room note",
  script: "Script",
  scene: "Scene",
  line: "Line",
  beat: "Beat",
  character: "Character",
  episode: "Episode",
};

export const NOTE_STATUSES = [
  "open",
  "in_review",
  "accepted",
  "rejected",
  "applied",
  "resolved",
] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];
export const NOTE_STATUS_LABELS: Record<NoteStatus, string> = {
  open: "Open",
  in_review: "In review",
  accepted: "Accepted",
  rejected: "Rejected",
  applied: "Applied",
  resolved: "Resolved",
};

export const NOTE_VISIBILITIES = ["private", "selected", "room", "project"] as const;
export type NoteVisibility = (typeof NOTE_VISIBILITIES)[number];
export const NOTE_VISIBILITY_LABELS: Record<NoteVisibility, string> = {
  private: "Private (only me)",
  selected: "Selected collaborators",
  room: "Everyone in this room",
  project: "Whole project",
};

/** A status is "live" (still needs action) vs "closed" (done with). */
export const OPEN_NOTE_STATUSES: NoteStatus[] = ["open", "in_review", "accepted"];
export const CLOSED_NOTE_STATUSES: NoteStatus[] = ["rejected", "applied", "resolved"];

export interface RoomNote {
  id: string;
  projectId: string;
  room: string; // "writers" | "creative" | …
  authorId: string | null;
  authorName: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  body: string;
  targetType: NoteTargetType;
  targetRef: string | null;
  targetLabel: string | null;
  visibility: NoteVisibility;
  selectedUserIds: string[];
  status: NoteStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface RoomNoteInput {
  room?: string;
  body: string;
  targetType?: NoteTargetType;
  targetRef?: string | null;
  targetLabel?: string | null;
  visibility?: NoteVisibility;
  selectedUserIds?: string[];
  assigneeId?: string | null;
  status?: NoteStatus;
}
