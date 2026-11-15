"use client";

/**
 * Server-status banner: shows a friendly message when the backend is waking
 * up or unreachable, instead of a raw error. Renders nothing when idle.
 */

import { Loader2, ServerCrash } from "lucide-react";
import { useServerStatus } from "@/lib/useServerStatus";

export function ServerStatusBanner() {
  const status = useServerStatus();

  if (status === "idle") return null;

  if (status === "starting") {
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[50] flex items-center justify-center gap-2 border-b border-amber-200 bg-amber-50/95 px-4 py-2.5 text-center text-sm font-medium text-amber-800 backdrop-blur"
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Server is starting, please wait up to a minute
      </div>
    );
  }

  return (
    <div
      role="alert"
      className="fixed inset-x-0 top-0 z-[50] flex items-center justify-center gap-2 border-b border-rose-200 bg-rose-50/95 px-4 py-2.5 text-center text-sm font-medium text-rose-800 backdrop-blur"
    >
      <ServerCrash className="h-4 w-4" aria-hidden />
      Server is not responding, please try again in a minute
    </div>
  );
}
