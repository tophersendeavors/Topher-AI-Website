import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!_client) {
    if (!url || !key) {
      // Provide a stub that throws on use so the UI shell still mounts.
      throw new Error(
        "Supabase env not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY."
      );
    }
    _client = createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return _client;
}

export function hasSupabaseEnv(): boolean {
  return !!url && !!key;
}
