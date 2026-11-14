"use client";

/**
 * Server-status banner: shows a friendly message when the backend is waking
 * up or unreachable, instead of a raw error. Renders nothing when idle.
 */

import { useServerStatus } from "@/lib/useServerStatus";

export function ServerStatusBanner() {
  const status = useServerStatus();

  if (status === "idle") return null;

  if (status === "starting") {
    return (
      <div className="fixed top-0 left-0 right-0 z-[50] bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-800 text-center shadow-sm">
        Server is starting, please wait up to a minute
      </div>
    );
  }

  return (
    <div className="fixed top-0 left-0 right-0 z-[50] bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-800 text-center shadow-sm">
      Server is not responding, please try again in a minute
    </div>
  );
}
