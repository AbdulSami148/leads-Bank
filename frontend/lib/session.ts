/**
 * Session guard hook shared by the pages: resolves the Supabase session and
 * the user's profile. Redirects to /login when logged out or on an invalid
 * session, and to /dashboard when a page requires an admin and the user is
 * not one.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getMe } from "./api";
import { getSupabase } from "./supabase";
import type { Profile } from "./types";

export interface SessionGuard {
  /** True once the session/profile check finished — the page can render. */
  ready: boolean;
  /** Access token for API calls, null until ready. */
  token: string | null;
  /** The user's own profile row, null until ready. */
  profile: Profile | null;
}

export function useSessionGuard(requireAdmin: boolean): SessionGuard {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      const session = data.session;
      if (!session) {
        router.replace("/login"); // not logged in
        return;
      }
      try {
        const me = await getMe(session.access_token);
        if (!active) return;
        if (requireAdmin && me.role !== "admin") {
          router.replace("/dashboard"); // non-admins never see admin pages
          return;
        }
        setToken(session.access_token);
        setProfile(me);
        setReady(true);
      } catch {
        // /me failed — stale token or API down: back to login.
        router.replace("/login");
      }
    })();
    return () => {
      active = false;
    };
  }, [requireAdmin, router]);

  return { ready, token, profile };
}
