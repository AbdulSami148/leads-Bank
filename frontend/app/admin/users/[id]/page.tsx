"use client";

/**
 * User activity page (/admin/users/[id]): status card with quota numbers and
 * a live cooldown countdown, a 30-day daily history table and the user's
 * recent lead jobs. Admins only (useSessionGuard).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, ListChecks, RotateCcw } from "lucide-react";
import {
  adminResetWindow,
  adminUpdateUser,
  describeError,
  getAdminUserActivity,
  isAuthError,
} from "@/lib/api";
import { formatCountdown, formatTime } from "@/lib/format";
import { useSessionGuard } from "@/lib/session";
import type { DailyBucket, UserActivity } from "@/lib/types";
import { useToast } from "@/components/toast";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Skeleton,
  Toggle,
  type BadgeKind,
} from "@/components/ui";

/** Badge kind for one daily row: Failed wins, then Partial, then Complete. */
function dailyBadgeKind(day: DailyBucket): BadgeKind {
  if (day.failed_jobs > 0) return "failed";
  if (day.pending > 0) return "partial";
  return "complete";
}

/** One labeled number inside the status card. */
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
    </div>
  );
}

export default function UserActivityPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const router = useRouter();
  const { ready, token } = useSessionGuard(true);
  const toast = useToast();

  const [activity, setActivity] = useState<UserActivity | null>(null);
  const [loaded, setLoaded] = useState(false); // first data load finished
  const [loadError, setLoadError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false); // a PATCH / reset-window is in flight
  const [confirmReset, setConfirmReset] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);

  // --- data loading -----------------------------------------------------------

  const load = useCallback(async () => {
    if (!token || !userId) return;
    try {
      const next = await getAdminUserActivity(token, userId);
      setActivity(next);
      setLoadError(null);
      setLoaded(true);
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login"); // session expired mid-use
        return;
      }
      setLoaded(true);
      setLoadError(describeError(error));
    }
  }, [token, userId, router]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  // --- live countdown while the account is locked ------------------------------

  const quotaState = activity?.quota_state ?? null;
  const lockedUntil = quotaState?.locked_until ?? null;
  const canRequest = quotaState?.can_request ?? false;

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
        void load(); // lock expired — refresh the quota state
      } else {
        setCountdown(formatCountdown(ms));
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockedUntil, canRequest, load]);

  // --- actions ------------------------------------------------------------------

  /** PATCH the cooldown toggle immediately when it flips. */
  async function patchCooldown(enabled: boolean) {
    if (!token || !userId || busy) return;
    setBusy(true);
    try {
      await adminUpdateUser(token, userId, { cooldown_enabled: enabled });
      toast("success", `Cooldown ${enabled ? "enabled" : "disabled"}.`);
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login");
        return;
      }
      toast("error", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  /** POST reset-window ("Remove cooldown") after the ConfirmDialog. */
  async function resetWindow() {
    if (!token || !userId || busy) return;
    setBusy(true);
    try {
      await adminResetWindow(token, userId);
      toast("success", "Cooldown removed — the quota window was reset.");
      setConfirmReset(false);
      await load();
    } catch (error) {
      if (isAuthError(error)) {
        router.replace("/login");
        return;
      }
      toast("error", describeError(error));
    } finally {
      setBusy(false);
    }
  }

  // --- render -------------------------------------------------------------------

  const userProfile = activity?.profile ?? null;

  return (
    <>
      <Link
        href="/admin"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to users
      </Link>

      <header className="mt-3 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 break-all">
          {loaded && userProfile
            ? userProfile.username ?? userProfile.email ?? userProfile.id
            : "User activity"}
        </h1>
        {userProfile && <Badge kind={userProfile.status} />}
      </header>
      {userProfile?.username && userProfile.email && (
        <p className="mt-1 truncate text-sm text-slate-500" title={userProfile.email}>
          {userProfile.email}
        </p>
      )}

      {loadError ? (
        <Card className="mt-6">
          <EmptyState
            title="Could not load this user"
            description={loadError}
            action={
              <Button variant="secondary" onClick={() => void load()}>
                Try again
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* current status card */}
          <Card className="mt-6 p-6 sm:p-7">
            {!loaded || !quotaState || !userProfile ? (
              <div className="grid gap-4 sm:grid-cols-3">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Metric label="Daily quota" value={quotaState.daily_quota} />
                  <Metric label="Used today" value={quotaState.leads_today} />
                  <Metric label="Remaining" value={quotaState.remaining} />
                </div>
                <div className="mt-5 flex flex-col gap-4 border-t border-slate-100 pt-5 lg:flex-row lg:items-center">
                  <div className="flex-1">
                    {quotaState.can_request ? (
                      <Alert kind="success">Ready to fetch leads</Alert>
                    ) : countdown ? (
                      <Alert kind="warning">Next leads in {countdown}</Alert>
                    ) : (
                      <Alert kind="warning">
                        No leads left — waiting for the window to reset.
                      </Alert>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Toggle
                        checked={userProfile.cooldown_enabled}
                        disabled={busy}
                        label={`Cooldown for ${userProfile.email ?? userProfile.id}`}
                        onChange={(checked) => void patchCooldown(checked)}
                      />
                      <span className="text-sm text-slate-500">
                        Cooldown {userProfile.cooldown_enabled ? "on" : "off"}
                      </span>
                    </div>
                    <Button
                      variant="secondary"
                      loading={busy}
                      onClick={() => setConfirmReset(true)}
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden />
                      Remove cooldown
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>

          {/* daily history (last 30 days, newest first) */}
          <Card className="mt-6 overflow-hidden">
            <div className="px-6 pt-6">
              <CardHeader
                title="Daily history"
                description="The last 30 days that had lead jobs."
              />
            </div>
            <div className="scroll-slim mt-4 overflow-x-auto">
              {!loaded || !activity ? (
                <div className="space-y-3 px-6 pb-6">
                  {[0, 1, 2, 3].map((row) => (
                    <Skeleton key={row} className="h-9 w-full" />
                  ))}
                </div>
              ) : (
                (() => {
                  // Only days that actually had jobs; zero days are hidden.
                  const activeDays = activity.daily.filter((day) => day.jobs > 0);
                  if (activeDays.length === 0) {
                    return (
                      <EmptyState
                        title="No activity yet"
                        description="This user has not fetched any leads in the last 30 days."
                        icon={CalendarDays}
                      />
                    );
                  }
                  return (
                    <table className="w-full min-w-[600px] text-left text-sm">
                      <thead>
                        <tr className="border-y border-slate-200 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                          <th className="px-6 py-3 font-medium">Date</th>
                          <th className="px-4 py-3 font-medium">Jobs</th>
                          <th className="px-4 py-3 font-medium">Requested</th>
                          <th className="px-4 py-3 font-medium">Delivered</th>
                          <th className="px-4 py-3 font-medium">Pending</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activeDays.map((day) => (
                          <tr key={day.date} className="border-b border-slate-100 last:border-0">
                            <td className="whitespace-nowrap px-6 py-3 text-slate-700">{day.date}</td>
                            <td className="px-4 py-3 tabular-nums text-slate-700">{day.jobs}</td>
                            <td className="px-4 py-3 tabular-nums text-slate-700">{day.requested}</td>
                            <td className="px-4 py-3 tabular-nums text-slate-700">{day.delivered}</td>
                            <td className="px-4 py-3 tabular-nums text-slate-700">{day.pending}</td>
                            <td className="px-4 py-3">
                              <Badge kind={dailyBadgeKind(day)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()
              )}
            </div>
          </Card>

          {/* recent jobs (newest first) */}
          <Card className="mb-2 mt-6 overflow-hidden">
            <div className="px-6 pt-6">
              <CardHeader title="Recent jobs" description="The latest lead jobs of this user." />
            </div>
            <div className="scroll-slim mt-4 overflow-x-auto">
              {!loaded || !activity ? (
                <div className="space-y-3 px-6 pb-6">
                  {[0, 1, 2].map((row) => (
                    <Skeleton key={row} className="h-9 w-full" />
                  ))}
                </div>
              ) : activity.jobs.length === 0 ? (
                <EmptyState
                  title="No jobs yet"
                  description="This user has not fetched any leads."
                  icon={ListChecks}
                />
              ) : (
                <table className="w-full min-w-[600px] text-left text-sm">
                  <thead>
                    <tr className="border-y border-slate-200 bg-slate-50/70 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-6 py-3 font-medium">Time</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Requested</th>
                      <th className="px-4 py-3 font-medium">Delivered</th>
                      <th className="px-4 py-3 font-medium">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activity.jobs.map((job) => (
                      <tr key={job.id} className="border-b border-slate-100 last:border-0">
                        <td className="whitespace-nowrap px-6 py-3 text-slate-700">
                          {formatTime(job.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge kind={job.status} />
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-700">
                          {job.requested ?? "—"}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-slate-700">{job.delivered}</td>
                        <td className="px-4 py-3 break-all text-slate-600">{job.error ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </Card>
        </>
      )}

      {/* remove-cooldown confirmation */}
      <ConfirmDialog
        open={confirmReset}
        title="Remove cooldown"
        message={`Reset the quota window for ${
          userProfile?.email ?? "this user"
        }? Leads today will be set to 0 and the account can fetch again right away.`}
        confirmLabel="Remove cooldown"
        danger
        loading={busy}
        onConfirm={() => void resetWindow()}
        onCancel={() => !busy && setConfirmReset(false)}
      />
    </>
  );
}
