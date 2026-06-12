// Writer / Talent Directory store. Reusable people records owned by a studio
// (the account owner). The Writers Room references these by id so a person is
// reusable across projects. Table: public.talent_profiles.

import { supabase } from "../db/client.js";
import type {
  LivePermission,
  TalentCategory,
  TalentInviteStatus,
  TalentProfile,
  TalentProfileInput,
  TalentProjectRef,
} from "@toburt/shared";

type Row = {
  id: string;
  owner_id: string;
  user_id: string | null;
  name: string;
  email: string | null;
  category: string;
  role: string | null;
  avatar_url: string | null;
  bio: string | null;
  credits: string[] | null;
  specialties: string[] | null;
  permission: string;
  invite_status: string;
  project_history: TalentProjectRef[] | null;
  created_at: string;
  updated_at: string;
};

function toProfile(r: Row): TalentProfile {
  return {
    id: r.id,
    ownerId: r.owner_id,
    userId: r.user_id,
    name: r.name,
    email: r.email,
    category: r.category as TalentCategory,
    role: r.role,
    avatarUrl: r.avatar_url,
    bio: r.bio,
    credits: r.credits ?? [],
    specialties: r.specialties ?? [],
    permission: r.permission as LivePermission,
    inviteStatus: r.invite_status as TalentInviteStatus,
    projectHistory: r.project_history ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listTalent(
  ownerId: string,
  category?: TalentCategory
): Promise<TalentProfile[]> {
  let q = supabase.from("talent_profiles").select("*").eq("owner_id", ownerId);
  if (category) q = q.eq("category", category);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw error;
  return (data as Row[]).map(toProfile);
}

export async function getTalent(ownerId: string, id: string): Promise<TalentProfile | null> {
  const { data, error } = await supabase
    .from("talent_profiles")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? toProfile(data as Row) : null;
}

export async function createTalent(
  ownerId: string,
  input: TalentProfileInput
): Promise<TalentProfile> {
  const row = {
    owner_id: ownerId,
    name: input.name.trim(),
    email: input.email?.trim() || null,
    category: input.category ?? "writer",
    role: input.role?.trim() || null,
    avatar_url: input.avatarUrl ?? null,
    bio: input.bio?.trim() || null,
    credits: input.credits ?? [],
    specialties: input.specialties ?? [],
    permission: input.permission ?? "comment",
    invite_status: input.inviteStatus ?? (input.email ? "invited" : "draft"),
  };
  const { data, error } = await supabase
    .from("talent_profiles")
    .insert(row)
    .select("*")
    .single();
  if (error) throw error;
  return toProfile(data as Row);
}

export async function updateTalent(
  ownerId: string,
  id: string,
  patch: TalentProfileInput
): Promise<TalentProfile> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.email !== undefined) row.email = patch.email?.trim() || null;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.role !== undefined) row.role = patch.role?.trim() || null;
  if (patch.avatarUrl !== undefined) row.avatar_url = patch.avatarUrl;
  if (patch.bio !== undefined) row.bio = patch.bio?.trim() || null;
  if (patch.credits !== undefined) row.credits = patch.credits;
  if (patch.specialties !== undefined) row.specialties = patch.specialties;
  if (patch.permission !== undefined) row.permission = patch.permission;
  if (patch.inviteStatus !== undefined) row.invite_status = patch.inviteStatus;
  const { data, error } = await supabase
    .from("talent_profiles")
    .update(row)
    .eq("owner_id", ownerId)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return toProfile(data as Row);
}

export async function deleteTalent(ownerId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from("talent_profiles")
    .delete()
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) throw error;
}

/** Record that a profile worked on a project (deduped by projectId). */
export async function addProjectHistory(
  ownerId: string,
  id: string,
  ref: TalentProjectRef
): Promise<void> {
  const existing = await getTalent(ownerId, id);
  if (!existing) return;
  const history = [
    ...existing.projectHistory.filter((h) => h.projectId !== ref.projectId),
    ref,
  ];
  const { error } = await supabase
    .from("talent_profiles")
    .update({ project_history: history })
    .eq("owner_id", ownerId)
    .eq("id", id);
  if (error) throw error;
}
