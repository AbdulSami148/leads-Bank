"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ApiError, postSheetLink } from "@/lib/api";
import { Button } from "@/components/ui";

interface SheetLinkFormProps {
  /** Supabase access token for the API call. */
  token: string;
  /** Service account email (from GET /sheet/info) to share the sheet with. */
  serviceAccountEmail: string;
  /** Called once the sheet has been linked successfully. */
  onLinked: () => void;
}

/**
 * "Connect your Google Sheet" card.
 *
 * Step 1: create a new Google Sheet.
 * Step 2: share it with the service account as Editor (copy button + toast).
 * Step 3: paste the sheet link and click "Link sheet" (POST /sheet/link).
 */
export function SheetLinkForm({
  token,
  serviceAccountEmail,
  onLinked,
}: SheetLinkFormProps) {
  const router = useRouter();
  const toast = useToast();
  const [sheetUrl, setSheetUrl] = useState("");
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkingRef = useRef(false); // guards against double submits

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(serviceAccountEmail);
      toast("success", "Copied");
    } catch {
      toast("error", "Could not copy to clipboard");
    }
  }, [serviceAccountEmail, toast]);

  const handleLink = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (linkingRef.current) return;
      const url = sheetUrl.trim();
      if (!url) {
        setLinkError("Paste a Google Sheet link.");
        return;
      }
      setLinking(true);
      setLinkError(null);
      linkingRef.current = true;
      try {
        await postSheetLink(token, url);
        toast("success", "Sheet linked.");
        onLinked();
      } catch (error) {
        if (error instanceof ApiError) {
          if (error.status === 401) {
            router.replace("/login"); // session expired
            return;
          }
          if (error.status === 400) {
            // Backend's own error message (e.g. "the sheet is not shared yet").
            setLinkError(
              typeof error.detail === "string" ? error.detail : String(error.detail ?? "Invalid sheet link."),
            );
            return;
          }
          setLinkError(error.message || "Something went wrong.");
          return;
        }
        setLinkError("Network error — is the API running?");
      } finally {
        setLinking(false);
        linkingRef.current = false;
      }
    },
    [token, sheetUrl, router, onLinked, toast],
  );

  return (
    <div className="space-y-4">
      <ol className="space-y-4 text-sm text-slate-600">
        <li className="flex gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
            1
          </span>
          <span>Create a new Google Sheet.</span>
        </li>
        <li className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
            2
          </span>
          <p>
            Share it with this email as <span className="font-medium">Editor</span>:
          </p>
          <div className="flex w-full min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center">
            <span className="w-full min-w-0 flex-1 break-all rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              {serviceAccountEmail}
            </span>
            <Button variant="secondary" size="sm" onClick={handleCopy}>
              Copy
            </Button>
          </div>
        </li>
        <li className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700">
            3
          </span>
          <form onSubmit={handleLink} className="flex w-full flex-col gap-2 sm:flex-row">
            <input
              id="sheet-link"
              type="text"
              placeholder="Paste your Google Sheet link"
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              disabled={linking}
              aria-label="Google Sheet link"
              className="w-full min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm shadow-sm transition placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 disabled:cursor-not-allowed disabled:bg-slate-50"
            />
            <Button type="submit" loading={linking} disabled={linking || !sheetUrl.trim()}>
              Link sheet
            </Button>
          </form>
          {linkError && (
            <p role="alert" className="text-sm font-medium text-rose-600">
              {linkError}
            </p>
          )}
        </li>
      </ol>
    </div>
  );
}
