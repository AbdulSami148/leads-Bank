"use client";

/**
 * Dashboard — the user's home page, driven by the account status from GET /me:
 * - pending:   "Waiting for approval" card, Refresh button + auto re-check
 *              every 30 seconds; switches to the active view on approval.
 * - suspended: "Account suspended" card, no actions.
 * - active:    quota hero card with a progress ring, Get Lead button, 5s
 *              polling while a job runs and a live countdown while locked.
 * All data comes from the backend API; Supabase is only used for the session.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ExternalLink, RefreshCw, Sparkles, User } from "lucide-react";
import { ApiError, getMe, getStatus, getSheetInfo, postGetLeads } from "@/lib/api";
import { wakeBackend } from "@/lib/api";
import { formatCountdown } from "@/lib/format";
import { useSessionGuard } from "@/lib/session";
import type { AccountStatus, LeadStatus, SheetInfo } from "@/lib/types";
import { SheetLinkForm } from "@/components/sheet-link-form";
import {
  Alert,
  Button,
  Card,
  CardHeader,
  ProgressBar,
  ProgressRing,
  Skeleton,
} from "@/components/ui";

type Notice = { text: string; kind: "info" | "success" | "error" } | null;

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
        if (error.status === 401) {
          router.replace("/login"); // session expired
          return;
        }
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
    // The guard redirects when not allowed; the layout frame shows skeletons
    // for the chrome — these fill the page area while the profile loads.
    return (
      <div className="space-y-6">
        <Card className="p-6 sm:p-8">
          <div className="flex flex-col items-center gap-8 sm:flex-row">
            <Skeleton className="h-[168px] w-[168px] rounded-full" />
            <div className="w-full space-y-4">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full max-w-sm" />
              <Skeleton className="h-12 w-full max-w-xs" />
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-4 h-10 w-full" />
        </Card>
      </div>
    );
  }

  const busy = running || starting;
  const hasSheet = !!sheetInfo?.sheet_url;
  const quota = status?.quota;
  const buttonDisabled = busy || !hasSheet || (quota ? !quota.can_request : true);

  return (
    <>
      {/* pending: waiting for approval, auto re-checked every 30s */}
      {accountStatus === "pending" && (
        <Card className="animate-slide-up space-y-4 p-8 text-center">
          <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-200/70">
            Waiting for approval
          </span>
          <p className="mx-auto max-w-md text-sm text-slate-600">
            Your account is being reviewed. You will get access once the admin
            approves it.
          </p>
          <Button
            variant="secondary"
            loading={rechecking}
            onClick={() => void recheckApproval()}
            className="mx-auto"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
            Refresh
          </Button>
        </Card>
      )}

      {/* suspended: no actions available */}
      {accountStatus === "suspended" && (
        <Card className="animate-slide-up space-y-3 p-8 text-center">
          <span className="inline-flex items-center rounded-full bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-inset ring-rose-200/70">
            Account suspended
          </span>
          <p className="text-sm text-slate-600">Account suspended — please contact the admin.</p>
        </Card>
      )}

      {/* active: the normal dashboard */}
      {accountStatus === "active" && (
        <div className="space-y-6">
          {/* welcome greeting */}
          <div className="flex items-center gap-3 rounded-xl bg-indigo-50 px-5 py-4 border border-indigo-100">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
              <User className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-slate-900">
                Welcome back, {profile?.username ?? profile?.email?.split("@")[0] ?? "there"}!
              </p>
              <p className="text-xs text-slate-500">
                Fresh leads are checked one by one and delivered straight into your Google Sheet.
              </p>
            </div>
          </div>

          {/* quota hero */}
          <Card className="animate-slide-up overflow-hidden">
            <div className="grid gap-8 p-6 sm:p-8 md:grid-cols-[auto,1fr] md:items-center">
              <div className="flex justify-center">
                {quota ? (
                  <ProgressRing value={quota.leads_today} max={quota.daily_quota} size={168} stroke={14}>
                    <span className="text-4xl font-semibold tracking-tight text-slate-900">
                      {quota.remaining}
                    </span>
                    <span className="mt-0.5 text-xs font-medium text-slate-500">
                      of {quota.daily_quota} left today
                    </span>
                  </ProgressRing>
                ) : (
                  <Skeleton className="h-[168px] w-[168px] rounded-full" />
                )}
              </div>

              <div className="space-y-5">
                <div>
                  <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                    Your daily quota
                  </h1>
                  <p className="mt-1 text-sm text-slate-500">
                    Fresh leads are checked one by one and delivered straight into your
                    Google Sheet.
                  </p>
                </div>

                {quota && (
                  <div>
                    <ProgressBar
                      value={quota.leads_today}
                      max={quota.daily_quota}
                      tone={quota.remaining === 0 ? "amber" : "indigo"}
                    />
                    <p className="mt-2 text-xs text-slate-500">
                      Used today: {quota.leads_today} · Daily quota: {quota.daily_quota}
                    </p>
                  </div>
                )}

                {/* running / locked / success / failed states */}
                {busy && (
                  <Alert kind="info">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
                        aria-hidden
                      />
                      Finding leads — this takes 1 to 3 minutes
                    </span>
                  </Alert>
                )}
                {!busy && notice && <Alert kind={notice.kind}>{notice.text}</Alert>}
                {!busy && status && !status.quota.can_request && countdown && (
                  <Alert kind="warning">Next leads in {countdown}</Alert>
                )}
                {!busy && !sheetLoading && !hasSheet && (
                  <Alert kind="warning">Link your Google Sheet first</Alert>
                )}

                <Button
                  size="lg"
                  className="w-full sm:w-auto"
                  loading={busy}
                  disabled={buttonDisabled}
                  onClick={handleGetLeads}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {busy ? "Finding leads…" : "Get Lead"}
                </Button>
              </div>
            </div>
          </Card>

          {/* Google Sheet connection */}
          <Card className="animate-slide-up p-6 sm:p-7">
            <CardHeader
              title="Google Sheet"
              description="Every delivered lead is appended to this spreadsheet."
            />

            <div className="mt-5">
              {sheetLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-6 w-44" />
                  <Skeleton className="h-4 w-full max-w-md" />
                </div>
              ) : sheetError ? (
                <Alert kind="error">
                  {sheetError}{" "}
                  <button
                    type="button"
                    onClick={() => void refreshSheetInfo()}
                    className="font-medium underline underline-offset-2"
                  >
                    Retry
                  </button>
                </Alert>
              ) : !sheetInfo?.sheet_url || showLinkForm ? (
                <SheetLinkForm
                  token={token!}
                  serviceAccountEmail={sheetInfo?.service_account_email ?? ""}
                  onLinked={handleSheetLinked}
                />
              ) : (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                      Sheet connected
                    </p>
                    <p className="mt-1 truncate text-xs text-slate-500">{sheetInfo.sheet_url}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Link
                      href={sheetInfo.sheet_url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-indigo-600 transition hover:bg-indigo-50 hover:text-indigo-700"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden />
                      Open sheet
                    </Link>
                    <Button variant="secondary" size="sm" onClick={() => setShowLinkForm(true)}>
                      Change sheet
                    </Button>
                  </div>
                </div>
              )}
        </div>
      </Card>
        </div>
      )}
    </>
  );
}
