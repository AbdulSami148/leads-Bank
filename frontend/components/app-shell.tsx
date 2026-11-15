"use client";

/**
 * User chrome: a top bar on every page with Dashboard and Settings (the active
 * one highlighted), the user box and Logout.
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "./logo";
import { UserBox } from "./user-menu";

export type AppSection = "dashboard" | "settings";

const LINKS: { key: AppSection; href: string; label: string }[] = [
  { key: "dashboard", href: "/dashboard", label: "Dashboard" },
  { key: "settings", href: "/settings", label: "Settings" },
];

export function AppShell({
  children,
  active,
  email,
  username,
  role,
}: {
  children: ReactNode;
  active: AppSection;
  email?: string | null;
  username?: string | null;
  role?: string | null;
}) {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4 sm:gap-3 sm:px-6">
          <Logo href="/dashboard" />
          <nav className="flex items-center gap-1" aria-label="Account">
            {LINKS.map((item) => {
              const isActive = item.key === active;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`rounded-lg px-2.5 py-2 text-sm font-medium transition sm:px-3 ${
                    isActive
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto">
            <UserBox email={email} username={username} role={role} />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
