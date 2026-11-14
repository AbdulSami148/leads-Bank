/**
 * Supabase browser client — used ONLY for login/logout/session.
 * All lead/profile data comes from the backend API (see lib/api.ts).
 *
 * Created lazily (on first use) so that prerendering/CI builds do not fail
 * when the env vars are not present at build time.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
      );
    }
    client = createClient(url, anonKey);
  }
  return client;
}
