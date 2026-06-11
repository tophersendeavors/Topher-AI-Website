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

  // Merge into user_metadata, preserving every other key.
  const meta = await loadUserMeta(userId);
  const { error: upErr } = await supabase.auth.admin.updateUserById(userId, {
    user_metadata: { ...meta, studioOwner: next },
  });
  if (upErr) throw new Error(`save studio owner failed: ${upErr.message}`);

  // Mirror name + avatar to the profiles table (best-effort).
  await supabase
    .from("profiles")
    .update({
      display_name: next.name || null,
      avatar_url: next.avatarUrl || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  return next;
}
