"use client";

/**
 * Dashboard — the user's home page, driven by the account status from GET /me:
 * - pending:   "Waiting for approval" card, Refresh button + auto re-check
 *              every 30 seconds; switches to the active view on approval.
 * - suspended: "Account suspended" card, no actions.
 * - active:    quota card with progress bar, Get Lead button, 5s polling while
 *              a job runs and a live countdown while locked.
 * All data comes from the backend API; Supabase is only used for the session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ApiError, getMe, getStatus, getSheetInfo, postGetLeads } from "@/lib/api";
import { wakeBackend } from "@/lib/api";
import { formatCountdown } from "@/lib/format";
import { useSessionGuard } from "@/lib/session";
import type { AccountStatus, LeadStatus, SheetInfo } from "@/lib/types";
import { TopBar } from "@/components/topbar";
import { Button, Card, Skeleton } from "@/components/ui";
import { SheetLinkForm } from "@/components/sheet-link-form";

type Notice = { text: string; kind: "info" | "success" | "error" } | null;

const NOTICE_STYLES: Record<"info" | "success" | "error", string> = {
  info: "text-gray-600",
  success: "text-green-600",
  error: "text-red-600",
};

export default function DashboardPage() {
  const router = useRouter();
  // Wake a sleeping backend as soon as the page loads.
  useEffect(() => {
    wakeBackend();
  }, []);
  const { ready, token, profile } = useSessionGuard(false);
  const tokenRef = useRef<string | null>(null); // access token, kept out of re-renders
  tokenRef.current = token;
  const runningRef = useRef(false); // mirrors `running` inside async callbacks

  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(
    profile?.status ?? null,
  );
  const [status, setStatus] = useState<LeadStatus | null>(null);
  const [running, setRunning] = useState(false); // a job is in progress
  const [starting, setStarting] = useState(false); // POST /leads/get in flight
  const [rechecking, setRechecking] = useState(false); // approval re-check in flight
  const [notice, setNotice] = useState<Notice>(null);
  const [countdown, setCountdown] = useState<string | null>(null);
  const [sheetInfo, setSheetInfo] = useState<SheetInfo | null>(null);
  const [sheetLoading, setSheetLoading] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [showLinkForm, setShowLinkForm] = useState(false);

  // Keep the local status in sync with the profile from the guard.
  useEffect(() => {
    setAccountStatus(profile?.status ?? null);
  }, [profile?.status]);

  // --- approval re-check (pending accounts only) -------------------------------

  const recheckApproval = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken || rechecking) return;
    setRechecking(true);
    try {
      const me = await getMe(currentToken);
      setAccountStatus(me.status); // "active" switches to the normal dashboard
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/login"); // session expired
      }
      // Other errors: keep showing the waiting card; the next re-check retries.
    } finally {
      setRechecking(false);
    }
  }, [rechecking, router]);

  useEffect(() => {
    if (accountStatus !== "pending") return;
    const id = setInterval(() => void recheckApproval(), 30000); // auto re-check
    return () => clearInterval(id);
  }, [accountStatus, recheckApproval]);

  // --- refresh quota + job state from the backend (active accounts) -----------

  const refreshStatus = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    try {
      const next = await getStatus(currentToken);
      setStatus(next);
      const job = next.job;
      // Report the finished job only once (while we were watching it run).
      if (job?.status === "done" && runningRef.current) {
        runningRef.current = false;
        setRunning(false);
        setNotice({ text: `${job.delivered ?? 0} leads delivered`, kind: "success" });
      } else if (job?.status === "failed" && runningRef.current) {
        runningRef.current = false;
        setRunning(false);
        setNotice({
          text: job.error
            ? `The last job failed (${job.error}) — please try again.`
            : "The last job failed — please try again.",
          kind: "error",
        });
      } else if (!job || job.status === "done" || job.status === "failed") {
        runningRef.current = false;
        setRunning(false);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/login"); // session expired
      }
    }
  }, [router]);

  // --- refresh Google Sheet info (GET /sheet/info) ---------------------------

  const refreshSheetInfo = useCallback(async () => {
    const currentToken = tokenRef.current;
    if (!currentToken) return;
    setSheetLoading(true);
    setSheetError(null);
    try {
      const info = await getSheetInfo(currentToken);
      setSheetInfo(info);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        router.replace("/login"); // session expired
        return;
      }
      setSheetError(error instanceof Error ? error.message : "Failed to load sheet info.");
    } finally {
      setSheetLoading(false);
    }
  }, [router]);

  const handleSheetLinked = useCallback(async () => {
    await refreshSheetInfo();
    setShowLinkForm(false);
  }, [refreshSheetInfo]);

  // initial load once the session is known
  useEffect(() => {
    if (ready && accountStatus === "active") {
      void refreshStatus();
      void refreshSheetInfo();
    }
  }, [ready, accountStatus, refreshStatus, refreshSheetInfo]);

  // poll every 5s while a job is running
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => void refreshStatus(), 5000);
    return () => clearInterval(id);
  }, [running, refreshStatus]);

  // --- live countdown while the quota is locked ---------------------------------

  const lockedUntil = status?.quota.locked_until;
  const canRequest = status?.quota.can_request;
  useEffect(() => {
    if (!lockedUntil || canRequest) {
      setCountdown(null);
      return;
    }
    const target = new Date(lockedUntil).getTime();
    const tick = () => {
      const ms = target - Date.now();
      if (ms <= 0) {
        setCountdown(null);
        void refreshStatus(); // lock expired — refresh quota (no notice: not running)
      } else {
        setCountdown(formatCountdown(ms));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, canRequest, refreshStatus]);

  // --- actions ------------------------------------------------------------------

  async function handleGetLeads() {
    const currentToken = tokenRef.current;
    if (!currentToken || running || starting) return;
    setStarting(true);
    setNotice(null);
    try {
      await postGetLeads(currentToken);
      runningRef.current = true;
      setRunning(true);
      setNotice({ text: "Finding leads, this takes 1 to 3 minutes", kind: "info" });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          setNotice({ text: "Daily quota used up — try again after the countdown.", kind: "error" });
          await refreshStatus(); // picks up locked_until for the countdown
        } else if (error.status === 409) {
          // a job is already running — resume watching it instead of failing
          runningRef.current = true;
          setRunning(true);
          setNotice({ text: "A lead job is already running — waiting for it…", kind: "info" });
        } else if (error.status === 400 && /sheet/i.test(String(error.detail))) {
          setNotice({ text: "Link your Google Sheet first.", kind: "error" });
        } else {
          setNotice({ text: error.message || "Something went wrong.", kind: "error" });
        }
      } else {
        setNotice({ text: "Network error — is the API running?", kind: "error" });
      }
    } finally {
      setStarting(false);
    }
  }

  // --- render ------------------------------------------------------------------

  if (!ready) {
    // The guard redirects when not allowed; show skeletons while it works.
    return (
      <main className="min-h-screen">
        <TopBar showUsers={false} current="dashboard" />
        <div className="mx-auto max-w-md px-4 py-10">
          <Card className="p-6">
            <Skeleton className="h-10 w-40" />
            <Skeleton className="mt-4 h-2 w-full" />
            <Skeleton className="mt-6 h-12 w-full" />
          </Card>
        </div>
      </main>
    );
  }

  const busy = running || starting;
  const hasSheet = !!sheetInfo?.sheet_url;
  const buttonDisabled = busy || !hasSheet || (status ? !status.quota.can_request : true);
  const quota = status?.quota;

  return (
    <main className="min-h-screen">
      <TopBar
        showUsers={profile?.role === "admin"}
        current="dashboard"
        email={profile?.email}
      />

      <div className="mx-auto max-w-md px-4 py-10">
        {/* pending: waiting for approval, auto re-checked every 30s */}
        {accountStatus === "pending" && (
          <Card className="space-y-4 p-6 text-center">
            <span className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
              Waiting for approval
            </span>
            <p className="text-gray-600">
              Your account is being reviewed. You will get access once the admin
              approves it.
            </p>
            <Button variant="secondary" loading={rechecking} onClick={() => void recheckApproval()}>
              Refresh
            </Button>
          </Card>
        )}

        {/* suspended: no actions available */}
        {accountStatus === "suspended" && (
          <Card className="space-y-3 p-6 text-center">
            <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
              Account suspended
            </span>
            <p className="text-gray-600">Account suspended, contact the admin.</p>
          </Card>
        )}

        {/* active: the normal dashboard */}
        {accountStatus === "active" && (
          <Card className="space-y-5 p-6">
            {/* Google Sheet link (above the quota card until a sheet is linked) */}
            {sheetLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-44" />
                <Skeleton className="h-2 w-full" />
              </div>
            ) : sheetError ? (
              <p className="text-sm text-red-600">
                {sheetError}{" "}
                <span
                  onClick={() => void refreshSheetInfo()}
                  className="underline cursor-pointer"
                >
                  Retry
                </span>
              </p>
            ) : !sheetInfo?.sheet_url || showLinkForm ? (
              <SheetLinkForm
                token={token!}
                serviceAccountEmail={sheetInfo?.service_account_email ?? ""}
                onLinked={handleSheetLinked}
              />
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <span className="text-sm text-gray-600">Sheet connected</span>
                <div className="flex items-center gap-2">
                  <Link
                    href={sheetInfo.sheet_url!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-blue-600 hover:underline"
                  >
                    Open sheet
                  </Link>
                  <Button
                    variant="secondary"
                    className="px-2 py-1 text-xs"
                    onClick={() => setShowLinkForm(true)}
                  >
                    Change sheet
                  </Button>
                </div>
              </div>
            )}

            {/* quota + progress bar (used / daily quota) */}
            {quota ? (
              <>
                <div>
                  <p className="text-sm text-gray-500">Remaining leads</p>
                  <p className="text-3xl font-semibold">
                    {quota.remaining} <span className="text-lg text-gray-400">/ {quota.daily_quota}</span>
                  </p>
                </div>
                <div>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>Used today: {quota.leads_today}</span>
                    <span>Quota: {quota.daily_quota}</span>
                  </div>
                  <div className="mt-1 h-2 rounded-full bg-gray-100">
                    <div
                      className="h-2 rounded-full bg-blue-600 transition-all"
                      style={{
                        width: `${Math.min(100, Math.round((quota.leads_today / Math.max(1, quota.daily_quota)) * 100))}%`,
                      }}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                <Skeleton className="h-10 w-44" />
                <Skeleton className="h-2 w-full" />
              </div>
            )}

            {/* status area: running / success / failed / locked */}
            {busy && (
              <p className="flex items-center gap-2 text-sm text-gray-600">
                <span
                  className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent"
                  aria-hidden
                />
                Finding leads, this takes 1 to 3 minutes
              </p>
            )}
            {!busy && notice && <p className={`text-sm ${NOTICE_STYLES[notice.kind]}`}>{notice.text}</p>}
            {status && !status.quota.can_request && countdown && (
              <p className="text-sm font-medium text-amber-600">Next leads in {countdown}</p>
            )}

            {!busy && !sheetLoading && !hasSheet && (
              <p className="text-sm text-gray-500">Link your Google Sheet first</p>
            )}

            {/* prominent Get Lead button — disabled while running or locked */}
            <Button
              className="w-full py-3 text-base"
              loading={busy}
              disabled={buttonDisabled}
              onClick={handleGetLeads}
            >
              Get Lead
            </Button>
          </Card>
        )}
      </div>
    </main>
  );
}
