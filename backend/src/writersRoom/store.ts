// Writers Room seat store. Seats live at projects.metadata.writersRoom and
// each holds a ProfileRef to a reusable profile (AI agent / AI creative / live
// person). Resolving a seat denormalizes display fields so the room renders
// without re-fetching the profile.

import { randomUUID } from "node:crypto";
import { supabase } from "../db/client.js";
import type {
  LivePermission,
  SeatKind,
  WritersRoomSeat,
  WritersRoomState,
} from "@toburt/shared";
import { STUDIO_AI_WRITER, WRITING_CREATIVES } from "./profiles.js";

async function loadMeta(projectId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.from("projects").select("metadata").eq("id", projectId).single();
  if (error) throw error;
  return (data?.metadata as Record<string, unknown> | null) ?? {};
}

export async function getWritersRoomState(projectId: string): Promise<WritersRoomState> {
  const meta = await loadMeta(projectId);
  const wr = (meta.writersRoom as WritersRoomState | undefined) ?? null;
  return wr ?? { seats: [], updatedAt: null };
}

async function saveState(projectId: string, state: WritersRoomState): Promise<WritersRoomState> {
  const meta = await loadMeta(projectId);
  const next = { ...meta, writersRoom: { ...state, updatedAt: new Date().toISOString() } };
  const { error } = await supabase.from("projects").update({ metadata: next }).eq("id", projectId);
  if (error) throw error;
  return next.writersRoom as WritersRoomState;
}

export interface AssignSeatInput {
  kind: SeatKind;
  profileId?: string; // ai_creative
  // live_person:
  name?: string;
  email?: string;
  role?: string;
  permission?: LivePermission;
}

/** Build a fully-resolved seat from an assignment and save it. */
export async function assignSeat(
  projectId: string,
  seatId: string,
  input: AssignSeatInput,
  userId: string
): Promise<WritersRoomState> {
  const now = new Date().toISOString();
  let seat: WritersRoomSeat;

  if (input.kind === "ai_writer") {
    const w = STUDIO_AI_WRITER;
    seat = {
      seatId, kind: "ai_writer", ref: { kind: "ai_writer", id: w.id },
      name: w.name, roleLabel: w.role, avatarUrl: w.avatarUrl, status: "Writing engine ready",
      assignedAt: now, assignedBy: userId,
    };
  } else if (input.kind === "ai_creative") {
    const c = WRITING_CREATIVES.find((x) => x.id === input.profileId);
    if (!c) throw new Error("Unknown AI creative profile.");
    seat = {
      seatId, kind: "ai_creative", ref: { kind: "ai_creative", id: c.id },
      name: c.name, roleLabel: c.role, avatarUrl: c.avatarUrl, status: "Ready to write",
      assignedAt: now, assignedBy: userId,
    };
  } else {
    // live_person — inline for now, but with a stable id so the Phase-2
    // directory can adopt it as a global profile without changing the seat.
    if (!input.name?.trim()) throw new Error("A live person needs a name.");
    const id = randomUUID();
    const permission: LivePermission = input.permission ?? "comment";
    seat = {
      seatId, kind: "live_person", ref: { kind: "live_person", id },
      name: input.name.trim(), roleLabel: input.role?.trim() || "Collaborator",
      avatarUrl: null, status: "Invite pending",
      personEmail: input.email?.trim() || null, permission, inviteStatus: "pending",
      assignedAt: now, assignedBy: userId,
    };
  }

  const state = await getWritersRoomState(projectId);
  const seats = [...state.seats.filter((s) => s.seatId !== seatId), seat];
  return saveState(projectId, { ...state, seats });
}

export async function clearSeat(projectId: string, seatId: string): Promise<WritersRoomState> {
  const state = await getWritersRoomState(projectId);
  return saveState(projectId, { ...state, seats: state.seats.filter((s) => s.seatId !== seatId) });
}
