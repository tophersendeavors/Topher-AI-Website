// Writers Room seat store. Seats live at projects.metadata.writersRoom and
// each holds a ProfileRef to a reusable profile (AI agent / AI creative / live
// person). Resolving a seat denormalizes display fields so the room renders
// without re-fetching the profile.

import { supabase } from "../db/client.js";
import type {
  LivePermission,
  SeatKind,
  WritersRoomSeat,
  WritersRoomState,
} from "@toburt/shared";
import { STUDIO_AI_WRITER, WRITING_CREATIVES } from "./profiles.js";
import { getTalent, createTalent, addProjectHistory } from "../talent/store.js";

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
  talentId?: string; // select an existing Writer/Talent Directory profile
  name?: string; // …or invite a new person (creates a reusable profile)
  email?: string;
  role?: string;
  permission?: LivePermission;
}

async function projectTitle(projectId: string): Promise<string> {
  const { data } = await supabase.from("projects").select("title").eq("id", projectId).maybeSingle();
  return (data?.title as string | undefined) ?? "Untitled";
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
    // live_person — resolve to a reusable Writer/Talent Directory profile.
    // Either select an existing profile or invite a new one (which creates the
    // profile). The seat references it by id so the person is reusable.
    let profile;
    if (input.talentId) {
      profile = await getTalent(userId, input.talentId);
      if (!profile) throw new Error("That writer profile could not be found.");
    } else {
      if (!input.name?.trim()) throw new Error("A live writer needs a name.");
      profile = await createTalent(userId, {
        name: input.name.trim(),
        email: input.email?.trim() || null,
        role: input.role?.trim() || "Co-Writer",
        category: "co_writer",
        permission: input.permission ?? "co_writer",
        inviteStatus: input.email?.trim() ? "invited" : "draft",
      });
    }
    const live = profile.inviteStatus === "active" ? "active" : "pending";
    seat = {
      seatId, kind: "live_person", ref: { kind: "live_person", id: profile.id },
      name: profile.name, roleLabel: profile.role || "Co-Writer",
      avatarUrl: profile.avatarUrl,
      status: profile.inviteStatus === "active" ? "On the team" : "Invite pending",
      personEmail: profile.email, permission: profile.permission, inviteStatus: live,
      assignedAt: now, assignedBy: userId,
    };
    // Record that this person is now part of this project.
    await addProjectHistory(userId, profile.id, {
      projectId, title: await projectTitle(projectId), role: profile.role, at: now,
    });
  }

  const state = await getWritersRoomState(projectId);
  const seats = [...state.seats.filter((s) => s.seatId !== seatId), seat];
  return saveState(projectId, { ...state, seats });
}

export async function clearSeat(projectId: string, seatId: string): Promise<WritersRoomState> {
  const state = await getWritersRoomState(projectId);
  return saveState(projectId, { ...state, seats: state.seats.filter((s) => s.seatId !== seatId) });
}
