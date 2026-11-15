/**
 * Session guard hook shared by the pages: resolves the Supabase session and
 * the user's profile. Redirects to /login when logged out or on an invalid
 * session, and to /dashboard when a page requires an admin and the user is
 * not one.
 *
 * The access token is kept in sync with the Supabase session, so a session
 * refresh (or a password change) never leaves the pages with a stale token.
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

type ProfileListener = (profile: Profile | null) => void;

/** Latest profile, so a name or email change updates every mounted page. */
let publishedProfile: Profile | null = null;
const profileListeners = new Set<ProfileListener>();

export function publishProfile(profile: Profile | null): void {
  publishedProfile = profile;
  profileListeners.forEach((listener) => listener(profile));
}

/** Merge a partial update (name, email) into the published profile. */
export function patchPublishedProfile(partial: Partial<Profile>): void {
  if (!publishedProfile) return;
  publishProfile({ ...publishedProfile, ...partial });
}

function subscribeProfile(listener: ProfileListener): () => void {
  profileListeners.add(listener);
  return () => {
    profileListeners.delete(listener);
  };
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
        publishProfile(me);
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

  // A name or email saved on another mounted page (settings) updates this one.
  useEffect(() => subscribeProfile(setProfile), []);

  // Keep the token fresh: Supabase refreshes the session in the background
  // (and after a password change) — the API calls always use the new token.
  useEffect(() => {
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) setToken(session.access_token);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { ready, token, profile };
}
