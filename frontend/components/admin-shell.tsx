"use client";

/**
 * Admin chrome: the same left sidebar on every admin page (Users, My dashboard,
 * Settings, user box and Logout). On a small screen it becomes a top bar with
 * a menu button that opens the same links.
 */

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { LayoutDashboard, Menu as MenuIcon, Settings, Users, X } from "lucide-react";
import { Logo } from "./logo";
import { UserBox } from "./user-menu";

export type AdminSection = "users" | "dashboard" | "settings";

const NAV_ITEMS: { key: AdminSection; href: string; label: string; icon: typeof Users }[] = [
  { key: "users", href: "/admin", label: "Users", icon: Users },
  { key: "dashboard", href: "/dashboard", label: "My dashboard", icon: LayoutDashboard },
  { key: "settings", href: "/settings", label: "Settings", icon: Settings },
];

export function AdminShell({
  children,
  active,
  email,
  username,
  role,
}: {
  children: ReactNode;
  active: AdminSection;
  email?: string | null;
  username?: string | null;
  role?: string | null;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const nav = (onNavigate?: () => void) =>
    NAV_ITEMS.map((item) => {
      const Icon = item.icon;
      const isActive = item.key === active;
      return (
        <Link
          key={item.key}
          href={item.href}
          onClick={onNavigate}
          aria-current={isActive ? "page" : undefined}
          className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
            isActive
              ? "bg-indigo-50 text-indigo-700"
              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <Icon className="h-[18px] w-[18px]" aria-hidden />
          {item.label}
        </Link>
      );
    });

  const userBox = <UserBox email={email} username={username} role={role} />;

  return (
    <div className="min-h-screen bg-slate-50">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-5">
          <Logo href="/admin" />
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Admin">
          {nav()}
        </nav>
        <div className="border-t border-slate-200 p-3">{userBox}</div>
      </aside>

      <header className="sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-100"
        >
          <MenuIcon className="h-5 w-5" aria-hidden />
        </button>
        <Logo href="/admin" />
      </header>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 flex-col bg-white shadow-pop">
            <div className="flex h-16 items-center justify-between px-5">
              <Logo href="/admin" />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Admin">
              {nav(() => setDrawerOpen(false))}
            </nav>
            <div className="border-t border-slate-200 p-3">{userBox}</div>
          </div>
        </div>
      )}

      <div className="lg:pl-64">
        <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </div>
  );
}
