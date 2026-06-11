// Studio Owner identity store. Persists the account-level creator profile in
// Supabase auth user_metadata.studioOwner (migration-free), and mirrors name
// + avatar into the profiles table so the rest of the app stays consistent.

import { supabase } from "../db/client.js";
import {
  STUDIO_ROLE_LABELS,
  type CreativeTwin,
  type StudioOwnerIdentity,
} from "@toburt/shared";

function emptyOwner(): StudioOwnerIdentity {
  return {
    name: "",
    role: null,
    bio: "",
    avatarUrl: null,
    creativeTwin: null,
    onboardingComplete: false,
    creativeDNA: null,
    studioConfig: null,
    updatedAt: null,
  };
}

/** The Creative Twin is derived from the identity — the studio's face. */
function buildCreativeTwin(o: StudioOwnerIdentity): CreativeTwin | null {
  if (!o.name.trim()) return null;
  const roleLabel = o.role ? STUDIO_ROLE_LABELS[o.role] : null;
  const titleLine = ["Studio Founder", roleLabel, "Creative Architect"]
    .filter(Boolean)
    .join(" · ");
  return { displayName: o.name.trim(), titleLine, avatarUrl: o.avatarUrl ?? null };
}

async function loadUserMeta(userId: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw new Error(`load user failed: ${error.message}`);
  return (data?.user?.user_metadata as Record<string, unknown> | null) ?? {};
}

export async function getStudioOwner(userId: string): Promise<StudioOwnerIdentity> {
  const { data, error } = await supabase.auth.admin.getUserById(userId);
  if (error) throw new Error(`load user failed: ${error.message}`);
  const meta = (data?.user?.user_metadata as Record<string, unknown> | null) ?? {};
  const stored = (meta.studioOwner as Partial<StudioOwnerIdentity> | undefined) ?? {};
  const owner: StudioOwnerIdentity = { ...emptyOwner(), ...stored };
  // Seed a friendly default name from auth so first-run isn't blank.
  if (!owner.name) {
    owner.name =
      (meta.name as string | undefined) ??
      (data?.user?.email ? data.user.email.split("@")[0] : "") ??
      "";
  }
  // The avatar lives in profiles, NOT user_metadata — user_metadata rides
  // inside the JWT, and a data-URL avatar there blows past the header size
  // limit (HTTP 431). Read it back from profiles.
  const { data: profile } = await supabase
    .from("profiles")
    .select("avatar_url")
    .eq("id", userId)
    .maybeSingle();
  const avatar = (profile?.avatar_url as string | null | undefined) ?? null;
  owner.avatarUrl = avatar;
  if (owner.creativeTwin) owner.creativeTwin = { ...owner.creativeTwin, avatarUrl: avatar };
  return owner;
}

export async function saveStudioOwner(
  userId: string,
  patch: Partial<StudioOwnerIdentity>
): Promise<StudioOwnerIdentity> {
  const current = await getStudioOwner(userId);
  const next: StudioOwnerIdentity = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  next.creativeTwin = buildCreativeTwin(next);

  // Avatar (often a sizeable data URL) goes to profiles ONLY. Keeping it out
  // of user_metadata keeps the JWT small (avoids HTTP 431 on every request).
  await supabase
    .from("profiles")
    .update({
      display_name: next.name || null,
      avatar_url: next.avatarUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  // Write a LIGHT copy to user_metadata — no avatar data anywhere in it.
  const light: StudioOwnerIdentity = {
    ...next,
    avatarUrl: null,
    creativeTwin: next.creativeTwin ? { ...next.creativeTwin, avatarUrl: null } : null,
  };
  const meta = await loadUserMeta(userId);
  const { error: upErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, studioOwner: light },
  });
  if (upErr) throw new Error(`save studio owner failed: ${upErr.message}`);

  return next; // full identity (with avatar) for the caller/UI
}
