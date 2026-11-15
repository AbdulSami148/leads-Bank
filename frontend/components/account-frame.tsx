"use client";

/**
 * One frame for every signed-in page. Admins get the sidebar (including on
 * My dashboard and Settings). Everyone else gets the user top bar.
 */

import type { ReactNode } from "react";
import { useSessionGuard } from "@/lib/session";
import { AdminShell, type AdminSection } from "./admin-shell";
import { AppShell, type AppSection } from "./app-shell";
import { Skeleton } from "./ui";

export function AccountFrame({
  children,
  area,
  active,
}: {
  children: ReactNode;
  area: "admin" | "auto";
  active: AdminSection;
}) {
  const { ready, profile } = useSessionGuard(area === "admin");

  if (!ready) {
    if (area === "admin") {
      return (
        <AdminShell active={active}>
          <div className="space-y-4">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-64 w-full" />
          </div>
        </AdminShell>
      );
    }
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-5xl space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  const identity = {
    email: profile?.email,
    username: profile?.username,
    role: profile?.role,
  };

  if (profile?.role === "admin") {
    return (
      <AdminShell active={active} {...identity}>
        {children}
      </AdminShell>
    );
  }

  const userActive: AppSection = active === "settings" ? "settings" : "dashboard";
  return (
    <AppShell active={userActive} {...identity}>
      {children}
    </AppShell>
  );
}
