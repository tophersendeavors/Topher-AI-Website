import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

// Service-role client — bypasses RLS. The backend re-checks project
// membership before mutating, so this is intentional.
export const supabase: SupabaseClient = createClient(
  config.SUPABASE_URL,
  config.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "x-toburt-server": "1" } },
  }
);

// Per-user client (RLS-bound) — created on demand from a JWT.
export function userClient(jwt: string): SupabaseClient {
  return createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
}
