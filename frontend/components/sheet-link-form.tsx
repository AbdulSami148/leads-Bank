"use client";

import { useCallback, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { ApiError, postSheetLink } from "@/lib/api";
import { Button, Card } from "@/components/ui";

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
    <Card className="space-y-4 p-6">
      <h2 className="text-lg font-semibold">Connect your Google Sheet</h2>
      <ol className="list-decimal list-inside space-y-4 text-sm text-gray-600 divide-y divide-gray-200">
        <li className="py-2">
          <span className="font-medium">Step 1:</span> Create a new Google Sheet.
        </li>
        <li className="py-2 flex flex-col sm:flex-row sm:items-start sm:gap-3 gap-2">
          <span className="font-medium shrink-0">Step 2:</span>
          <p className="text-sm text-gray-600">
            Share it with this email as <span className="font-medium">Editor</span>:
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-2 mt-1 sm:mt-0 w-full sm:w-auto">
            <span
              className="flex-1 min-w-0 break-all rounded border border-gray-200 bg-gray-50 px-3 py-1.5 text-sm text-gray-800"
            >
              {serviceAccountEmail}
            </span>
            <Button variant="secondary" className="px-2 py-1 text-xs" onClick={handleCopy}>
              Copy
            </Button>
          </div>
        </li>
        <li className="py-2 flex flex-col gap-2">
          <span className="font-medium">Step 3:</span>
          <form onSubmit={handleLink} className="flex flex-col sm:flex-row sm:gap-2 w-full">
            <input
              id="sheet-link"
              type="text"
              placeholder="Paste your Google Sheet link"
              value={sheetUrl}
              onChange={(event) => setSheetUrl(event.target.value)}
              disabled={linking}
              className="flex-1 min-w-0 rounded border border-gray-300 bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50 disabled:cursor-not-allowed"
            />
            <Button
              type="submit"
              loading={linking}
              disabled={linking || !sheetUrl.trim()}
            >
              Link sheet
            </Button>
          </form>
          {linkError && <p className="text-sm text-red-600">{linkError}</p>}
        </li>
      </ol>
    </Card>
  );
}
