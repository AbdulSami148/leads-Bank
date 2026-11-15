"use client";

/**
 * Lead Bank logo: a small rounded square with "LB" plus the wordmark.
 * Used in the top bar, the admin sidebar and the login/signup screens.
 */

import Link from "next/link";

/** The mark on its own — a rounded indigo square with the "LB" initials. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-[13px] font-bold tracking-tight text-white shadow-sm ${className}`}
    >
      LB
    </span>
  );
}

/** Mark + wordmark, linked to `href`. */
export function Logo({ href = "/dashboard", className = "" }: { href?: string; className?: string }) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-2.5 rounded-lg transition hover:opacity-90 ${className}`}
    >
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-slate-900">Lead Bank</span>
    </Link>
  );
}
