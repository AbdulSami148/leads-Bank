"use client";

/**
 * Shared top bar: app name, primary nav (Admin / My dashboard), the signed-in
 * email and Logout. `showUsers` hides the admin link for regular users;
 * `current` highlights the active nav entry.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabase } from "@/lib/supabase";
import { Button } from "./ui";

export function TopBar({
  showUsers,
  current,
  email,
}: {
  showUsers: boolean;
  current: "users" | "dashboard";
  email?: string | null;
}) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await getSupabase().auth.signOut();
      router.replace("/login");
    } finally {
      setLoggingOut(false);
    }
  }

  const linkClass = (active: boolean) =>
    `text-sm transition ${
      active ? "font-semibold text-blue-600" : "text-gray-500 hover:text-gray-800"
    }`;

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex min-w-0 items-center gap-6">
          <Link href={showUsers ? "/admin" : "/dashboard"} className="shrink-0 text-base font-semibold">
            Leads
          </Link>
          <nav className="flex items-center gap-4" aria-label="Main">
            {showUsers && (
              <Link href="/admin" className={linkClass(current === "users")}>
                Admin
              </Link>
            )}
            <Link href="/dashboard" className={linkClass(current === "dashboard")}>
              My dashboard
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {email && (
            <span className="hidden max-w-[14rem] truncate text-sm text-gray-500 sm:inline">
              {email}
            </span>
          )}
          <Button variant="secondary" loading={loggingOut} onClick={handleLogout}>
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
}
