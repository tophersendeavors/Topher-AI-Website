// Studio Owner identity — the account-level creator profile that turns the
// app from "a tool I subscribed to" into "my studio." Stored in Supabase
// auth user_metadata (account-level, migration-free), with name + avatar
// mirrored to the profiles table.

export type StudioRole =
  | "producer"
  | "writer"
  | "director"
  | "showrunner"
  | "executive_producer"
  | "solo_creator";

export const STUDIO_ROLE_LABELS: Record<StudioRole, string> = {
  producer: "Producer",
  writer: "Writer",
  director: "Director",
  showrunner: "Showrunner",
  executive_producer: "Executive Producer",
  solo_creator: "Solo Creator",
};

/** The AI representation of the Studio Owner — the face of the studio. */
export interface CreativeTwin {
  displayName: string;
  /** e.g. "Studio Founder · Showrunner · Creative Architect" */
  titleLine: string;
  /** Uploaded likeness (data URL or storage URL), or null → monogram. */
  avatarUrl: string | null;
}

export interface StudioOwnerIdentity {
  name: string;
  role: StudioRole | null;
  bio: string;
  avatarUrl: string | null;
  creativeTwin: CreativeTwin | null;
  onboardingComplete: boolean;
  /** Forward-compat for later phases (Creative DNA interview, Studio Builder).
   *  Not populated in Phase 1. */
  creativeDNA?: Record<string, unknown> | null;
  studioConfig?: Record<string, unknown> | null;
  updatedAt: string | null;
}

export interface StudioOwnerResponse {
  owner: StudioOwnerIdentity;
}
