// Writer / Talent Directory — reusable people records owned by a studio.
//
// A profile here is the single source of truth for a real collaborator. The
// Writers Room Live Co-Writer seat references one of these by id, so the same
// person is reusable across every project. Phase-2 of the Writers Room.

import type { LivePermission } from "./writersRoom";

export const TALENT_CATEGORIES = [
  "writer",
  "co_writer",
  "human_reader",
  "consultant",
  "producer",
  "director",
] as const;
export type TalentCategory = (typeof TALENT_CATEGORIES)[number];

export const TALENT_CATEGORY_LABELS: Record<TalentCategory, string> = {
  writer: "Writer",
  co_writer: "Co-Writer",
  human_reader: "Human Reader",
  consultant: "Consultant",
  producer: "Producer",
  director: "Director",
};

export type TalentInviteStatus = "draft" | "invited" | "active";

export const TALENT_INVITE_LABELS: Record<TalentInviteStatus, string> = {
  draft: "Not invited",
  invited: "Invite pending",
  active: "Active",
};

/** One project this person has been part of (for the profile's history). */
export interface TalentProjectRef {
  projectId: string;
  title: string;
  role: string | null;
  at: string; // ISO
}

export interface TalentProfile {
  id: string;
  ownerId: string;
  userId: string | null; // set once an invited person signs up
  name: string;
  email: string | null;
  category: TalentCategory;
  role: string | null;
  avatarUrl: string | null;
  bio: string | null;
  credits: string[];
  specialties: string[];
  permission: LivePermission;
  inviteStatus: TalentInviteStatus;
  projectHistory: TalentProjectRef[];
  createdAt: string;
  updatedAt: string;
}

/** Create / update payload (id, owner, timestamps server-managed). */
export interface TalentProfileInput {
  name: string;
  email?: string | null;
  category?: TalentCategory;
  role?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  credits?: string[];
  specialties?: string[];
  permission?: LivePermission;
  inviteStatus?: TalentInviteStatus;
}
