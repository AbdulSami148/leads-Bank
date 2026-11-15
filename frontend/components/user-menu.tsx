"use client";

/**
 * The signed-in user box: one-letter avatar, name, email, and a Logout button.
 * Long names and emails truncate; the full value is on the title tooltip.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { publishProfile } from "@/lib/session";
import { getSupabase } from "@/lib/supabase";
import { useToast } from "./toast";
import { Avatar } from "./ui";

export function UserBox({
  email,
  username,
  role,
}: {
  email?: string | null;
  username?: string | null;
  role?: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [loggingOut, setLoggingOut] = useState(false);

  const name = username?.trim() || "";
  const displayName = name || email?.split("@")[0] || "Account";
  const avatarName = name || email || "?";

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await getSupabase().auth.signOut();
      publishProfile(null);
      router.replace("/login");
    } catch {
      toast("error", "Could not log out — please try again.");
      setLoggingOut(false);
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar name={avatarName} size="sm" />
      <div className="hidden min-w-0 max-w-[11rem] sm:block">
        <p className="truncate text-sm font-medium text-slate-800" title={displayName}>
          {displayName}
        </p>
        <p className="truncate text-[11px] text-slate-500" title={email ?? ""}>
          {email ?? ""}
        </p>
      </div>
      {role === "admin" && (
        <span className="hidden rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700 lg:inline">
          Admin
        </span>
      )}
      <button
        type="button"
        onClick={() => void handleLogout()}
        disabled={loggingOut}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-2.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-rose-50 hover:text-rose-700 disabled:opacity-60"
      >
        <LogOut className="h-4 w-4" aria-hidden />
        {loggingOut ? "…" : "Logout"}
      </button>
    </div>
  );
}
